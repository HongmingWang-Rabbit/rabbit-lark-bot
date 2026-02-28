const logger = require('../utils/logger');

/**
 * 简单的内存 rate limiter（单实例）
 * 注意：计数器存储在进程内存中，多实例部署时每个实例独立计数，
 * 有效限流阈值 = maxRequests × 实例数。生产多实例建议使用 Redis。
 */
const MAX_RATE_LIMIT_ENTRIES = 10000; // prevent unbounded memory growth under attack

class RateLimiter {
  constructor() {
    this.requests = new Map();

    // 每分钟清理过期记录
    this._cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
    this._cleanupInterval.unref(); // don't keep process alive just for cleanup
  }

  destroy() {
    clearInterval(this._cleanupInterval);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, data] of this.requests) {
      if (now - data.windowStart > data.windowMs) {
        this.requests.delete(key);
      }
    }
  }

  isRateLimited(key, maxRequests, windowMs) {
    const now = Date.now();
    const data = this.requests.get(key);

    if (!data || now - data.windowStart > windowMs) {
      // Evict ~10% of oldest entries when map is full (prevent memory exhaustion)
      if (this.requests.size >= MAX_RATE_LIMIT_ENTRIES) {
        const evictCount = Math.ceil(MAX_RATE_LIMIT_ENTRIES * 0.1);
        const iter = this.requests.keys();
        for (let i = 0; i < evictCount; i++) {
          const { value, done } = iter.next();
          if (done) break;
          this.requests.delete(value);
        }
      }
      this.requests.set(key, { count: 1, windowStart: now, windowMs });
      return false;
    }

    data.count++;
    if (data.count >= maxRequests) {
      return true;
    }

    return false;
  }

  getRemaining(key, maxRequests, windowMs) {
    const data = this.requests.get(key);
    if (!data) return maxRequests;
    
    const now = Date.now();
    if (now - data.windowStart > windowMs) return maxRequests;
    
    return Math.max(0, maxRequests - data.count);
  }
}

const limiter = new RateLimiter();

/**
 * Rate limit 中间件工厂
 * @param {Object} options
 * @param {number} options.maxRequests - 窗口内最大请求数
 * @param {number} options.windowMs - 窗口时间（毫秒）
 * @param {string} options.keyGenerator - 生成限流 key 的函数
 */
function rateLimit({ maxRequests = 100, windowMs = 60 * 1000, keyGenerator } = {}) {
  return (req, res, next) => {
    const key = keyGenerator ? keyGenerator(req) : req.ip;
    
    if (limiter.isRateLimited(key, maxRequests, windowMs)) {
      logger.warn('Rate limit exceeded', { key, path: req.path });
      
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      
      return res.status(429).json({ 
        error: 'Too many requests, please try again later' 
      });
    }

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', limiter.getRemaining(key, maxRequests, windowMs));
    
    next();
  };
}

// 预设的限流配置
const rateLimits = {
  // API 通用限流：每分钟 100 次
  api: rateLimit({ maxRequests: 100, windowMs: 60 * 1000 }),
  
  // Webhook 限流：每分钟 200 次（飞书可能批量推送）
  webhook: rateLimit({ maxRequests: 200, windowMs: 60 * 1000 }),
  
  // 严格限流：每分钟 10 次（敏感操作）
  strict: rateLimit({ maxRequests: 10, windowMs: 60 * 1000 }),
};

module.exports = { rateLimit, rateLimits, limiter };
