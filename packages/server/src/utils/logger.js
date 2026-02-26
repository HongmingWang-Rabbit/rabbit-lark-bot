const fs = require('fs');
const path = require('path');

const LOG_LEVEL = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = LOG_LEVEL[process.env.LOG_LEVEL || 'info'];
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../../logs');

// 确保日志目录存在
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (err) {
  console.error('Failed to create log directory:', LOG_DIR, err.message);
}

// Maintain a write stream per date, rotate automatically
let currentDate = '';
let logStream = null;

function getLogStream() {
  const date = new Date().toISOString().split('T')[0];
  if (date !== currentDate) {
    if (logStream) logStream.end();
    currentDate = date;
    const logFile = path.join(LOG_DIR, `${date}.log`);
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
    logStream.on('error', (err) => {
      console.error('Log stream error:', err.message);
      // Reset state so getLogStream() creates a fresh stream on next call
      if (logStream) logStream.destroy();
      logStream = null;
      currentDate = '';
    });
  }
  return logStream;
}

function formatMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  let metaStr = '';
  try {
    metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  } catch { metaStr = ' [non-serializable meta]'; }
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

function log(level, message, meta = {}) {
  if (LOG_LEVEL[level] > currentLevel) return;

  const formatted = formatMessage(level, message, meta);

  // Console output with colors
  const colors = {
    error: '\x1b[31m',   // red
    warn: '\x1b[33m',    // yellow
    info: '\x1b[36m',    // cyan
    debug: '\x1b[90m',   // gray
  };
  const reset = '\x1b[0m';

  console.log(`${colors[level]}${formatted}${reset}`);

  // Write to file in production (async, non-blocking)
  if (process.env.NODE_ENV === 'production') {
    const stream = getLogStream();
    if (stream) stream.write(formatted + '\n');
  }
}

const logger = {
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),

  /** Close the log file stream (call during graceful shutdown) */
  close() {
    if (logStream) {
      logStream.end();
      logStream = null;
      currentDate = '';
    }
  },

  // Request logger middleware
  middleware: (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log(level, `${req.method} ${req.path}`, {
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
      });
    });

    next();
  },
};

module.exports = logger;
