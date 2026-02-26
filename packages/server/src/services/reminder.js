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
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Get a user's pending tasks (assigned to them, not yet completed).
 * @param {string} feishuUserId - feishu_user_id (on_xxx) from webhook sender_id
 */
async function getUserPendingTasks(feishuUserId) {
  const result = await pool.query(
    `SELECT * FROM tasks
     WHERE assignee_id = $1 AND status = 'pending'
     ORDER BY deadline ASC NULLS LAST, created_at ASC`,
    [feishuUserId]
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
 * @param {string} [params.reporterOpenId]   - Reporter open_id (ou_xxx), notified when task completes
 */
async function createTask({ title, assigneeId, assigneeOpenId, assigneeName, deadline, note, creatorId, reporterOpenId }) {
  const deadlineDate = deadline
    ? new Date(deadline)
    : new Date(Date.now() + DEFAULT_DEADLINE_DAYS * MS_PER_DAY);

  const result = await pool.query(
    `INSERT INTO tasks (title, assignee_id, assignee_open_id, reporter_open_id, deadline, note, creator_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [title, assigneeId, assigneeOpenId || null, reporterOpenId || null, deadlineDate, note || null, creatorId || null]
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
    const notifyMsg =
      `📋 你收到一个新的催办任务：\n\n` +
      `「${title}」\n` +
      `📅 截止：${deadlineStr}\n\n` +
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
     WHERE id = $1
     RETURNING *`,
    [taskId, proof || null]
  );

  const task = result.rows[0];

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

module.exports = {
  // Queries
  getUserPendingTasks,
  getAllPendingTasks,
  getAllTasks,
  // Mutations
  createTask,
  completeTask,
  deleteTask,
  // Constants
  DEFAULT_DEADLINE_DAYS,
};
