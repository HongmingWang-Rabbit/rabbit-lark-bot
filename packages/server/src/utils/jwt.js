const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('./logger');

const JWT_COOKIE_NAME = 'rlk_session';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    logger.error('JWT_SECRET not set in production — sessions will not work');
  } else {
    logger.warn('JWT_SECRET not set — using random secret (sessions lost on restart)');
  }
  // Fallback: random secret per process (dev only)
  if (!getSecret._fallback) {
    getSecret._fallback = crypto.randomBytes(32).toString('hex');
  }
  return getSecret._fallback;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * Sign a JWT with the configured secret.
 * @param {object} payload - Claims to include (sub, name, role, etc.)
 * @returns {string} Signed JWT
 */
function signJwt(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' });
}

/**
 * Verify and decode a JWT.
 * @param {string} token
 * @returns {object|null} Decoded payload or null if invalid/expired
 */
function verifyJwt(token) {
  try {
    return jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

module.exports = { signJwt, verifyJwt, JWT_COOKIE_NAME, COOKIE_OPTIONS };
