'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface AuthUser {
  userId: string;
  name: string | null;
  email: string | null;
  role: 'superadmin' | 'admin' | 'user';
  avatarUrl: string | null;
}

interface AuthCtx {
  authed: boolean;
  user: AuthUser | null;
  loading: boolean;
  loginWithPassword: (password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  feishuOAuthUrl: string;
}

const AuthContext = createContext<AuthCtx>({
  authed: false,
  user: null,
  loading: true,
  loginWithPassword: async () => ({ success: false }),
  logout: async () => {},
  feishuOAuthUrl: '/api/auth/feishu',
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      if (data.authed && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const loginWithPassword = useCallback(async (password: string) => {
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        // Re-check session to get full user info
        await checkSession();
        return { success: true };
      }
      return { success: false, error: data.error || '登录失败' };
    } catch {
      return { success: false, error: '网络错误，请重试' };
    }
  }, [checkSession]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      setUser(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center" role="status">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" aria-hidden="true" />
          <p className="mt-2 text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  const authed = !!user;

  return (
    <AuthContext.Provider value={{
      authed,
      user,
      loading,
      loginWithPassword,
      logout,
      feishuOAuthUrl: '/api/auth/feishu',
    }}>
      {authed ? children : <LoginScreen loginWithPassword={loginWithPassword} />}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000; // 1 minute

function LoginScreen({ loginWithPassword }: { loginWithPassword: AuthCtx['loginWithPassword'] }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (Date.now() < lockedUntil) {
      const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
      setError(`登录已锁定，请 ${secs} 秒后重试`);
      return;
    }

    setSubmitting(true);
    setError('');

    const result = await loginWithPassword(pw);

    if (!result.success) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= MAX_LOGIN_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_MS);
        setError(`连续错误 ${MAX_LOGIN_ATTEMPTS} 次，锁定 1 分钟`);
        setAttempts(0);
      } else {
        setError(result.error || '密码错误');
      }
      setPw('');
    }

    setSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🐰</div>
          <h1 className="text-xl font-bold text-gray-900">Rabbit Lark Bot</h1>
          <p className="text-sm text-gray-500 mt-1">管理后台</p>
        </div>

        {/* Feishu OAuth — primary */}
        <a
          href="/api/auth/feishu"
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg py-2.5 font-medium hover:bg-blue-700 transition-colors mb-4"
        >
          飞书账号登录
        </a>

        {/* Password — collapsible fallback */}
        <div className="border-t pt-4">
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="w-full text-sm text-gray-400 hover:text-gray-600 transition-colors text-center"
          >
            {showPassword ? '收起密码登录' : '使用密码登录'}
          </button>

          {showPassword && (
            <form onSubmit={handleSubmit} className="mt-3 space-y-3">
              <div>
                <input
                  type="password"
                  value={pw}
                  onChange={e => { setPw(e.target.value); setError(''); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入密码"
                  aria-label="密码"
                  disabled={submitting}
                  autoFocus
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={submitting || !pw}
                className="w-full bg-gray-600 text-white rounded-lg py-2 font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {submitting ? '登录中...' : '登录'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
