'use client';

import { useState, useMemo, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { api, SWR_KEYS, Task, User, CreateTaskParams, WorkloadUser } from '@/lib/api';
import UserCombobox from '@/components/UserCombobox';
import Pagination from '@/components/Pagination';
import { LoadingState, ErrorState } from '@/components/StatusStates';

// ── constants ────────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<string, { label: string; className: string }> = {
  p0: { label: 'P0 紧急', className: 'bg-red-100 text-red-700' },
  p1: { label: 'P1 一般', className: 'bg-yellow-100 text-yellow-700' },
  p2: { label: 'P2 不紧急', className: 'bg-green-100 text-green-700' },
};

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build open_id → display name map from the users list */
function useUserMap() {
  const { data: users } = useSWR<User[]>(SWR_KEYS.users, api.getUsers);
  return useMemo(() => {
    const map = new Map<string, string>();
    users?.forEach((u) => {
      if (u.openId) map.set(u.openId, u.name || u.email || u.openId.slice(0, 12) + '…');
    });
    return map;
  }, [users]);
}

function resolveName(openId: string | null, userMap: Map<string, string>) {
  if (!openId) return '-';
  return userMap.get(openId) || openId.slice(0, 16) + '…';
}

// ── page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

function makeSwrKey(page: number, search: string, status: 'pending' | 'completed' | null) {
  const q = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (search) q.set('search', search);
  if (status) q.set('status', status);
  return `${SWR_KEYS.tasks}?${q}`;
}

export default function TasksPage() {
  const [page,          setPage]          = useState(1);
  const [search,        setSearch]        = useState('');
  const [debouncedSearch, setDebounced]   = useState('');
  const [filterStatus,  setFilterStatus]  = useState<'pending' | 'completed' | null>(null);
  const [showForm,      setShowForm]      = useState(false);

  // Debounce search — 350 ms
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when status filter changes
  useEffect(() => { setPage(1); }, [filterStatus]);

  const swrKey = makeSwrKey(page, debouncedSearch, filterStatus);
  const { data, error, isLoading } = useSWR(
    swrKey,
    () => api.getTasks({ page, limit: PAGE_SIZE, search: debouncedSearch, status: filterStatus })
  );

  const tasks      = data?.tasks ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const userMap    = useUserMap();

  const refresh = () => mutate(swrKey);

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold">催办任务</h2>
          <p className="text-sm text-gray-500 mt-1">
            催办任务管理
            {total > 0 && <span className="ml-2 text-gray-400">· 共 {total} 条</span>}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
        >
          {showForm ? '取消' : '+ 创建任务'}
        </button>
      </div>

      {showForm && (
        <TaskForm onSuccess={() => {
          setShowForm(false);
          mutate(makeSwrKey(1, debouncedSearch, filterStatus));
          setPage(1);
        }} />
      )}

      {/* Search + filter bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="search"
          placeholder="搜索任务名称…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] max-w-xs border border-gray-300 rounded-lg px-3 py-1.5 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={filterStatus ?? 'all'}
          onChange={e => setFilterStatus(e.target.value === 'all' ? null : e.target.value as 'pending' | 'completed')}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">全部状态</option>
          <option value="pending">待办</option>
          <option value="completed">已完成</option>
        </select>
      </div>

      {isLoading && <LoadingState />}
      {error    && <ErrorState message={error.message} retryKey={swrKey} />}

      {!isLoading && !error && (
        <>
          <TaskTable
            tasks={tasks}
            userMap={userMap}
            onRefresh={refresh}
            emptyMessage={debouncedSearch || filterStatus ? '没有匹配的任务' : '暂无任务'}
          />
          {totalPages > 1 && (
            <Pagination
              page={page} totalPages={totalPages} total={total}
              pageSize={PAGE_SIZE} onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

const TH = 'px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap';

function TaskTable({
  tasks, userMap, onRefresh, emptyMessage,
}: {
  tasks: Task[];
  userMap: Map<string, string>;
  onRefresh: () => void;
  emptyMessage?: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full min-w-[640px]" aria-label="催办任务列表">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className={TH}>任务名称</th>
            <th className={`${TH} w-20`}>优先级</th>
            <th className={`${TH} w-28`}>催办对象</th>
            <th className={`${TH} w-20`}>状态</th>
            <th className={`${TH} w-24`}>截止时间</th>
            <th className={`${TH} w-20`}>操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} userMap={userMap} onRefresh={onRefresh} />
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">
                {emptyMessage ?? '暂无任务'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ task, userMap, onRefresh }: { task: Task; userMap: Map<string, string>; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'complete' | 'delete' | null>(null);

  const handleComplete = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.completeTask(String(task.id), {});
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
      setConfirming(null);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.deleteTask(String(task.id));
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
      setConfirming(null);
    }
  };

  const assigneeName = resolveName(task.assignee_open_id, userMap);
  const reporterName = resolveName(task.reporter_open_id, userMap);

  const badge = PRIORITY_BADGE[task.priority] || PRIORITY_BADGE['p1'];

  return (
    <>
      <tr className={`hover:bg-gray-50 transition-colors ${loading ? 'opacity-50' : ''}`}>

        {/* 任务名称 — title + note + secondary tags */}
        <td className="px-3 py-2.5">
          <p className="text-sm font-medium text-gray-900 leading-snug">{task.title}</p>
          {task.note && (
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs" title={task.note}>
              {task.note}
            </p>
          )}
          {/* Secondary meta: reporter / reminder / workload tags */}
          <div className="flex gap-1.5 mt-1 flex-wrap">
            {task.reporter_open_id && reporterName && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                ↩ {reporterName}
              </span>
            )}
            {task.reminder_interval_hours > 0 && task.reminder_interval_hours !== 24 && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                ⏰ {task.reminder_interval_hours}h
              </span>
            )}
            {task.estimated_hours != null && (
              <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                ⏱ {task.estimated_hours}h
              </span>
            )}
            {task.target_tag && (
              <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                #{task.target_tag}
              </span>
            )}
          </div>
        </td>

        {/* 优先级 */}
        <td className="px-3 py-2.5 whitespace-nowrap">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.className}`}>
            {badge.label}
          </span>
        </td>

        {/* 催办对象 */}
        <td className="px-3 py-2.5 whitespace-nowrap text-sm text-gray-700">
          {assigneeName || <span className="text-gray-300">—</span>}
        </td>

        {/* 状态 */}
        <td className="px-3 py-2.5 whitespace-nowrap">
          <StatusBadge status={task.status} />
        </td>

        {/* 截止时间 */}
        <td className="px-3 py-2.5 whitespace-nowrap text-sm text-gray-500">
          {task.deadline
            ? new Date(task.deadline).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
            : <span className="text-gray-300">—</span>}
        </td>

        {/* 操作 */}
        <td className="px-3 py-2.5 whitespace-nowrap">
          {confirming ? (
            <div className="flex items-center gap-1.5">
              <button onClick={confirming === 'complete' ? handleComplete : handleDelete}
                disabled={loading}
                className={`text-xs font-medium px-2 py-0.5 rounded disabled:opacity-50 ${
                  confirming === 'delete'
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-green-100 text-green-700 hover:bg-green-200'
                }`}>
                {loading ? '…' : '确认'}
              </button>
              <button onClick={() => setConfirming(null)} disabled={loading}
                className="text-xs text-gray-400 hover:text-gray-600">取消</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {task.status === 'pending' && (
                <button onClick={() => setConfirming('complete')} disabled={loading}
                  className="text-xs text-green-600 hover:text-green-800 font-medium disabled:opacity-50">
                  完成
                </button>
              )}
              <button onClick={() => setConfirming('delete')} disabled={loading}
                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
                删除
              </button>
            </div>
          )}
        </td>
      </tr>

      {error && (
        <tr>
          <td colSpan={6} className="px-3 py-1.5">
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded px-3 py-1.5">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">×</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: Task['status'] }) {
  if (status === 'completed') {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap">
        已完成
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 whitespace-nowrap">
      待办
    </span>
  );
}

// ── create form ───────────────────────────────────────────────────────────────

function TaskForm({ onSuccess }: { onSuccess: () => void }) {
  const { data: users = [] } = useSWR<User[]>(SWR_KEYS.users, api.getUsers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Collect all unique tags from all users (sorted)
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    users.forEach(u => (u.tags ?? []).forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [users]);

  const [form, setForm] = useState<{
    title: string;
    assignMode: 'direct' | 'tag';
    targetOpenId: string | null;
    targetTag: string;
    reporterOpenId: string | null;
    deadline: string;
    note: string;
    estimatedHours: string;          // kept as string for input binding; parsed on submit
    reminderIntervalHours: number;
    priority: 'p0' | 'p1' | 'p2';
  }>({
    title: '',
    assignMode: 'direct',
    targetOpenId: null,
    targetTag: '',
    reporterOpenId: null,
    deadline: '',
    note: '',
    estimatedHours: '',
    reminderIntervalHours: 24,
    priority: 'p1',
  });

  // Workload preview for tag mode — fires immediately on tag select
  const [tagPreview, setTagPreview] = useState<WorkloadUser[] | null>(null);
  const [tagPreviewLoading, setTagPreviewLoading] = useState(false);
  useEffect(() => {
    if (form.assignMode !== 'tag' || !form.targetTag) {
      setTagPreview(null);
      return;
    }
    let cancelled = false;
    setTagPreviewLoading(true);
    api.getWorkload(form.targetTag).then(data => {
      if (!cancelled) setTagPreview(data);
    }).catch(() => {
      if (!cancelled) setTagPreview([]);
    }).finally(() => {
      if (!cancelled) setTagPreviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [form.assignMode, form.targetTag]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.assignMode === 'direct' && !form.targetOpenId) {
      setError('请选择催办对象'); return;
    }
    if (form.assignMode === 'tag' && !form.targetTag) {
      setError('请选择分配标签'); return;
    }
    setLoading(true);
    setError(null);
    try {
      const parsedHours = form.estimatedHours !== '' ? parseFloat(form.estimatedHours) : undefined;
      const params: CreateTaskParams = {
        title: form.title,
        reporterOpenId: form.reporterOpenId ?? undefined,
        deadline: form.deadline || undefined,
        note: form.note || undefined,
        reminderIntervalHours: form.reminderIntervalHours,
        priority: form.priority,
        estimatedHours: (parsedHours != null && !isNaN(parsedHours)) ? parsedHours : null,
      };
      if (form.assignMode === 'tag') {
        params.targetTag = form.targetTag;
      } else {
        params.targetOpenId = form.targetOpenId!;
      }
      await api.createTask(params);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-6">
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}
      <div className="grid grid-cols-2 gap-4">

        {/* 任务名称 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">任务名称 *</label>
          <input
            type="text" required
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            className={inputCls}
            placeholder="例：提交季度报告"
          />
        </div>

        {/* 催办对象 — 直接指定 or 标签自动分配 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            催办对象 *
          </label>
          {/* Mode toggle */}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden mb-2 text-sm">
            <button type="button"
              onClick={() => setForm({ ...form, assignMode: 'direct' })}
              className={`flex-1 py-1.5 transition-colors ${
                form.assignMode === 'direct'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              指定人员
            </button>
            <button type="button"
              onClick={() => setForm({ ...form, assignMode: 'tag' })}
              className={`flex-1 py-1.5 transition-colors ${
                form.assignMode === 'tag'
                  ? 'bg-purple-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              按标签分配
            </button>
          </div>

          {form.assignMode === 'direct' ? (
            <UserCombobox
              users={users}
              value={form.targetOpenId}
              onChange={openId => setForm({ ...form, targetOpenId: openId })}
              placeholder="搜索姓名或邮箱…"
            />
          ) : (
            <div>
              <select
                value={form.targetTag}
                onChange={e => setForm({ ...form, targetTag: e.target.value })}
                className={inputCls}
              >
                <option value="">— 选择标签 —</option>
                {availableTags.map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
              {availableTags.length === 0 && (
                <p className="mt-1 text-xs text-gray-400">暂无标签，请先在用户管理中为用户添加标签</p>
              )}
              {/* Workload preview */}
              {tagPreviewLoading && (
                <p className="mt-1 text-xs text-gray-400">加载工作量…</p>
              )}
              {tagPreview && tagPreview.length === 0 && !tagPreviewLoading && (
                <p className="mt-1 text-xs text-red-500">⚠️ 该标签下没有用户</p>
              )}
              {tagPreview && tagPreview.length > 0 && (
                <div className="mt-1.5 border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-left text-gray-500 font-medium">姓名</th>
                        <th className="px-2 py-1 text-right text-gray-500 font-medium">待办</th>
                        <th className="px-2 py-1 text-right text-gray-500 font-medium">预计工时</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {tagPreview.map((u, i) => (
                        <tr key={u.userId} className={i === 0 ? 'bg-green-50' : ''}>
                          <td className="px-2 py-1 font-medium">
                            {i === 0 && <span className="mr-1">→</span>}
                            {u.name || u.openId}
                          </td>
                          <td className="px-2 py-1 text-right text-gray-600">{u.pendingTasks}</td>
                          <td className="px-2 py-1 text-right text-gray-600">{u.workloadHours.toFixed(1)} h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-2 py-1 text-xs text-gray-400 bg-gray-50">
                    → 将自动分配给工时最少的用户
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 报告对象 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            报告对象
            <span className="ml-1 text-gray-400 font-normal text-xs">（任务完成时收到通知）</span>
          </label>
          <UserCombobox
            users={users}
            value={form.reporterOpenId}
            onChange={openId => setForm({ ...form, reporterOpenId: openId })}
            placeholder="搜索姓名或邮箱（可选）"
          />
        </div>

        {/* 截止时间 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">截止时间</label>
          <input
            type="date"
            value={form.deadline}
            onChange={e => setForm({ ...form, deadline: e.target.value })}
            className={inputCls}
          />
        </div>

        {/* 预计工时 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            预计工时（小时）
            <span className="ml-1 text-gray-400 font-normal text-xs">（用于工作量平衡，可选）</span>
          </label>
          <input
            type="number" min={0.25} max={999} step={0.25}
            value={form.estimatedHours}
            onChange={e => setForm({ ...form, estimatedHours: e.target.value })}
            className={inputCls}
            placeholder="例：2、0.5、8"
          />
        </div>

        {/* 备注 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <input
            type="text"
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
            className={inputCls}
            placeholder="可选说明"
          />
        </div>

        {/* 紧急程度 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">紧急程度</label>
          <select
            value={form.priority}
            onChange={e => setForm({ ...form, priority: e.target.value as 'p0' | 'p1' | 'p2' })}
            className={inputCls}
          >
            <option value="p0">🔴 P0 紧急（今天必须完成）</option>
            <option value="p1">🟡 P1 一般（默认）</option>
            <option value="p2">🟢 P2 不紧急</option>
          </select>
        </div>

        {/* 提醒间隔 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            提醒间隔（小时）
            <span className="ml-1 text-gray-400 font-normal text-xs">（0 = 关闭）</span>
          </label>
          <input
            type="number" min={0} max={168}
            value={form.reminderIntervalHours}
            onChange={e => setForm({ ...form, reminderIntervalHours: parseInt(e.target.value, 10) || 0 })}
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-4">
        <button
          type="submit" disabled={loading}
          className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {loading ? '创建中...' : '创建任务'}
        </button>
      </div>
    </form>
  );
}
