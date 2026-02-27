/**
 * Agent Forwarder — Direct Anthropic API with tool calling
 *
 * Replaces the OpenClaw agent forwarding with a direct call to Anthropic.
 * Claude gets tool definitions and calls them; this service executes them.
 *
 * Tools:
 *   list_tasks      — get pending tasks for a user
 *   create_task     — create a task and notify the assignee via Feishu DM
 *   complete_task   — mark a task as done
 *   send_message    — send a text reply to the Feishu chat
 */

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');
const { pool } = require('../db/index');
const reminderService = require('./reminder');
const usersDb = require('../db/users');
const feishu = require('../feishu/client');

const MODEL = 'claude-haiku-4-5-20251001'; // cheapest & fastest
const MAX_HISTORY = 20;        // messages per chat to keep
const MAX_TOOL_ROUNDS = 5;     // prevent infinite loops

// ---------------------------------------------------------------------------
// Conversation history (PostgreSQL)
// ---------------------------------------------------------------------------

async function getHistory(chatId) {
  
  const { rows } = await pool.query(
    `SELECT role, content FROM conversation_history
     WHERE chat_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [chatId, MAX_HISTORY]
  );
  return rows.reverse().map(r => ({ role: r.role, content: r.content }));
}

async function appendHistory(chatId, role, content) {
  
  await pool.query(
    `INSERT INTO conversation_history (chat_id, role, content) VALUES ($1, $2, $3)`,
    [chatId, role, JSON.stringify(content)]
  );
  // Prune old messages beyond limit
  await pool.query(
    `DELETE FROM conversation_history
     WHERE chat_id = $1 AND id NOT IN (
       SELECT id FROM conversation_history WHERE chat_id = $1
       ORDER BY created_at DESC LIMIT $2
     )`,
    [chatId, MAX_HISTORY]
  );
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_tasks',
    description: '获取用户的待办催办任务列表',
    input_schema: {
      type: 'object',
      properties: {
        open_id: { type: 'string', description: '用户的飞书 open_id (ou_xxx)' },
      },
      required: ['open_id'],
    },
  },
  {
    name: 'create_task',
    description: '创建一个催办任务，并通过飞书 DM 通知被催办人',
    input_schema: {
      type: 'object',
      properties: {
        title:            { type: 'string', description: '任务标题' },
        target_open_id:   { type: 'string', description: '被催办人的 open_id' },
        reporter_open_id: { type: 'string', description: '创建人的 open_id（当前用户）' },
        deadline:         { type: 'string', description: '截止日期 YYYY-MM-DD，可选' },
        note:             { type: 'string', description: '备注，可选' },
      },
      required: ['title', 'target_open_id'],
    },
  },
  {
    name: 'complete_task',
    description: '将一个任务标记为已完成',
    input_schema: {
      type: 'object',
      properties: {
        task_id:       { type: 'number', description: '任务 ID' },
        user_open_id:  { type: 'string', description: '完成人的 open_id' },
        proof:         { type: 'string', description: '完成证明链接，可选' },
      },
      required: ['task_id', 'user_open_id'],
    },
  },
  {
    name: 'send_message',
    description: '向飞书会话发送一条消息（用于追问或通知）',
    input_schema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: '飞书 chat_id' },
        content: { type: 'string', description: '消息内容（纯文本）' },
      },
      required: ['chat_id', 'content'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

async function executeTool(name, input, { userOpenId, chatId }) {
  logger.info('🔧 Executing tool', { tool: name, input });

  if (name === 'list_tasks') {
    const oid = input.open_id || userOpenId;
    const tasks = await reminderService.getUserPendingTasks(oid, oid);
    if (!tasks.length) return { tasks: [], message: '没有待办任务' };
    return {
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        deadline: t.deadline ? new Date(t.deadline).toISOString().slice(0, 10) : null,
      })),
    };
  }

  if (name === 'create_task') {
    const targetUser = await usersDb.findByOpenId(input.target_open_id);
    const result = await reminderService.createTask({
      title: input.title,
      assigneeId: input.target_open_id,
      assigneeOpenId: input.target_open_id,
      assigneeName: targetUser?.name || null,
      deadline: input.deadline || null,
      creatorId: input.reporter_open_id || userOpenId,
      reporterOpenId: input.reporter_open_id || userOpenId,
    });
    return { success: true, task_id: result?.id, message: `任务「${input.title}」已创建，已通知 ${targetUser?.name || input.target_open_id}` };
  }

  if (name === 'complete_task') {
    const completed = await reminderService.completeTask(
      input.task_id,
      input.proof || '',
      input.user_open_id,
      null
    );
    if (!completed) return { success: false, message: '任务不存在或已完成' };
    return { success: true, message: '任务已完成' };
  }

  if (name === 'send_message') {
    await feishu.sendMessage(input.chat_id, input.content, 'chat_id');
    return { success: true };
  }

  return { error: `Unknown tool: ${name}` };
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(userContext, registeredUsers) {
  const allowed = Object.entries(userContext?.allowedFeatures ?? {})
    .filter(([, v]) => v).map(([k]) => k);

  const userList = registeredUsers?.length
    ? registeredUsers.map(u => `  - ${u.name ?? '(无名称)'} | ${u.email ?? '-'} | open_id: ${u.open_id ?? '-'}`).join('\n')
    : '  (暂无注册用户)';

  return [
    '你是一个飞书（Feishu/Lark）催办任务助手。你通过工具调用来管理任务，用中文与用户交流。',
    '',
    '## 当前用户',
    `姓名: ${userContext?.name ?? '未知'} | open_id: ${userContext?.openId ?? '未知'}`,
    `已开通功能: ${allowed.join(', ') || '无'}`,
    '',
    '## 系统注册用户',
    userList,
    '',
    '## 规则',
    '- 处理任务时必须使用工具，不要直接在文字里说"我已创建"',
    '- target_open_id 必须从上方注册用户里取，不能编造',
    '- 名字不完全匹配时先用 send_message 追问确认，再执行操作',
    '- 找不到用户时告知对方先发一条飞书消息完成注册',
    '- 回复简洁友好，用中文',
    `- 权限检查：cuiban_view(查任务) cuiban_complete(完成任务) cuiban_create(创建任务)，没有权限直接告知`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main: forwardToOwnerAgent
// ---------------------------------------------------------------------------

async function forwardToOwnerAgent(event, apiBaseUrl, userContext = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('ANTHROPIC_API_KEY not set, skipping agent forward');
    return null;
  }

  const message = event.message || {};
  const sender  = event.sender  || {};
  const chatId  = message.chat_id;
  const openId  = sender.sender_id?.open_id || userContext?.open_id;

  let text = '';
  try {
    const raw = JSON.parse(message.content || '{}');
    text = raw.text || message.content || '';
  } catch {
    text = message.content || '';
  }

  if (!text || !chatId) {
    logger.warn('Missing text or chatId, skipping');
    return null;
  }

  // Build registered users list
  let registeredUsers = [];
  try {
    registeredUsers = await usersDb.list({ limit: 100 });
  } catch (e) {
    logger.debug('Could not fetch users', { error: e.message });
  }

  const uc = userContext ? {
    name: userContext.name,
    openId: userContext.open_id,
    role: userContext.role,
    allowedFeatures: userContext.resolvedFeatures ?? {},
  } : null;

  const systemPrompt = buildSystemPrompt(uc, registeredUsers);

  // Load history
  const history = await getHistory(chatId).catch(() => []);

  // Append current user message
  const userMsg = { role: 'user', content: text };
  await appendHistory(chatId, 'user', text).catch(() => {});

  const client = new Anthropic({ apiKey });
  const messages = [...history, userMsg];

  // Agentic loop
  let rounds = 0;
  let finalText = '';

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let response;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });
    } catch (err) {
      logger.error('Anthropic API error', { error: err.message });
      await feishu.sendMessage(chatId, '⚠️ AI 服务暂时不可用，请稍后重试', 'chat_id');
      return null;
    }

    // Collect text from this response
    const textBlocks = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (textBlocks) finalText = textBlocks;

    // If no tool use, we're done
    if (response.stop_reason === 'end_turn') {
      break;
    }

    // Process tool calls
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    if (!toolUses.length) break;

    // Add assistant message to history
    messages.push({ role: 'assistant', content: response.content });

    // Execute all tools and collect results
    const toolResults = [];
    for (const tu of toolUses) {
      const result = await executeTool(tu.name, tu.input, {
        userOpenId: uc?.openId || openId,
        chatId,
      }).catch(err => ({ error: err.message }));

      logger.info('🔧 Tool result', { tool: tu.name, result });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }

    // Add tool results to messages and loop
    messages.push({ role: 'user', content: toolResults });
  }

  // Send final reply if we have text
  if (finalText) {
    try {
      await feishu.sendMessage(chatId, finalText, 'chat_id');
      await appendHistory(chatId, 'assistant', finalText).catch(() => {});
    } catch (err) {
      logger.error('Failed to send reply', { error: err.message });
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Legacy exports (keep for compat)
// ---------------------------------------------------------------------------

module.exports = {
  forwardToOwnerAgent,
  isAgentConfigured: () => !!process.env.ANTHROPIC_API_KEY,
  getAgentConfig: () => process.env.ANTHROPIC_API_KEY ? { model: MODEL } : null,
};
