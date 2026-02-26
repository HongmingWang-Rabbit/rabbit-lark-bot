'use client';

import { useState, useMemo } from 'react';
import useSWR, { mutate } from 'swr';
import { api, Task, User, CreateTaskParams } from '@/lib/api';
import UserCombobox from '@/components/UserCombobox';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build open_id → display name map from the users list */
function useUserMap() {
  const { data: users } = useSWR<User[]>('/users', api.getUsers);
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
  const { data: tasks, error, isLoading } = useSWR<Task[]>('/tasks', api.getTasks);
  const userMap = useUserMap();
  const [showForm, setShowForm] = useState(false);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  const pending   = (tasks ?? []).filter(t => t.status === 'pending');
  const completed = (tasks ?? []).filter(t => t.status === 'completed');

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
            mutate('/tasks');
          }}
        />
      )}

      <TaskTable tasks={tasks ?? []} userMap={userMap} />
    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="text-center py-12">
      <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      <p className="mt-2 text-gray-500">加载中...</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-red-500">❌ 加载失败</p>
      <p className="text-sm text-gray-500 mt-2">{message}</p>
      <button onClick={() => mutate('/tasks')} className="mt-4 text-blue-500 hover:underline">
        重试
      </button>
    </div>
  );
}

function TaskTable({ tasks, userMap }: { tasks: Task[]; userMap: Map<string, string> }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full min-w-[700px]">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">任务名称</th>
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
              <td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无任务</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ task, userMap }: { task: Task; userMap: Map<string, string> }) {
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    if (!confirm('确认标记为完成？')) return;
    setLoading(true);
    try {
      await api.completeTask(String(task.id), {});
      mutate('/tasks');
    } catch (err) {
      alert(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('确认删除此任务？')) return;
    setLoading(true);
    try {
      await api.deleteTask(String(task.id));
      mutate('/tasks');
    } catch (err) {
      alert(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const assigneeName = resolveName(task.assignee_open_id, userMap);
  const reporterName = resolveName(task.reporter_open_id, userMap);

  return (
    <tr className={`hover:bg-gray-50 ${loading ? 'opacity-50' : ''}`}>
      <td className="px-4 py-3 font-medium">
        {task.title}
        {task.note && <p className="text-xs text-gray-400 mt-0.5">{task.note}</p>}
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
        <StatusBadge status={task.status} completedAt={task.completed_at} />
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
      <td className="px-4 py-3 flex gap-3">
        {task.status === 'pending' && (
          <button
            onClick={handleComplete}
            disabled={loading}
            className="text-green-600 hover:text-green-800 disabled:opacity-50"
          >
            完成
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={loading}
          className="text-red-600 hover:text-red-800 disabled:opacity-50"
        >
          删除
        </button>
      </td>
    </tr>
  );
}

function StatusBadge({ status, completedAt }: { status: Task['status']; completedAt: string | null }) {
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
  const { data: users = [] } = useSWR<User[]>('/users', api.getUsers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    title: string;
    targetOpenId: string | null;
    reporterOpenId: string | null;
    deadline: string;
    note: string;
    reminderIntervalHours: number;
  }>({
    title: '',
    targetOpenId: null,
    reporterOpenId: null,
    deadline: '',
    note: '',
    reminderIntervalHours: 24,
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            提醒间隔（小时）
            <span className="ml-1 text-gray-400 font-normal text-xs">（0 = 关闭）</span>
          </label>
          <input
            type="number" min={0} max={168}
            value={form.reminderIntervalHours}
            onChange={e => setForm({ ...form, reminderIntervalHours: Number(e.target.value) })}
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
