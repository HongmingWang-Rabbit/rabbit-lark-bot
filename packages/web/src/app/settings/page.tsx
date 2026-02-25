'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { api, Setting } from '@/lib/api';

export default function SettingsPage() {
  const { data: settings, error, isLoading } = useSWR<Setting[]>('/settings', api.getSettings);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">系统设置</h2>

      <div className="bg-white rounded-lg shadow">
        <div className="divide-y">
          {settings?.map((setting) => (
            <SettingRow key={setting.key} setting={setting} />
          ))}
          {settings?.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-500">暂无配置项</div>
          )}
        </div>
      </div>

      {/* 系统信息 */}
      <SystemInfo />
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
      <button onClick={() => mutate('/settings')} className="mt-4 text-blue-500 hover:underline">
        重试
      </button>
    </div>
  );
}

function SettingRow({ setting }: { setting: Setting }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(JSON.stringify(setting.value));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(value);
      await api.updateSetting(setting.key, parsed);
      mutate('/settings');
      setEditing(false);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('JSON 格式错误');
      } else {
        setError(err instanceof Error ? err.message : '保存失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setValue(JSON.stringify(setting.value));
    setError(null);
  };

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="font-medium">{setting.key}</div>
          {setting.description && (
            <div className="text-sm text-gray-500">{setting.description}</div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {editing ? (
            <>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={loading}
                className={`border rounded px-2 py-1 font-mono text-sm w-48 ${
                  loading ? 'opacity-50' : ''
                } ${error ? 'border-red-500' : ''}`}
              />
              <button
                onClick={handleSave}
                disabled={loading}
                className="text-green-600 hover:text-green-800 disabled:opacity-50"
              >
                {loading ? '保存中...' : '保存'}
              </button>
              <button
                onClick={handleCancel}
                disabled={loading}
                className="text-gray-600 hover:text-gray-800 disabled:opacity-50"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                {JSON.stringify(setting.value)}
              </code>
              <button
                onClick={() => setEditing(true)}
                className="text-blue-600 hover:text-blue-800"
              >
                编辑
              </button>
            </>
          )}
        </div>
      </div>
      {error && <div className="mt-2 text-sm text-red-500">{error}</div>}
    </div>
  );
}

function SystemInfo() {
  return (
    <div className="mt-8 bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">系统信息</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-500">飞书 App ID:</span>
          <span className="ml-2 font-mono">
            {process.env.NEXT_PUBLIC_FEISHU_APP_ID || '***'}
          </span>
        </div>
        <div>
          <span className="text-gray-500">API 地址:</span>
          <span className="ml-2 font-mono">
            {process.env.NEXT_PUBLIC_API_URL || '/api'}
          </span>
        </div>
      </div>
    </div>
  );
}
