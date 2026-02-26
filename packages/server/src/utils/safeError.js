/**
 * Return a production-safe error message.
 * In production, hides internal details; in dev, passes through err.message.
 *
 * @param {Error} err
 * @param {string} [fallback='Internal server error'] - generic message for production
 * @returns {string}
 */
function safeErrorMessage(err, fallback = 'Internal server error') {
  return process.env.NODE_ENV === 'production' ? fallback : (err.message || fallback);
}

module.exports = { safeErrorMessage };
