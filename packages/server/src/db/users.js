/**
 * Users DB module
 *
 * Handles all CRUD for the users table.
 * Each user has a role (superadmin/admin/user) and a configs JSONB field
 * that stores per-user feature overrides.
 *
 * Identity model:
 *   user_id       = canonical ID (email if known, else Feishu user_id)
 *   email         = human-readable identifier; used for admin provisioning
 *   open_id       = Feishu open_id (ou_xxx) for sending messages
 *   feishu_user_id = Feishu internal user_id (on_xxx) from webhook sender_id
 */

const pool = require('./pool');
const { validateConfigs } = require('../features');
const logger = require('../utils/logger');

const VALID_ROLES = ['superadmin', 'admin', 'user'];

const users = {
  /**
   * Find a user by any known identifier.
   * Priority: open_id > email > feishu_user_id > user_id
   */
  async get(userId, openId = null) {
    const result = await pool.query(
      `SELECT * FROM users
       WHERE user_id = $1
          OR ($2::varchar IS NOT NULL AND open_id = $2)
       LIMIT 1`,
      [userId, openId]
    );
    return result.rows[0] || null;
  },

  /** Find by open_id (Feishu ou_xxx) */
  async findByOpenId(openId) {
    if (!openId) return null;
    const result = await pool.query(
      'SELECT * FROM users WHERE open_id = $1 LIMIT 1',
      [openId]
    );
    return result.rows[0] || null;
  },

  /** Find by email */
  async findByEmail(email) {
    if (!email) return null;
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 LIMIT 1',
      [email]
    );
    return result.rows[0] || null;
  },

  /** Find by Feishu user_id (on_xxx) stored in feishu_user_id column */
  async findByFeishuUserId(feishuUserId) {
    if (!feishuUserId) return null;
    const result = await pool.query(
      'SELECT * FROM users WHERE feishu_user_id = $1 LIMIT 1',
      [feishuUserId]
    );
    return result.rows[0] || null;
  },

  /**
   * Get by user_id only (strict).
   */
  async getById(userId) {
    const result = await pool.query(
      'SELECT * FROM users WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    return result.rows[0] || null;
  },

  /**
   * Link Feishu IDs to an existing user record (when email was pre-provisioned).
   */
  async linkFeishuIds(userId, { openId, feishuUserId }) {
    const result = await pool.query(
      `UPDATE users
       SET open_id         = COALESCE(open_id, $2),
           feishu_user_id  = COALESCE(feishu_user_id, $3)
       WHERE user_id = $1
       RETURNING *`,
      [userId, openId ?? null, feishuUserId ?? null]
    );
    return result.rows[0] || null;
  },

  /**
   * Upsert a user (insert or update on conflict).
   * Only provided fields are updated.
   */
  async upsert({ userId, openId, name, email, phone, role = 'user', configs, feishuUserId }) {
    if (!userId) throw new Error('userId is required');
    if (role && !VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`);
    }

    // Default to empty object — never pass NULL for configs (NOT NULL constraint)
    const safeConfigs = validateConfigs(configs ?? {});

    const result = await pool.query(
      `INSERT INTO users (user_id, open_id, name, email, phone, role, configs, feishu_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET
         open_id         = COALESCE($2, users.open_id),
         name            = COALESCE($3, users.name),
         email           = COALESCE($4, users.email),
         phone           = COALESCE($5, users.phone),
         role            = COALESCE($6, users.role),
         configs         = CASE WHEN $7::jsonb IS NOT NULL
                                THEN $7::jsonb
                                ELSE users.configs END,
         feishu_user_id  = COALESCE($8, users.feishu_user_id)
       RETURNING *`,
      [
        userId,
        openId ?? null,
        name ?? null,
        email ?? null,
        phone ?? null,
        role,
        JSON.stringify(safeConfigs),
        feishuUserId ?? null,
      ]
    );
    return result.rows[0];
  },

  /**
   * Update only the configs field for a user.
   */
  async updateConfigs(userId, newConfigs) {
    const safeConfigs = validateConfigs(newConfigs);
    const result = await pool.query(
      `UPDATE users
       SET configs = configs || $2::jsonb
       WHERE user_id = $1
       RETURNING *`,
      [userId, JSON.stringify(safeConfigs)]
    );
    if (!result.rows[0]) throw new Error(`User not found: ${userId}`);
    return result.rows[0];
  },

  /**
   * Update profile fields (name, email, phone). Only updates fields that are provided.
   */
  async updateProfile(userId, { name, email, phone }) {
    const result = await pool.query(
      `UPDATE users SET
         name  = CASE WHEN $2::varchar IS NOT NULL THEN $2 ELSE name END,
         email = CASE WHEN $3::varchar IS NOT NULL THEN $3 ELSE email END,
         phone = CASE WHEN $4::varchar IS NOT NULL THEN $4 ELSE phone END
       WHERE user_id = $1
       RETURNING *`,
      [userId, name ?? null, email ?? null, phone ?? null]
    );
    if (!result.rows[0]) throw new Error(`User not found: ${userId}`);
    return result.rows[0];
  },

  /**
   * Set a single feature toggle for a user.
   * featureId must be validated (alphanumeric + underscore) before calling.
   */
  async setFeature(userId, featureId, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    // Guard: featureId must be safe for jsonb path (alphanumeric + underscore only)
    if (!/^[a-z0-9_]+$/i.test(featureId)) {
      throw new Error(`Invalid featureId: ${featureId}`);
    }
    // jsonb_set path cannot be fully parameterized in pg; featureId is validated above
    const result = await pool.query(
      `UPDATE users
       SET configs = jsonb_set(
           configs,
           $3::text[],
           $2::jsonb,
           true
         )
       WHERE user_id = $1
       RETURNING *`,
      [userId, JSON.stringify(enabled), `{features,${featureId}}`]
    );
    if (!result.rows[0]) throw new Error(`User not found: ${userId}`);
    return result.rows[0];
  },

  /**
   * Update role.
   */
  async setRole(userId, role) {
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }
    const result = await pool.query(
      'UPDATE users SET role = $2 WHERE user_id = $1 RETURNING *',
      [userId, role]
    );
    if (!result.rows[0]) throw new Error(`User not found: ${userId}`);
    return result.rows[0];
  },

  /**
   * Remove a user.
   */
  async remove(userId) {
    const result = await pool.query(
      'DELETE FROM users WHERE user_id = $1 RETURNING *',
      [userId]
    );
    return result.rows[0] || null;
  },

  /**
   * List all users, optionally filtered by role.
   */
  async list({ role, limit = 100, offset = 0 } = {}) {
    let query = 'SELECT * FROM users WHERE 1=1';
    const params = [];
    let idx = 1;
    if (role) {
      query += ` AND role = $${idx++}`;
      params.push(role);
    }
    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  },

  /**
   * Check if a user exists and has admin or superadmin role.
   */
  async isAdmin(userId) {
    const result = await pool.query(
      `SELECT 1 FROM users WHERE user_id = $1 AND role IN ('admin','superadmin') LIMIT 1`,
      [userId]
    );
    return result.rows.length > 0;
  },

  /**
   * Auto-provision a user on first contact.
   *
   * Lookup order:
   *   1. open_id match          → link feishu_user_id if missing, return
   *   2. email match            → link open_id + feishu_user_id, return
   *   3. feishu_user_id match   → return
   *   4. Create new user:
   *        user_id = email (if resolved) or feishuUserId
   *
   * @param {object} opts
   * @param {string} opts.openId        - Feishu open_id (ou_xxx)
   * @param {string} [opts.email]       - resolved email (may be null if no contact perm)
   * @param {string} [opts.name]        - resolved display name
   * @param {string} [opts.feishuUserId] - Feishu user_id from webhook (on_xxx)
   */
  async autoProvision({ openId, email, phone, name, feishuUserId }) {
    /**
     * Fill in any missing fields (feishu_user_id, phone) for a user we already know.
     * Uses COALESCE logic — only updates NULL columns.
     */
    async function enrich(user) {
      const needsUpdate =
        (!user.feishu_user_id && feishuUserId) ||
        (!user.open_id && openId) ||
        (!user.phone && phone) ||
        (!user.name && name) ||
        (!user.email && email);

      if (!needsUpdate) return user;

      const result = await pool.query(
        `UPDATE users SET
           feishu_user_id = COALESCE(feishu_user_id, $2),
           open_id        = COALESCE(open_id, $3),
           phone          = COALESCE(phone, $4),
           name           = COALESCE(name, $5),
           email          = COALESCE(email, $6)
         WHERE user_id = $1
         RETURNING *`,
        [user.user_id, feishuUserId ?? null, openId ?? null, phone ?? null, name ?? null, email ?? null]
      );
      return result.rows[0] || user;
    }

    // 1. Fast path: already linked by open_id
    const byOpenId = await users.findByOpenId(openId);
    if (byOpenId) return enrich(byOpenId);

    // 2. Admin pre-provisioned by email
    if (email) {
      const byEmail = await users.findByEmail(email);
      if (byEmail) {
        logger.info('Linking Feishu IDs to pre-provisioned email user', { email, openId, feishuUserId });
        return enrich(byEmail);
      }
    }

    // 3. Previously auto-provisioned without email
    if (feishuUserId) {
      const byFeishu = await users.findByFeishuUserId(feishuUserId);
      if (byFeishu) return enrich(byFeishu);
    }

    // 4. Create new user
    const newUserId = email || feishuUserId || openId;
    logger.info('Auto-provisioning new user', { newUserId, email, openId, feishuUserId, hasPhone: !!phone });
    return users.upsert({
      userId: newUserId,
      openId,
      email: email || null,
      phone: phone || null,
      name: name || null,
      feishuUserId: feishuUserId || null,
      role: 'user',
      configs: {},
    });
  },
};

module.exports = users;
