const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const feishu = require('../feishu/client');
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
    const unionId = event.sender?.sender_id?.union_id;

    // ── [1] 收到消息，打印原始 ID ─────────────────────────────────────────
    logger.info('📨 Message received', {
      eventId,
      chatId,
      messageId,
      msgType: event.message?.message_type,
      senderId:  senderId  || '(null)',
      openId:    openId    || '(null)',
      unionId:   unionId   || '(null)',
      chatType:  event.message?.chat_type,
    });

    // 自动注册用户 + 补全信息
    let user = null;
    if (openId || senderId) {
      try {
        const existing = await usersDb.findByOpenId(openId);
        logger.info('👤 User lookup', {
          openId,
          found: !!existing,
          existingName: existing?.name || null,
          existingEmail: existing?.email || null,
          existingPhone: existing?.phone || null,
        });

        // Resolve user info from Feishu Contact API when:
        //   a) new user (no DB record), or
        //   b) existing user still missing name (contact permission may have been added later)
        // Try user_id first; fall back to open_id if user_id isn't in the event
        let userInfo = null;
        const needsResolve = !existing || (!existing.name && !existing.email);
        if (needsResolve) {
          const resolveBy = senderId ? `user_id=${senderId}` : `open_id=${openId}`;
          logger.info('🔍 Resolving user info from Feishu Contact API', { resolveBy });
          userInfo = await (
            senderId
              ? feishu.resolveUserInfo(senderId, 'user_id')
              : feishu.resolveUserInfo(openId, 'open_id')
          ).catch((err) => {
            logger.warn('resolveUserInfo failed', { error: err.message });
            return null;
          });
          logger.info('🔍 resolveUserInfo result', {
            success: !!userInfo,
            name:  userInfo?.name  || null,
            email: userInfo?.email || null,
            phone: userInfo?.mobile || null,
            feishuUserId: userInfo?.feishuUserId || null,
            reason: userInfo ? 'ok' : 'null (no contact permission or API error)',
          });
        } else {
          logger.info('⏭️  Skip resolveUserInfo (user already has name/email)', {
            name: existing.name, email: existing.email,
          });
        }

        user = await usersDb.autoProvision({
          openId,
          email: userInfo?.email || null,
          phone: userInfo?.mobile || null,
          name: userInfo?.name || null,
          feishuUserId: senderId || userInfo?.feishuUserId || null,
        });

        logger.info('✅ User provisioned', {
          userId:        user?.user_id,
          name:          user?.name   || '(none)',
          email:         user?.email  || '(none)',
          phone:         user?.phone  || '(none)',
          role:          user?.role,
          feishuUserId:  user?.feishu_user_id || '(none)',
          openId:        user?.open_id || '(none)',
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

    // ── [2] 意图检测 ──────────────────────────────────────────────────────
    const intent = detectIntent(messageText);
    logger.info('🧭 Intent detected', {
      intent,
      text: messageText.slice(0, 80) || '(empty)',
    });

    if (intent === 'greeting' || intent === 'menu') {
      if (chatId) {
        const menuMsg = buildMenu(user || { role: 'user', configs: {} }, { isGreeting: intent === 'greeting' });
        feishu.sendMessage(chatId, menuMsg, 'chat_id').catch((err) => {
          logger.error('Failed to send menu', { error: err.message });
        });
      }
      return res.json({ success: true });
    }

    // ── [3] 权限检查 ──────────────────────────────────────────────────────
    if (user) {
      const resolved = resolveFeatures(user);
      user.resolvedFeatures = resolved;
      const enabledFeatures = Object.entries(resolved).filter(([,v]) => v).map(([k]) => k);
      logger.info('🔐 User features', { userId: user.user_id, enabled: enabledFeatures });
      if (!enabledFeatures.length) {
        logger.info('🚫 No features — blocking message', { userId: user.user_id });
        if (chatId) {
          feishu.sendMessage(chatId, '⚠️ 你目前没有任何可用功能，请联系管理员开通权限。', 'chat_id').catch(() => {});
        }
        return res.json({ success: true });
      }
    }

    // ── [4] 会话上下文（数字选择） ────────────────────────────────────────
    const sessionKey = openId || senderId;
    const activeSession = getSession(sessionKey);
    if (activeSession) {
      logger.info('💬 Active session found', { step: activeSession.step, taskCount: activeSession.tasks?.length });
    }
    if (activeSession?.step === 'complete_select' && /^\d+$/.test(messageText.trim())) {
      const idx = parseInt(messageText.trim(), 10) - 1;
      logger.info('✔️  Session: completing task by number', { idx: idx + 1 });
      if (idx >= 0 && idx < activeSession.tasks.length) {
        const task = activeSession.tasks[idx];
        deleteSession(sessionKey);
        await completeTaskAndReply(task, activeSession.proof || '', user, user?.user_id || senderId, chatId, messageId).catch((err) => {
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

    // ── [5] 催办直接命令 ──────────────────────────────────────────────────
    if (['cuiban_view', 'cuiban_complete', 'cuiban_create'].includes(intent)) {
      logger.info('📋 Handling cuiban command', { intent, senderId, text: messageText.slice(0, 60) });
      const handled = await handleCuibanCommand({
        intent,
        text: messageText,
        user,
        senderId,
        openId,
        chatId,
        messageId,
        sessionKey,
      }).catch((err) => {
        logger.error('Cuiban command error', { error: err.message });
        feishu.sendMessage(chatId, '⚠️ 命令处理失败，请稍后重试。', 'chat_id').catch(() => {});
        return true;
      });
      if (handled) return res.json({ success: true });
    }

    // ── [6] 转发给 AI Agent ────────────────────────────────────────────────
    logger.info('🤖 Forwarding to AI agent', { userId: user?.user_id, intent });
    const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3456}`;
    agentForwarder.forwardToOwnerAgent(event, apiBaseUrl, user).catch(async (err) => {
      logger.error('Agent forwarding failed', { error: err.message });
      if (chatId) {
        try {
          await feishu.sendMessage(chatId, '⚠️ 消息处理失败，请稍后重试。', 'chat_id');
        } catch (sendErr) {
          logger.error('Failed to send error message to user', { error: sendErr.message });
        }
      }
    });

  }

  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// 催办命令处理器
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 向聊天发送回复（优先线程回复，否则发到 chat）
 */
async function replyToChat(chatId, messageId, text) {
  if (messageId) {
    return feishu.sendMessage(chatId, text, 'chat_id', messageId).catch(() =>
      feishu.sendMessage(chatId, text, 'chat_id')
    );
  }
  return feishu.sendMessage(chatId, text, 'chat_id');
}

/**
 * 完成任务并通知用户
 */
async function completeTaskAndReply(task, proof, user, senderId, chatId, messageId) {
  const completerName = user?.name || user?.email || null;
  const completed = await reminderService.completeTask(task.id, proof || '', senderId, completerName);
  if (!completed) {
    await replyToChat(chatId, messageId, `⚠️ 任务「${task.title}」不存在或已完成`);
    return;
  }
  let reply = `✅ 已完成任务「${task.title}」！`;
  if (proof) reply += `\n📎 证明：${proof}`;
  await replyToChat(chatId, messageId, reply);
}

/**
 * 主催办命令处理函数
 * @param {object} params
 * @param {string} params.intent - 'cuiban_view' | 'cuiban_complete' | 'cuiban_create'
 * @param {string} params.text - 原始消息文本
 * @param {object} params.user - 用户记录（含 resolvedFeatures）
 * @param {string} params.senderId - 飞书 feishu_user_id（用于任务查询和审计）
 * @param {string} params.chatId - 聊天 ID
 * @param {string} params.messageId - 消息 ID（用于线程回复）
 * @param {string} params.sessionKey - 会话 key（openId || senderId）
 * @returns {Promise<boolean>} true if handled
 */
async function handleCuibanCommand({ intent, text, user, senderId, openId, chatId, messageId, sessionKey }) {
  const resolved = user?.resolvedFeatures || resolveFeatures(user || { role: 'user', configs: {} });

  // 用于任务查询的 feishu_user_id：优先用 DB 里存的（autoProvision 可能从 contact API 补全过）
  const effectiveSenderId = user?.user_id || senderId;

  // ── 查看任务 ──────────────────────────────────────────────────────────────
  if (intent === 'cuiban_view') {
    if (!resolved.cuiban_view) {
      await replyToChat(chatId, messageId, '🚫 你没有查看催办任务的权限，请联系管理员');
      return true;
    }

    if (!effectiveSenderId) {
      await replyToChat(chatId, messageId, '⚠️ 无法识别你的飞书用户 ID，请联系管理员');
      return true;
    }

    const tasks = await reminderService.getUserPendingTasks(effectiveSenderId);

    if (!tasks.length) {
      await replyToChat(chatId, messageId, '🎉 你目前没有待办的催办任务！');
      return true;
    }

    let msg = `📋 你的待办任务（${tasks.length} 项）：\n\n`;
    tasks.forEach((t, i) => {
      const deadlineStr = t.deadline
        ? new Date(t.deadline).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
        : '无截止日期';
      msg += `${i + 1}. ${t.title}\n   📅 ${deadlineStr}\n`;
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

    if (!effectiveSenderId) {
      await replyToChat(chatId, messageId, '⚠️ 无法识别你的飞书用户 ID，请联系管理员');
      return true;
    }

    const tasks = await reminderService.getUserPendingTasks(effectiveSenderId);

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
      targetTask = tasks.find((t) => t.title.includes(cleanArg) || cleanArg.includes(t.title));
    }

    // 只有一个任务 → 直接完成
    if (!targetTask && tasks.length === 1) {
      targetTask = tasks[0];
    }

    if (targetTask) {
      await completeTaskAndReply(targetTask, proof, user, effectiveSenderId, chatId, messageId);
      return true;
    }

    // 多个任务，让用户选择
    let msg = `你有 ${tasks.length} 个待办任务，请回复编号选择：\n\n`;
    tasks.forEach((t, i) => {
      msg += `${i + 1}. ${t.title}\n`;
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
      title: taskName,
      assigneeId: targetUser.feishu_user_id,
      assigneeOpenId: targetUser.open_id || null,
      assigneeName: targetUser.name || null,
      deadline,
      creatorId: senderId,
      reporterOpenId: openId || null,  // 报告对象：催办发起人，任务完成时收到通知
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
