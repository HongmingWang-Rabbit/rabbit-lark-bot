/**
 * Reminder Service
 *
 * Task storage backed by PostgreSQL.
 * Bot messages assignees directly via Feishu API — no Bitable dependency.
 */

const pool = require('../db/pool');
const { audit } = require('../db');
const feishu = require('../feishu/client');
const logger = require('../utils/logger');

const DEFAULT_DEADLINE_DAYS = parseInt(process.env.DEFAULT_DEADLINE_DAYS, 10) || 3;
const DEFAULT_REMINDER_INTERVAL_HOURS = parseInt(process.env.DEFAULT_REMINDER_INTERVAL_HOURS, 10) || 24;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Get a user's pending tasks (assigned to them, not yet completed).
 * Matches by feishu_user_id (assignee_id) OR open_id (assignee_open_id) — whichever is available.
 * @param {string|null} feishuUserId - feishu_user_id (on_xxx); may be null
 * @param {string|null} openId       - open_id (ou_xxx) as fallback
 */
async function getUserPendingTasks(feishuUserId, openId = null) {
  const result = await pool.query(
    `SELECT * FROM tasks
     WHERE status = 'pending'
       AND (
         ($1::text IS NOT NULL AND assignee_id = $1)
         OR ($2::text IS NOT NULL AND assignee_open_id = $2)
       )
     ORDER BY deadline ASC NULLS LAST, created_at ASC`,
    [feishuUserId || null, openId || null]
  );
  return result.rows;
}

/**
 * Get all pending tasks (admin view).
 */
async function getAllPendingTasks() {
  const result = await pool.query(
    `SELECT * FROM tasks WHERE status = 'pending' ORDER BY deadline ASC NULLS LAST`
  );
  return result.rows;
}

/**
 * Get all tasks (admin view).
 * @param {number} limit
 */
async function getAllTasks(limit = 100) {
  const result = await pool.query(
    `SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Create a task and notify the assignee via Feishu message.
 *
 * @param {object} params
 * @param {string} params.title              - Task name
 * @param {string} params.assigneeId         - Assignee feishu_user_id (on_xxx)
 * @param {string} [params.assigneeOpenId]   - Assignee open_id (ou_xxx) for messaging
 * @param {string} [params.assigneeName]     - Assignee display name (for confirmation msg)
 * @param {string} [params.deadline]         - Deadline as YYYY-MM-DD string
 * @param {string} [params.note]             - Optional note
 * @param {string} [params.creatorId]        - Creator feishu_user_id (for audit)
 * @param {string} [params.reporterOpenId]        - Reporter open_id (ou_xxx), notified when task completes
 * @param {number} [params.reminderIntervalHours] - Hours between reminders (0 = disabled, default 24)
 */
async function createTask({ title, assigneeId, assigneeOpenId, assigneeName, deadline, note, creatorId, reporterOpenId, reminderIntervalHours }) {
  let deadlineDate;
  if (deadline) {
    // Strict date validation: accept YYYY-MM-DD or ISO 8601
    if (typeof deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      // Append T00:00:00 to avoid timezone-shift issues with date-only strings
      deadlineDate = new Date(deadline + 'T00:00:00');
    } else {
      deadlineDate = new Date(deadline);
    }
    if (isNaN(deadlineDate.getTime())) {
      throw new Error(`Invalid deadline date: ${deadline}`);
    }
  } else {
    deadlineDate = new Date(Date.now() + DEFAULT_DEADLINE_DAYS * MS_PER_DAY);
  }

  const intervalHours = (reminderIntervalHours !== undefined && reminderIntervalHours !== null)
    ? parseInt(reminderIntervalHours, 10)
    : DEFAULT_REMINDER_INTERVAL_HOURS;

  const result = await pool.query(
    `INSERT INTO tasks (title, assignee_id, assignee_open_id, reporter_open_id, deadline, note, creator_id, reminder_interval_hours)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [title, assigneeId, assigneeOpenId || null, reporterOpenId || null, deadlineDate, note || null, creatorId || null, intervalHours]
  );
  const task = result.rows[0];

  // Audit log (silent fail — don't block task creation)
  if (creatorId) {
    audit
      .log({
        userId: creatorId,
        action: 'create_task',
        targetType: 'task',
        targetId: String(task.id),
        details: { title, assigneeId, deadline },
      })
      .catch(() => {});
  }

  // Notify assignee via direct Feishu message
  if (assigneeOpenId) {
    const deadlineStr = deadlineDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
    const reminderNote = intervalHours > 0 ? `\n⏰ 每 ${intervalHours} 小时提醒一次` : '';
    const notifyMsg =
      `📋 你收到一个新的催办任务：\n\n` +
      `「${title}」\n` +
      `📅 截止：${deadlineStr}${reminderNote}\n\n` +
      `发送「完成」标记任务已完成`;

    feishu.sendMessage(assigneeOpenId, notifyMsg, 'open_id').catch((err) => {
      logger.warn('Failed to notify assignee of new task', { error: err.message, assigneeOpenId });
    });
  }

  logger.info('Task created', { id: task.id, title, assigneeId });
  return task;
}

/**
 * Mark a task as completed, then notify the reporter (task creator) via Feishu DM.
 *
 * @param {number} taskId          - Task ID (integer)
 * @param {string} [proof]         - Proof URL or description
 * @param {string} [userId]        - Completer's feishu_user_id (for audit)
 * @param {string} [completerName] - Completer's display name (for reporter notification)
 */
async function completeTask(taskId, proof, userId, completerName) {
  const result = await pool.query(
    `UPDATE tasks
     SET status = 'completed', proof = $2, completed_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [taskId, proof || null]
  );

  const task = result.rows[0];
  if (!task) {
    logger.warn('completeTask: task not found or already completed', { taskId });
    return null;
  }

  if (userId) {
    audit
      .log({
        userId,
        action: 'complete_task',
        targetType: 'task',
        targetId: String(taskId),
        details: { proof },
      })
      .catch(() => {});
  }

  // Notify reporter (task creator) that the task is done
  if (task && task.reporter_open_id) {
    const completedAt = new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const whoStr = completerName || '执行人';
    let notifyMsg =
      `✅ 催办任务已完成！\n\n` +
      `📋 「${task.title}」\n` +
      `👤 完成人：${whoStr}\n` +
      `🕐 完成时间：${completedAt}`;
    if (proof) notifyMsg += `\n📎 完成证明：${proof}`;

    feishu.sendMessage(task.reporter_open_id, notifyMsg, 'open_id').catch((err) => {
      logger.warn('Failed to notify reporter of task completion', {
        error: err.message,
        reporterOpenId: task.reporter_open_id,
        taskId,
      });
    });
  }

  logger.info('Task completed', { id: taskId, proof: !!proof });
  return task;
}

/**
 * Delete a task.
 *
 * @param {number} taskId   - Task ID
 * @param {string} [userId] - Deleter's feishu_user_id (for audit)
 */
async function deleteTask(taskId, userId) {
  const result = await pool.query(
    `DELETE FROM tasks WHERE id = $1 RETURNING *`,
    [taskId]
  );

  if (userId) {
    audit
      .log({
        userId,
        action: 'delete_task',
        targetType: 'task',
        targetId: String(taskId),
        details: {},
      })
      .catch(() => {});
  }

  logger.info('Task deleted', { id: taskId });
  return result.rows[0];
}

// ── Cron ─────────────────────────────────────────────────────────────────────

/**
 * Scan for pending tasks that are due for a reminder and send Feishu DMs.
 * Called periodically by the reminder cron in index.js.
 *
 * A task is due for a reminder when:
 *   - status = 'pending'
 *   - reminder_interval_hours > 0  (0 = disabled)
 *   - assignee_open_id is set (need it to send the DM)
 *   - NOW() >= COALESCE(last_reminded_at, created_at) + reminder_interval_hours
 *
 * @returns {Promise<number>} number of reminders sent
 */
async function sendPendingReminders() {
  const now = new Date();
  let totalSent = 0;

  // ── Part 1: One-time deadline-overdue alert ─────────────────────────────
  // Uses FOR UPDATE SKIP LOCKED to prevent concurrent cron runs from
  // double-sending the same alert.
  let overdueTasks = [];
  {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`
        SELECT * FROM tasks
        WHERE status = 'pending'
          AND deadline IS NOT NULL
          AND deadline < NOW()
          AND deadline_notified_at IS NULL
        FOR UPDATE SKIP LOCKED
      `);
      overdueTasks = rows;

      if (overdueTasks.length > 0) {
        for (const task of overdueTasks) {
          await client.query(
            'UPDATE tasks SET deadline_notified_at = NOW() WHERE id = $1',
            [task.id]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch((rollbackErr) => {
        logger.error('Rollback failed', { error: rollbackErr.message });
      });
      throw err;
    } finally {
      client.release();
    }
  }

  // Send overdue notifications (outside any DB client hold)
  if (overdueTasks.length > 0) {
    logger.info(`⏰ Deadline alert: ${overdueTasks.length} task(s) newly overdue`);

    await Promise.allSettled(
      overdueTasks.map(async (task) => {
        const deadlineStr = new Date(task.deadline).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        if (task.assignee_open_id) {
          const assigneeMsg =
            `🚨 催办任务已逾期，请尽快完成：\n\n` +
            `📋 「${task.title}」\n` +
            `📅 截止时间：${deadlineStr}（已过期）\n\n` +
            `发送「完成」标记任务已完成`;
          await feishu.sendMessage(task.assignee_open_id, assigneeMsg, 'open_id').catch((err) => {
            logger.warn('Deadline alert: failed to DM assignee', { taskId: task.id, error: err.message });
          });
        }

        if (task.reporter_open_id) {
          const reporterMsg =
            `📢 催办任务逾期通报：\n\n` +
            `📋 「${task.title}」\n` +
            `📅 截止时间：${deadlineStr}\n` +
            `🔴 状态：已逾期，执行人尚未完成\n\n` +
            `系统将继续每 ${task.reminder_interval_hours} 小时提醒执行人`;
          await feishu.sendMessage(task.reporter_open_id, reporterMsg, 'open_id').catch((err) => {
            logger.warn('Deadline alert: failed to DM reporter', { taskId: task.id, error: err.message });
          });
        }

        logger.info('Deadline alert sent', {
          taskId: task.id,
          title: task.title,
          hasReporter: !!task.reporter_open_id,
        });
      })
    );

    totalSent += overdueTasks.length;
  }

  // ── Part 2: Regular interval reminders (assignee only) ─────────────────
  let intervalTasks = [];
  {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`
        SELECT * FROM tasks
        WHERE status = 'pending'
          AND reminder_interval_hours > 0
          AND assignee_open_id IS NOT NULL
          AND NOW() >= COALESCE(last_reminded_at, created_at) + (reminder_interval_hours || ' hours')::interval
        ORDER BY deadline ASC NULLS LAST
        FOR UPDATE SKIP LOCKED
      `);
      intervalTasks = rows;

      if (intervalTasks.length > 0) {
        for (const task of intervalTasks) {
          await client.query('UPDATE tasks SET last_reminded_at = NOW() WHERE id = $1', [task.id]);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch((rollbackErr) => {
        logger.error('Rollback failed', { error: rollbackErr.message });
      });
      throw err;
    } finally {
      client.release();
    }
  }

  // Send interval reminders (outside any DB client hold)
  if (intervalTasks.length > 0) {
    const results = await Promise.allSettled(
      intervalTasks.map(async (task) => {
        const isOverdue = task.deadline && new Date(task.deadline) < now;
        const deadlineStr = task.deadline
          ? new Date(task.deadline).toLocaleDateString('zh-CN', {
              timeZone: 'Asia/Shanghai',
              month: 'long',
              day: 'numeric',
            })
          : '无截止日期';

        const overdueTag = isOverdue ? '⚠️ 已逾期！\n' : '';
        const msg =
          `⏰ 催办提醒：\n\n` +
          `${overdueTag}📋 「${task.title}」\n` +
          `📅 截止：${deadlineStr}\n\n` +
          `发送「完成」标记任务已完成`;

        await feishu.sendMessage(task.assignee_open_id, msg, 'open_id').catch((err) => {
          logger.warn('Reminder: failed to DM assignee', { taskId: task.id, error: err.message });
        });

        logger.info('Interval reminder sent', { taskId: task.id, title: task.title, isOverdue });
      })
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn('Reminder cron: some interval reminders failed', {
        failed: failed.length,
        errors: failed.map((r) => r.reason?.message),
      });
    }

    totalSent += intervalTasks.length;
  }

  return totalSent;
}

module.exports = {
  // Queries
  getUserPendingTasks,
  getAllPendingTasks,
  getAllTasks,
  // Mutations
  createTask,
  completeTask,
  deleteTask,
  // Cron
  sendPendingReminders,
  // Constants
  DEFAULT_DEADLINE_DAYS,
  DEFAULT_REMINDER_INTERVAL_HOURS,
};
