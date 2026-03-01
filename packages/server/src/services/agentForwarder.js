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
const MAX_CONCURRENT_AGENTS = 10; // prevent unbounded Anthropic API calls under load

// ---------------------------------------------------------------------------
// Lazy singleton Anthropic client (avoids allocating per request)
// ---------------------------------------------------------------------------

let _anthropicClient = null;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!_anthropicClient) {
    _anthropicClient = new Anthropic({ apiKey });
  }
  return _anthropicClient;
}

// ---------------------------------------------------------------------------
// Concurrency semaphore — limits parallel agent calls to avoid exhausting
// connections or hitting Anthropic rate limits under load.
// ---------------------------------------------------------------------------

let _activeAgents = 0;
const _waitQueue = [];

const SLOT_TIMEOUT_MS = 30_000; // 30s max wait for a concurrency slot

function acquireSlot() {
  if (_activeAgents < MAX_CONCURRENT_AGENTS) {
    _activeAgents++;
    return Promise.resolve();
  }
  // Queue the caller, but reject after SLOT_TIMEOUT_MS so users aren't left
  // waiting forever when all slots are held by slow/hung Anthropic calls.
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = _waitQueue.indexOf(resolve);
      if (idx !== -1) _waitQueue.splice(idx, 1);
      reject(new Error('Agent concurrency timeout — please try again'));
    }, SLOT_TIMEOUT_MS);
    _waitQueue.push(() => { clearTimeout(timer); resolve(); });
  });
}

function releaseSlot() {
  if (_waitQueue.length > 0) {
    const next = _waitQueue.shift();
    next();
  } else {
    _activeAgents--;
  }
}

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
  // Atomic insert + prune via CTE to avoid race conditions when concurrent
  // messages arrive for the same chat.
  await pool.query(
    `WITH inserted AS (
       INSERT INTO conversation_history (chat_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING id
     )
     DELETE FROM conversation_history
     WHERE chat_id = $1 AND id NOT IN (
       SELECT id FROM conversation_history WHERE chat_id = $1
       ORDER BY created_at DESC LIMIT $4
     )`,
    [chatId, role, JSON.stringify(content), MAX_HISTORY]
  );
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_tasks',
    description: '获取某用户的待办催办任务列表（完成任务前必须先调用此工具获取 task_id）',
    input_schema: {
      type: 'object',
      properties: {
        open_id: { type: 'string', description: '用户的飞书 open_id (ou_xxx)，默认用当前用户' },
      },
      required: ['open_id'],
    },
  },
  {
    name: 'create_task',
    description: '创建一个催办任务。创建成功后系统会自动通过飞书 DM 通知被催办人，无需再单独发消息。',
    input_schema: {
      type: 'object',
      properties: {
        title:            { type: 'string',  description: '任务标题（简洁描述要完成的事）' },
        target_open_id:   { type: 'string',  description: '被催办人的 open_id（从注册用户列表取）' },
        deadline:         { type: 'string',  description: '截止日期 YYYY-MM-DD，从用户话语中提取，今天/明天等要转成具体日期' },
        note:             { type: 'string',  description: '备注说明，可选' },
        reminder_interval_hours: { type: 'number', description: '提醒间隔小时数，默认 24' },
        priority: {
          type: 'string',
          enum: ['p0', 'p1', 'p2'],
          description: 'P0=紧急（今天必须完成）, P1=一般（默认）, P2=不紧急',
        },
      },
      required: ['title', 'target_open_id', 'deadline'],
    },
  },
  {
    name: 'complete_task',
    description: '将任务标记为已完成。必须先调用 list_tasks 获取 task_id，再调用此工具。',
    input_schema: {
      type: 'object',
      properties: {
        task_id:      { type: 'number', description: '任务 ID（从 list_tasks 结果中获取）' },
        proof:        { type: 'string', description: '完成证明链接或说明，可选' },
      },
      required: ['task_id'],
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
    // First arg is feishuUserId (on_xxx); second is openId (ou_xxx).
    // oid is always an open_id (ou_xxx), so pass null for feishuUserId to
    // avoid matching unrelated records stored under assignee_id with ou_ prefix.
    const tasks = await reminderService.getUserPendingTasks(null, oid);
    if (!tasks.length) return { tasks: [], message: '没有待办任务' };
    return {
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        deadline: t.deadline ? new Date(t.deadline).toISOString().slice(0, 10) : null,
        status: t.status,
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
      note: input.note || null,
      reminderIntervalHours: input.reminder_interval_hours || 24,
      priority: input.priority || 'p1',
      creatorId: userOpenId,
      reporterOpenId: userOpenId,
    });
    return {
      success: true,
      task_id: result?.id,
      assignee_name: targetUser?.name || input.target_open_id,
      message: `任务已创建，系统已通过飞书 DM 通知 ${targetUser?.name || input.target_open_id}`,
    };
  }

  if (name === 'complete_task') {
    // Ownership check: only the task's assignee may complete it via chat.
    // Admins can use the web UI which bypasses this guard.
    const { rows: taskRows } = await pool.query(
      'SELECT assignee_open_id, assignee_id FROM tasks WHERE id = $1 AND status = $2',
      [input.task_id, 'pending']
    );
    const taskRecord = taskRows[0];
    if (!taskRecord) return { success: false, message: '任务不存在或已完成' };

    const isOwner =
      taskRecord.assignee_open_id === userOpenId ||
      taskRecord.assignee_id === userOpenId;
    if (!isOwner) {
      logger.warn('Unauthorized complete_task attempt', {
        taskId: input.task_id, userOpenId,
        assigneeOpenId: taskRecord.assignee_open_id,
      });
      return { success: false, message: '你只能完成分配给自己的任务' };
    }

    const completed = await reminderService.completeTask(
      input.task_id,
      input.proof || '',
      userOpenId,
      null
    );
    if (!completed) return { success: false, message: '任务不存在或已完成' };
    return { success: true, message: '任务已标记为完成' };
  }

  return { error: `Unknown tool: ${name}` };
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(userContext, registeredUsers, chatMeta = {}, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const todayLabel = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' });
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

  const allowed = Object.entries(userContext?.allowedFeatures ?? {})
    .filter(([, v]) => v).map(([k]) => k);

  const userList = registeredUsers?.length
    ? registeredUsers.map(u =>
        `  - 姓名:${u.name ?? '(未知)'} | 邮箱:${u.email ?? '-'} | open_id:${u.open_id ?? '-'} | 角色:${u.role ?? '-'}`
      ).join('\n')
    : '  (暂无注册用户)';

  return [
    '你是一个飞书（Feishu/Lark）催办任务助手，负责帮助用户创建、查看和完成催办任务。通过工具调用执行操作，用中文与用户交流。',
    '',
    `## 时间`,
    `今天: ${todayLabel}（${today}）`,
    `明天: ${tomorrow}`,
    `处理「今天/明天/后天/本周五」等相对日期时，转换成上方对应的 YYYY-MM-DD 格式。`,
    '',
    '## 当前用户（发消息的人）',
    `姓名: ${userContext?.name ?? '未知'}`,
    `open_id: ${userContext?.openId ?? '未知'}（这是 reporter_open_id，也是当前用户自己的任务归属 ID）`,
    `角色: ${userContext?.role ?? 'user'}`,
    `已开通功能: ${allowed.join(', ') || '无'}`,
    '',
    '## 会话信息',
    `chat_id: ${chatMeta.chatId ?? '未知'}`,
    `会话类型: ${chatMeta.chatType === 'group' ? '群聊' : '私聊'}`,
    '',
    '## 系统注册用户（可被催办的人）',
    userList,
    '',
    '## 工具使用规则',
    '- **create_task**: 创建后系统自动 DM 通知被催办人，无需额外发消息',
    '- **complete_task**: 必须先调 list_tasks 获取 task_id，再调此工具',
    '- **target_open_id**: 只能使用注册用户里的 open_id，不能编造',
    '- **priority**: P0=紧急（今天必须完成）, P1=一般（默认，无特别说明时使用）, P2=不紧急；根据用户描述自动判断',
    '- 名字不完全匹配（如「王鸿铭」vs「王泓铭」）时，先在回复中询问确认，再执行操作',
    '- 找不到用户时，告知对方让其先给机器人发一条消息完成注册',
    '- 没有对应权限时直接告知（cuiban_view=查任务 cuiban_complete=完成 cuiban_create=创建）',
    '- 操作成功后，用简洁友好的中文告知用户结果，不要重复工具返回的 JSON',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main: forwardToOwnerAgent
// ---------------------------------------------------------------------------

async function forwardToOwnerAgent(event, apiBaseUrl, userContext = null) {
  const client = getClient();
  if (!client) {
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

  const chatMeta = { chatId, chatType: message.chat_type ?? 'p2p' };
  const systemPrompt = buildSystemPrompt(uc, registeredUsers, chatMeta);

  // Load history
  const history = await getHistory(chatId).catch(() => []);

  // Append current user message
  const userMsg = { role: 'user', content: text };
  await appendHistory(chatId, 'user', text).catch(err =>
    logger.warn('appendHistory(user) failed', { chatId, error: err.message })
  );

  const messages = [...history, userMsg];

  // Acquire concurrency slot (waits if at capacity)
  await acquireSlot();

  try {
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

    // Send final reply
    if (finalText) {
      try {
        await feishu.sendMessage(chatId, finalText, 'chat_id');
        await appendHistory(chatId, 'assistant', finalText).catch(err =>
      logger.warn('appendHistory(assistant) failed', { chatId, error: err.message })
    );
      } catch (err) {
        logger.error('Failed to send reply', { error: err.message });
      }
    } else {
      // No text generated — this happens if Claude only called tools and hit MAX_TOOL_ROUNDS
      // without producing a summary. Notify the user so the request doesn't silently vanish.
      logger.warn('Agentic loop produced no text response', { chatId, rounds });
      await feishu.sendMessage(chatId, '⚠️ 操作处理中遇到问题，请稍后重试或换种说法', 'chat_id').catch(() => {});
    }

    return { ok: true };
  } finally {
    releaseSlot();
  }
}

// ---------------------------------------------------------------------------
// Legacy exports (keep for compat)
// ---------------------------------------------------------------------------

module.exports = {
  forwardToOwnerAgent,
  isAgentConfigured: () => !!process.env.ANTHROPIC_API_KEY,
  getAgentConfig: () => process.env.ANTHROPIC_API_KEY
    ? { model: MODEL, maxHistoryMessages: MAX_HISTORY, maxToolRounds: MAX_TOOL_ROUNDS, maxConcurrentAgents: MAX_CONCURRENT_AGENTS }
    : null,
};
