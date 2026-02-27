const logger = require('./logger');

/**
 * 验证必需的环境变量
 */
function validateEnv() {
  // 核心必需
  const required = [
    'DATABASE_URL',
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
  ];

  const optional = [
    'PORT',
    'NODE_ENV',
    'LOG_LEVEL',
    'API_KEY',
    'API_BASE_URL',
    'FEISHU_ENCRYPT_KEY',
    'AGENT_WEBHOOK_URL',
    'AGENT_API_KEY',
    'AGENT_TIMEOUT_MS',
    'ENABLE_BUILTIN_BOT',
    'CORS_ORIGIN',
    'REQUIRE_AUTH',
  ];

  const missing = [];
  const present = [];

  // 检查核心必需变量
  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    } else {
      present.push(key);
    }
  }

  const builtinBotEnabled = (process.env.ENABLE_BUILTIN_BOT ?? 'true') !== 'false';

  if (missing.length > 0) {
    logger.error('Missing required environment variables — check your .env file', { missing });
    process.exit(1);
  }

  // 警告可选但推荐的变量
  const warnings = [];
  if (!process.env.API_KEY) {
    warnings.push('API_KEY not set - API endpoints are unprotected');
  }
  if (!process.env.FEISHU_ENCRYPT_KEY) {
    warnings.push('FEISHU_ENCRYPT_KEY not set - webhook signature verification disabled');
  }
  if (!process.env.AGENT_WEBHOOK_URL) {
    warnings.push('AGENT_WEBHOOK_URL not set - messages will not be forwarded to any agent');
  }
  if (!process.env.AGENT_API_KEY) {
    warnings.push('AGENT_API_KEY not set - /api/agent/send endpoint is unprotected and agent reply auth will fail if openclaw.json has rabbitApiKey set');
  }
  if (!process.env.API_BASE_URL) {
    warnings.push('API_BASE_URL not set - reply_via.api will use localhost');
  }
  if (!process.env.CORS_ORIGIN) {
    warnings.push('CORS_ORIGIN not set - CORS allows all origins (*)');
  }

  if (warnings.length > 0) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('Production security warnings — fix before deploying', { warnings });
      // Critical security vars must be set in production
      if (!process.env.API_KEY || !process.env.FEISHU_ENCRYPT_KEY) {
        logger.error('Refusing to start: API_KEY and FEISHU_ENCRYPT_KEY are required in production');
        process.exit(1);
      }
      if (!process.env.AGENT_API_KEY) {
        logger.warn('AGENT_API_KEY not set in production - agent callback endpoint /api/agent/send is unprotected');
      }
    } else {
      logger.warn('Security/Config warnings', { warnings });
    }
  }

  logger.info('Environment validated', { 
    required: present.length,
    optional: optional.filter(k => process.env[k]).length,
    builtinBot: builtinBotEnabled,
    agentForwarding: !!process.env.AGENT_WEBHOOK_URL,
  });

  return true;
}

module.exports = { validateEnv };
