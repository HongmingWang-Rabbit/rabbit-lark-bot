const express = require('express');
const router = express.Router();
const { admins, settings, audit } = require('../db');
const pool = require('../db/pool');
const usersDb = require('../db/users');
const reminderService = require('../services/reminder');
const feishu = require('../feishu/client');
const { safeErrorMessage } = require('../utils/safeError');

// ============ Dashboard ============

router.get('/dashboard', async (req, res) => {
  try {
    const [taskStats, userCount, adminList, recentLogs] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
        FROM tasks
      `),
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      admins.list(),
      audit.list({ limit: 10 }),
    ]);

    const stats = taskStats.rows[0];
    res.json({
      stats: {
        totalTasks: stats.total,
        pendingTasks: stats.pending,
        completedTasks: stats.completed,
        adminCount: adminList.length,
        totalUsers: userCount.rows[0].count,
      },
      recentActivity: recentLogs,
    });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err, 'Failed to load dashboard') });
  }
});

// ============ Tasks ============

// 获取所有任务（DB rows，直接返回）
router.get('/tasks', async (req, res) => {
  try {
    const tasks = await reminderService.getAllTasks();
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// 创建任务（通过邮箱查找被催办人）
router.post('/tasks', async (req, res) => {
  try {
    const { title, targetOpenId, targetEmail, deadline, note, creatorId, reporterOpenId, reminderIntervalHours } = req.body;

    if (!title || (!targetOpenId && !targetEmail)) {
      return res.status(400).json({ error: '任务名称和目标用户必填' });
    }
    if (title.length > 200) {
      return res.status(400).json({ error: '任务名称不能超过 200 字' });
    }
    if (note && note.length > 1000) {
      return res.status(400).json({ error: '备注不能超过 1000 字' });
    }

    // 查找目标用户：优先 open_id（来自前端 combobox），回退到 email（旧接口兼容）
    let targetUser = null;
    if (targetOpenId) {
      targetUser = await usersDb.findByOpenId(targetOpenId);
    }
    if (!targetUser && targetEmail) {
      targetUser = await usersDb.findByEmail(targetEmail);
    }
    if (!targetUser || (!targetUser.feishu_user_id && !targetUser.open_id)) {
      return res.status(400).json({ error: '找不到该用户，请确认对方已发送过飞书消息' });
    }

    // reporterOpenId 已直接从前端传入（combobox 选出的 open_id）
    const resolvedReporterOpenId = reporterOpenId || null;

    const task = await reminderService.createTask({
      title,
      assigneeId: targetUser.feishu_user_id || targetUser.open_id,
      assigneeOpenId: targetUser.open_id || null,
      assigneeName: targetUser.name || null,
      deadline,
      note,
      creatorId,
      reporterOpenId: resolvedReporterOpenId,
      reminderIntervalHours: reminderIntervalHours !== undefined
        ? Math.min(8760, Math.max(0, Math.floor(Number(reminderIntervalHours) || 0)))
        : undefined,
    });

    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// 完成任务
router.post('/tasks/:id/complete', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid task ID' });
    const { proof, userId } = req.body;
    const task = await reminderService.completeTask(id, proof, userId);
    if (!task) return res.status(404).json({ error: '任务不存在或已完成' });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// 删除任务
router.delete('/tasks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid task ID' });
    const { userId } = req.query;
    const task = await reminderService.deleteTask(id, userId);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// ============ Admins ============

// 获取管理员列表
router.get('/admins', async (req, res) => {
  try {
    const list = await admins.list();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
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
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// 删除管理员
router.delete('/admins/:userId', async (req, res) => {
  try {
    const removed = await admins.remove(req.params.userId);
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// ============ Settings ============

// 获取所有配置
router.get('/settings', async (req, res) => {
  try {
    const all = await settings.getAll();
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// 更新配置
const VALID_SETTING_KEYS = [
  'enable_builtin_bot', 'default_deadline_days', 'default_reminder_interval_hours',
  'welcome_message', 'max_tasks_per_user',
];

router.put('/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    if (!VALID_SETTING_KEYS.includes(key)) {
      return res.status(400).json({ error: `Unknown setting key: ${key}` });
    }
    const { value, description } = req.body;
    await settings.set(key, value, description);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// ============ Audit Logs ============

router.get('/audit', async (req, res) => {
  try {
    const { limit, offset, userId, action } = req.query;
    const logs = await audit.list({
      limit: Math.min(parseInt(limit) || 50, 500),
      offset: Math.max(parseInt(offset) || 0, 0),
      userId,
      action
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

module.exports = router;
