const pool = require('./pool');

const scheduledTasksDb = {
  async list() {
    const { rows } = await pool.query('SELECT * FROM scheduled_tasks ORDER BY created_at DESC');
    return rows;
  },

  async get(id) {
    const { rows } = await pool.query('SELECT * FROM scheduled_tasks WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async create({ name, title, targetOpenId, reporterOpenId, schedule, timezone, deadlineDays, priority, note, reminderIntervalHours, createdBy }) {
    const { rows } = await pool.query(
      `INSERT INTO scheduled_tasks
         (name, title, target_open_id, reporter_open_id, schedule, timezone,
          deadline_days, priority, note, reminder_interval_hours, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [name, title, targetOpenId, reporterOpenId ?? null, schedule,
       timezone ?? 'Asia/Shanghai', deadlineDays ?? 1, priority ?? 'p1',
       note ?? null, reminderIntervalHours ?? 24, createdBy ?? null]
    );
    return rows[0];
  },

  async update(id, { name, title, targetOpenId, reporterOpenId, schedule, timezone, deadlineDays, priority, note, reminderIntervalHours, enabled }) {
    const fields = [], values = [];
    let i = 1;
    const set = (col, val) => { if (val !== undefined) { fields.push(`${col}=$${i++}`); values.push(val); } };
    set('name', name);
    set('title', title);
    set('target_open_id', targetOpenId);
    set('reporter_open_id', reporterOpenId);
    set('schedule', schedule);
    set('timezone', timezone);
    set('deadline_days', deadlineDays);
    set('priority', priority);
    set('note', note);
    set('reminder_interval_hours', reminderIntervalHours);
    set('enabled', enabled);
    if (!fields.length) return null;
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE scheduled_tasks SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
      values
    );
    return rows[0] ?? null;
  },

  async remove(id) {
    const { rows } = await pool.query('DELETE FROM scheduled_tasks WHERE id=$1 RETURNING *', [id]);
    return rows[0] ?? null;
  },

  async markRun(id) {
    await pool.query('UPDATE scheduled_tasks SET last_run_at=NOW() WHERE id=$1', [id]);
  },
};

module.exports = scheduledTasksDb;
