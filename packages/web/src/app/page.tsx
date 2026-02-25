'use client';

import useSWR from 'swr';
import { api } from '@/lib/api';

export default function Dashboard() {
  const { data, error, isLoading } = useSWR('/dashboard', api.getDashboard);

  if (isLoading) return <div className="text-center py-12">加载中...</div>;
  if (error) return <div className="text-center py-12 text-red-500">加载失败: {error.message}</div>;

  const stats = data?.stats || {};
  const activity = data?.recentActivity || [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>
      
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard title="总任务数" value={stats.totalTasks} color="blue" />
        <StatCard title="待办任务" value={stats.pendingTasks} color="yellow" />
        <StatCard title="已完成" value={stats.completedTasks} color="green" />
        <StatCard title="管理员" value={stats.adminCount} color="purple" />
      </div>

      {/* 最近活动 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">最近活动</h3>
        {activity.length === 0 ? (
          <p className="text-gray-500">暂无活动记录</p>
        ) : (
          <div className="space-y-3">
            {activity.map((log: any) => (
              <div key={log.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <span className="font-medium">{actionLabel(log.action)}</span>
                  {log.target_id && <span className="text-gray-500 ml-2">({log.target_id.slice(0, 8)}...)</span>}
                </div>
                <span className="text-sm text-gray-400">
                  {new Date(log.created_at).toLocaleString('zh-CN')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, color }: { title: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
  };
  
  return (
    <div className={`rounded-lg border p-4 ${colors[color]}`}>
      <div className="text-sm opacity-75">{title}</div>
      <div className="text-3xl font-bold">{value ?? '-'}</div>
    </div>
  );
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    create_task: '创建任务',
    complete_task: '完成任务',
    delete_task: '删除任务',
    add_admin: '添加管理员',
    remove_admin: '移除管理员',
  };
  return labels[action] || action;
}
