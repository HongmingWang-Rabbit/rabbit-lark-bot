/**
 * DB-backed session store (PostgreSQL)
 *
 * Replaces the in-memory Map so sessions survive server restarts.
 * Sessions expire automatically via expires_at; cleanup() prunes stale rows.
 */

const pool = require('./pool');
const logger = require('../utils/logger');

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Write or overwrite a session.
 * @param {string} key  - session key (openId or senderId)
 * @param {object} data - arbitrary JSON-serializable payload
 */
async function set(key, data) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO user_sessions (session_key, data, expires_at)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (session_key) DO UPDATE
       SET data = $2::jsonb, expires_at = $3`,
    [key, JSON.stringify(data), expiresAt]
  );
}

/**
 * Read a session. Returns null if not found or expired.
 * @param {string} key
 * @returns {Promise<object|null>}
 */
async function get(key) {
  const result = await pool.query(
    `SELECT data FROM user_sessions
     WHERE session_key = $1 AND expires_at > NOW()`,
    [key]
  );
  return result.rows[0]?.data ?? null;
}

/**
 * Delete a session.
 * @param {string} key
 */
async function del(key) {
  await pool.query('DELETE FROM user_sessions WHERE session_key = $1', [key]);
}

/**
 * Remove all expired sessions. Call periodically.
 * @returns {Promise<number>} rows deleted
 */
async function cleanup() {
  const result = await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
  if (result.rowCount > 0) {
    logger.debug('Session cleanup', { deleted: result.rowCount });
  }
  return result.rowCount;
}

module.exports = { set, get, del, cleanup, SESSION_TTL_MS };
