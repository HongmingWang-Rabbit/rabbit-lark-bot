// ============ 类型定义 ============

export interface Task {
  id: string;
  name: string;
  target: string;
  status: '待办' | '进行中' | '已完成';
  deadline: number | null;
  proof: string | null;
  note: string;
  createdAt: number;
}

export interface CreateTaskParams {
  taskName: string;
  targetEmail: string;
  deadline?: string;
  note?: string;
  creatorId?: string;
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
  };
  recentActivity: AuditLog[];
}

export interface ApiError {
  error: string;
}

// ============ API 配置 ============

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

// ============ 请求封装 ============

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options?.headers,
  };

  // 添加 API Key 认证
  if (API_KEY) {
    (headers as Record<string, string>)['X-API-Key'] = API_KEY;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorData: ApiError = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errorData.error || `API Error: ${res.status}`);
  }

  return res.json();
}

// ============ API 方法 ============

export const api = {
  // Dashboard
  getDashboard: () => fetchAPI<DashboardData>('/dashboard'),

  // Tasks
  getTasks: () => fetchAPI<Task[]>('/tasks'),

  createTask: (data: CreateTaskParams) =>
    fetchAPI<{ success: boolean; record: unknown }>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  completeTask: (id: string, data: { proof?: string; userId?: string }) =>
    fetchAPI<{ success: boolean }>(`/tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteTask: (id: string, userId?: string) =>
    fetchAPI<{ success: boolean }>(`/tasks/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId }),
    }),

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
    const query = params ? new URLSearchParams(params as Record<string, string>).toString() : '';
    return fetchAPI<AuditLog[]>(`/audit${query ? `?${query}` : ''}`);
  },
};

export default api;
