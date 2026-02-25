/**
 * Agent Forwarder Service
 * 
 * Forwards incoming Lark messages to registered AI agents via webhook.
 * Agents receive messages in a standardized format and can respond via MCP or API.
 */

const logger = require('../utils/logger');
const { pool } = require('../db');

/**
 * Standard message format sent to agents
 * @typedef {Object} AgentMessage
 * @property {Object} source - Message source info
 * @property {string} source.bridge - "rabbit-lark-bot"
 * @property {string} source.platform - "lark"
 * @property {string} source.version - Bridge version
 * @property {string[]} source.capabilities - Supported features
 * @property {Object} reply_via - How to reply
 * @property {string} reply_via.mcp - MCP server name
 * @property {string} reply_via.api - Direct API endpoint
 * @property {string} event - Event type (message, reaction, etc.)
 * @property {string} message_id - Lark message ID
 * @property {string} chat_id - Lark chat ID
 * @property {Object} user - Sender info
 * @property {Object} content - Message content
 * @property {number} timestamp - Unix timestamp
 */

const BRIDGE_VERSION = '1.0.0';
const CAPABILITIES = ['text', 'image', 'file', 'reply', 'reaction', 'interactive'];

/**
 * Format a Lark event into standard agent message format
 * @param {Object} event - Raw Lark event
 * @param {string} apiBaseUrl - Base URL of this server
 * @returns {AgentMessage}
 */
function formatForAgent(event, apiBaseUrl) {
  const message = event.message || {};
  const sender = event.sender || {};
  
  // Parse content based on message type
  let content = {};
  try {
    const rawContent = JSON.parse(message.content || '{}');
    content = {
      type: message.message_type || 'text',
      text: rawContent.text || '',
      ...rawContent,
    };
  } catch {
    content = { type: 'text', text: message.content || '' };
  }
  
  return {
    source: {
      bridge: 'rabbit-lark-bot',
      platform: 'lark',
      version: BRIDGE_VERSION,
      capabilities: CAPABILITIES,
    },
    reply_via: {
      mcp: 'rabbit-lark',
      api: `${apiBaseUrl}/api/agent/send`,
    },
    event: 'message',
    message_id: message.message_id,
    chat_id: message.chat_id,
    chat_type: message.chat_type, // p2p or group
    user: {
      id: sender.sender_id?.user_id || sender.sender_id?.open_id,
      open_id: sender.sender_id?.open_id,
      union_id: sender.sender_id?.union_id,
      type: sender.sender_type, // user or bot
    },
    content,
    timestamp: parseInt(message.create_time) || Date.now(),
    // Include raw event for agents that need full access
    _raw: event,
  };
}

/**
 * Forward message to a registered agent
 * @param {string} webhookUrl - Agent's webhook URL
 * @param {AgentMessage} message - Formatted message
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Response from agent
 */
async function forwardToAgent(webhookUrl, message, options = {}) {
  const { apiKey, timeout = 30000 } = options;
  
  const headers = {
    'Content-Type': 'application/json',
    'X-Rabbit-Lark-Signature': generateSignature(message, apiKey),
  };
  
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    logger.info('Forwarding to agent', { 
      webhookUrl, 
      messageId: message.message_id,
      chatId: message.chat_id,
    });
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Agent returned ${response.status}: ${error}`);
    }
    
    const result = await response.json();
    logger.info('Agent responded', { webhookUrl, success: true });
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    
    if (err.name === 'AbortError') {
      logger.warn('Agent timeout', { webhookUrl, timeout });
      throw new Error('Agent request timeout');
    }
    
    logger.error('Forward to agent failed', { webhookUrl, error: err.message });
    throw err;
  }
}

/**
 * Generate HMAC signature for webhook verification
 * @param {Object} payload - Message payload
 * @param {string} secret - Shared secret
 * @returns {string} HMAC signature
 */
function generateSignature(payload, secret) {
  if (!secret) return '';
  
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

// ============ Agent Registration (Database) ============

/**
 * Register a new agent webhook
 * @param {Object} agent - Agent configuration
 */
async function registerAgent(agent) {
  const { name, webhook_url, api_key, enabled = true, filters = {} } = agent;
  
  const result = await pool.query(
    `INSERT INTO agent_webhooks (name, webhook_url, api_key, enabled, filters, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (name) DO UPDATE SET
       webhook_url = $2, api_key = $3, enabled = $4, filters = $5, updated_at = NOW()
     RETURNING *`,
    [name, webhook_url, api_key, enabled, JSON.stringify(filters)]
  );
  
  return result.rows[0];
}

/**
 * Get all enabled agents
 * @returns {Promise<Array>}
 */
async function getEnabledAgents() {
  const result = await pool.query(
    'SELECT * FROM agent_webhooks WHERE enabled = true'
  );
  return result.rows;
}

/**
 * Remove an agent
 * @param {string} name - Agent name
 */
async function removeAgent(name) {
  await pool.query('DELETE FROM agent_webhooks WHERE name = $1', [name]);
}

/**
 * Forward message to all registered agents
 * @param {Object} event - Raw Lark event
 * @param {string} apiBaseUrl - This server's base URL
 */
async function forwardToAllAgents(event, apiBaseUrl) {
  const agents = await getEnabledAgents();
  
  if (agents.length === 0) {
    logger.debug('No agents registered, skipping forward');
    return;
  }
  
  const message = formatForAgent(event, apiBaseUrl);
  
  // Forward to all agents in parallel
  const results = await Promise.allSettled(
    agents.map(agent => 
      forwardToAgent(agent.webhook_url, message, { apiKey: agent.api_key })
    )
  );
  
  // Log results
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.warn('Agent forward failed', { 
        agent: agents[i].name, 
        error: result.reason.message 
      });
    }
  });
  
  return results;
}

module.exports = {
  formatForAgent,
  forwardToAgent,
  forwardToAllAgents,
  registerAgent,
  getEnabledAgents,
  removeAgent,
  generateSignature,
  BRIDGE_VERSION,
  CAPABILITIES,
};
