require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const logger = require('./utils/logger');
const { validateEnv } = require('./utils/validateEnv');
const { apiAuth, feishuWebhookAuth } = require('./middleware/auth');
const { rateLimits } = require('./middleware/rateLimit');
const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');
const agentRoutes = require('./routes/agent');
const userRoutes = require('./routes/users');
const { sendPendingReminders } = require('./services/reminder');

// 验证环境变量
validateEnv();

const app = express();
const PORT = process.env.PORT || 3456;

// Middleware
app.use(cors());
app.use(express.json());
app.use(logger.middleware);

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
    });
  } catch (err) {
    res.status(503).json({ status: 'error', error: 'Database unavailable' });
  }
});

// Routes with middleware
app.use('/webhook', rateLimits.webhook, feishuWebhookAuth, webhookRoutes);
app.use('/api', rateLimits.api, apiAuth, apiRoutes);
app.use('/api/agent', rateLimits.api, apiAuth, agentRoutes);
app.use('/api/users', rateLimits.api, apiAuth, userRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: err.message });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await pool.end();
  process.exit(0);
});

// Start server
async function start() {
  try {
    // Test DB connection
    await pool.query('SELECT NOW()');
    logger.info('Database connected');
    
    app.listen(PORT, () => {
      logger.info(`🐰 Rabbit Lark Server started`, { port: PORT });
      logger.info(`Webhook: http://localhost:${PORT}/webhook/event`);
      logger.info(`API: http://localhost:${PORT}/api`);
    });

    // ── 催办提醒定时任务 ──────────────────────────────────────────────────────
    const REMINDER_CHECK_MINUTES = parseInt(process.env.REMINDER_CHECK_INTERVAL_MINUTES, 10) || 15;
    const runReminderCron = async () => {
      try {
        const count = await sendPendingReminders();
        if (count > 0) logger.info(`⏰ Reminder cron: sent ${count} reminder(s)`);
      } catch (err) {
        logger.error('Reminder cron error', { error: err.message });
      }
    };
    // Run once immediately on startup (catches any reminders missed during downtime)
    runReminderCron();
    setInterval(runReminderCron, REMINDER_CHECK_MINUTES * 60 * 1000);
    logger.info(`⏰ Reminder cron started`, { checkIntervalMinutes: REMINDER_CHECK_MINUTES });
    // ─────────────────────────────────────────────────────────────────────────

  } catch (err) {
    logger.error('Startup failed', { error: err.message });
    process.exit(1);
  }
}

start();
