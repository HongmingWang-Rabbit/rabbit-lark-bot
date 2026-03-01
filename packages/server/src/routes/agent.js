/**
 * Agent API Routes
 * 
 * These routes are used by AI agents (via MCP or direct API) to interact with Lark.
 * The rabbit-lark-mcp server calls these endpoints.
 */

const express = require('express');
const router = express.Router();
const feishu = require('../feishu/client');
const reminderService = require('../services/reminder');
const usersDb = require('../db/users');
const pool = require('../db/pool');
const logger = require('../utils/logger');
const agentForwarder = require('../services/agentForwarder');
const { safeErrorMessage } = require('../utils/safeError');

/**
 * Detect receive_id_type based on ID format
 * @param {string} id - Lark ID
 * @returns {string} receive_id_type
 */
function detectIdType(id) {
  if (!id) throw new Error('ID is required');
  if (id.startsWith('oc_')) return 'chat_id';   // group chat
  if (id.startsWith('ou_')) return 'open_id';   // open_id (per-app user ID)
  if (id.startsWith('on_')) return 'union_id';  // union_id (cross-app user ID)
  return 'user_id';                             // numeric/email user_id
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
    
    logger.info('Agent sending message', { chat_id, contentLength: typeof content === 'string' ? content.length : JSON.stringify(content).length, msg_type });
    
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
    res.status(500).json({ error: safeErrorMessage(err) });
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
    res.status(500).json({ error: safeErrorMessage(err) });
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
    res.status(500).json({ error: safeErrorMessage(err) });
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
    res.status(500).json({ error: safeErrorMessage(err) });
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
    res.status(500).json({ error: safeErrorMessage(err) });
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
    model: config?.model ?? null,
    maxHistoryMessages: config?.maxHistoryMessages ?? null,
    maxToolRounds: config?.maxToolRounds ?? null,
  });
});

// ── Task management (for MCP tool calls) ─────────────────────────────────────

/**
 * GET /api/agent/tasks?open_id=ou_xxx
 * List pending tasks for a user (by open_id)
 */
router.get('/tasks', async (req, res) => {
  try {
    const { open_id } = req.query;
    if (!open_id) return res.status(400).json({ error: 'open_id is required' });

    // Resolve feishu_user_id from DB (tasks may be indexed by either)
    const user = await usersDb.findByOpenId(open_id);
    const feishuUserId = user?.feishu_user_id || null;

    const tasks = await reminderService.getUserPendingTasks(feishuUserId, open_id);
    res.json({ success: true, tasks });
  } catch (err) {
    logger.error('Agent list tasks failed', { error: err.message });
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

/**
 * POST /api/agent/tasks/:id/complete
 * Complete a task on behalf of the user.
 * Ownership check: only the task's assignee (by open_id or feishu_user_id) may complete it.
 */
router.post('/tasks/:id/complete', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid task ID' });

    const { proof, user_open_id } = req.body;

    // Resolve actor info for audit + completion name
    let completerName = null;
    let feishuUserId = null;
    if (user_open_id) {
      const user = await usersDb.findByOpenId(user_open_id).catch(() => null);
      completerName = user?.name || user?.email || null;
      feishuUserId = user?.feishu_user_id || user_open_id;
    }

    // Ownership check: only the task's assignee may complete via agent API
    if (user_open_id) {
      const { rows } = await pool.query(
        'SELECT assignee_open_id, assignee_id FROM tasks WHERE id = $1 AND status = $2',
        [id, 'pending']
      );
      const taskRecord = rows[0];
      if (!taskRecord) return res.status(404).json({ error: '任务不存在或已完成' });

      const isOwner =
        taskRecord.assignee_open_id === user_open_id ||
        taskRecord.assignee_id === user_open_id ||
        (feishuUserId && taskRecord.assignee_id === feishuUserId);
      if (!isOwner) {
        logger.warn('Agent API: unauthorized complete_task attempt', {
          taskId: id, userOpenId: user_open_id, assigneeOpenId: taskRecord.assignee_open_id,
        });
        return res.status(403).json({ error: '你只能完成分配给自己的任务' });
      }
    }

    const task = await reminderService.completeTask(id, proof || '', feishuUserId || 'agent', completerName);
    if (!task) return res.status(404).json({ error: '任务不存在或已完成' });

    res.json({ success: true, task });
  } catch (err) {
    logger.error('Agent complete task failed', { error: err.message });
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

/**
 * POST /api/agent/tasks
 * Create a task (AI-driven, target by open_id)
 */
router.post('/tasks', async (req, res) => {
  try {
    const { title, target_open_id, reporter_open_id, deadline, note, priority } = req.body;
    if (!title || !target_open_id) {
      return res.status(400).json({ error: 'title and target_open_id are required' });
    }

    const targetUser = await usersDb.findByOpenId(target_open_id);
    if (!targetUser) {
      return res.status(400).json({ error: `User not found for open_id: ${target_open_id}` });
    }

    const task = await reminderService.createTask({
      title,
      assigneeId: targetUser.feishu_user_id || target_open_id,
      assigneeOpenId: target_open_id,
      assigneeName: targetUser.name || null,
      deadline: deadline || null,
      note: note || null,
      priority: priority || 'p1',
      reporterOpenId: reporter_open_id || null,
    });

    res.json({ success: true, task });
  } catch (err) {
    logger.error('Agent create task failed', { error: err.message });
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

/**
 * GET /api/agent/schema
 * Get the message schema documentation
 */
router.get('/schema', (req, res) => {
  res.json({
    success: true,
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
