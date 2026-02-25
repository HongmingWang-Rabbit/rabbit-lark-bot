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
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function formatMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

function writeToFile(message) {
  const date = new Date().toISOString().split('T')[0];
  const logFile = path.join(LOG_DIR, `${date}.log`);
  fs.appendFileSync(logFile, message + '\n');
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
  
  // Write to file in production
  if (process.env.NODE_ENV === 'production') {
    writeToFile(formatted);
  }
}

const logger = {
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
  
  // Request logger middleware
  middleware: (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 400 ? 'error' : 'info';
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
