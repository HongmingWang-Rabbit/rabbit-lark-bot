const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const feishu = require('../feishu/client');
const usersDb = require('../db/users');
const { resolveFeatures } = require('../features');
const { detectIntent } = require('../utils/intentDetector');
const { buildMenu } = require('../utils/menuBuilder');
const logger = require('../utils/logger');
const agentForwarder = require('../services/agentForwarder');
const { handleCuibanCommand, handleSessionSelect } = require('../services/cuibanHandler');

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

// ============ 事件去重（单实例） ============
// 注意：Map 存储在进程内存中，多实例部署时无法跨实例去重。
// 多实例环境请改用 Redis 或 PostgreSQL INSERT ON CONFLICT。

const processedEventIds = new Map(); // eventId -> timestamp
const EVENT_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 min
const EVENT_DEDUP_MAX_SIZE = 5000;

function dedupCleanup() {
  const cutoff = Date.now() - EVENT_DEDUP_TTL_MS;
  for (const [id, ts] of processedEventIds) {
    if (ts < cutoff) processedEventIds.delete(id);
  }
}

// Periodic cleanup so stale entries expire even when no events arrive
const _dedupCleanupInterval = setInterval(dedupCleanup, 60_000);
_dedupCleanupInterval.unref(); // don't keep process alive just for cleanup

function isDuplicateEvent(eventId) {
  if (!eventId) return false;
  if (processedEventIds.has(eventId)) return true;
  processedEventIds.set(eventId, Date.now());
  // Also prune inline when map grows too large
  if (processedEventIds.size > EVENT_DEDUP_MAX_SIZE) {
    dedupCleanup();
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
        logger.debug('👤 User lookup', {
          openId,
          found: !!existing,
          existingName: existing?.name || null,
          existingEmail: existing?.email || null,
          existingPhone: existing?.phone || null,
        });

        // Resolve user info from Feishu Contact API when:
        //   a) new user (no DB record), or
        //   b) existing user missing name/email/feishu_user_id (backfill after permission added)
        // Try user_id first; fall back to open_id if user_id isn't in the event
        let userInfo = null;
        const needsResolve = !existing
          || !existing.name
          || !existing.email
          || !existing.feishu_user_id;
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
          logger.debug('🔍 resolveUserInfo result', {
            success:      !!userInfo,
            name:         userInfo?.name        || null,
            email:        userInfo?.email       || null,
            feishuUserId: userInfo?.feishuUserId || null,
            reason: userInfo ? 'ok' : 'null (no contact permission or API error)',
          });
        } else {
          logger.info('⏭️  Skip resolveUserInfo (user already complete)', {
            name: existing.name, email: existing.email, feishuUserId: existing.feishu_user_id,
          });
        }

        // feishuUserId priority: webhook senderId > Contact API user_id/union_id > event unionId
        const resolvedFeishuUserId = senderId
          || userInfo?.feishuUserId
          || unionId
          || null;

        user = await usersDb.autoProvision({
          openId,
          email: userInfo?.email || null,
          phone: userInfo?.mobile || null,
          name: userInfo?.name || null,
          feishuUserId: resolvedFeishuUserId,
        });

        logger.debug('✅ User provisioned', {
          userId:        user?.user_id,
          name:          user?.name   || '(none)',
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
    } catch (parseErr) {
      logger.debug('Failed to parse message content', { error: parseErr.message });
    }

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
    const sessionHandled = await handleSessionSelect({
      sessionKey, messageText, user, senderId, chatId, messageId,
    }).catch((err) => {
      logger.error('Session select error', { error: err.message });
      return false;
    });
    if (sessionHandled) return res.json({ success: true });

    // ── [5] 催办直接命令 ──────────────────────────────────────────────────
    if (['cuiban_view', 'cuiban_complete', 'cuiban_create', 'cuiban_create_nl'].includes(intent)) {
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

module.exports = router;
