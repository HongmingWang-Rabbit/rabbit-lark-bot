/**
 * Users DB module
 *
 * Handles all CRUD for the users table.
 * Each user has a role (superadmin/admin/user) and a configs JSONB field
 * that stores per-user feature overrides.
 */

const pool = require('./pool');
const { validateConfigs } = require('../features');
const logger = require('../utils/logger');

const VALID_ROLES = ['superadmin', 'admin', 'user'];

const users = {
  /**
   * Find a user by user_id or open_id.
   * Returns null if not found.
   */
  async get(userId, openId = null) {
    const result = await pool.query(
      `SELECT * FROM users
       WHERE user_id = $1 OR ($2::varchar IS NOT NULL AND open_id = $2)
       LIMIT 1`,
      [userId, openId]
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
   * Upsert a user (insert or update on conflict).
   * Only provided fields are updated.
   */
  async upsert({ userId, openId, name, email, role = 'user', configs }) {
    if (!userId) throw new Error('userId is required');
    if (role && !VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`);
    }

    const safeConfigs = configs ? validateConfigs(configs) : undefined;

    const result = await pool.query(
      `INSERT INTO users (user_id, open_id, name, email, role, configs)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         open_id   = COALESCE($2, users.open_id),
         name      = COALESCE($3, users.name),
         email     = COALESCE($4, users.email),
         role      = COALESCE($5, users.role),
         configs   = CASE WHEN $6::jsonb IS NOT NULL
                          THEN $6::jsonb
                          ELSE users.configs END
       RETURNING *`,
      [
        userId,
        openId ?? null,
        name ?? null,
        email ?? null,
        role,
        safeConfigs ? JSON.stringify(safeConfigs) : null,
      ]
    );
    return result.rows[0];
  },

  /**
   * Update only the configs field for a user.
   * Merges deeply: existing keys not in newConfigs are preserved.
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
   * Set a single feature toggle for a user.
   */
  async setFeature(userId, featureId, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    const result = await pool.query(
      `UPDATE users
       SET configs = jsonb_set(
           configs,
           '{features, ${featureId}}',
           $2::jsonb,
           true
         )
       WHERE user_id = $1
       RETURNING *`,
      [userId, JSON.stringify(enabled)]
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
   * Auto-provision a user on first seen (role: 'user', empty configs).
   * Returns existing user if already present.
   */
  async autoProvision({ userId, openId, name }) {
    const existing = await users.get(userId, openId);
    if (existing) return existing;

    logger.info('Auto-provisioning new user', { userId, name });
    return users.upsert({ userId, openId, name, role: 'user', configs: {} });
  },
};

module.exports = users;
