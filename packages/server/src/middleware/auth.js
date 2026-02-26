const crypto = require('crypto');
const { admins } = require('../db');
const logger = require('../utils/logger');

/**
 * 验证飞书 webhook 签名
 * @see https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN
 */
function verifyFeishuSignature(timestamp, nonce, rawBody, signature) {
  const encryptKey = process.env.FEISHU_ENCRYPT_KEY;
  if (!encryptKey) {
    logger.warn('FEISHU_ENCRYPT_KEY not set, skipping signature verification');
    return true; // 开发环境可以跳过
  }

  // Use raw body bytes to avoid JSON.stringify key-ordering / whitespace differences.
  // rawBody should be a Buffer set by express.json({ verify }) in index.js.
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(rawBody);
  const content = timestamp + nonce + encryptKey + bodyStr;
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  if (!signature || hash.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

/**
 * 飞书 Webhook 签名验证中间件
 */
function feishuWebhookAuth(req, res, next) {
  // URL 验证请求不需要签名（明文或加密体）
  if (req.body?.type === 'url_verification') {
    return next();
  }
  // Encrypted payloads skip signature verification here because decryption
  // itself acts as authentication — only the holder of FEISHU_ENCRYPT_KEY can
  // produce a valid ciphertext. The webhook handler will reject any payload
  // that fails AES-256-CBC decryption.
  // Guard: only allow encrypt bypass if FEISHU_ENCRYPT_KEY is actually configured
  if (req.body?.encrypt && process.env.FEISHU_ENCRYPT_KEY) {
    return next();
  }

  const timestamp = req.headers['x-lark-request-timestamp'];
  const nonce = req.headers['x-lark-request-nonce'];
  const signature = req.headers['x-lark-signature'];

  if (process.env.FEISHU_ENCRYPT_KEY && (!timestamp || !nonce || !signature)) {
    logger.warn('Missing Feishu signature headers');
    return res.status(401).json({ error: 'Missing signature headers' });
  }

  if (!verifyFeishuSignature(timestamp, nonce, req.rawBody || req.body, signature)) {
    logger.warn('Invalid Feishu signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

/**
 * API 身份验证中间件
 * 支持 Bearer token 或 API key
 */
async function apiAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'];

    // 开发环境可以跳过认证
    if (process.env.NODE_ENV === 'development' && !process.env.REQUIRE_AUTH) {
      return next();
    }

    const expectedKey = process.env.API_KEY;

    // Guard: refuse all requests if API_KEY is not configured (except explicit dev mode)
    if (!expectedKey) {
      if (process.env.NODE_ENV === 'production') {
        logger.error('API_KEY not set in production — rejecting request');
        return res.status(500).json({ error: 'Server misconfigured' });
      }
      // Only allow unauthenticated access in development mode
      if (process.env.NODE_ENV !== 'development') {
        logger.warn('API_KEY not set and NODE_ENV is not development — rejecting request');
        return res.status(500).json({ error: 'Server misconfigured' });
      }
      logger.warn('API_KEY not set, API is unprotected (dev mode)');
      return next();
    }

    // Hash both values before comparison to prevent length-based timing side-channel
    const expectedHash = crypto.createHash('sha256').update(expectedKey).digest();

    // 检查 API Key (constant-time comparison via hash)
    if (apiKey) {
      const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest();
      if (crypto.timingSafeEqual(apiKeyHash, expectedHash)) {
        return next();
      }
    }

    // 检查 Bearer token (预留给未来 JWT 实现)
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const tokenHash = crypto.createHash('sha256').update(token).digest();
      if (crypto.timingSafeEqual(tokenHash, expectedHash)) {
        return next();
      }
    }

    logger.warn('Unauthorized API access attempt', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    logger.error('Auth middleware error', { error: err.message });
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * 检查是否为管理员
 *
 * @deprecated DO NOT use on routes exposed to untrusted clients. This middleware
 * reads identity from x-user-id / x-user-email headers, which can be forged by
 * any client. It must only be used behind a trusted reverse proxy that strips
 * and re-sets these headers, or replaced with JWT/session-based auth.
 */
async function requireAdmin(req, res, next) {
  logger.warn('requireAdmin called — ensure this route is behind a trusted proxy', { path: req.path });
  try {
    const userId = req.headers['x-user-id'];
    const email = req.headers['x-user-email'];

    if (!userId && !email) {
      return res.status(401).json({ error: 'User identification required' });
    }

    const isAdmin = await admins.isAdmin(userId, email);
    if (!isAdmin) {
      logger.warn('Non-admin access attempt', { userId, email, path: req.path });
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.adminUser = { userId, email };
    next();
  } catch (err) {
    logger.error('Admin check error', { error: err.message });
    res.status(500).json({ error: 'Authorization error' });
  }
}

module.exports = {
  verifyFeishuSignature,
  feishuWebhookAuth,
  apiAuth,
  requireAdmin,
};
