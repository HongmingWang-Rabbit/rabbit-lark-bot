/**
 * Scheduled Task Runner
 *
 * Loads scheduled_tasks from DB on startup and registers cron jobs.
 * Each job creates a task via reminderService when it fires.
 * Call reload() after any CRUD on scheduled_tasks.
 */
const cron = require('node-cron');
const scheduledTasksDb = require('../db/scheduledTasks');
const usersDb = require('../db/users');
const reminderService = require('./reminder');
const logger = require('../utils/logger');

/**
 * Resolve the assignee for a scheduled task:
 * - If target_open_id is set → use it directly
 * - If target_tag is set → pick the user in that tag group with lowest workload
 * Returns { openId, name } or null if resolution fails.
 */
async function resolveAssignee(st) {
  if (st.target_open_id) {
    const user = await usersDb.findByOpenId(st.target_open_id).catch(() => null);
    return { openId: st.target_open_id, name: user?.name ?? null };
  }
  if (st.target_tag) {
    const user = await usersDb.pickByWorkload(st.target_tag);
    if (!user?.open_id) {
      logger.warn('No users found for tag, skipping scheduled task', { id: st.id, tag: st.target_tag });
      return null;
    }
    logger.info('Auto-assigned by workload', {
      id: st.id, tag: st.target_tag, assignee: user.name, openId: user.open_id,
    });
    return { openId: user.open_id, name: user.name ?? null };
  }
  logger.warn('Scheduled task has neither target_open_id nor target_tag', { id: st.id });
  return null;
}

const jobs = new Map(); // id (string) -> cron.ScheduledTask

async function runJob(st) {
  // Re-fetch from DB to get latest config (may have been updated since cron was registered)
  const latest = await scheduledTasksDb.get(st.id);
  if (!latest || !latest.enabled) return;

  // Resolve assignee — either direct open_id or tag-based workload pick
  const assignee = await resolveAssignee(latest);
  if (!assignee) return; // logged inside resolveAssignee

  // Calculate deadline date
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + latest.deadline_days);
  const deadlineStr = deadline.toISOString().slice(0, 10);

  try {
    await reminderService.createTask({
      title: latest.title,
      assigneeId: assignee.openId,
      assigneeOpenId: assignee.openId,
      assigneeName: assignee.name,
      deadline: deadlineStr,
      note: latest.note ?? null,
      priority: latest.priority,
      reminderIntervalHours: latest.reminder_interval_hours,
      reporterOpenId: latest.reporter_open_id ?? null,
      creatorId: 'scheduled',
    });

    await scheduledTasksDb.markRun(latest.id);
    logger.info('Scheduled task fired', {
      id: latest.id,
      name: latest.name,
      title: latest.title,
      assignee: assignee.name,
      openId: assignee.openId,
      via: latest.target_tag ? `tag:${latest.target_tag}` : 'direct',
      deadline: deadlineStr,
    });
  } catch (err) {
    logger.error('Scheduled task execution failed', { id: latest.id, error: err.message });
  }
}

function registerJob(st) {
  // Validate cron expression
  if (!cron.validate(st.schedule)) {
    logger.warn('Invalid cron expression, skipping', { id: st.id, schedule: st.schedule });
    return;
  }

  const task = cron.schedule(st.schedule, () => runJob(st), {
    scheduled: true,
    timezone: st.timezone || 'Asia/Shanghai',
  });

  jobs.set(String(st.id), task);
  logger.debug('Scheduled task registered', {
    id: st.id,
    name: st.name,
    schedule: st.schedule,
    timezone: st.timezone,
  });
}

function cancelJob(id) {
  const key = String(id);
  if (jobs.has(key)) {
    jobs.get(key).destroy();
    jobs.delete(key);
  }
}

async function loadAll() {
  // Cancel existing jobs
  for (const task of jobs.values()) task.destroy();
  jobs.clear();

  const all = await scheduledTasksDb.list();
  const enabled = all.filter(st => st.enabled);

  for (const st of enabled) registerJob(st);
  logger.info('Scheduled task runner loaded', { total: all.length, enabled: enabled.length });
}

async function reload() {
  await loadAll();
}

module.exports = { loadAll, reload, registerJob, cancelJob };
