const crypto = require('crypto');
const logger = require('../utils/logger');
const { verifyJwt, JWT_COOKIE_NAME } = require('../utils/jwt');
const apiKeys = require('../db/apiKeys');

// Synthetic user for legacy API key auth (env var API_KEY)
const LEGACY_API_KEY_USER = Object.freeze({ sub: 'api_key_user', name: 'API Key', role: 'superadmin' });

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
 * Session-based auth middleware for web /api/* routes.
 * Priority: dev bypass → JWT cookie → legacy API key (X-API-Key / Bearer)
 */
async function sessionAuth(req, res, next) {
  try {
    // Dev mode bypass
    if (process.env.NODE_ENV === 'development' && !process.env.REQUIRE_AUTH) {
      return next();
    }

    // 1. JWT cookie (primary)
    const token = req.cookies?.[JWT_COOKIE_NAME];
    if (token) {
      const payload = verifyJwt(token);
      if (payload) {
        req.user = payload;
        return next();
      }
      // Token expired/invalid — fall through to API key check
    }

    // 2. Legacy API key support (X-API-Key or Bearer token matched against API_KEY env var)
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];
    const expectedKey = process.env.API_KEY;

    if (expectedKey && (apiKeyHeader || authHeader)) {
      const expectedHash = crypto.createHash('sha256').update(expectedKey).digest();

      if (apiKeyHeader) {
        const keyHash = crypto.createHash('sha256').update(apiKeyHeader).digest();
        if (crypto.timingSafeEqual(keyHash, expectedHash)) {
          req.user = LEGACY_API_KEY_USER;
          return next();
        }
      }

      if (authHeader?.startsWith('Bearer ')) {
        const bearerToken = authHeader.slice(7);
        const tokenHash = crypto.createHash('sha256').update(bearerToken).digest();
        if (crypto.timingSafeEqual(tokenHash, expectedHash)) {
          req.user = LEGACY_API_KEY_USER;
          return next();
        }
      }
    }

    // 3. No valid auth
    if (!expectedKey && !process.env.JWT_SECRET) {
      if (process.env.NODE_ENV === 'production') {
        logger.error('Neither JWT_SECRET nor API_KEY set in production');
        return res.status(500).json({ error: 'Server misconfigured' });
      }
      // Non-production without any auth config — allow through
      logger.warn('No auth configured, API is unprotected');
      return next();
    }

    logger.warn('Unauthorized API access attempt', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    logger.error('Session auth middleware error', { error: err.message });
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Agent callback authentication middleware
 * Validates requests from agents using AGENT_API_KEY env var or DB-backed API keys.
 * Falls back to API_KEY if AGENT_API_KEY is not separately configured.
 */
async function agentAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];

    const token = apiKeyHeader
      || authHeader?.replace(/^Bearer\s+/i, '');

    if (!token) {
      // Check if any auth is configured at all
      const expectedKey = process.env.AGENT_API_KEY || process.env.API_KEY;
      if (!expectedKey) {
        logger.warn('AGENT_API_KEY not set, agent endpoint unprotected');
        return next();
      }
      logger.warn('Agent auth: missing credentials', { path: req.path });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 1. Check env var key (AGENT_API_KEY or API_KEY)
    const expectedKey = process.env.AGENT_API_KEY || process.env.API_KEY;
    if (expectedKey) {
      const expectedHash = crypto.createHash('sha256').update(expectedKey).digest();
      const tokenHash = crypto.createHash('sha256').update(token).digest();

      if (expectedHash.length === tokenHash.length && crypto.timingSafeEqual(tokenHash, expectedHash)) {
        return next();
      }
    }

    // 2. Check DB-backed API keys
    try {
      const keyHash = crypto.createHash('sha256').update(token).digest('hex');
      const dbKey = await apiKeys.findByHash(keyHash);
      if (dbKey) {
        // Fire-and-forget last_used update
        apiKeys.touchLastUsed(dbKey.id).catch(err => {
          logger.debug('touchLastUsed failed', { id: dbKey.id, error: err.message });
        });
        req.agentKeyName = dbKey.name;
        return next();
      }
    } catch (err) {
      // DB lookup failure should not block auth if env var check already ran
      logger.warn('DB API key lookup failed', { error: err.message });
    }

    logger.warn('Agent auth: invalid credentials', { path: req.path, ip: req.ip });
    return res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    logger.error('Agent auth middleware error', { error: err.message });
    return res.status(500).json({ error: 'Authentication error' });
  }
}

module.exports = {
  verifyFeishuSignature,
  feishuWebhookAuth,
  sessionAuth,
  agentAuth,
};
