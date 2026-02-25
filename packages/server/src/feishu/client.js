const logger = require('../utils/logger');

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const BASE_URL = 'https://open.feishu.cn/open-apis';
const REQUEST_TIMEOUT_MS = 10000; // 10秒超时

let tokenCache = { token: null, expiresAt: 0 };

/**
 * 带超时的 fetch
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 获取 tenant_access_token（带缓存）
 * @returns {Promise<string>}
 */
async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  try {
    const resp = await fetchWithTimeout(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
    });

    if (!resp.ok) {
      throw new Error(`Token request failed: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();

    if (!data.tenant_access_token) {
      throw new Error(`Invalid token response: ${JSON.stringify(data)}`);
    }

    tokenCache = {
      token: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire - 60) * 1000, // 提前 60s 过期
    };

    logger.debug('Feishu token refreshed', { expiresIn: data.expire });
    return tokenCache.token;
  } catch (err) {
    logger.error('Failed to get Feishu token', { error: err.message });
    throw err;
  }
}

/**
 * 通用请求封装
 * @param {string} path - API 路径
 * @param {RequestInit} options - fetch 选项
 * @returns {Promise<any>}
 */
async function request(path, options = {}) {
  const token = await getToken();

  try {
    const resp = await fetchWithTimeout(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await resp.json();

    // 飞书 API 错误检查
    if (data.code && data.code !== 0) {
      logger.warn('Feishu API error', { path, code: data.code, msg: data.msg });
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.error('Feishu request timeout', { path });
      throw new Error(`Request timeout: ${path}`);
    }
    logger.error('Feishu request failed', { path, error: err.message });
    throw err;
  }
}

// ============ 消息相关 ============

/**
 * 发送文本消息
 * @param {string} receiveId - 接收者 ID
 * @param {string} text - 消息内容
 * @param {string} receiveIdType - ID 类型 (user_id | open_id | chat_id)
 */
async function sendMessage(receiveId, text, receiveIdType = 'user_id') {
  return request(`/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: 'POST',
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
}

/**
 * 发送卡片消息
 * @param {string} receiveId - 接收者 ID
 * @param {object} card - 卡片内容
 * @param {string} receiveIdType - ID 类型
 */
async function sendCardMessage(receiveId, card, receiveIdType = 'user_id') {
  return request(`/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: 'POST',
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    }),
  });
}

// ============ 用户相关 ============

/**
 * 通过邮箱获取用户信息
 * @param {string} email
 */
async function getUserByEmail(email) {
  const result = await request('/contact/v3/users/batch_get_id', {
    method: 'POST',
    body: JSON.stringify({ emails: [email] }),
  });
  return result.data?.user_list?.[0] || null;
}

/**
 * 获取用户详情
 * @param {string} userId
 */
async function getUserInfo(userId) {
  return request(`/contact/v3/users/${userId}`);
}

// ============ 多维表格相关 ============
const bitable = {
  /**
   * 获取记录列表
   */
  async getRecords(appToken, tableId, options = {}) {
    const params = new URLSearchParams();
    if (options.pageSize) params.set('page_size', String(options.pageSize));
    if (options.pageToken) params.set('page_token', options.pageToken);

    return request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`);
  },

  /**
   * 搜索记录
   */
  async searchRecords(appToken, tableId, filter) {
    return request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`, {
      method: 'POST',
      body: JSON.stringify({ filter }),
    });
  },

  /**
   * 创建记录
   */
  async createRecord(appToken, tableId, fields) {
    return request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  },

  /**
   * 更新记录
   */
  async updateRecord(appToken, tableId, recordId, fields) {
    return request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
      method: 'PUT',
      body: JSON.stringify({ fields }),
    });
  },

  /**
   * 删除记录
   */
  async deleteRecord(appToken, tableId, recordId) {
    return request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
      method: 'DELETE',
    });
  },
};

module.exports = {
  getToken,
  request,
  sendMessage,
  sendCardMessage,
  getUserByEmail,
  getUserInfo,
  bitable,
  // 常量导出
  BASE_URL,
  REQUEST_TIMEOUT_MS,
};
