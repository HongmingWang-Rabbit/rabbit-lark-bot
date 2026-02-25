const { Pool } = require('pg');
const logger = require('../utils/logger');

// 连接池配置
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 10,           // 最大连接数
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000, // 空闲超时
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT, 10) || 5000, // 连接超时
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT, 10) || 10000, // 查询超时
});

pool.on('error', (err) => {
  logger.error('Database pool error', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

// ============ Admin 操作 ============
const admins = {
  async isAdmin(userId, email) {
    const result = await pool.query(
      'SELECT 1 FROM admins WHERE user_id = $1 OR email = $2 LIMIT 1',
      [userId, email]
    );
    return result.rows.length > 0;
  },

  async get(userId, email) {
    const result = await pool.query(
      'SELECT * FROM admins WHERE user_id = $1 OR email = $2 LIMIT 1',
      [userId, email]
    );
    return result.rows[0] || null;
  },

  async add({ userId, email, name, role = 'admin' }) {
    // 如果有 userId，用 userId 做 upsert；否则用 email
    if (userId) {
      const result = await pool.query(
        `INSERT INTO admins (user_id, email, name, role) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (user_id) DO UPDATE SET email = COALESCE($2, admins.email), name = COALESCE($3, admins.name), role = $4
         RETURNING *`,
        [userId, email, name, role]
      );
      return result.rows[0];
    } else if (email) {
      const result = await pool.query(
        `INSERT INTO admins (user_id, email, name, role) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (email) DO UPDATE SET user_id = COALESCE($1, admins.user_id), name = COALESCE($3, admins.name), role = $4
         RETURNING *`,
        [userId, email, name, role]
      );
      return result.rows[0];
    }
    throw new Error('Either userId or email is required');
  },

  async remove(userId) {
    const result = await pool.query(
      'DELETE FROM admins WHERE user_id = $1 RETURNING *',
      [userId]
    );
    return result.rows[0];
  },

  async list() {
    const result = await pool.query(
      'SELECT * FROM admins ORDER BY created_at'
    );
    return result.rows;
  }
};

// ============ Settings 操作 ============
const settings = {
  async get(key) {
    const result = await pool.query(
      'SELECT value FROM settings WHERE key = $1',
      [key]
    );
    return result.rows[0]?.value;
  },

  async set(key, value, description) {
    await pool.query(
      `INSERT INTO settings (key, value, description) 
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, description = COALESCE($3, settings.description)`,
      [key, JSON.stringify(value), description]
    );
  },

  async getAll() {
    const result = await pool.query('SELECT key, value, description FROM settings');
    return result.rows;
  },

  async delete(key) {
    await pool.query('DELETE FROM settings WHERE key = $1', [key]);
  }
};

// ============ Audit Log 操作 ============
const audit = {
  async log({ userId, action, targetType, targetId, details }) {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, targetType, targetId, JSON.stringify(details)]
    );
  },

  async list({ limit = 50, offset = 0, userId, action } = {}) {
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (userId) {
      query += ` AND user_id = $${paramIndex++}`;
      params.push(userId);
    }
    if (action) {
      query += ` AND action = $${paramIndex++}`;
      params.push(action);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }
};

module.exports = { pool, admins, settings, audit };
