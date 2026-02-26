/**
 * Agent API Routes
 * 
 * These routes are used by AI agents (via MCP or direct API) to interact with Lark.
 * The rabbit-lark-mcp server calls these endpoints.
 */

const express = require('express');
const router = express.Router();
const feishu = require('../feishu/client');
const logger = require('../utils/logger');
const agentForwarder = require('../services/agentForwarder');

/**
 * Detect receive_id_type based on ID format
 * @param {string} id - Lark ID
 * @returns {string} receive_id_type
 */
function detectIdType(id) {
  if (!id) return 'user_id';
  if (id.startsWith('oc_')) return 'chat_id';  // 群聊 ID
  if (id.startsWith('ou_')) return 'open_id';  // open_id
  return 'user_id';  // 默认 user_id
}

/**
 * POST /api/agent/send
 * Send a message to a Lark user or chat
 */
router.post('/send', async (req, res) => {
  try {
    const { chat_id, content, msg_type = 'text', reply_to_message_id } = req.body;
    
    if (!chat_id || !content) {
      return res.status(400).json({ error: 'chat_id and content are required' });
    }
    
    logger.info('Agent sending message', { chat_id, contentLength: content.length, msg_type });
    
    let message_id;
    // Use reply endpoint for threaded replies when message_id is provided
    if (reply_to_message_id) {
      message_id = await feishu.replyMessage(reply_to_message_id, content);
    } else {
      const receiveIdType = detectIdType(chat_id);
      message_id = await feishu.sendMessageByType(chat_id, content, msg_type, receiveIdType);
    }
    
    res.json({ success: true, message_id });
  } catch (err) {
    logger.error('Agent send failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/agent/reply
 * Reply to a specific message
 */
router.post('/reply', async (req, res) => {
  try {
    const { message_id, content } = req.body;
    
    if (!message_id || !content) {
      return res.status(400).json({ error: 'message_id and content are required' });
    }
    
    logger.info('Agent replying to message', { message_id });
    
    const reply_id = await feishu.replyMessage(message_id, content);
    
    res.json({ success: true, message_id: reply_id });
  } catch (err) {
    logger.error('Agent reply failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/agent/react
 * Add emoji reaction to a message
 */
router.post('/react', async (req, res) => {
  try {
    const { message_id, emoji } = req.body;
    
    if (!message_id || !emoji) {
      return res.status(400).json({ error: 'message_id and emoji are required' });
    }
    
    logger.info('Agent reacting to message', { message_id, emoji });
    
    await feishu.addReaction(message_id, emoji);
    
    res.json({ success: true });
  } catch (err) {
    logger.error('Agent react failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/agent/history
 * Get message history from a chat
 */
router.get('/history', async (req, res) => {
  try {
    const { chat_id, limit = '20', before } = req.query;
    
    if (!chat_id) {
      return res.status(400).json({ error: 'chat_id is required' });
    }
    
    // 验证并限制 limit 范围
    const parsedLimit = Math.min(Math.max(1, parseInt(limit) || 20), 100);
    
    logger.info('Agent fetching history', { chat_id, limit: parsedLimit });
    
    const messages = await feishu.getMessageHistory(chat_id, parsedLimit, before);
    
    res.json({ success: true, messages });
  } catch (err) {
    logger.error('Agent history fetch failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/agent/user/:user_id
 * Get user information
 */
router.get('/user/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    
    logger.info('Agent fetching user info', { user_id });
    
    const user = await feishu.getUserInfo(user_id);
    
    res.json({ success: true, user });
  } catch (err) {
    logger.error('Agent user fetch failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/agent/status
 * Check if agent is configured
 */
router.get('/status', (req, res) => {
  const configured = agentForwarder.isAgentConfigured();
  const config = agentForwarder.getAgentConfig();
  
  res.json({
    success: true,
    configured,
    // 不暴露完整 URL，只显示是否配置
    webhook_configured: !!config?.webhookUrl,
  });
});

/**
 * GET /api/agent/schema
 * Get the message schema documentation
 */
router.get('/schema', (req, res) => {
  res.json({
    success: true,
    version: agentForwarder.BRIDGE_VERSION,
    capabilities: agentForwarder.CAPABILITIES,
    message_format: {
      source: {
        bridge: 'rabbit-lark-bot',
        platform: 'lark',
        version: 'string',
        capabilities: ['text', 'image', 'file', 'reply', 'reaction', 'interactive'],
      },
      reply_via: {
        mcp: 'rabbit-lark',
        api: 'string (endpoint URL)',
      },
      event: 'message | reaction',
      message_id: 'string',
      chat_id: 'string',
      chat_type: 'p2p | group',
      user: {
        id: 'string (user_id)',
        open_id: 'string',
        union_id: 'string',
        type: 'user | bot',
      },
      content: {
        type: 'text | image | file | interactive',
        text: 'string (for text messages)',
      },
      timestamp: 'number (unix ms)',
    },
  });
});

module.exports = router;
