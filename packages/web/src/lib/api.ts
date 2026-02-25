const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export async function fetchAPI(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'API Error');
  }
  
  return res.json();
}

export const api = {
  // Dashboard
  getDashboard: () => fetchAPI('/dashboard'),
  
  // Tasks
  getTasks: () => fetchAPI('/tasks'),
  createTask: (data: any) => fetchAPI('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  completeTask: (id: string, data: any) => fetchAPI(`/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify(data) }),
  deleteTask: (id: string) => fetchAPI(`/tasks/${id}`, { method: 'DELETE' }),
  
  // Admins
  getAdmins: () => fetchAPI('/admins'),
  addAdmin: (data: any) => fetchAPI('/admins', { method: 'POST', body: JSON.stringify(data) }),
  removeAdmin: (userId: string) => fetchAPI(`/admins/${userId}`, { method: 'DELETE' }),
  
  // Settings
  getSettings: () => fetchAPI('/settings'),
  updateSetting: (key: string, value: any) => fetchAPI(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  
  // Audit
  getAuditLogs: (params?: any) => {
    const query = new URLSearchParams(params).toString();
    return fetchAPI(`/audit${query ? `?${query}` : ''}`);
  },
};
