const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const feishu = require('../feishu/client');
const { admins } = require('../db');
const usersDb = require('../db/users');
const { resolveFeatures } = require('../features');
const { detectIntent } = require('../utils/intentDetector');
const { buildMenu } = require('../utils/menuBuilder');
const reminderService = require('../services/reminder');
const logger = require('../utils/logger');
const agentForwarder = require('../services/agentForwarder');

/**
 * Decrypt Feishu AES-256-CBC encrypted payload.
 * Key = SHA256(FEISHU_ENCRYPT_KEY), IV = first 16 bytes of base64-decoded data.
 */
function decryptFeishuPayload(encryptStr, encryptKey) {
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const buf = Buffer.from(encryptStr, 'base64');
  const iv = buf.subarray(0, 16);
  const ciphertext = buf.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(ciphertext, null, 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// ============ 用户会话管理 ============

// 会话过期时间（5分钟）
const SESSION_TTL_MS = 5 * 60 * 1000;

// 用户会话状态（内存存储）
const userSessions = new Map();

/**
 * 设置用户会话（带自动过期）
 */
function setSession(userId, data) {
  // 清理旧的定时器
  const existing = userSessions.get(userId);
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }

  // 设置新会话
  const timer = setTimeout(() => {
    userSessions.delete(userId);
    logger.debug('Session expired', { userId });
  }, SESSION_TTL_MS);

  userSessions.set(userId, { ...data, timer, createdAt: Date.now() });
}

/**
 * 获取用户会话
 */
function getSession(userId) {
  const session = userSessions.get(userId);
  if (!session) return null;

  // 排除内部字段
  const { timer, ...data } = session;
  return data;
}

/**
 * 删除用户会话
 */
function deleteSession(userId) {
  const session = userSessions.get(userId);
  if (session?.timer) {
    clearTimeout(session.timer);
  }
  userSessions.delete(userId);
}

// ============ 事件去重 ============

const processedEventIds = new Map(); // eventId -> timestamp
const EVENT_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 min

function isDuplicateEvent(eventId) {
  if (!eventId) return false;
  if (processedEventIds.has(eventId)) return true;
  processedEventIds.set(eventId, Date.now());
  // Clean up old entries
  if (processedEventIds.size > 1000) {
    const cutoff = Date.now() - EVENT_DEDUP_TTL_MS;
    for (const [id, ts] of processedEventIds) {
      if (ts < cutoff) processedEventIds.delete(id);
    }
  }
  return false;
}

// ============ Webhook 路由 ============

router.post('/event', async (req, res) => {
  let data = req.body;

  // Decrypt if Feishu sent an encrypted payload
  if (data.encrypt && process.env.FEISHU_ENCRYPT_KEY) {
    try {
      data = decryptFeishuPayload(data.encrypt, process.env.FEISHU_ENCRYPT_KEY);
      logger.info('Webhook decrypted payload', { eventType: data.header?.event_type || data.type });
    } catch (err) {
      logger.error('Failed to decrypt Feishu payload', { error: err.message });
      return res.status(400).json({ error: 'Decryption failed' });
    }
  } else {
    logger.debug('Webhook event received', { eventType: data.header?.event_type || data.type });
  }

  // URL 验证 (v1: data.type, v2: data.header.event_type)
  if (data.type === 'url_verification') {
    logger.info('Challenge v1', { challenge: data.challenge });
    return res.json({ challenge: data.challenge });
  }
  if (data.schema === '2.0' && data.header?.event_type === 'url_verification') {
    logger.info('Challenge v2', { challenge: data.event?.challenge });
    return res.json({ challenge: data.event?.challenge });
  }

  // 处理消息事件
  if (data.header?.event_type === 'im.message.receive_v1') {
    const event = data.event;
    const eventId = data.header?.event_id;
    const msgType = event.message?.message_type;
    const senderId = event.sender?.sender_id?.user_id;

    // 去重：Feishu 有时会重复投递同一事件
    if (isDuplicateEvent(eventId)) {
      logger.debug('Duplicate event ignored', { eventId });
      return res.json({ success: true });
    }

    const chatId = event.message?.chat_id;
    const messageId = event.message?.message_id;
    const openId = event.sender?.sender_id?.open_id;

    // 自动注册用户（首次见到时创建记录）
    // 优先使用 email 作为标识符（需要飞书 contact 权限），降级到 feishu_user_id
    let user = null;
    if (openId || senderId) {
      try {
        // Quick check: already in DB by open_id (avoid unnecessary Feishu API call)
        let userInfo = null;
        const existing = await usersDb.findByOpenId(openId);
        if (!existing) {
          // First time — resolve email via Feishu contact API (silent fail if no permission)
          userInfo = senderId ? await feishu.resolveUserInfo(senderId).catch(() => null) : null;
        }

        user = await usersDb.autoProvision({
          openId,
          email: userInfo?.email || null,
          name: userInfo?.name || null,
          feishuUserId: senderId || null,
        });
      } catch (provisionErr) {
        logger.warn('User auto-provision failed', { senderId, error: provisionErr.message });
      }
    }

    // 解析消息文本（用于意图检测）
    let messageText = '';
    try {
      const rawContent = JSON.parse(event.message?.content || '{}');
      messageText = rawContent.text || '';
    } catch (_) {}

    // 意图检测：greeting 或 menu → 发送动态菜单，跳过 AI
    const intent = detectIntent(messageText);
    if (intent === 'greeting' || intent === 'menu') {
      logger.info('Intent detected, sending menu', { senderId, intent });
      if (chatId) {
        const menuMsg = buildMenu(user || { role: 'user', configs: {} }, { isGreeting: intent === 'greeting' });
        feishu.sendMessage(chatId, menuMsg, 'chat_id').catch((err) => {
          logger.error('Failed to send menu', { error: err.message });
        });
      }
      return res.json({ success: true });
    }

    // 权限检查：用户必须至少有一项功能权限
    if (user) {
      const resolved = resolveFeatures(user);
      user.resolvedFeatures = resolved;
      const hasAnyFeature = Object.values(resolved).some(Boolean);
      if (!hasAnyFeature) {
        logger.info('User has no features, blocking message', { senderId });
        if (chatId) {
          feishu.sendMessage(chatId, '⚠️ 你目前没有任何可用功能，请联系管理员开通权限。', 'chat_id').catch(() => {});
        }
        return res.json({ success: true });
      }
    }

    // ── 催办会话：数字选择（完成任务流程中途回复数字）─────────────────────
    const sessionKey = openId || senderId;
    const activeSession = getSession(sessionKey);
    if (activeSession?.step === 'complete_select' && /^\d+$/.test(messageText.trim())) {
      const idx = parseInt(messageText.trim(), 10) - 1;
      if (idx >= 0 && idx < activeSession.tasks.length) {
        const task = activeSession.tasks[idx];
        deleteSession(sessionKey);
        await completeTaskAndReply(task, activeSession.proof || '', user, senderId, chatId, messageId).catch((err) => {
          logger.error('Complete task error', { error: err.message });
          feishu.sendMessage(chatId, '⚠️ 完成任务失败，请稍后重试。', 'chat_id').catch(() => {});
        });
        return res.json({ success: true });
      } else {
        const count = activeSession.tasks.length;
        await feishu.sendMessage(chatId, `❌ 请输入 1-${count} 之间的数字`, 'chat_id').catch(() => {});
        return res.json({ success: true });
      }
    }

    // ── 催办直接命令（cuiban_view / cuiban_complete / cuiban_create）────────
    if (['cuiban_view', 'cuiban_complete', 'cuiban_create'].includes(intent)) {
      logger.info('Handling cuiban command', { intent, senderId });
      const handled = await handleCuibanCommand({
        intent,
        text: messageText,
        user,
        senderId,
        chatId,
        messageId,
        sessionKey,
      }).catch((err) => {
        logger.error('Cuiban command error', { error: err.message });
        feishu.sendMessage(chatId, '⚠️ 命令处理失败，请稍后重试。', 'chat_id').catch(() => {});
        return true; // mark as handled (error already sent)
      });
      if (handled) return res.json({ success: true });
    }

    // 转发给配置的 AI Agent（附带用户权限上下文）
    const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3456}`;
    agentForwarder.forwardToOwnerAgent(event, apiBaseUrl, user).catch(async (err) => {
      logger.error('Agent forwarding failed', { error: err.message });
      // 通知用户转发失败
      if (chatId) {
        try {
          await feishu.sendMessage(chatId, '⚠️ 消息处理失败，请稍后重试。', 'chat_id');
        } catch (sendErr) {
          logger.error('Failed to send error message to user', { error: sendErr.message });
        }
      }
    });

    // 内置的催办功能（可选，保留向后兼容）
    if (process.env.ENABLE_BUILTIN_BOT !== 'false' && msgType === 'text' && senderId) {
      try {
        const content = JSON.parse(event.message.content || '{}');
        if (content.text) {
          handleUserMessage(senderId, content.text).catch((err) => {
            logger.error('Message handling failed', {
              error: err.message,
              userId: senderId,
            });
          });
        }
      } catch (parseErr) {
        logger.warn('Failed to parse builtin bot message content', { error: parseErr.message });
      }
    }
  }

  res.json({ success: true });
});

// ============ 消息处理 ============

/**
 * 处理用户消息主入口
 */
async function handleUserMessage(userId, text) {
  logger.info('Message received', { userId, textLength: text.length });

  const isAdminUser = await admins.isAdmin(userId, null);
  const lowerText = text.toLowerCase().trim();
  const links = extractLinks(text);

  // Admin 命令
  if (isAdminUser) {
    const handled = await handleAdminCommand(userId, lowerText);
    if (handled) return;
  }

  // 普通用户命令
  const handled = await handleUserCommand(userId, lowerText, links);
  if (handled) return;

  // 处理会话上下文（数字选择等）
  const sessionHandled = await handleSessionContext(userId, lowerText, links);
  if (sessionHandled) return;

  // 发送帮助信息
  await sendHelpMessage(userId, isAdminUser);
}

/**
 * 从文本中提取链接
 */
function extractLinks(text) {
  return text.match(/(https?:\/\/[^\s]+)/g) || [];
}

// ============ Admin 命令处理 ============

async function handleAdminCommand(userId, lowerText) {
  // 创建任务提示
  if (lowerText.startsWith('/add ') || lowerText.startsWith('创建任务')) {
    await feishu.sendMessage(
      userId,
      '📝 创建任务请使用格式：\n/add 任务名称 用户邮箱 截止日期\n\n示例：\n/add 提交周报 zhangsan@company.com 2026-03-01'
    );
    return true;
  }

  // 查看所有任务
  if (lowerText === '/all' || lowerText === '所有任务') {
    const tasks = await reminderService.getAllTasks();
    if (tasks.length === 0) {
      await feishu.sendMessage(userId, '📋 暂无任务');
      return true;
    }

    let reply = '📋 所有任务：\n\n';
    tasks.forEach((task, i) => {
      const name = reminderService.extractFieldText(task.fields[reminderService.FIELDS.TASK_NAME]);
      const target = reminderService.extractFieldText(task.fields[reminderService.FIELDS.TARGET]);
      const status = reminderService.extractFieldText(task.fields[reminderService.FIELDS.STATUS]);
      reply += `${i + 1}. ${name} → ${target} [${status}]\n`;
    });
    await feishu.sendMessage(userId, reply);
    return true;
  }

  // 查看待办
  if (lowerText === '/pending' || lowerText === '待办') {
    const tasks = await reminderService.getAllPendingTasks();
    if (tasks.length === 0) {
      await feishu.sendMessage(userId, '✅ 没有待办任务');
      return true;
    }

    let reply = '⏳ 待办任务：\n\n';
    tasks.forEach((task, i) => {
      const name = reminderService.extractFieldText(task.fields[reminderService.FIELDS.TASK_NAME]);
      const target = reminderService.extractFieldText(task.fields[reminderService.FIELDS.TARGET]);
      reply += `${i + 1}. ${name} → ${target}\n   ID: ${task.record_id}\n`;
    });
    await feishu.sendMessage(userId, reply);
    return true;
  }

  return false;
}

// ============ 普通用户命令处理 ============

async function handleUserCommand(userId, lowerText, links) {
  // 查看自己的任务
  if (lowerText.includes('任务') || lowerText.includes('待办') || lowerText === '/list') {
    const tasks = await reminderService.getUserPendingTasks(userId);
    if (tasks.length === 0) {
      await feishu.sendMessage(userId, '🎉 你没有待办的催办任务');
      return true;
    }

    let reply = '📋 你的待办任务：\n\n';
    tasks.forEach((task, i) => {
      const name = reminderService.extractFieldText(task.fields[reminderService.FIELDS.TASK_NAME]);
      reply += `${i + 1}. ${name}\n`;
    });
    reply += '\n发送「完成」或证明材料链接来完成任务';

    setSession(userId, { tasks, step: 'select_task' });
    await feishu.sendMessage(userId, reply);
    return true;
  }

  // 完成任务
  if (lowerText.includes('完成') || lowerText === 'done' || links.length > 0) {
    const tasks = await reminderService.getUserPendingTasks(userId);

    if (tasks.length === 0) {
      await feishu.sendMessage(userId, '✅ 你目前没有待办任务');
      return true;
    }

    if (tasks.length === 1) {
      // 只有一个任务，直接完成
      await completeTaskAndNotify(userId, tasks[0], links[0]);
      return true;
    }

    // 多个任务，让用户选择
    let reply = '你有多个待办任务，请回复编号选择：\n\n';
    tasks.forEach((task, i) => {
      const name = reminderService.extractFieldText(task.fields[reminderService.FIELDS.TASK_NAME]);
      reply += `${i + 1}. ${name}\n`;
    });

    setSession(userId, { tasks, links, step: 'complete_select' });
    await feishu.sendMessage(userId, reply);
    return true;
  }

  return false;
}

// ============ 会话上下文处理 ============

async function handleSessionContext(userId, lowerText, links) {
  // 检查是否为有效的数字选择（正整数）
  const numMatch = lowerText.match(/^(\d+)$/);
  if (!numMatch) return false;

  const num = parseInt(numMatch[1], 10);
  if (num < 1) return false; // 排除 0 或负数

  const session = getSession(userId);
  if (!session || session.step !== 'complete_select') return false;

  const index = num - 1;
  if (index >= session.tasks.length) {
    await feishu.sendMessage(userId, `❌ 请输入 1-${session.tasks.length} 之间的数字`);
    return true;
  }

  const task = session.tasks[index];
  const proof = session.links?.[0] || links[0] || '';

  await completeTaskAndNotify(userId, task, proof);
  deleteSession(userId);
  return true;
}

// ============ 辅助函数 ============

/**
 * 完成任务并发送通知
 */
async function completeTaskAndNotify(userId, task, proof) {
  const taskName = reminderService.extractFieldText(task.fields[reminderService.FIELDS.TASK_NAME]);

  await reminderService.completeTask(task.record_id, proof || '', userId);

  let reply = `✅ 已完成任务「${taskName}」`;
  if (proof) reply += `\n📎 证明材料: ${proof}`;
  await feishu.sendMessage(userId, reply);
}

/**
 * 发送帮助信息
 */
async function sendHelpMessage(userId, isAdmin) {
  let help = '👋 你好！我是催办助手。\n\n';
  help += '📋 发送「任务」查看你的待办\n';
  help += '✅ 发送「完成」或证明链接来完成任务\n';

  if (isAdmin) {
    help += '\n--- 管理员命令 ---\n';
    help += '/all - 查看所有任务\n';
    help += '/pending - 查看待办任务\n';
  }

  await feishu.sendMessage(userId, help);
}

// ══════════════════════════════════════════════════════════════════════════════
// 催办命令处理器
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 检查催办功能是否已配置（需要飞书多维表格环境变量）
 */
function isReminderConfigured() {
  return !!(process.env.REMINDER_APP_TOKEN && process.env.REMINDER_TABLE_ID);
}

/**
 * 向聊天发送回复（优先线程回复，否则发到 chat）
 */
async function replyToChat(chatId, messageId, text) {
  if (messageId) {
    return feishu.sendMessage(chatId, text, 'chat_id', messageId).catch(() =>
      // Fallback: send to chat without threading
      feishu.sendMessage(chatId, text, 'chat_id')
    );
  }
  return feishu.sendMessage(chatId, text, 'chat_id');
}

/**
 * 完成任务并通知用户
 */
async function completeTaskAndReply(task, proof, user, senderId, chatId, messageId) {
  const taskName = reminderService.extractFieldText(task.fields[reminderService.FIELDS.TASK_NAME]);
  await reminderService.completeTask(task.record_id, proof || '', senderId);
  let reply = `✅ 已完成任务「${taskName}」！`;
  if (proof) reply += `\n📎 证明：${proof}`;
  await replyToChat(chatId, messageId, reply);
}

/**
 * 主催办命令处理函数
 * @param {object} params
 * @param {string} params.intent - 'cuiban_view' | 'cuiban_complete' | 'cuiban_create'
 * @param {string} params.text - 原始消息文本
 * @param {object} params.user - 用户记录（含 resolvedFeatures）
 * @param {string} params.senderId - 飞书 feishu_user_id（用于 Bitable 操作）
 * @param {string} params.chatId - 聊天 ID
 * @param {string} params.messageId - 消息 ID（用于线程回复）
 * @param {string} params.sessionKey - 会话 key（openId || senderId）
 * @returns {Promise<boolean>} true if handled
 */
async function handleCuibanCommand({ intent, text, user, senderId, chatId, messageId, sessionKey }) {
  // 功能未配置时给出明确提示
  if (!isReminderConfigured()) {
    await replyToChat(
      chatId,
      messageId,
      '⚠️ 催办功能尚未配置，请联系管理员设置 REMINDER_APP_TOKEN 和 REMINDER_TABLE_ID'
    );
    return true;
  }

  const resolved = user?.resolvedFeatures || resolveFeatures(user || { role: 'user', configs: {} });

  // ── 查看任务 ──────────────────────────────────────────────────────────────
  if (intent === 'cuiban_view') {
    if (!resolved.cuiban_view) {
      await replyToChat(chatId, messageId, '🚫 你没有查看催办任务的权限，请联系管理员');
      return true;
    }

    const tasks = await reminderService.getUserPendingTasks(senderId);

    if (!tasks.length) {
      await replyToChat(chatId, messageId, '🎉 你目前没有待办的催办任务！');
      return true;
    }

    let msg = `📋 你的待办任务（${tasks.length} 项）：\n\n`;
    tasks.forEach((t, i) => {
      const name = reminderService.extractFieldText(t.fields[reminderService.FIELDS.TASK_NAME]);
      const deadlineMs = t.fields[reminderService.FIELDS.DEADLINE];
      const deadlineStr = deadlineMs
        ? new Date(deadlineMs).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
        : '无截止日期';
      msg += `${i + 1}. ${name}\n   📅 ${deadlineStr}\n`;
    });
    msg += '\n发送「完成 N」标记对应任务完成';
    await replyToChat(chatId, messageId, msg);
    return true;
  }

  // ── 完成任务 ──────────────────────────────────────────────────────────────
  if (intent === 'cuiban_complete') {
    if (!resolved.cuiban_complete) {
      await replyToChat(chatId, messageId, '🚫 你没有完成任务的权限，请联系管理员');
      return true;
    }

    // 解析参数：可能包含任务名/序号 + 证明链接
    const match = text.trim().match(/^(?:完成|done|\/done|\/complete)\s*([\s\S]*)?$/i);
    const arg = (match?.[1] || '').trim();

    // 提取证明链接（URL）
    const urlMatch = arg.match(/(https?:\/\/[^\s]+)/);
    const proof = urlMatch?.[1] || '';
    const cleanArg = arg.replace(/(https?:\/\/[^\s]+)/g, '').trim();

    const tasks = await reminderService.getUserPendingTasks(senderId);

    if (!tasks.length) {
      await replyToChat(chatId, messageId, '✅ 你目前没有待办任务');
      return true;
    }

    let targetTask = null;

    // 尝试数字序号选择
    if (/^\d+$/.test(cleanArg)) {
      const idx = parseInt(cleanArg, 10) - 1;
      if (idx >= 0 && idx < tasks.length) targetTask = tasks[idx];
    }

    // 尝试任务名模糊匹配
    if (!targetTask && cleanArg) {
      targetTask = tasks.find((t) => {
        const name = reminderService.extractFieldText(t.fields[reminderService.FIELDS.TASK_NAME]);
        return name.includes(cleanArg) || cleanArg.includes(name);
      });
    }

    // 只有一个任务 → 直接完成
    if (!targetTask && tasks.length === 1) {
      targetTask = tasks[0];
    }

    if (targetTask) {
      await completeTaskAndReply(targetTask, proof, user, senderId, chatId, messageId);
      return true;
    }

    // 多个任务，让用户选择
    let msg = `你有 ${tasks.length} 个待办任务，请回复编号选择：\n\n`;
    tasks.forEach((t, i) => {
      const name = reminderService.extractFieldText(t.fields[reminderService.FIELDS.TASK_NAME]);
      msg += `${i + 1}. ${name}\n`;
    });
    msg += '\n（回复数字选择，如「1」）';

    setSession(sessionKey, { tasks, proof, step: 'complete_select', chatId, messageId });
    await replyToChat(chatId, messageId, msg);
    return true;
  }

  // ── 创建任务 ──────────────────────────────────────────────────────────────
  if (intent === 'cuiban_create') {
    if (!resolved.cuiban_create) {
      await replyToChat(chatId, messageId, '🚫 你没有创建催办任务的权限，请联系管理员');
      return true;
    }

    // 解析格式：/add 任务名称 用户邮箱/ID [截止日期YYYY-MM-DD]
    const addMatch = text.trim().match(/^\/add\s+(.+)$/i);
    if (!addMatch) {
      await replyToChat(
        chatId,
        messageId,
        '📝 创建任务格式：\n/add 任务名称 用户邮箱 [截止日期]\n\n示例：\n/add 提交周报 zhangsan@company.com 2026-03-01'
      );
      return true;
    }

    const parts = addMatch[1].trim().split(/\s+/);
    if (parts.length < 2) {
      await replyToChat(
        chatId,
        messageId,
        '📝 格式：/add 任务名称 用户邮箱 [截止日期]\n示例：/add 提交周报 zhangsan@company.com 2026-03-01'
      );
      return true;
    }

    // 解析：最后一个 YYYY-MM-DD 格式的 part 是截止日期
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    let taskName, target, deadline;

    if (parts.length >= 3 && datePattern.test(parts[parts.length - 1])) {
      deadline = parts[parts.length - 1];
      target = parts[parts.length - 2];
      taskName = parts.slice(0, parts.length - 2).join(' ');
    } else {
      target = parts[parts.length - 1];
      taskName = parts.slice(0, parts.length - 1).join(' ');
    }

    if (!taskName) {
      await replyToChat(chatId, messageId, '❌ 任务名称不能为空');
      return true;
    }

    // 查找目标用户（按邮箱 → 按 feishu_user_id）
    let targetUser = null;
    if (target.includes('@')) {
      targetUser = await usersDb.findByEmail(target);
    }
    if (!targetUser) {
      targetUser = await usersDb.findByFeishuUserId(target);
    }

    if (!targetUser || !targetUser.feishu_user_id) {
      await replyToChat(
        chatId,
        messageId,
        `❌ 找不到用户「${target}」\n请使用已注册用户的邮箱地址，或先让对方发送一条消息完成注册`
      );
      return true;
    }

    await reminderService.createTask({
      taskName,
      targetUserId: targetUser.feishu_user_id,
      deadline,
      creatorId: senderId,
    });

    const deadlineStr = deadline || `默认 ${reminderService.DEFAULT_DEADLINE_DAYS} 天`;
    const targetLabel = targetUser.name || targetUser.email || target;
    await replyToChat(
      chatId,
      messageId,
      `✅ 任务已创建！\n📋 ${taskName}\n👤 → ${targetLabel}\n📅 截止：${deadlineStr}`
    );
    return true;
  }

  return false;
}

module.exports = router;
