const express = require('express');
const router = express.Router();
const { admins, settings, audit } = require('../db');
const usersDb = require('../db/users');
const reminderService = require('../services/reminder');
const feishu = require('../feishu/client');

// ============ Dashboard ============

router.get('/dashboard', async (req, res) => {
  try {
    const [adminList, recentLogs, allUsers, allTasks, pendingTasks] = await Promise.all([
      admins.list(),
      audit.list({ limit: 10 }),
      usersDb.list({ limit: 1000 }),
      reminderService.getAllTasks(),
      reminderService.getAllPendingTasks(),
    ]);

    res.json({
      stats: {
        totalTasks: allTasks.length,
        pendingTasks: pendingTasks.length,
        completedTasks: allTasks.filter(t => t.status === 'completed').length,
        adminCount: adminList.length,
        totalUsers: allUsers.length,
      },
      recentActivity: recentLogs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ Tasks ============

// 获取所有任务（DB rows，直接返回）
router.get('/tasks', async (req, res) => {
  try {
    const tasks = await reminderService.getAllTasks();
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建任务（通过邮箱查找被催办人）
router.post('/tasks', async (req, res) => {
  try {
    const { title, targetEmail, deadline, note, creatorId } = req.body;

    if (!title || !targetEmail) {
      return res.status(400).json({ error: '任务名称和目标用户必填' });
    }

    // 从本地 DB 查找目标用户（已通过飞书消息自动注册）
    const targetUser = await usersDb.findByEmail(targetEmail);
    if (!targetUser?.feishu_user_id) {
      return res.status(400).json({ error: `找不到用户: ${targetEmail}（请确认用户已发送过飞书消息）` });
    }

    const task = await reminderService.createTask({
      title,
      assigneeId: targetUser.feishu_user_id,
      assigneeOpenId: targetUser.open_id || null,
      assigneeName: targetUser.name || null,
      deadline,
      note,
      creatorId,
    });

    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 完成任务
router.post('/tasks/:id/complete', async (req, res) => {
  try {
    const { proof, userId } = req.body;
    const task = await reminderService.completeTask(parseInt(req.params.id, 10), proof, userId);
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除任务
router.delete('/tasks/:id', async (req, res) => {
  try {
    const { userId } = req.body;
    const task = await reminderService.deleteTask(parseInt(req.params.id, 10), userId);
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ Admins ============

// 获取管理员列表
router.get('/admins', async (req, res) => {
  try {
    const list = await admins.list();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 添加管理员
router.post('/admins', async (req, res) => {
  try {
    const { userId, email, name, role } = req.body;
    if (!userId && !email) {
      return res.status(400).json({ error: 'userId 或 email 必填' });
    }
    const admin = await admins.add({ userId, email, name, role });
    res.json(admin);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除管理员
router.delete('/admins/:userId', async (req, res) => {
  try {
    const removed = await admins.remove(req.params.userId);
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ Settings ============

// 获取所有配置
router.get('/settings', async (req, res) => {
  try {
    const all = await settings.getAll();
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新配置
router.put('/settings/:key', async (req, res) => {
  try {
    const { value, description } = req.body;
    await settings.set(req.params.key, value, description);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ Audit Logs ============

router.get('/audit', async (req, res) => {
  try {
    const { limit, offset, userId, action } = req.query;
    const logs = await audit.list({
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      userId,
      action
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
