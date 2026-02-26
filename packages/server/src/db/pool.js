const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT, 10) || 5000,
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT, 10) || 10000,
});

pool.on('error', (err) => {
  logger.error('Database pool error', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

module.exports = pool;
