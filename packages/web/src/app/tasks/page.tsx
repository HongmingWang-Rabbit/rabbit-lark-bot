'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { api } from '@/lib/api';

export default function TasksPage() {
  const { data: tasks, error, isLoading } = useSWR('/tasks', api.getTasks);
  const [showForm, setShowForm] = useState(false);

  if (isLoading) return <div className="text-center py-12">加载中...</div>;
  if (error) return <div className="text-center py-12 text-red-500">加载失败</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">催办任务</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
        >
          {showForm ? '取消' : '+ 创建任务'}
        </button>
      </div>

      {showForm && <TaskForm onSuccess={() => { setShowForm(false); mutate('/tasks'); }} />}

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
            {tasks?.map((task: any) => (
              <tr key={task.id} className="hover:bg-gray-50">
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
                      onClick={() => handleComplete(task.id)}
                      className="text-green-600 hover:text-green-800 mr-3"
                    >
                      完成
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="text-red-600 hover:text-red-800"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {tasks?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  暂无任务
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskForm({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ taskName: '', targetEmail: '', deadline: '', note: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.createTask(form);
      onSuccess();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">任务名称 *</label>
          <input
            type="text"
            required
            value={form.taskName}
            onChange={e => setForm({ ...form, taskName: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="例：提交周报"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">催办对象邮箱 *</label>
          <input
            type="email"
            required
            value={form.targetEmail}
            onChange={e => setForm({ ...form, targetEmail: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="someone@company.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">截止时间</label>
          <input
            type="date"
            value={form.deadline}
            onChange={e => setForm({ ...form, deadline: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <input
            type="text"
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
      </div>
      <div className="mt-4">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? '创建中...' : '创建任务'}
        </button>
      </div>
    </form>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    '待办': 'bg-yellow-100 text-yellow-800',
    '进行中': 'bg-blue-100 text-blue-800',
    '已完成': 'bg-green-100 text-green-800',
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
}

async function handleComplete(id: string) {
  if (!confirm('确认标记为完成？')) return;
  try {
    await api.completeTask(id, {});
    mutate('/tasks');
  } catch (err: any) {
    alert(err.message);
  }
}

async function handleDelete(id: string) {
  if (!confirm('确认删除此任务？')) return;
  try {
    await api.deleteTask(id);
    mutate('/tasks');
  } catch (err: any) {
    alert(err.message);
  }
}
