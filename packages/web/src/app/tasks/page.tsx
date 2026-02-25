'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { api, Task, CreateTaskParams } from '@/lib/api';

export default function TasksPage() {
  const { data: tasks, error, isLoading } = useSWR<Task[]>('/tasks', api.getTasks);
  const [showForm, setShowForm] = useState(false);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">催办任务</h2>
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

      <TaskTable tasks={tasks || []} />
    </div>
  );
}

// ============ 组件 ============

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
      <button
        onClick={() => mutate('/tasks')}
        className="mt-4 text-blue-500 hover:underline"
      >
        重试
      </button>
    </div>
  );
}

function TaskTable({ tasks }: { tasks: Task[] }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">任务名称</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">催办对象</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">截止时间</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                暂无任务
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ task }: { task: Task }) {
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    if (!confirm('确认标记为完成？')) return;
    setLoading(true);
    try {
      await api.completeTask(task.id, {});
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
      await api.deleteTask(task.id);
      mutate('/tasks');
    } catch (err) {
      alert(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <tr className={`hover:bg-gray-50 ${loading ? 'opacity-50' : ''}`}>
      <td className="px-4 py-3">{task.name}</td>
      <td className="px-4 py-3 text-gray-600">{task.target}</td>
      <td className="px-4 py-3">
        <StatusBadge status={task.status} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-500">
        {task.deadline ? new Date(task.deadline).toLocaleDateString('zh-CN') : '-'}
      </td>
      <td className="px-4 py-3">
        {task.status === '待办' && (
          <button
            onClick={handleComplete}
            disabled={loading}
            className="text-green-600 hover:text-green-800 mr-3 disabled:opacity-50"
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

function TaskForm({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateTaskParams>({
    taskName: '',
    targetEmail: '',
    deadline: '',
    note: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.createTask(form);
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
          <label htmlFor="taskName" className="block text-sm font-medium text-gray-700 mb-1">
            任务名称 *
          </label>
          <input
            id="taskName"
            type="text"
            required
            value={form.taskName}
            onChange={(e) => setForm({ ...form, taskName: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="例：提交周报"
          />
        </div>
        <div>
          <label htmlFor="targetEmail" className="block text-sm font-medium text-gray-700 mb-1">
            催办对象邮箱 *
          </label>
          <input
            id="targetEmail"
            type="email"
            required
            value={form.targetEmail}
            onChange={(e) => setForm({ ...form, targetEmail: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="someone@company.com"
          />
        </div>
        <div>
          <label htmlFor="deadline" className="block text-sm font-medium text-gray-700 mb-1">
            截止时间
          </label>
          <input
            id="deadline"
            type="date"
            value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label htmlFor="note" className="block text-sm font-medium text-gray-700 mb-1">
            备注
          </label>
          <input
            id="note"
            type="text"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="mt-4">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {loading ? '创建中...' : '创建任务'}
        </button>
      </div>
    </form>
  );
}

function StatusBadge({ status }: { status: Task['status'] }) {
  const styles: Record<Task['status'], string> = {
    待办: 'bg-yellow-100 text-yellow-800',
    进行中: 'bg-blue-100 text-blue-800',
    已完成: 'bg-green-100 text-green-800',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
}
