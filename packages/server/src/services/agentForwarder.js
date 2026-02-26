/**
 * Agent Forwarder Service
 * 
 * Forwards incoming Lark messages to the configured AI agent via webhook.
 * Single-agent mode: one Rabbit Lark instance = one AI agent owner.
 * 
 * Configure via environment:
 *   AGENT_WEBHOOK_URL - The agent's webhook endpoint
 *   AGENT_API_KEY - Shared secret for signing (optional)
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

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
  } catch (parseErr) {
    logger.debug('Failed to parse message content as JSON', { error: parseErr.message });
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
  // Redact URL to avoid leaking embedded credentials in logs
  const redactedUrl = new URL(webhookUrl).origin + new URL(webhookUrl).pathname;

  try {
    logger.info('Forwarding to agent', {
      webhookUrl: redactedUrl,
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
      const error = await response.text().catch(() => 'unknown');
      throw new Error(`Agent returned ${response.status}: ${error.slice(0, 500)}`);
    }
    
    const result = await response.json();
    logger.info('Agent responded', { webhookUrl: redactedUrl, success: true });
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    
    if (err.name === 'AbortError') {
      logger.warn('Agent timeout', { webhookUrl: redactedUrl, timeout });
      throw new Error('Agent request timeout');
    }
    
    logger.error('Forward to agent failed', { webhookUrl: redactedUrl, error: err.message });
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
  
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

// ============ Single Agent Mode ============

/**
 * Get agent configuration from environment
 * @returns {Object|null}
 */
function getAgentConfig() {
  const webhookUrl = process.env.AGENT_WEBHOOK_URL;
  if (!webhookUrl) {
    return null;
  }
  
  return {
    webhookUrl,
    apiKey: process.env.AGENT_API_KEY || '',
    timeout: parseInt(process.env.AGENT_TIMEOUT_MS) || 30000,
  };
}

/**
 * Check if agent is configured
 * @returns {boolean}
 */
function isAgentConfigured() {
  return !!process.env.AGENT_WEBHOOK_URL;
}

/**
 * Forward message to the configured agent
 * @param {Object} event - Raw Lark event
 * @param {string} apiBaseUrl - This server's base URL
 * @param {Object} [userContext] - User record with resolved features
 */
async function forwardToOwnerAgent(event, apiBaseUrl, userContext = null) {
  const config = getAgentConfig();
  
  if (!config) {
    logger.debug('No agent configured (AGENT_WEBHOOK_URL not set), skipping forward');
    return null;
  }
  
  const message = formatForAgent(event, apiBaseUrl);

  // Attach user context so the agent knows what this user is allowed to do
  if (userContext) {
    message.userContext = {
      userId: userContext.user_id,
      name: userContext.name,
      role: userContext.role,
      allowedFeatures: userContext.resolvedFeatures ?? {},
    };
  }
  
  // Redact URL to avoid leaking embedded credentials in logs
  const redactedUrl = new URL(config.webhookUrl).origin + new URL(config.webhookUrl).pathname;

  try {
    const result = await forwardToAgent(config.webhookUrl, message, {
      apiKey: config.apiKey,
      timeout: config.timeout,
    });
    return result;
  } catch (err) {
    logger.error('Failed to forward to owner agent', {
      error: err.message,
      webhookUrl: redactedUrl,
    });
    throw err;
  }
}

module.exports = {
  formatForAgent,
  forwardToAgent,
  forwardToOwnerAgent,
  getAgentConfig,
  isAgentConfigured,
  generateSignature,
  BRIDGE_VERSION,
  CAPABILITIES,
};
