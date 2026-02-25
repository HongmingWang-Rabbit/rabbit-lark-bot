'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { api } from '@/lib/api';

export default function AdminsPage() {
  const { data: admins, error, isLoading } = useSWR('/admins', api.getAdmins);
  const [showForm, setShowForm] = useState(false);

  if (isLoading) return <div className="text-center py-12">加载中...</div>;
  if (error) return <div className="text-center py-12 text-red-500">加载失败</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">管理员</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
        >
          {showForm ? '取消' : '+ 添加管理员'}
        </button>
      </div>

      {showForm && <AdminForm onSuccess={() => { setShowForm(false); mutate('/admins'); }} />}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">名称</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">邮箱</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">User ID</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">角色</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">添加时间</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {admins?.map((admin: any) => (
              <tr key={admin.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{admin.name || '-'}</td>
                <td className="px-4 py-3 text-gray-600">{admin.email || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-500 font-mono">
                  {admin.user_id ? `${admin.user_id.slice(0, 12)}...` : '-'}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    admin.role === 'superadmin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {admin.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(admin.created_at).toLocaleDateString('zh-CN')}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleRemove(admin.user_id)}
                    className="text-red-600 hover:text-red-800"
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
            {admins?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  暂无管理员
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminForm({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'admin' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.addAdmin(form);
      onSuccess();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">邮箱 *</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="someone@company.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="张三"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
          <select
            value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
          >
            <option value="admin">Admin</option>
            <option value="superadmin">Super Admin</option>
          </select>
        </div>
      </div>
      <div className="mt-4">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? '添加中...' : '添加管理员'}
        </button>
      </div>
    </form>
  );
}

async function handleRemove(userId: string) {
  if (!confirm('确认移除此管理员？')) return;
  try {
    await api.removeAdmin(userId);
    mutate('/admins');
  } catch (err: any) {
    alert(err.message);
  }
}
