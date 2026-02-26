'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function NavBar() {
  const { authed, logout } = useAuth();
  const pathname = usePathname();

  if (!authed) return null;

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-gray-900 hover:text-gray-700">
            🐰 Rabbit Lark Bot
          </Link>
          <div className="flex items-center gap-6">
            <NavLink href="/" active={pathname === '/'}>Dashboard</NavLink>
            <NavLink href="/users" active={pathname.startsWith('/users')}>用户管理</NavLink>
            <NavLink href="/tasks" active={pathname.startsWith('/tasks')}>任务</NavLink>
            <NavLink href="/settings" active={pathname.startsWith('/settings')}>设置</NavLink>
            <button
              onClick={logout}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              退出
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

function NavLink({ href, children, active }: { href: string; children: React.ReactNode; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`text-sm font-medium transition-colors ${
        active ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      {children}
    </Link>
  );
}
