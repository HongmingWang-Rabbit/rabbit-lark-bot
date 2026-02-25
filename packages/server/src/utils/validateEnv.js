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

  // 内置催办功能需要（ENABLE_BUILTIN_BOT !== 'false' 时）
  const reminderRequired = [
    'REMINDER_APP_TOKEN',
    'REMINDER_TABLE_ID',
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

  // 如果启用内置 bot，检查 reminder 变量
  const builtinBotEnabled = process.env.ENABLE_BUILTIN_BOT !== 'false';
  if (builtinBotEnabled) {
    for (const key of reminderRequired) {
      if (!process.env[key]) {
        missing.push(key);
      } else {
        present.push(key);
      }
    }
  }

  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missing });
    logger.error(`Missing: ${missing.join(', ')}`);
    if (builtinBotEnabled && (missing.includes('REMINDER_APP_TOKEN') || missing.includes('REMINDER_TABLE_ID'))) {
      logger.error('Tip: Set ENABLE_BUILTIN_BOT=false if you only want message forwarding');
    }
    logger.error('Please check your .env file');
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
  if (!process.env.API_BASE_URL) {
    warnings.push('API_BASE_URL not set - reply_via.api will use localhost');
  }

  if (warnings.length > 0 && process.env.NODE_ENV === 'production') {
    logger.warn('Security/Config warnings', { warnings });
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
