const express = require('express');
const router = express.Router();
const { admins, settings, audit } = require('../db');
const reminderService = require('../services/reminder');
const feishu = require('../feishu/client');

// ============ Dashboard ============

// 获取仪表盘数据
router.get('/dashboard', async (req, res) => {
  try {
    const builtinEnabled = process.env.ENABLE_BUILTIN_BOT !== 'false';
    const users = require('../db/users');

    const [adminList, recentLogs, allUsers] = await Promise.all([
      admins.list(),
      audit.list({ limit: 10 }),
      users.list({ limit: 1000 }),
    ]);

    // Only call reminder service if builtin bot is enabled
    let totalTasks = 0, pendingTasks = 0, completedTasks = 0;
    if (builtinEnabled) {
      const [allTasks, pending] = await Promise.all([
        reminderService.getAllTasks(),
        reminderService.getAllPendingTasks(),
      ]);
      totalTasks = allTasks.length;
      pendingTasks = pending.length;
      completedTasks = allTasks.filter(t =>
        reminderService.extractFieldText(t.fields[reminderService.FIELDS.STATUS]) === reminderService.STATUS.COMPLETED
      ).length;
    }

    res.json({
      stats: {
        totalTasks,
        pendingTasks,
        completedTasks,
        adminCount: adminList.length,
        totalUsers: allUsers.length,
      },
      recentActivity: recentLogs,
      builtinEnabled,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ Tasks ============

// 获取所有任务
router.get('/tasks', async (req, res) => {
  try {
    const tasks = await reminderService.getAllTasks();
    const { FIELDS } = reminderService;
    const formatted = tasks.map(t => ({
      id: t.record_id,
      name: reminderService.extractFieldText(t.fields[FIELDS.TASK_NAME]),
      target: reminderService.extractFieldText(t.fields[FIELDS.TARGET]),
      status: reminderService.extractFieldText(t.fields[FIELDS.STATUS]),
      deadline: t.fields[FIELDS.DEADLINE],
      proof: t.fields[FIELDS.PROOF]?.link || null,
      note: reminderService.extractFieldText(t.fields[FIELDS.NOTE]),
      createdAt: t.fields[FIELDS.CREATED_AT]
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建任务
router.post('/tasks', async (req, res) => {
  try {
    const { taskName, targetEmail, deadline, note, creatorId } = req.body;
    
    if (!taskName || !targetEmail) {
      return res.status(400).json({ error: '任务名称和目标用户必填' });
    }

    // 通过邮箱获取 user_id
    const user = await feishu.getUserByEmail(targetEmail);
    if (!user?.user_id) {
      return res.status(400).json({ error: `找不到用户: ${targetEmail}` });
    }

    const record = await reminderService.createTask({
      taskName,
      targetUserId: user.user_id,
      deadline,
      note,
      creatorId
    });

    res.json({ success: true, record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 完成任务
router.post('/tasks/:id/complete', async (req, res) => {
  try {
    const { proof, userId } = req.body;
    await reminderService.completeTask(req.params.id, proof, userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除任务
router.delete('/tasks/:id', async (req, res) => {
  try {
    const { userId } = req.body;
    await reminderService.deleteTask(req.params.id, userId);
    res.json({ success: true });
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
