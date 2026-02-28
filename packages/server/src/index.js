require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const logger = require('./utils/logger');
const { validateEnv } = require('./utils/validateEnv');
const { apiAuth, agentAuth, feishuWebhookAuth } = require('./middleware/auth');
const { rateLimits, limiter } = require('./middleware/rateLimit');
const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');
const agentRoutes = require('./routes/agent');
const userRoutes = require('./routes/users');
const { sendPendingReminders } = require('./services/reminder');
const sessions = require('./db/sessions');

// 验证环境变量
validateEnv();

const app = express();
const PORT = process.env.PORT || 3456;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : '*'),
}));
app.use(express.json({
  limit: '1mb',
  // Preserve raw body for webhook signature verification
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
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
// Agent routes use AGENT_API_KEY auth (separate from web API_KEY)
// Must be registered before /api to take precedence
app.use('/api/agent', rateLimits.api, agentAuth, agentRoutes);
apiRoutes.use('/users', userRoutes);
app.use('/api', rateLimits.api, apiAuth, apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(500).json({ error: message });
});

// Start server
let server;
const intervalIds = [];

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`${signal} received, shutting down...`);
  intervalIds.forEach(clearInterval);
  limiter.destroy();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
  logger.close();
  process.exit(0);
}
process.on('SIGTERM', () => { shutdown('SIGTERM').catch(err => logger.error('Shutdown error', { error: err.message })); });
process.on('SIGINT', () => { shutdown('SIGINT').catch(err => logger.error('Shutdown error', { error: err.message })); });

async function start() {
  try {
    // Test DB connection
    await pool.query('SELECT NOW()');
    logger.info('Database connected');

    server = app.listen(PORT, () => {
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
    intervalIds.push(setInterval(runReminderCron, REMINDER_CHECK_MINUTES * 60 * 1000));
    logger.info(`⏰ Reminder cron started`, { checkIntervalMinutes: REMINDER_CHECK_MINUTES });

    // Session cleanup: prune expired rows every 30 minutes
    intervalIds.push(setInterval(() => sessions.cleanup().catch((err) => {
      logger.error('Session cleanup error', { error: err.message });
    }), 30 * 60 * 1000));
    // ─────────────────────────────────────────────────────────────────────────

  } catch (err) {
    logger.error('Startup failed', { error: err.message });
    process.exit(1);
  }
}

start();
