// ============ 类型定义 ============

export interface Task {
  id: number;
  title: string;
  creator_id: string | null;
  assignee_id: string | null;
  assignee_open_id: string | null;
  reporter_open_id: string | null;   // person notified on completion
  deadline: string | null;           // ISO date string
  status: 'pending' | 'completed';
  reminder_interval_hours: number;
  last_reminded_at: string | null;
  proof: string | null;
  note: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CreateTaskParams {
  title: string;
  targetOpenId: string;              // assignee's open_id (ou_xxx)
  reporterOpenId?: string;           // reporter's open_id — notified on completion
  deadline?: string;
  note?: string;
  reminderIntervalHours?: number;
}

export interface Admin {
  id: number;
  user_id: string | null;
  email: string | null;
  name: string | null;
  role: 'admin' | 'superadmin';
  created_at: string;
  updated_at: string;
}

export interface AddAdminParams {
  userId?: string;
  email?: string;
  name?: string;
  role?: 'admin' | 'superadmin';
}

export type UserRole = 'superadmin' | 'admin' | 'user';

export interface User {
  id: number;
  userId: string;
  openId: string | null;
  feishuUserId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: UserRole;
  configs: { features?: Record<string, boolean> };
  resolvedFeatures?: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface Feature {
  id: string;
  label: string;
  description: string;
  defaultFor: 'all' | string[];
  adminOnly: boolean;
}

export interface Setting {
  key: string;
  value: unknown;
  description: string | null;
}

export interface AuditLog {
  id: number;
  user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface DashboardData {
  stats: {
    totalTasks: number;
    pendingTasks: number;
    completedTasks: number;
    adminCount: number;
    totalUsers: number;
  };
  recentActivity: AuditLog[];
  builtinEnabled: boolean;
}

export interface ApiError {
  error: string;
}

// ============ SWR cache key constants ============
// Use these in useSWR() and mutate() to ensure consistent cache keys across pages.

export const SWR_KEYS = {
  dashboard: '/dashboard',
  tasks: '/tasks',
  users: '/users',
  features: '/users/_features',
} as const;

// ============ API 配置 ============

// Client always calls /api (relative) — Next.js rewrites proxy to the backend server
const API_BASE = '/api';
// TODO: NEXT_PUBLIC_API_KEY is inlined into the client bundle, making it extractable.
// For production, route API calls through Next.js server-side API routes that inject
// the key server-side, and remove the NEXT_PUBLIC_ prefix.
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';
const FETCH_TIMEOUT_MS = 15_000;

// ============ 请求封装 ============

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };

  // Only set Content-Type for requests with a body
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  // 添加 API Key 认证
  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorData: ApiError = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(errorData.error || `API Error: ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Unexpected response type: ${contentType || 'unknown'}`);
    }

    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============ API 方法 ============

export const api = {
  // Dashboard
  getDashboard: () => fetchAPI<DashboardData>('/dashboard'),

  // Tasks
  getTasks: () => fetchAPI<Task[]>('/tasks'),

  createTask: (data: CreateTaskParams) =>
    fetchAPI<{ success: boolean; task: Task }>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  completeTask: (id: string, data: { proof?: string; userId?: string }) =>
    fetchAPI<{ success: boolean }>(`/tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteTask: (id: string, userId?: string) => {
    const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    return fetchAPI<{ success: boolean }>(`/tasks/${id}${query}`, {
      method: 'DELETE',
    });
  },

  // Admins
  getAdmins: () => fetchAPI<Admin[]>('/admins'),

  addAdmin: (data: AddAdminParams) =>
    fetchAPI<Admin>('/admins', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  removeAdmin: (userId: string) =>
    fetchAPI<{ success: boolean; removed: Admin }>(`/admins/${userId}`, {
      method: 'DELETE',
    }),

  // Settings
  getSettings: () => fetchAPI<Setting[]>('/settings'),

  updateSetting: (key: string, value: unknown, description?: string) =>
    fetchAPI<{ success: boolean }>(`/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, description }),
    }),

  // Audit
  getAuditLogs: (params?: { limit?: number; offset?: number; userId?: string; action?: string }) => {
    if (!params) return fetchAPI<AuditLog[]>('/audit');
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) filtered[k] = String(v);
    }
    const query = new URLSearchParams(filtered).toString();
    return fetchAPI<AuditLog[]>(`/audit${query ? `?${query}` : ''}`);
  },

  // Users
  getUsers: () => fetchAPI<{ users: User[] }>('/users').then(r => r.users),

  getUser: (userId: string) => fetchAPI<{ user: User }>(`/users/${userId}`).then(r => r.user),

  upsertUser: (data: { userId: string; name?: string; email?: string; role?: UserRole; openId?: string }) =>
    fetchAPI<{ user: User }>('/users', { method: 'POST', body: JSON.stringify(data) }).then(r => r.user),

  updateUser: (userId: string, data: { role?: UserRole; configs?: { features?: Record<string, boolean> }; name?: string | null; email?: string | null; phone?: string | null }) =>
    fetchAPI<{ user: User }>(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify(data) }).then(r => r.user),

  setFeature: (userId: string, featureId: string, enabled: boolean) =>
    fetchAPI<{ user: User }>(`/users/${userId}/features/${featureId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }).then(r => r.user),

  deleteUser: (userId: string) =>
    fetchAPI<{ success: boolean }>(`/users/${userId}`, { method: 'DELETE' }),

  getFeatures: () => fetchAPI<{ features: Feature[] }>('/users/_features').then(r => r.features),
};

export default api;
