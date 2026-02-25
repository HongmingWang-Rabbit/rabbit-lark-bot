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
 * POST /api/agent/send
 * Send a message to a Lark user or chat
 */
router.post('/send', async (req, res) => {
  try {
    const { chat_id, content, msg_type = 'text' } = req.body;
    
    if (!chat_id || !content) {
      return res.status(400).json({ error: 'chat_id and content are required' });
    }
    
    logger.info('Agent sending message', { chat_id, contentLength: content.length });
    
    const message_id = await feishu.sendMessage(chat_id, content, msg_type);
    
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
    const { chat_id, limit = 20, before } = req.query;
    
    if (!chat_id) {
      return res.status(400).json({ error: 'chat_id is required' });
    }
    
    logger.info('Agent fetching history', { chat_id, limit });
    
    const messages = await feishu.getMessageHistory(chat_id, parseInt(limit), before);
    
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

// ============ Agent Registration Management ============

/**
 * POST /api/agent/register
 * Register a new agent webhook
 */
router.post('/register', async (req, res) => {
  try {
    const { name, webhook_url, api_key, description, filters } = req.body;
    
    if (!name || !webhook_url) {
      return res.status(400).json({ error: 'name and webhook_url are required' });
    }
    
    logger.info('Registering agent', { name, webhook_url });
    
    const agent = await agentForwarder.registerAgent({
      name,
      webhook_url,
      api_key,
      description,
      filters,
    });
    
    res.json({ success: true, agent });
  } catch (err) {
    logger.error('Agent registration failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/agent/list
 * List all registered agents
 */
router.get('/list', async (req, res) => {
  try {
    const agents = await agentForwarder.getEnabledAgents();
    
    // 不返回 api_key
    const safeAgents = agents.map(({ api_key, ...agent }) => agent);
    
    res.json({ success: true, agents: safeAgents });
  } catch (err) {
    logger.error('Agent list failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/agent/:name
 * Remove an agent registration
 */
router.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    logger.info('Removing agent', { name });
    
    await agentForwarder.removeAgent(name);
    
    res.json({ success: true });
  } catch (err) {
    logger.error('Agent removal failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
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
