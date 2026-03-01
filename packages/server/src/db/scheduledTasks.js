const pool = require('./pool');

/** Normalize empty string to null for optional text fields */
const nullIfEmpty = (v) => (v === '' || v === null || v === undefined ? null : v);

const scheduledTasksDb = {
  /**
   * Paginated list with optional search and enabled filter.
   * @param {object} opts
   * @param {number} [opts.page=1]    - 1-based page number
   * @param {number} [opts.limit=20]  - rows per page (max 100)
   * @param {string} [opts.search=''] - ILIKE match against name and title
   * @param {boolean|null} [opts.enabled=null] - null = all, true/false = filter
   * @returns {Promise<{rows: object[], total: number}>}
   */
  async list({ page = 1, limit = 20, search = '', enabled = null } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const values = [];
    let i = 1;

    if (search) {
      conditions.push(`(name ILIKE $${i} OR title ILIKE $${i})`);
      values.push(`%${search}%`);
      i++;
    }
    if (enabled !== null) {
      conditions.push(`enabled = $${i++}`);
      values.push(enabled);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rowsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM scheduled_tasks ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
        [...values, limit, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM scheduled_tasks ${where}`, values),
    ]);

    return {
      rows: rowsResult.rows,
      total: countResult.rows[0].total,
    };
  },

  async get(id) {
    const { rows } = await pool.query('SELECT * FROM scheduled_tasks WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async create({ name, title, targetOpenId, targetTag, reporterOpenId, schedule, timezone, deadlineDays, priority, note, reminderIntervalHours, createdBy }) {
    const { rows } = await pool.query(
      `INSERT INTO scheduled_tasks
         (name, title, target_open_id, target_tag, reporter_open_id, schedule, timezone,
          deadline_days, priority, note, reminder_interval_hours, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [name, title, nullIfEmpty(targetOpenId), nullIfEmpty(targetTag),
       nullIfEmpty(reporterOpenId), schedule,
       timezone ?? 'Asia/Shanghai', deadlineDays ?? 1, priority ?? 'p1',
       nullIfEmpty(note), reminderIntervalHours ?? 24, nullIfEmpty(createdBy)]
    );
    return rows[0];
  },

  async update(id, { name, title, targetOpenId, targetTag, reporterOpenId, schedule, timezone, deadlineDays, priority, note, reminderIntervalHours, enabled }) {
    const fields = [], values = [];
    let i = 1;
    const set = (col, val) => { if (val !== undefined) { fields.push(`${col}=$${i++}`); values.push(val); } };
    set('name', name);
    set('title', title);
    if (targetOpenId !== undefined) set('target_open_id', nullIfEmpty(targetOpenId));
    if (targetTag !== undefined) set('target_tag', nullIfEmpty(targetTag));
    // Normalize empty string to NULL for optional text fields
    if (reporterOpenId !== undefined) set('reporter_open_id', nullIfEmpty(reporterOpenId));
    set('schedule', schedule);
    set('timezone', timezone);
    set('deadline_days', deadlineDays);
    set('priority', priority);
    if (note !== undefined) set('note', nullIfEmpty(note));
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
