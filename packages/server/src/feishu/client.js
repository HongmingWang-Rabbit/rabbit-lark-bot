const logger = require('../utils/logger');

const BASE_URL = 'https://open.feishu.cn/open-apis';
const REQUEST_TIMEOUT_MS = 10000; // 10秒超时

let tokenCache = { token: null, expiresAt: 0 };
let tokenPromise = null; // coalesce concurrent token refreshes

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

  // Coalesce concurrent requests: if a refresh is already in-flight, reuse it
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    try {
      const appId = process.env.FEISHU_APP_ID;
      const appSecret = process.env.FEISHU_APP_SECRET;
      if (!appId || !appSecret) {
        throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET must be set');
      }

      const resp = await fetchWithTimeout(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });

      if (!resp.ok) {
        throw new Error(`Token request failed: ${resp.status} ${resp.statusText}`);
      }

      const data = await resp.json();

      if (!data.tenant_access_token) {
        throw new Error(`Invalid token response: code=${data.code}, msg=${data.msg || 'unknown'}`);
      }

      // Refresh 60s before real expiry to avoid races; floor at 300s (5 min)
      // in case Feishu returns a very short TTL.
      tokenCache = {
        token: data.tenant_access_token,
        expiresAt: Date.now() + Math.max(data.expire - 60, 300) * 1000,
      };

      logger.debug('Feishu token refreshed', { expiresIn: data.expire });
      return tokenCache.token;
    } catch (err) {
      logger.error('Failed to get Feishu token', { error: err.message });
      throw err;
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise;
}

/**
 * 通用请求封装
 * @param {string} path - API 路径
 * @param {RequestInit} options - fetch 选项
 * @returns {Promise<any>}
 */
async function request(path, options = {}, _retried = false) {
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

    // Retry once on 401 — cached token may have expired between read and use
    if (resp.status === 401 && !_retried) {
      logger.warn('Feishu 401 — invalidating token cache and retrying', { path });
      tokenCache = { token: null, expiresAt: 0 };
      return request(path, options, true);
    }

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
 * @returns {Promise<Object>} 飞书 API 响应
 */
const VALID_RECEIVE_ID_TYPES = ['user_id', 'open_id', 'chat_id', 'union_id', 'email'];

async function sendMessage(receiveId, text, receiveIdType = 'user_id', replyToMessageId = null) {
  if (!VALID_RECEIVE_ID_TYPES.includes(receiveIdType)) {
    throw new Error(`Invalid receiveIdType: ${receiveIdType}`);
  }
  const body = {
    receive_id: receiveId,
    msg_type: 'text',
    content: JSON.stringify({ text }),
  };

  let url = `/im/v1/messages?${new URLSearchParams({ receive_id_type: receiveIdType })}`;

  // Use the reply endpoint for threaded replies.
  // The reply API uses a different path and ignores receive_id / receive_id_type;
  // msg_type and content remain required in the body.
  if (replyToMessageId) {
    url = `/im/v1/messages/${encodeURIComponent(replyToMessageId)}/reply`;
    delete body.receive_id;
  }

  const result = await request(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  // 检查飞书 API 错误
  if (result.code && result.code !== 0) {
    throw new Error(`Feishu API error: ${result.code} - ${result.msg}`);
  }

  return result;
}

/**
 * 通用发送消息（支持不同消息类型）
 * @param {string} receiveId - 接收者 ID
 * @param {string} content - 消息内容
 * @param {string} msgType - 消息类型 (text | interactive)
 * @param {string} receiveIdType - ID 类型 (user_id | open_id | chat_id)
 * @returns {Promise<string>} 消息 ID
 */
async function sendMessageByType(receiveId, content, msgType = 'text', receiveIdType = 'user_id') {
  if (!VALID_RECEIVE_ID_TYPES.includes(receiveIdType)) {
    throw new Error(`Invalid receiveIdType: ${receiveIdType}`);
  }
  let body;
  
  if (msgType === 'text') {
    body = {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: content }),
    };
  } else if (msgType === 'interactive') {
    // interactive 类型，content 应该是 JSON 字符串或对象
    const cardContent = typeof content === 'string' ? content : JSON.stringify(content);
    body = {
      receive_id: receiveId,
      msg_type: 'interactive',
      content: cardContent,
    };
  } else {
    throw new Error(`Unsupported message type: ${msgType}`);
  }
  
  const result = await request(`/im/v1/messages?${new URLSearchParams({ receive_id_type: receiveIdType })}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (result.code && result.code !== 0) {
    throw new Error(`Feishu API error: ${result.code} - ${result.msg}`);
  }

  return result.data?.message_id;
}

/**
 * 发送卡片消息
 * @param {string} receiveId - 接收者 ID
 * @param {object} card - 卡片内容
 * @param {string} receiveIdType - ID 类型
 */
async function sendCardMessage(receiveId, card, receiveIdType = 'user_id') {
  if (!VALID_RECEIVE_ID_TYPES.includes(receiveIdType)) {
    throw new Error(`Invalid receiveIdType: ${receiveIdType}`);
  }
  const result = await request(`/im/v1/messages?${new URLSearchParams({ receive_id_type: receiveIdType })}`, {
    method: 'POST',
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    }),
  });

  if (result.code && result.code !== 0) {
    throw new Error(`Feishu API error: ${result.code} - ${result.msg}`);
  }

  return result;
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
 * Look up a Feishu user by email or employee_id, returning normalised profile.
 *
 * Strategy:
 *   - email      → batch_get_id  → resolveUserInfo(open_id, 'open_id')
 *   - employee_id→ contact API with user_id_type=user_id
 *
 * @param {{ email?: string, employeeId?: string }} query
 * @returns {Promise<{openId:string,name:string|null,email:string|null,unionId:string|null}|null>}
 */
async function lookupFeishuUser({ email, employeeId }) {
  try {
    if (email) {
      // Step 1: get open_id from email
      const batchRes = await request('/contact/v3/users/batch_get_id', {
        method: 'POST',
        body: JSON.stringify({ emails: [email.toLowerCase()] }),
      });
      const entry = batchRes.data?.user_list?.[0];
      if (!entry?.open_id) return null;

      // Step 2: get full profile
      const info = await resolveUserInfo(entry.open_id, 'open_id');
      return info;
    }

    if (employeeId) {
      // employee_id maps to user_id in Feishu (org-assigned ID, e.g. "E00001")
      const info = await resolveUserInfo(employeeId, 'user_id');
      return info;
    }

    return null;
  } catch (err) {
    logger.debug('lookupFeishuUser failed', { email, employeeId, error: err.message });
    return null;
  }
}

/**
 * 获取用户详情
 * @param {string} userId
 */
async function getUserInfo(userId) {
  return request(`/contact/v3/users/${encodeURIComponent(userId)}`);
}

/**
 * 解析用户信息（email + name），用于首次消息时建立身份映射
 * 若飞书 app 没有 contact 权限，静默返回 null
 * @param {string} userId - 飞书 user_id (on_xxx) 或 open_id
 * @param {'user_id'|'open_id'} userIdType
 * @returns {Promise<{email: string|null, mobile: string|null, name: string|null, openId: string|null}|null>}
 */
async function resolveUserInfo(userId, userIdType = 'user_id') {
  try {
    const result = await request(
      `/contact/v3/users/${encodeURIComponent(userId)}?user_id_type=${userIdType}`
    );
    if (result.code === 0 && result.data?.user) {
      const u = result.data.user;
      return {
        email: u.email || u.enterprise_email || null,
        mobile: u.mobile || null,           // may be masked without extra permissions
        name: u.name || null,
        openId: u.open_id || null,
        unionId: u.union_id || null,        // on_xxx, always returned with contact:contact.base:readonly
        feishuUserId: u.user_id || u.union_id || null,  // user_id preferred; union_id as fallback
      };
    }
    logger.debug('resolveUserInfo: non-zero code', { userId, code: result.code, msg: result.msg });
    return null;
  } catch (err) {
    logger.debug('resolveUserInfo failed (likely no contact permission)', {
      userId,
      error: err.message,
    });
    return null;
  }
}

/**
 * 回复消息
 * @param {string} messageId - 要回复的消息 ID
 * @param {string} text - 回复内容
 */
async function replyMessage(messageId, text) {
  const result = await request(`/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  return result.data?.message_id;
}

/**
 * 添加消息表情回应
 * @param {string} messageId - 消息 ID
 * @param {string} emojiType - 表情类型
 */
async function addReaction(messageId, emojiType) {
  return request(`/im/v1/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    body: JSON.stringify({
      reaction_type: { emoji_type: emojiType },
    }),
  });
}

/**
 * 获取消息历史
 * @param {string} containerId - 会话 ID
 * @param {number} pageSize - 每页数量
 * @param {string} startTime - 起始时间戳（可选）
 */
async function getMessageHistory(containerId, pageSize = 20, pageToken = null) {
  const params = new URLSearchParams({
    container_id_type: 'chat',
    container_id: containerId,
    page_size: String(pageSize),
  });
  if (pageToken) params.set('page_token', pageToken);
  
  const result = await request(`/im/v1/messages?${params}`);
  return result.data?.items || [];
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

    return request(`/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${params}`);
  },

  /**
   * 搜索记录
   */
  async searchRecords(appToken, tableId, filter) {
    return request(`/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/search`, {
      method: 'POST',
      body: JSON.stringify({ filter }),
    });
  },

  /**
   * 创建记录
   */
  async createRecord(appToken, tableId, fields) {
    return request(`/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  },

  /**
   * 更新记录
   */
  async updateRecord(appToken, tableId, recordId, fields) {
    return request(`/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`, {
      method: 'PUT',
      body: JSON.stringify({ fields }),
    });
  },

  /**
   * 删除记录
   */
  async deleteRecord(appToken, tableId, recordId) {
    return request(`/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`, {
      method: 'DELETE',
    });
  },
};

module.exports = {
  getToken,
  request,
  sendMessage,
  sendMessageByType,
  sendCardMessage,
  replyMessage,
  addReaction,
  getMessageHistory,
  getUserByEmail,
  getUserInfo,
  resolveUserInfo,
  lookupFeishuUser,
  bitable,
  // 常量导出
  BASE_URL,
  REQUEST_TIMEOUT_MS,
};
