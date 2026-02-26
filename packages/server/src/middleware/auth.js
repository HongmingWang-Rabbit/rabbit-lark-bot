const crypto = require('crypto');
const { admins } = require('../db');
const logger = require('../utils/logger');

/**
 * 验证飞书 webhook 签名
 * @see https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN
 */
function verifyFeishuSignature(timestamp, nonce, body, signature) {
  const encryptKey = process.env.FEISHU_ENCRYPT_KEY;
  if (!encryptKey) {
    logger.warn('FEISHU_ENCRYPT_KEY not set, skipping signature verification');
    return true; // 开发环境可以跳过
  }

  const content = timestamp + nonce + encryptKey + JSON.stringify(body);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return hash === signature;
}

/**
 * 飞书 Webhook 签名验证中间件
 */
function feishuWebhookAuth(req, res, next) {
  // URL 验证请求不需要签名（明文或加密体）
  if (req.body?.type === 'url_verification') {
    return next();
  }
  // 加密体也暂时跳过签名校验，由 webhook handler 解密后再处理
  if (req.body?.encrypt) {
    return next();
  }

  const timestamp = req.headers['x-lark-request-timestamp'];
  const nonce = req.headers['x-lark-request-nonce'];
  const signature = req.headers['x-lark-signature'];

  if (process.env.FEISHU_ENCRYPT_KEY && (!timestamp || !nonce || !signature)) {
    logger.warn('Missing Feishu signature headers');
    return res.status(401).json({ error: 'Missing signature headers' });
  }

  if (!verifyFeishuSignature(timestamp, nonce, req.body, signature)) {
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
    // 健康检查和公开接口跳过
    const publicPaths = ['/health', '/api/health'];
    if (publicPaths.includes(req.path)) {
      return next();
    }

    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'];

    // 开发环境可以跳过认证
    if (process.env.NODE_ENV === 'development' && !process.env.REQUIRE_AUTH) {
      return next();
    }

    // 检查 API Key
    if (apiKey && apiKey === process.env.API_KEY) {
      return next();
    }

    // 检查 Bearer token (预留给未来 JWT 实现)
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      // TODO: 实现 JWT 验证
      if (token === process.env.API_KEY) {
        return next();
      }
    }

    // 如果没有配置 API_KEY，允许访问（开发模式）
    if (!process.env.API_KEY) {
      logger.warn('API_KEY not set, API is unprotected');
      return next();
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
 */
async function requireAdmin(req, res, next) {
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
