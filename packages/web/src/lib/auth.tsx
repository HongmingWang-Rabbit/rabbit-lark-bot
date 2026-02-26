'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

const PASSWORD = 'adminrabbit';
const STORAGE_KEY = 'rabbit_lark_authed';

interface AuthCtx {
  authed: boolean;
  login: (pw: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({ authed: false, login: () => false, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAuthed(localStorage.getItem(STORAGE_KEY) === 'true');
    setChecked(true);
  }, []);

  function login(pw: string) {
    if (pw === PASSWORD) {
      localStorage.setItem(STORAGE_KEY, 'true');
      setAuthed(true);
      return true;
    }
    return false;
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    setAuthed(false);
  }

  if (!checked) return null;

  return (
    <AuthContext.Provider value={{ authed, login, logout }}>
      {authed ? children : <LoginScreen login={login} />}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

function LoginScreen({ login }: { login: (pw: string) => boolean }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!login(pw)) {
      setError('密码错误');
      setPw('');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🐰</div>
          <h1 className="text-xl font-bold text-gray-900">Rabbit Lark Bot</h1>
          <p className="text-sm text-gray-500 mt-1">管理后台</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={pw}
              onChange={e => { setPw(e.target.value); setError(''); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="请输入密码"
              autoFocus
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 transition-colors"
          >
            登录
          </button>
        </form>
      </div>
    </div>
  );
}
