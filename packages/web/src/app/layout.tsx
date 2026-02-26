import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import NavBar from './NavBar';

export const metadata: Metadata = {
  title: 'Rabbit Lark Bot - 管理后台',
  description: '飞书自动化工具管理后台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50">
        <AuthProvider>
          <NavBar />
          <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
