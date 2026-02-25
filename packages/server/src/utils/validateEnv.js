const logger = require('./logger');

/**
 * 验证必需的环境变量
 */
function validateEnv() {
  const required = [
    'DATABASE_URL',
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'REMINDER_APP_TOKEN',
    'REMINDER_TABLE_ID',
  ];

  const optional = [
    'PORT',
    'NODE_ENV',
    'LOG_LEVEL',
    'API_KEY',
    'FEISHU_ENCRYPT_KEY',
  ];

  const missing = [];
  const present = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    } else {
      present.push(key);
    }
  }

  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missing });
    logger.error(`Missing: ${missing.join(', ')}`);
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

  if (warnings.length > 0 && process.env.NODE_ENV === 'production') {
    logger.warn('Security warnings', { warnings });
  }

  logger.info('Environment validated', { 
    required: present.length,
    optional: optional.filter(k => process.env[k]).length 
  });

  return true;
}

module.exports = { validateEnv };
