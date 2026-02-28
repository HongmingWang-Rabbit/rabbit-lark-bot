'use client';

import { useState, useMemo } from 'react';
import useSWR, { mutate } from 'swr';
import { api, SWR_KEYS, Task, User, CreateTaskParams } from '@/lib/api';
import UserCombobox from '@/components/UserCombobox';
import { LoadingState, ErrorState } from '@/components/StatusStates';

// ── constants ────────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<string, { label: string; className: string }> = {
  p0: { label: 'P0 紧急', className: 'bg-red-100 text-red-700' },
  p1: { label: 'P1 一般', className: 'bg-yellow-100 text-yellow-700' },
  p2: { label: 'P2 不紧急', className: 'bg-green-100 text-green-700' },
};

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build open_id → display name map from the users list */
function useUserMap() {
  const { data: users } = useSWR<User[]>(SWR_KEYS.users, api.getUsers);
  return useMemo(() => {
    const map = new Map<string, string>();
    users?.forEach((u) => {
      if (u.openId) map.set(u.openId, u.name || u.email || u.openId.slice(0, 12) + '…');
    });
    return map;
  }, [users]);
}

function resolveName(openId: string | null, userMap: Map<string, string>) {
  if (!openId) return '-';
  return userMap.get(openId) || openId.slice(0, 16) + '…';
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const { data: tasks, error, isLoading } = useSWR<Task[]>(SWR_KEYS.tasks, api.getTasks);
  const userMap = useUserMap();
  const [showForm, setShowForm] = useState(false);

  // useMemo must be called before any early returns (Rules of Hooks)
  const pending   = useMemo(() => (tasks ?? []).filter(t => t.status === 'pending'), [tasks]);
  const completed = useMemo(() => (tasks ?? []).filter(t => t.status === 'completed'), [tasks]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} retryKey={SWR_KEYS.tasks} />;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">催办任务</h2>
          <p className="text-sm text-gray-500 mt-1">
            待办 {pending.length} / 已完成 {completed.length}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
        >
          {showForm ? '取消' : '+ 创建任务'}
        </button>
      </div>

      {showForm && (
        <TaskForm
          onSuccess={() => {
            setShowForm(false);
            mutate(SWR_KEYS.tasks);
          }}
        />
      )}

      <TaskTable tasks={tasks ?? []} userMap={userMap} />
    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function TaskTable({ tasks, userMap }: { tasks: Task[]; userMap: Map<string, string> }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full min-w-[700px]" aria-label="催办任务列表">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">任务名称</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">优先级</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">催办对象</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">报告对象</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">截止时间</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">提醒间隔</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} userMap={userMap} />
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-gray-500">暂无任务</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ task, userMap }: { task: Task; userMap: Map<string, string> }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'complete' | 'delete' | null>(null);

  const handleComplete = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.completeTask(String(task.id), {});
      mutate(SWR_KEYS.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
      setConfirming(null);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.deleteTask(String(task.id));
      mutate(SWR_KEYS.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
      setConfirming(null);
    }
  };

  const assigneeName = resolveName(task.assignee_open_id, userMap);
  const reporterName = resolveName(task.reporter_open_id, userMap);

  return (
    <>
      <tr className={`hover:bg-gray-50 ${loading ? 'opacity-50' : ''}`}>
        <td className="px-4 py-3 font-medium">
          {task.title}
          {task.note && <p className="text-xs text-gray-400 mt-0.5">{task.note}</p>}
        </td>
        <td className="px-4 py-3">
          {(() => {
            const badge = PRIORITY_BADGE[task.priority] || PRIORITY_BADGE['p1'];
            return (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.className}`}>
                {badge.label}
              </span>
            );
          })()}
        </td>
        <td className="px-4 py-3 text-gray-600">{assigneeName}</td>
        <td className="px-4 py-3 text-gray-600">
          {task.reporter_open_id ? (
            <span title={task.reporter_open_id}>{reporterName}</span>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={task.status} />
        </td>
        <td className="px-4 py-3 text-sm text-gray-500">
          {task.deadline
            ? new Date(task.deadline).toLocaleDateString('zh-CN')
            : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-4 py-3 text-sm text-gray-500">
          {task.reminder_interval_hours > 0
            ? `每 ${task.reminder_interval_hours}h`
            : <span className="text-gray-300">关闭</span>}
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-3 items-center">
            {confirming ? (
              <>
                <span className="text-xs text-gray-500">
                  {confirming === 'complete' ? '确认完成？' : '确认删除？'}
                </span>
                <button
                  onClick={confirming === 'complete' ? handleComplete : handleDelete}
                  disabled={loading}
                  className={`text-xs font-medium px-2 py-0.5 rounded ${
                    confirming === 'delete' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  } disabled:opacity-50`}
                >
                  确认
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  disabled={loading}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  取消
                </button>
              </>
            ) : (
              <>
                {task.status === 'pending' && (
                  <button
                    onClick={() => setConfirming('complete')}
                    disabled={loading}
                    aria-label={`完成任务「${task.title}」`}
                    className="text-green-600 hover:text-green-800 disabled:opacity-50"
                  >
                    完成
                  </button>
                )}
                <button
                  onClick={() => setConfirming('delete')}
                  disabled={loading}
                  aria-label={`删除任务「${task.title}」`}
                  className="text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  删除
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={8} className="px-4 py-2">
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded px-3 py-1.5">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-auto">
                &times;
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: Task['status'] }) {
  if (status === 'completed') {
    return (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
        ✅ 已完成
      </span>
    );
  }
  return (
    <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
      ⏳ 待办
    </span>
  );
}

// ── create form ───────────────────────────────────────────────────────────────

function TaskForm({ onSuccess }: { onSuccess: () => void }) {
  const { data: users = [] } = useSWR<User[]>(SWR_KEYS.users, api.getUsers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    title: string;
    targetOpenId: string | null;
    reporterOpenId: string | null;
    deadline: string;
    note: string;
    reminderIntervalHours: number;
    priority: 'p0' | 'p1' | 'p2';
  }>({
    title: '',
    targetOpenId: null,
    reporterOpenId: null,
    deadline: '',
    note: '',
    reminderIntervalHours: 24,
    priority: 'p1',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.targetOpenId) { setError('请选择催办对象'); return; }
    setLoading(true);
    setError(null);
    try {
      await api.createTask({
        title: form.title,
        targetOpenId: form.targetOpenId,
        reporterOpenId: form.reporterOpenId ?? undefined,
        deadline: form.deadline || undefined,
        note: form.note || undefined,
        reminderIntervalHours: form.reminderIntervalHours,
        priority: form.priority,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-6">
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">任务名称 *</label>
          <input
            type="text" required
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="例：提交季度报告"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">催办对象 *</label>
          <UserCombobox
            users={users}
            value={form.targetOpenId}
            onChange={openId => setForm({ ...form, targetOpenId: openId })}
            placeholder="搜索姓名或邮箱…"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            报告对象
            <span className="ml-1 text-gray-400 font-normal text-xs">（任务完成时收到通知）</span>
          </label>
          <UserCombobox
            users={users}
            value={form.reporterOpenId}
            onChange={openId => setForm({ ...form, reporterOpenId: openId })}
            placeholder="搜索姓名或邮箱（可选）"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">截止时间</label>
          <input
            type="date"
            value={form.deadline}
            onChange={e => setForm({ ...form, deadline: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <input
            type="text"
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="可选说明"
          />
        </div>

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

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            提醒间隔（小时）
            <span className="ml-1 text-gray-400 font-normal text-xs">（0 = 关闭）</span>
          </label>
          <input
            type="number" min={0} max={168}
            value={form.reminderIntervalHours}
            onChange={e => setForm({ ...form, reminderIntervalHours: parseInt(e.target.value, 10) || 0 })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="mt-4">
        <button
          type="submit" disabled={loading}
          className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {loading ? '创建中...' : '创建任务'}
        </button>
      </div>
    </form>
  );
}
