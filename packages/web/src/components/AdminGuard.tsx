'use client';

import { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

interface Props {
  children: ReactNode;
  /** Minimum role required. Defaults to 'admin'. */
  require?: 'admin' | 'superadmin';
}

/**
 * Renders children only if the current user has sufficient role.
 * Shows a 403 page otherwise. Use this on any admin-only page.
 */
export default function AdminGuard({ children, require: minRole = 'admin' }: Props) {
  const { user } = useAuth();

  const roleRank: Record<string, number> = { user: 0, admin: 1, superadmin: 2 };
  const userRank = roleRank[user?.role ?? 'user'] ?? 0;
  const requiredRank = roleRank[minRole] ?? 1;

  if (userRank < requiredRank) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="text-6xl mb-4">🔒</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">无权限访问</h1>
        <p className="text-gray-500 text-sm max-w-xs">
          此页面需要管理员权限。请联系超级管理员开通权限。
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
