/**
 * Cuiban (催办) Command Handler
 *
 * Handles cuiban_view, cuiban_complete, cuiban_create intents
 * from Feishu chat messages. Extracted from webhook.js for clarity.
 */

const feishu = require('../feishu/client');
const usersDb = require('../db/users');
const sessions = require('../db/sessions');
const { resolveFeatures } = require('../features');
const reminderService = require('../services/reminder');
const logger = require('../utils/logger');

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Send a reply (thread reply if possible, else plain chat message).
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
 * Complete a task and notify the user.
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

// ── session-based numeric selection ─────────────────────────────────────────

/**
 * Handle a numeric reply inside an active complete_select session.
 * @returns {Promise<boolean>} true if handled
 */
async function handleSessionSelect({ sessionKey, messageText, user, senderId, chatId, messageId }) {
  const activeSession = await sessions.get(sessionKey);
  if (!activeSession) return false;

  logger.info('💬 Active session found', { step: activeSession.step, taskCount: activeSession.tasks?.length });

  if (activeSession.step === 'complete_select' && /^\d+$/.test(messageText.trim())) {
    const idx = parseInt(messageText.trim(), 10) - 1;
    logger.info('✔️  Session: completing task by number', { idx: idx + 1 });
    if (idx >= 0 && idx < activeSession.tasks.length) {
      const task = activeSession.tasks[idx];
      await sessions.del(sessionKey);
      const effectiveSenderId = user?.feishu_user_id || senderId;
      await completeTaskAndReply(task, activeSession.proof || '', user, effectiveSenderId, chatId, messageId).catch((err) => {
        logger.error('Complete task error', { error: err.message });
        feishu.sendMessage(chatId, '⚠️ 完成任务失败，请稍后重试。', 'chat_id').catch(() => {});
      });
      return true;
    } else {
      const count = activeSession.tasks.length;
      await feishu.sendMessage(chatId, `❌ 请输入 1-${count} 之间的数字`, 'chat_id').catch(() => {});
      return true;
    }
  }

  return false;
}

// ── main handler ────────────────────────────────────────────────────────────

/**
 * Main cuiban command handler.
 * @param {object} params
 * @param {string} params.intent - 'cuiban_view' | 'cuiban_complete' | 'cuiban_create'
 * @param {string} params.text - Raw message text
 * @param {object} params.user - User record (with resolvedFeatures)
 * @param {string} params.senderId - Feishu user_id (may be null)
 * @param {string} params.openId  - Feishu open_id (ou_xxx)
 * @param {string} params.chatId - Chat ID
 * @param {string} params.messageId - Message ID (for thread reply)
 * @param {string} params.sessionKey - Session key (openId || senderId)
 * @returns {Promise<boolean>} true if handled
 */
async function handleCuibanCommand({ intent, text, user, senderId, openId, chatId, messageId, sessionKey }) {
  const resolved = user?.resolvedFeatures || resolveFeatures(user || { role: 'user', configs: {} });

  // Tasks are indexed by feishu_user_id (on_xxx), NOT user_id (which may be an email).
  const effectiveSenderId = user?.feishu_user_id || senderId;

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

    const tasks = await reminderService.getUserPendingTasks(effectiveSenderId, openId);

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

    // 支持两种格式：
    //   正向：完成 [任务名/序号] [证明链接]
    //   自然语言：[任务名] 任务完成 / [任务名] 完成了
    const forwardMatch = text.trim().match(/^(?:完成|done|\/done|\/complete)\s*([\s\S]*)?$/i);
    const reverseMatch = text.trim().match(/^([\s\S]+?)\s+(?:任务完成|完成了|已完成|done了)(\s+https?:\/\/\S+)?$/i);
    let arg = '';
    if (forwardMatch) {
      arg = (forwardMatch[1] || '').trim();
    } else if (reverseMatch) {
      arg = (reverseMatch[1] || '').trim();
      if (reverseMatch[2]) arg += reverseMatch[2].trim();
    }

    const urlMatch = arg.match(/(https?:\/\/[^\s]+)/);
    const proof = urlMatch?.[1] || '';
    const cleanArg = arg.replace(/(https?:\/\/[^\s]+)/g, '').trim();

    if (!effectiveSenderId) {
      await replyToChat(chatId, messageId, '⚠️ 无法识别你的飞书用户 ID，请联系管理员');
      return true;
    }

    const tasks = await reminderService.getUserPendingTasks(effectiveSenderId, openId);

    if (!tasks.length) {
      await replyToChat(chatId, messageId, '✅ 你目前没有待办任务');
      return true;
    }

    let targetTask = null;

    if (/^\d+$/.test(cleanArg)) {
      const idx = parseInt(cleanArg, 10) - 1;
      if (idx >= 0 && idx < tasks.length) targetTask = tasks[idx];
    }

    if (!targetTask && cleanArg) {
      const lower = cleanArg.toLowerCase();
      // Priority: exact match > startsWith > includes (avoid short-title false positives)
      targetTask =
        tasks.find((t) => t.title.toLowerCase() === lower) ||
        tasks.find((t) => t.title.toLowerCase().startsWith(lower)) ||
        tasks.find((t) => t.title.toLowerCase().includes(lower));
    }

    if (!targetTask && tasks.length === 1) {
      targetTask = tasks[0];
    }

    if (targetTask) {
      await completeTaskAndReply(targetTask, proof, user, effectiveSenderId, chatId, messageId);
      return true;
    }

    // Multiple tasks — ask user to choose
    let msg = `你有 ${tasks.length} 个待办任务，请回复编号选择：\n\n`;
    tasks.forEach((t, i) => {
      msg += `${i + 1}. ${t.title}\n`;
    });
    msg += '\n（回复数字选择，如「1」）';

    // Store only id + title to avoid bloating the session table
    const taskSummaries = tasks.map(t => ({ id: t.id, title: t.title }));
    await sessions.set(sessionKey, { tasks: taskSummaries, proof, step: 'complete_select', chatId, messageId });
    await replyToChat(chatId, messageId, msg);
    return true;
  }

  // ── 创建任务 ──────────────────────────────────────────────────────────────
  if (intent === 'cuiban_create') {
    if (!resolved.cuiban_create) {
      await replyToChat(chatId, messageId, '🚫 你没有创建催办任务的权限，请联系管理员');
      return true;
    }

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

    let targetUser = null;
    if (target.includes('@')) {
      targetUser = await usersDb.findByEmail(target);
    }
    if (!targetUser) {
      targetUser = await usersDb.findByFeishuUserId(target);
    }
    if (!targetUser) {
      const nameMatches = await usersDb.searchByName(target, 5);
      if (nameMatches.length === 1) {
        targetUser = nameMatches[0];
      } else if (nameMatches.length > 1) {
        const list = nameMatches.slice(0, 5).map((u) => `• ${u.name}`).join('\n');
        await replyToChat(chatId, messageId,
          `⚠️ 找到多个名字相似的用户，请用邮箱指定：\n\n${list}`
        );
        return true;
      }
    }

    if (!targetUser || (!targetUser.feishu_user_id && !targetUser.open_id)) {
      await replyToChat(
        chatId,
        messageId,
        `❌ 找不到用户「${target}」\n支持邮箱、姓名搜索。请先让对方发送一条飞书消息完成注册。`
      );
      return true;
    }

    await reminderService.createTask({
      title: taskName,
      assigneeId: targetUser.feishu_user_id || targetUser.open_id,
      assigneeOpenId: targetUser.open_id || null,
      assigneeName: targetUser.name || null,
      deadline,
      creatorId: senderId,
      reporterOpenId: openId || null,
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

  // ── 自然语言催办创建 ─────────────────────────────────────────────────────
  if (intent === 'cuiban_create_nl') {
    if (!resolved.cuiban_create) {
      await replyToChat(chatId, messageId, '🚫 你没有创建催办任务的权限，请联系管理员');
      return true;
    }

    // Extract person name from message
    const nlPatterns = [
      /给(.{1,20}?)(?:发|送)(?:一?个?)?(?:催办|催一下|任务|提醒)/,
      /催(?:一下|催)?(.{2,20}?)(?:完成|做|交|提交|处理|$)/,
      /(?:发|送)催办给(.{1,20})/,
    ];

    let personName = null;
    let taskTitle = '催办';

    for (const pat of nlPatterns) {
      const m = text.trim().match(pat);
      if (m && m[1] && m[1].trim().length >= 2) {
        personName = m[1].trim()
          .replace(/^[的一个\s]+|[的一个\s]+$/g, '')  // strip particles
          .trim();
        break;
      }
    }

    // Try to extract a custom task title (text before the person action)
    const titleMatch = text.trim().match(/[""「](.+?)[""」]/);
    if (titleMatch) taskTitle = titleMatch[1];
    else if (text.includes('测试')) taskTitle = '测试催办';

    if (!personName || personName.length < 2) {
      await replyToChat(chatId, messageId,
        '❓ 请告诉我要催办谁？\n格式：给 [姓名/邮箱] 发一个催办\n或使用：/add 任务名 邮箱'
      );
      return true;
    }

    // Look up user in DB by name
    const nameMatches = await usersDb.searchByName(personName, 5);
    let targetUser = null;
    if (nameMatches.length === 1) {
      targetUser = nameMatches[0];
    } else if (nameMatches.length > 1) {
      const list = nameMatches.slice(0, 5).map((u) => `• ${u.name}`).join('\n');
      await replyToChat(chatId, messageId,
        `⚠️ 找到多个名字相似的用户，请用邮箱指定：\n\n${list}\n\n示例：/add ${taskTitle} 邮箱@xxx.com`
      );
      return true;
    }

    if (!targetUser || (!targetUser.feishu_user_id && !targetUser.open_id)) {
      await replyToChat(chatId, messageId,
        `❌ 找不到用户「${personName}」\n请先让对方发一条飞书消息完成注册，或用邮箱指定：\n/add ${taskTitle} 邮箱@xxx.com`
      );
      return true;
    }

    await reminderService.createTask({
      title: taskTitle,
      assigneeId: targetUser.feishu_user_id || targetUser.open_id,
      assigneeOpenId: targetUser.open_id || null,
      assigneeName: targetUser.name || null,
      deadline: null,
      creatorId: senderId,
      reporterOpenId: openId || null,
    });

    const targetLabel = targetUser.name || targetUser.email || personName;
    await replyToChat(chatId, messageId,
      `✅ 催办已创建！\n📋 ${taskTitle}\n👤 → ${targetLabel}\n\n对方将收到飞书提醒 🔔`
    );
    return true;
  }

  return false;
}

module.exports = {
  handleCuibanCommand,
  handleSessionSelect,
  completeTaskAndReply,
  replyToChat,
};
