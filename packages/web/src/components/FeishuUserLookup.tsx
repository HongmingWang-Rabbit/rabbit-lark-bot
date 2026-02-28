'use client';

import { useState } from 'react';

interface LookupResult {
  openId: string;
  name: string | null;
  email: string | null;
  role: string;
}

interface Props {
  /** Called when the user clicks "使用此用户" — passes the open_id */
  onSelect: (openId: string, name: string | null) => void;
}

/**
 * Companion lookup panel for UserCombobox.
 *
 * Lets admins find a Feishu user by email or employee_id when they haven't
 * yet chatted with the bot and are absent from the local user list.
 * On success the user is auto-provisioned in the local DB so they also
 * appear in the UserCombobox going forward.
 */
export default function FeishuUserLookup({ onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLookup() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Detect whether input looks like an email or employee_id
      const isEmail = query.includes('@');
      const param = isEmail
        ? `email=${encodeURIComponent(query.trim())}`
        : `employee_id=${encodeURIComponent(query.trim())}`;

      const res = await fetch(`/api/users/_lookup?${param}`, { credentials: 'include' });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || '查询失败');
      if (!data.success || !data.user) {
        setError('未找到该用户，请确认邮箱/工号是否正确');
        return;
      }
      setResult(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败');
    } finally {
      setLoading(false);
    }
  }

  function handleSelect() {
    if (!result) return;
    onSelect(result.openId, result.name);
    setOpen(false);
    setQuery('');
    setResult(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-xs text-blue-500 hover:text-blue-700 hover:underline"
      >
        没找到？按邮箱 / 工号查找
      </button>
    );
  }

  return (
    <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
      <p className="text-xs text-blue-700 mb-2 font-medium">
        输入邮箱或工号（员工 ID）查找飞书用户
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setResult(null); setError(null); }}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleLookup())}
          placeholder="user@company.com 或 E00123"
          className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
          autoFocus
        />
        <button
          type="button"
          onClick={handleLookup}
          disabled={loading || !query.trim()}
          className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {loading ? '查询中…' : '查找'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setQuery(''); setResult(null); setError(null); }}
          className="px-2 py-1.5 text-gray-400 hover:text-gray-600 text-sm"
        >
          取消
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}

      {result && (
        <div className="mt-2 flex items-center justify-between bg-white rounded-lg px-3 py-2 border">
          <div>
            <span className="text-sm font-medium text-gray-800">
              {result.name || <span className="text-gray-400 italic">无姓名</span>}
            </span>
            {result.email && (
              <span className="ml-2 text-xs text-gray-400">{result.email}</span>
            )}
            <span className="ml-2 text-xs text-gray-400 font-mono">{result.openId}</span>
          </div>
          <button
            type="button"
            onClick={handleSelect}
            className="ml-3 px-3 py-1 bg-green-500 text-white text-xs rounded-lg hover:bg-green-600 transition-colors"
          >
            使用此用户
          </button>
        </div>
      )}
    </div>
  );
}
