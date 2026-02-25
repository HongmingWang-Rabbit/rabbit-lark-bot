import type { Metadata } from 'next';
import Link from 'next/link';
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
              <Link href="/" className="text-xl font-bold text-gray-900 hover:text-gray-700">
                🐰 Rabbit Lark Bot
              </Link>
              <div className="flex gap-6">
                <NavLink href="/">Dashboard</NavLink>
                <NavLink href="/tasks">任务</NavLink>
                <NavLink href="/admins">管理员</NavLink>
                <NavLink href="/settings">设置</NavLink>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-gray-600 hover:text-gray-900 transition-colors"
    >
      {children}
    </Link>
  );
}
