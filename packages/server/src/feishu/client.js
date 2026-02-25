const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const BASE_URL = 'https://open.feishu.cn/open-apis';

let tokenCache = { token: null, expiresAt: 0 };

// 获取 tenant_access_token（带缓存）
async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const resp = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const data = await resp.json();
  
  tokenCache = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire - 60) * 1000 // 提前 60s 过期
  };
  
  return tokenCache.token;
}

// 通用请求封装
async function request(path, options = {}) {
  const token = await getToken();
  const resp = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return resp.json();
}

// ============ 消息相关 ============
async function sendMessage(receiveId, text, receiveIdType = 'user_id') {
  return request(`/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: 'POST',
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text })
    })
  });
}

async function sendCardMessage(receiveId, card, receiveIdType = 'user_id') {
  return request(`/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: 'POST',
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'interactive',
      content: JSON.stringify(card)
    })
  });
}

// ============ 用户相关 ============
async function getUserByEmail(email) {
  const result = await request('/contact/v3/users/batch_get_id', {
    method: 'POST',
    body: JSON.stringify({ emails: [email] })
  });
  return result.data?.user_list?.[0] || null;
}

async function getUserInfo(userId) {
  return request(`/contact/v3/users/${userId}`);
}

// ============ 多维表格相关 ============
const bitable = {
  async getRecords(appToken, tableId, options = {}) {
    const params = new URLSearchParams();
    if (options.pageSize) params.set('page_size', options.pageSize);
    if (options.pageToken) params.set('page_token', options.pageToken);
    
    return request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`);
  },

  async searchRecords(appToken, tableId, filter) {
    return request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`, {
      method: 'POST',
      body: JSON.stringify({ filter })
    });
  },

  async createRecord(appToken, tableId, fields) {
    return request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
      method: 'POST',
      body: JSON.stringify({ fields })
    });
  },

  async updateRecord(appToken, tableId, recordId, fields) {
    return request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
      method: 'PUT',
      body: JSON.stringify({ fields })
    });
  },

  async deleteRecord(appToken, tableId, recordId) {
    return request(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
      method: 'DELETE'
    });
  }
};

module.exports = {
  getToken,
  request,
  sendMessage,
  sendCardMessage,
  getUserByEmail,
  getUserInfo,
  bitable
};
