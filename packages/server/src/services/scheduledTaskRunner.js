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

const jobs = new Map(); // id (string) -> cron.ScheduledTask

async function runJob(st) {
  // Re-fetch from DB to get latest config (may have been updated since cron was registered)
  const latest = await scheduledTasksDb.get(st.id);
  if (!latest || !latest.enabled) return;

  // Calculate deadline date
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + latest.deadline_days);
  const deadlineStr = deadline.toISOString().slice(0, 10);

  // Resolve assignee name
  const targetUser = await usersDb.findByOpenId(latest.target_open_id).catch(() => null);

  try {
    await reminderService.createTask({
      title: latest.title,
      assigneeId: latest.target_open_id,
      assigneeOpenId: latest.target_open_id,
      assigneeName: targetUser?.name ?? null,
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
      assignee: targetUser?.name,
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
