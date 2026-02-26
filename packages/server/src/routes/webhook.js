const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const feishu = require('../feishu/client');
const { admins } = require('../db');
const usersDb = require('../db/users');
const { can } = require('../features');
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
    const openId = event.sender?.sender_id?.open_id;

    // 自动注册用户（首次见到时创建记录）
    let user = null;
    if (senderId) {
      try {
        user = await usersDb.autoProvision({
          userId: senderId,
          openId,
          name: null, // Feishu event doesn't carry display name; can be enriched later
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
      const { resolveFeatures } = require('../features');
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
      const content = JSON.parse(event.message.content);
      // 异步处理，立即返回
      handleUserMessage(senderId, content.text).catch((err) => {
        logger.error('Message handling failed', {
          error: err.message,
          userId: senderId,
        });
      });
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

module.exports = router;
