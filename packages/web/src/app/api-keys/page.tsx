'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { api, AgentApiKey, SWR_KEYS } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/StatusStates';
import AdminGuard from '@/components/AdminGuard';

function ApiKeysPage() {
  const { data: keys, error, isLoading } = useSWR<AgentApiKey[]>(SWR_KEYS.apiKeys, api.getApiKeys);

  if (isLoading) return <LoadingState />;
  if (error) {
    const is403 = error.message?.includes('Forbidden') || error.message?.includes('403');
    return <ErrorState
      message={is403 ? '无权访问：需要管理员权限' : error.message}
      retryKey={is403 ? undefined : SWR_KEYS.apiKeys}
    />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">API Keys</h2>
      </div>

      <CreateKeyForm />

      <div className="bg-white rounded-lg shadow mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">名称</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Key 前缀</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">创建者</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">创建时间</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">最后使用</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">状态</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {keys?.map((k) => (
                <KeyRow key={k.id} apiKey={k} />
              ))}
              {keys?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    暂无 API Key
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CreateKeyForm() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError('');

    try {
      const result = await api.createApiKey(name.trim());
      setCreatedKey(result.key);
      setName('');
      mutate(SWR_KEYS.apiKeys);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <form onSubmit={handleCreate} className="flex items-center gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key 名称（如 MCP Prod）"
          aria-label="Key 名称"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          maxLength={100}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="bg-blue-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {loading ? '创建中...' : '创建 Key'}
        </button>
      </form>

      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

      {createdKey && (
        <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800 font-medium mb-2">
            Key 已创建 — 请立即复制，此密钥只显示一次！
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border rounded px-3 py-2 text-sm font-mono break-all">
              {createdKey}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 bg-green-600 text-white rounded px-3 py-2 text-sm hover:bg-green-700 transition-colors"
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <button
            onClick={() => { setCreatedKey(null); setCopied(false); }}
            className="text-sm text-gray-500 hover:text-gray-700 mt-2"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}

function KeyRow({ apiKey }: { apiKey: AgentApiKey }) {
  const [revoking, setRevoking] = useState(false);

  const isRevoked = !!apiKey.revoked_at;

  async function handleRevoke() {
    if (!confirm(`确认撤销 Key "${apiKey.name}"？此操作不可恢复。`)) return;

    setRevoking(true);
    try {
      await api.revokeApiKey(apiKey.id);
      mutate(SWR_KEYS.apiKeys);
    } catch {
      alert('撤销失败，请重试');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <tr className={`border-b last:border-0 ${isRevoked ? 'opacity-50' : ''}`}>
      <td className="px-4 py-3 font-medium">{apiKey.name}</td>
      <td className="px-4 py-3 font-mono text-gray-500">{apiKey.key_prefix}...</td>
      <td className="px-4 py-3 text-gray-600">{apiKey.created_by}</td>
      <td className="px-4 py-3 text-gray-500">{new Date(apiKey.created_at).toLocaleDateString()}</td>
      <td className="px-4 py-3 text-gray-500">
        {apiKey.last_used_at ? new Date(apiKey.last_used_at).toLocaleDateString() : '—'}
      </td>
      <td className="px-4 py-3">
        {isRevoked ? (
          <span className="text-red-500 text-xs font-medium">已撤销</span>
        ) : (
          <span className="text-green-600 text-xs font-medium">有效</span>
        )}
      </td>
      <td className="px-4 py-3">
        {!isRevoked && (
          <button
            onClick={handleRevoke}
            disabled={revoking}
            aria-label={`撤销 ${apiKey.name}`}
            className="text-red-500 hover:text-red-700 text-sm disabled:opacity-50"
          >
            {revoking ? '撤销中...' : '撤销'}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function ApiKeysPageGuarded() {
  return <AdminGuard><ApiKeysPage /></AdminGuard>;
}
