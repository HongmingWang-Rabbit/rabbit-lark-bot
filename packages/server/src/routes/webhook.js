const express = require('express');
const router = express.Router();
const feishu = require('../feishu/client');
const { admins } = require('../db');
const reminderService = require('../services/reminder');
const logger = require('../utils/logger');

// 用户会话状态（内存存储，生产环境可以用 Redis）
const userSessions = new Map();

// 飞书事件回调
router.post('/event', async (req, res) => {
  const data = req.body;
  logger.debug('Webhook event received', { eventType: data.header?.event_type || data.type });

  // URL 验证
  if (data.type === 'url_verification') {
    return res.json({ challenge: data.challenge });
  }

  // 处理消息事件
  if (data.header?.event_type === 'im.message.receive_v1') {
    const event = data.event;
    const msgType = event.message?.message_type;
    const senderId = event.sender?.sender_id?.user_id;

    if (msgType === 'text' && senderId) {
      const content = JSON.parse(event.message.content);
      // 异步处理，立即返回
      handleUserMessage(senderId, content.text).catch(err => {
        logger.error('Message handling failed', { error: err.message, userId: senderId });
      });
    }
  }

  res.json({ success: true });
});

// 处理用户消息
async function handleUserMessage(userId, text) {
  logger.info('Message received', { userId, textLength: text.length });
  
  const isAdminUser = await admins.isAdmin(userId, null);
  const lowerText = text.toLowerCase().trim();
  
  // 提取链接
  const links = text.match(/(https?:\/\/[^\s]+)/g) || [];

  // ===== Admin 命令 =====
  if (isAdminUser) {
    // 创建任务: /add 任务名 @用户 截止日期
    if (lowerText.startsWith('/add ') || lowerText.startsWith('创建任务')) {
      await feishu.sendMessage(userId, 
        '📝 创建任务请使用格式：\n/add 任务名称 用户邮箱 截止日期\n\n示例：\n/add 提交周报 zhangsan@company.com 2026-03-01'
      );
      return;
    }

    // 查看所有任务
    if (lowerText === '/all' || lowerText === '所有任务') {
      const tasks = await reminderService.getAllTasks();
      if (tasks.length === 0) {
        await feishu.sendMessage(userId, '📋 暂无任务');
        return;
      }
      
      let reply = '📋 所有任务：\n\n';
      tasks.forEach((task, i) => {
        const name = reminderService.extractFieldText(task.fields['任务名称']);
        const target = reminderService.extractFieldText(task.fields['催办对象']);
        const status = reminderService.extractFieldText(task.fields['状态']);
        reply += `${i + 1}. ${name} → ${target} [${status}]\n`;
      });
      await feishu.sendMessage(userId, reply);
      return;
    }

    // 查看待办
    if (lowerText === '/pending' || lowerText === '待办') {
      const tasks = await reminderService.getAllPendingTasks();
      if (tasks.length === 0) {
        await feishu.sendMessage(userId, '✅ 没有待办任务');
        return;
      }
      
      let reply = '⏳ 待办任务：\n\n';
      tasks.forEach((task, i) => {
        const name = reminderService.extractFieldText(task.fields['任务名称']);
        const target = reminderService.extractFieldText(task.fields['催办对象']);
        reply += `${i + 1}. ${name} → ${target}\n   ID: ${task.record_id}\n`;
      });
      await feishu.sendMessage(userId, reply);
      return;
    }
  }

  // ===== 普通用户命令 =====
  
  // 查看自己的任务
  if (lowerText.includes('任务') || lowerText.includes('待办') || lowerText === '/list') {
    const tasks = await reminderService.getUserPendingTasks(userId);
    if (tasks.length === 0) {
      await feishu.sendMessage(userId, '🎉 你没有待办的催办任务');
      return;
    }
    
    let reply = '📋 你的待办任务：\n\n';
    tasks.forEach((task, i) => {
      const name = reminderService.extractFieldText(task.fields['任务名称']);
      reply += `${i + 1}. ${name}\n`;
    });
    reply += '\n发送「完成」或证明材料链接来完成任务';
    
    // 保存会话状态
    userSessions.set(userId, { tasks, step: 'select_task' });
    
    await feishu.sendMessage(userId, reply);
    return;
  }

  // 完成任务
  if (lowerText.includes('完成') || lowerText === 'done' || links.length > 0) {
    const tasks = await reminderService.getUserPendingTasks(userId);
    
    if (tasks.length === 0) {
      await feishu.sendMessage(userId, '✅ 你目前没有待办任务');
      return;
    }

    if (tasks.length === 1) {
      // 只有一个任务，直接完成
      const task = tasks[0];
      const taskName = reminderService.extractFieldText(task.fields['任务名称']);
      const proof = links[0] || '';
      
      await reminderService.completeTask(task.record_id, proof, userId);
      
      let reply = `✅ 已完成任务「${taskName}」`;
      if (proof) reply += `\n📎 证明材料: ${proof}`;
      await feishu.sendMessage(userId, reply);
      return;
    }

    // 多个任务，让用户选择
    let reply = '你有多个待办任务，请回复编号选择：\n\n';
    tasks.forEach((task, i) => {
      const name = reminderService.extractFieldText(task.fields['任务名称']);
      reply += `${i + 1}. ${name}\n`;
    });
    
    userSessions.set(userId, { tasks, links, step: 'complete_select' });
    await feishu.sendMessage(userId, reply);
    return;
  }

  // 处理数字选择
  if (/^[1-9]\d*$/.test(lowerText)) {
    const session = userSessions.get(userId);
    if (session?.step === 'complete_select') {
      const index = parseInt(lowerText) - 1;
      if (index >= 0 && index < session.tasks.length) {
        const task = session.tasks[index];
        const taskName = reminderService.extractFieldText(task.fields['任务名称']);
        const proof = session.links?.[0] || '';
        
        await reminderService.completeTask(task.record_id, proof, userId);
        userSessions.delete(userId);
        
        let reply = `✅ 已完成任务「${taskName}」`;
        if (proof) reply += `\n📎 证明材料: ${proof}`;
        await feishu.sendMessage(userId, reply);
        return;
      }
    }
  }

  // 帮助信息
  let help = '👋 你好！我是催办助手。\n\n';
  help += '📋 发送「任务」查看你的待办\n';
  help += '✅ 发送「完成」或证明链接来完成任务\n';
  
  if (isAdminUser) {
    help += '\n--- 管理员命令 ---\n';
    help += '/all - 查看所有任务\n';
    help += '/pending - 查看待办任务\n';
  }
  
  await feishu.sendMessage(userId, help);
}

module.exports = router;
