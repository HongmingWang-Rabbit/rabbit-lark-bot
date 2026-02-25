import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rabbit Lark Bot - Dashboard',
  description: '飞书自动化工具管理后台',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50">
        <nav className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-gray-900">🐰 Rabbit Lark Bot</h1>
              <div className="flex gap-6">
                <a href="/" className="text-gray-600 hover:text-gray-900">Dashboard</a>
                <a href="/tasks" className="text-gray-600 hover:text-gray-900">任务</a>
                <a href="/admins" className="text-gray-600 hover:text-gray-900">管理员</a>
                <a href="/settings" className="text-gray-600 hover:text-gray-900">设置</a>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
