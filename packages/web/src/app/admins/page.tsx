'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { api, Admin, AddAdminParams } from '@/lib/api';
import AdminGuard from '@/components/AdminGuard';

function AdminsPage() {
  const { data: admins, error, isLoading } = useSWR<Admin[]>('/admins', api.getAdmins);
  const [showForm, setShowForm] = useState(false);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">管理员</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
        >
          {showForm ? '取消' : '+ 添加管理员'}
        </button>
      </div>

      {showForm && (
        <AdminForm
          onSuccess={() => {
            setShowForm(false);
            mutate('/admins');
          }}
        />
      )}

      <AdminTable admins={admins || []} />
    </div>
  );
}

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
      <button onClick={() => mutate('/admins')} className="mt-4 text-blue-500 hover:underline">
        重试
      </button>
    </div>
  );
}

function AdminTable({ admins }: { admins: Admin[] }) {
  return (
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
          {admins.map((admin) => (
            <AdminRow key={admin.id} admin={admin} />
          ))}
          {admins.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                暂无管理员
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AdminRow({ admin }: { admin: Admin }) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = async () => {
    if (!admin.user_id) { setError('无法删除：缺少 user_id'); return; }
    setLoading(true);
    setError(null);
    try {
      await api.removeAdmin(admin.user_id);
      mutate('/admins');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <tr className={`hover:bg-gray-50 ${loading ? 'opacity-50' : ''}`}>
        <td className="px-4 py-3 font-medium">{admin.name || '-'}</td>
        <td className="px-4 py-3 text-gray-600">{admin.email || '-'}</td>
        <td className="px-4 py-3 text-sm text-gray-500 font-mono">
          {admin.user_id ? `${admin.user_id.slice(0, 12)}...` : '-'}
        </td>
        <td className="px-4 py-3"><RoleBadge role={admin.role} /></td>
        <td className="px-4 py-3 text-sm text-gray-500">
          {new Date(admin.created_at).toLocaleDateString('zh-CN')}
        </td>
        <td className="px-4 py-3">
          {confirming ? (
            <div className="flex items-center gap-2">
              <button onClick={handleRemove} disabled={loading}
                className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700 disabled:opacity-50">
                {loading ? '移除中…' : '确认'}
              </button>
              <button onClick={() => setConfirming(false)} disabled={loading}
                className="text-xs text-gray-400 hover:text-gray-600">取消</button>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)}
              className="text-red-600 hover:text-red-800 text-sm">移除</button>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={6} className="px-4 py-2">
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded px-3 py-1.5">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">×</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function RoleBadge({ role }: { role: Admin['role'] }) {
  const styles: Record<Admin['role'], string> = {
    superadmin: 'bg-purple-100 text-purple-800',
    admin: 'bg-blue-100 text-blue-800',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[role]}`}>
      {role}
    </span>
  );
}

export default function AdminsPageGuarded() {
  return <AdminGuard><AdminsPage /></AdminGuard>;
}

function AdminForm({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AddAdminParams>({
    email: '',
    name: '',
    role: 'admin',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.addAdmin(form);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-6">
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            邮箱 *
          </label>
          <input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="someone@company.com"
          />
        </div>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            名称
          </label>
          <input
            id="name"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="张三"
          />
        </div>
        <div>
          <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
            角色
          </label>
          <select
            id="role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Admin['role'] })}
            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {loading ? '添加中...' : '添加管理员'}
        </button>
      </div>
    </form>
  );
}
