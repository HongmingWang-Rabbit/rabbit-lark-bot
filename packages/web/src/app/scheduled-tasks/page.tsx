'use client';

import { useState, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { api, SWR_KEYS, ScheduledTask, User, WorkloadUser } from '@/lib/api';
import AdminGuard from '@/components/AdminGuard';
import UserCombobox from '@/components/UserCombobox';
import FeishuUserLookup from '@/components/FeishuUserLookup';

// ── constants ────────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<string, { label: string; className: string }> = {
  p0: { label: 'P0 紧急', className: 'bg-red-100 text-red-700' },
  p1: { label: 'P1 一般', className: 'bg-yellow-100 text-yellow-700' },
  p2: { label: 'P2 不紧急', className: 'bg-green-100 text-green-700' },
};

const CRON_PRESETS = [
  { label: '每周一 6:00 (CST)', value: '0 6 * * 1' },
  { label: '每周五 17:00 (CST)', value: '0 17 * * 5' },
  { label: '每月1号 9:00 (CST)', value: '0 9 1 * *' },
  { label: '每月4号 6:00 (CST)', value: '0 6 4 * *' },
  { label: '自定义', value: 'custom' },
];

const TIMEZONES = ['Asia/Shanghai', 'UTC', 'America/New_York'];

// ── types ─────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  title: string;
  assignMode: 'direct' | 'tag';   // direct = specific user, tag = auto-assign by workload
  targetOpenId: string;
  targetTag: string;
  reporterOpenId: string;
  schedulePreset: string;
  schedule: string;
  timezone: string;
  deadlineDays: number;
  priority: 'p0' | 'p1' | 'p2';
  note: string;
  reminderIntervalHours: number;
  enabled: boolean;
}

const DEFAULT_FORM: FormState = {
  name: '',
  title: '',
  assignMode: 'direct',
  targetOpenId: '',
  targetTag: '',
  reporterOpenId: '',
  schedulePreset: '0 6 * * 1',
  schedule: '0 6 * * 1',
  timezone: 'Asia/Shanghai',
  deadlineDays: 1,
  priority: 'p1',
  note: '',
  reminderIntervalHours: 24,
  enabled: true,
};

// ── page ─────────────────────────────────────────────────────────────────────

export default function ScheduledTasksPage() {
  return (
    <AdminGuard>
      <ScheduledTasksContent />
    </AdminGuard>
  );
}

function ScheduledTasksContent() {
  const { data: tasks = [], error, isLoading } = useSWR<ScheduledTask[]>(
    SWR_KEYS.scheduledTasks,
    api.getScheduledTasks
  );
  const { data: usersData } = useSWR(SWR_KEYS.users, api.getUsers);
  // Build open_id → name lookup map
  const userMap: Record<string, string> = {};
  (usersData ?? []).forEach((u: User) => {
    if (u.openId) userMap[u.openId] = u.name || u.openId;
  });

  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);

  const handleCreate = () => {
    setEditingTask(null);
    setShowForm(true);
  };

  const handleEdit = (task: ScheduledTask) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingTask(null);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingTask(null);
    mutate(SWR_KEYS.scheduledTasks);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">定时任务</h2>
          <p className="text-sm text-gray-500 mt-1">基于 cron 表达式自动创建催办任务</p>
        </div>
        <button
          onClick={handleCreate}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
        >
          + 新增定时任务
        </button>
      </div>

      {showForm && (
        <ScheduledTaskForm
          initial={editingTask}
          users={usersData ?? []}
          onSuccess={handleFormSuccess}
          onCancel={handleFormClose}
        />
      )}

      {isLoading && (
        <div className="text-center py-8 text-gray-400">加载中…</div>
      )}
      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg mb-4">{error.message}</div>
      )}
      {!isLoading && !error && (
        <ScheduledTaskTable tasks={tasks} onEdit={handleEdit} userMap={userMap} />
      )}
    </div>
  );
}

// ── table ─────────────────────────────────────────────────────────────────────

function ScheduledTaskTable({
  tasks,
  onEdit,
  userMap,
}: {
  tasks: ScheduledTask[];
  onEdit: (t: ScheduledTask) => void;
  userMap: Record<string, string>;
}) {
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full min-w-[860px]" aria-label="定时任务列表">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap w-36">名称</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">催办标题</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap w-32">被催办人</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap w-44">执行时间</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap w-20">优先级</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap w-16">状态</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap w-28">上次执行</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap w-20">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {tasks.map((task) => (
            <ScheduledTaskRow key={task.id} task={task} onEdit={onEdit} userMap={userMap} />
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                暂无定时任务，点击「新增定时任务」创建
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ScheduledTaskRow({
  task,
  onEdit,
  userMap,
}: {
  task: ScheduledTask;
  onEdit: (t: ScheduledTask) => void;
  userMap: Record<string, string>;
}) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    try {
      await api.updateScheduledTask(task.id, { enabled: !task.enabled });
      mutate(SWR_KEYS.scheduledTasks);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      await api.deleteScheduledTask(task.id);
      mutate(SWR_KEYS.scheduledTasks);
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  };

  const badge = PRIORITY_BADGE[task.priority] || PRIORITY_BADGE['p1'];
  const lastRun = task.last_run_at
    ? new Date(task.last_run_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : '—';

  const assigneeName = task.target_open_id
    ? (userMap[task.target_open_id] || task.target_open_id)
    : null;

  return (
    <tr className={`hover:bg-gray-50 ${loading ? 'opacity-50' : ''}`}>
      {/* 名称 */}
      <td className="px-4 py-2 font-medium text-sm whitespace-nowrap">{task.name}</td>

      {/* 催办标题 + 备注（截断） */}
      <td className="px-4 py-2 max-w-xs">
        <p className="text-sm text-gray-800 truncate">{task.title}</p>
        {task.note && (
          <p className="text-xs text-gray-400 truncate" title={task.note}>{task.note}</p>
        )}
      </td>

      {/* 被催办人 — 名字 or 标签自动分配 */}
      <td className="px-4 py-2 whitespace-nowrap">
        {task.target_tag ? (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full font-medium">
            🏷 {task.target_tag}
            <span className="text-purple-400 font-normal">按工作量</span>
          </span>
        ) : (
          <span className="text-sm font-medium" title={task.target_open_id ?? undefined}>
            {assigneeName}
          </span>
        )}
      </td>

      {/* 执行时间 — cron + timezone 同一行 */}
      <td className="px-4 py-2 whitespace-nowrap">
        <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">{task.schedule}</span>
        <span className="text-xs text-gray-400 block mt-0.5">{task.timezone}</span>
      </td>

      {/* 优先级 */}
      <td className="px-4 py-2 whitespace-nowrap">
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.className}`}>
          {badge.label}
        </span>
      </td>

      {/* 状态 */}
      <td className="px-4 py-2 whitespace-nowrap">
        <button
          onClick={handleToggle}
          disabled={loading}
          className={`text-xs px-2 py-0.5 rounded font-medium transition-colors whitespace-nowrap ${
            task.enabled
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          {task.enabled ? '✅ 启用' : '⏸ 停用'}
        </button>
      </td>

      {/* 上次执行 */}
      <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">{lastRun}</td>

      {/* 操作 */}
      <td className="px-4 py-2">
        <div className="flex gap-2 items-center whitespace-nowrap">
          {confirming ? (
            <>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700 disabled:opacity-50"
              >
                确认
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={loading}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onEdit(task)}
                className="text-blue-600 hover:text-blue-800 text-xs font-medium"
              >
                编辑
              </button>
              <button
                onClick={() => setConfirming(true)}
                disabled={loading}
                className="text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-50"
              >
                删除
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── form ──────────────────────────────────────────────────────────────────────

function ScheduledTaskForm({
  initial,
  users,
  onSuccess,
  onCancel,
}: {
  initial: ScheduledTask | null;
  users: User[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presetForSchedule = (s: string) => {
    const found = CRON_PRESETS.find(p => p.value === s && p.value !== 'custom');
    return found ? found.value : 'custom';
  };

  const [form, setForm] = useState<FormState>(() => {
    if (!initial) return DEFAULT_FORM;
    const hasTag = !!initial.target_tag;
    return {
      name: initial.name,
      title: initial.title,
      assignMode: hasTag ? 'tag' : 'direct',
      targetOpenId: initial.target_open_id || '',
      targetTag: initial.target_tag || '',
      reporterOpenId: initial.reporter_open_id || '',
      schedulePreset: presetForSchedule(initial.schedule),
      schedule: initial.schedule,
      timezone: initial.timezone,
      deadlineDays: initial.deadline_days,
      priority: initial.priority,
      note: initial.note || '',
      reminderIntervalHours: initial.reminder_interval_hours,
      enabled: initial.enabled,
    };
  });

  // Fetch workload preview when tag mode is active
  const [workloadPreview, setWorkloadPreview] = useState<WorkloadUser[]>([]);
  const [workloadLoading, setWorkloadLoading] = useState(false);
  useEffect(() => {
    if (form.assignMode !== 'tag' || !form.targetTag.trim()) {
      setWorkloadPreview([]);
      return;
    }
    const tag = form.targetTag.trim();
    setWorkloadLoading(true);
    api.getWorkload(tag)
      .then(setWorkloadPreview)
      .catch(() => setWorkloadPreview([]))
      .finally(() => setWorkloadLoading(false));
  }, [form.assignMode, form.targetTag]);

  const handlePresetChange = (value: string) => {
    if (value === 'custom') {
      setForm(f => ({ ...f, schedulePreset: 'custom' }));
    } else {
      setForm(f => ({ ...f, schedulePreset: value, schedule: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError('请填写任务名称'); return; }
    if (!form.title) { setError('请填写催办标题'); return; }
    if (form.assignMode === 'direct' && !form.targetOpenId) { setError('请选择被催办人'); return; }
    if (form.assignMode === 'tag' && !form.targetTag.trim()) { setError('请输入分配标签'); return; }
    if (!form.schedule) { setError('请设置执行时间'); return; }
    setLoading(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        title: form.title,
        targetOpenId: form.assignMode === 'direct' ? form.targetOpenId : null,
        targetTag: form.assignMode === 'tag' ? form.targetTag.trim().toLowerCase() : null,
        reporterOpenId: form.reporterOpenId || null,
        schedule: form.schedule,
        timezone: form.timezone,
        deadlineDays: form.deadlineDays,
        priority: form.priority,
        note: form.note || null,
        reminderIntervalHours: form.reminderIntervalHours,
        enabled: form.enabled,
      };
      if (initial) {
        await api.updateScheduledTask(initial.id, payload);
      } else {
        await api.createScheduledTask(payload as Parameters<typeof api.createScheduledTask>[0]);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-6">
      <h3 className="text-lg font-semibold mb-4">{initial ? '编辑定时任务' : '新增定时任务'}</h3>
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {/* 名称 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">名称 *</label>
          <input
            type="text" required
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="例：周报催办"
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* 催办标题 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">催办标题 *</label>
          <input
            type="text" required
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="例：提交本周工作周报"
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* 分配方式 */}
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            分配方式 <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, assignMode: 'direct' }))}
              className={`px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors ${
                form.assignMode === 'direct'
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              👤 指定人员
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, assignMode: 'tag' }))}
              className={`px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors ${
                form.assignMode === 'tag'
                  ? 'bg-purple-500 text-white border-purple-500'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              🏷 按标签自动分配（按工作量）
            </button>
          </div>

          {form.assignMode === 'direct' ? (
            <div>
              <UserCombobox
                value={form.targetOpenId || null}
                onChange={v => setForm({ ...form, targetOpenId: v ?? '' })}
                users={users}
                placeholder="搜索姓名或邮箱…"
                required
              />
              <FeishuUserLookup
                onSelect={(openId) => {
                  setForm(f => ({ ...f, targetOpenId: openId }));
                  mutate(SWR_KEYS.users);
                }}
              />
            </div>
          ) : (
            <div>
              <input
                type="text"
                value={form.targetTag}
                onChange={e => setForm(f => ({ ...f, targetTag: e.target.value.toLowerCase().trim() }))}
                placeholder="标签名，例：finance、ops（需先在用户管理中设置）"
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
              />
              {/* Workload preview */}
              {form.targetTag.trim() && (
                <div className="mt-2 p-3 bg-purple-50 rounded-lg border border-purple-100">
                  <p className="text-xs font-medium text-purple-700 mb-1.5">
                    🏷 标签「{form.targetTag}」成员工作量预览
                    {workloadLoading && <span className="ml-2 text-purple-400">加载中…</span>}
                  </p>
                  {workloadPreview.length === 0 && !workloadLoading ? (
                    <p className="text-xs text-gray-400">未找到该标签的成员，请在用户管理中为用户添加标签</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {workloadPreview.map((u, i) => (
                        <span key={u.openId ?? u.userId} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${
                          i === 0 ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-white text-gray-600 border border-gray-200'
                        }`}>
                          {i === 0 && '⚡ '}
                          {u.name ?? u.userId}
                          <span className="font-medium">{u.pendingTasks} 任务</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {workloadPreview.length > 0 && (
                    <p className="text-xs text-purple-500 mt-1.5">⚡ 任务将分配给工作量最少的成员（绿色高亮）</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 报告人 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            报告人
            <span className="ml-1 text-gray-400 font-normal text-xs">（任务完成时通知，可选）</span>
          </label>
          <UserCombobox
            value={form.reporterOpenId || null}
            onChange={v => setForm({ ...form, reporterOpenId: v ?? '' })}
            users={users}
            placeholder="搜索姓名或邮箱…（可选）"
          />
          <FeishuUserLookup
            onSelect={(openId) => {
              setForm(f => ({ ...f, reporterOpenId: openId }));
              mutate(SWR_KEYS.users);
            }}
          />
        </div>

        {/* 执行时间预设 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">执行时间 *</label>
          <select
            value={form.schedulePreset}
            onChange={e => handlePresetChange(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-2"
          >
            {CRON_PRESETS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          {form.schedulePreset === 'custom' && (
            <input
              type="text"
              value={form.schedule}
              onChange={e => setForm({ ...form, schedule: e.target.value })}
              placeholder="Cron 表达式，例：0 9 * * 1-5"
              className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
          )}
          {form.schedulePreset !== 'custom' && (
            <span className="text-xs text-gray-400 font-mono">{form.schedule}</span>
          )}
        </div>

        {/* 时区 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">时区</label>
          <select
            value={form.timezone}
            onChange={e => setForm({ ...form, timezone: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {TIMEZONES.map(tz => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        {/* 截止天数 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            截止天数
            <span className="ml-1 text-gray-400 font-normal text-xs">（创建后几天截止）</span>
          </label>
          <input
            type="number" min={1} max={365}
            value={form.deadlineDays}
            onChange={e => setForm({ ...form, deadlineDays: parseInt(e.target.value) || 1 })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* 紧急程度 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">紧急程度</label>
          <select
            value={form.priority}
            onChange={e => setForm({ ...form, priority: e.target.value as 'p0' | 'p1' | 'p2' })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="p0">🔴 P0 紧急（今天必须完成）</option>
            <option value="p1">🟡 P1 一般（默认）</option>
            <option value="p2">🟢 P2 不紧急</option>
          </select>
        </div>

        {/* 备注 */}
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
          <textarea
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
            rows={2}
            placeholder="可选说明"
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* 提醒间隔 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            提醒间隔（小时）
            <span className="ml-1 text-gray-400 font-normal text-xs">（0 = 关闭）</span>
          </label>
          <input
            type="number" min={0} max={168}
            value={form.reminderIntervalHours}
            onChange={e => setForm({ ...form, reminderIntervalHours: parseInt(e.target.value) || 0 })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* 启用 */}
        <div className="flex items-center gap-2 pt-6">
          <input
            type="checkbox"
            id="enabled"
            checked={form.enabled}
            onChange={e => setForm({ ...form, enabled: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <label htmlFor="enabled" className="text-sm font-medium text-gray-700">启用此定时任务</label>
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {loading ? '保存中...' : (initial ? '保存修改' : '创建定时任务')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-gray-100 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-200 transition-colors"
        >
          取消
        </button>
      </div>
    </form>
  );
}
