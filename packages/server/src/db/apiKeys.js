/**
 * Agent API keys DB module
 *
 * Manages DB-backed API keys for agent authentication.
 * Keys are stored as SHA-256 hashes — the raw key is only returned once at creation.
 */

const pool = require('./pool');

const apiKeys = {
  /**
   * Create a new API key record.
   * @param {string} name - Human-readable label
   * @param {string} keyHash - SHA-256 hex of the raw key
   * @param {string} keyPrefix - First 8 chars for display (e.g. "rlk_abcd")
   * @param {string} createdBy - user_id of creator
   * @returns {Promise<object>} Created row
   */
  async create(name, keyHash, keyPrefix, createdBy) {
    const result = await pool.query(
      `INSERT INTO agent_api_keys (name, key_hash, key_prefix, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, key_prefix, created_by, created_at`,
      [name, keyHash, keyPrefix, createdBy]
    );
    return result.rows[0];
  },

  /**
   * Find an active (non-revoked) key by its hash.
   * @param {string} keyHash - SHA-256 hex
   * @returns {Promise<object|null>}
   */
  async findByHash(keyHash) {
    const result = await pool.query(
      `SELECT id, name, key_prefix, created_by, created_at, last_used_at
       FROM agent_api_keys
       WHERE key_hash = $1 AND revoked_at IS NULL`,
      [keyHash]
    );
    return result.rows[0] || null;
  },

  /**
   * List all keys (hash never returned).
   * @returns {Promise<object[]>}
   */
  async list() {
    const result = await pool.query(
      `SELECT id, name, key_prefix, created_by, created_at, last_used_at, revoked_at
       FROM agent_api_keys
       ORDER BY created_at DESC`
    );
    return result.rows;
  },

  /**
   * Soft-revoke a key by setting revoked_at.
   * @param {number} id
   * @returns {Promise<object|null>}
   */
  async revoke(id) {
    const result = await pool.query(
      `UPDATE agent_api_keys SET revoked_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING id, name, key_prefix, revoked_at`,
      [id]
    );
    return result.rows[0] || null;
  },

  /**
   * Update last_used_at timestamp (fire-and-forget).
   * @param {number} id
   */
  async touchLastUsed(id) {
    await pool.query(
      'UPDATE agent_api_keys SET last_used_at = NOW() WHERE id = $1',
      [id]
    );
  },
};

module.exports = apiKeys;
