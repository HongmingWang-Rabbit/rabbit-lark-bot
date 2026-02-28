'use client';

import { useState, useEffect, useRef, useCallback, useId, cloneElement, type RefObject, type ReactElement } from 'react';
import useSWR, { mutate } from 'swr';
import { api, SWR_KEYS, User, Feature, UserRole } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/StatusStates';

const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: '超级管理员',
  admin: '管理员',
  user: '普通用户',
};

const ROLE_COLORS: Record<UserRole, string> = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  user: 'bg-gray-100 text-gray-600',
};

export default function UsersPage() {
  const { data: users = [], error: usersErr, isLoading } = useSWR(SWR_KEYS.users, api.getUsers);
  const { data: features = [] } = useSWR(SWR_KEYS.features, api.getFeatures);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleRoleChange = useCallback(async (userId: string, role: UserRole) => {
    setSaving(userId + '_role');
    setActionError(null);
    try {
      await api.updateUser(userId, { role });
      mutate(SWR_KEYS.users);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }, []);

  const handleFeatureToggle = useCallback(async (userId: string, featureId: string, enabled: boolean) => {
    setSaving(userId + '_' + featureId);
    setActionError(null);
    try {
      await api.setFeature(userId, featureId, enabled);
      mutate(SWR_KEYS.users);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }, []);

  const handleDelete = useCallback(async (userId: string) => {
    setSaving(userId + '_delete');
    setActionError(null);
    try {
      await api.deleteUser(userId);
      setConfirmingDelete(null);
      mutate(SWR_KEYS.users);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }, []);

  const closeAddModal = useCallback(() => setShowAdd(false), []);
  const savedAddModal = useCallback(() => { setShowAdd(false); mutate(SWR_KEYS.users); }, []);
  const closeEditModal = useCallback(() => setEditUser(null), []);
  const savedEditModal = useCallback(() => { setEditUser(null); mutate(SWR_KEYS.users); }, []);

  if (isLoading) return <LoadingState />;
  if (usersErr) return <ErrorState message={usersErr.message} retryKey={SWR_KEYS.users} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">用户管理</h2>
          <p className="text-sm text-gray-500 mt-1">管理用户权限和功能访问控制</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + 添加用户
        </button>
      </div>

      {showAdd && (
        <AddUserModal
          onClose={closeAddModal}
          onSaved={savedAddModal}
        />
      )}

      {actionError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={closeEditModal}
          onSaved={savedEditModal}
        />
      )}

      <div className="space-y-3">
        {users.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-2">👤</p>
            <p>暂无用户。用户在首次发消息时自动注册，或手动添加。</p>
          </div>
        )}

        {users.map((user) => (
          <UserRow
            key={user.userId}
            user={user}
            features={features}
            expanded={expandedId === user.userId}
            saving={saving}
            confirmingDelete={confirmingDelete === user.userId}
            onExpand={() => setExpandedId(expandedId === user.userId ? null : user.userId)}
            onRoleChange={handleRoleChange}
            onFeatureToggle={handleFeatureToggle}
            onEdit={() => setEditUser(user)}
            onDelete={handleDelete}
            onConfirmDelete={(id) => setConfirmingDelete(id)}
            onCancelDelete={() => setConfirmingDelete(null)}
            onActionError={setActionError}
          />
        ))}
      </div>
    </div>
  );
}

// ── UserRow ──────────────────────────────────────────────────────────────────

function UserRow({
  user, features, expanded, saving, confirmingDelete, onExpand, onRoleChange, onFeatureToggle, onEdit, onDelete, onConfirmDelete, onCancelDelete, onActionError,
}: {
  user: User;
  features: Feature[];
  expanded: boolean;
  saving: string | null;
  confirmingDelete: boolean;
  onExpand: () => void;
  onRoleChange: (id: string, role: UserRole) => void;
  onFeatureToggle: (id: string, fid: string, enabled: boolean) => void;
  onEdit: () => void;
  onDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  onActionError: (msg: string | null) => void;
}) {
  const resolved = user.resolvedFeatures ?? {};
  const overrides = user.configs?.features ?? {};
  const enabledCount = Object.values(resolved).filter(Boolean).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Row header */}
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          {(user.name ?? user.userId).charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 truncate">
              {user.name ?? user.email ?? <span className="text-gray-400 italic">未命名</span>}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[user.role]}`}>
              {ROLE_LABELS[user.role]}
            </span>
            {(user.openId || user.feishuUserId) ? (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">
                ✓ 已关联
              </span>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-gray-200">
                待关联
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {user.email && (
              <span className="text-xs text-gray-400 truncate">📧 {user.email}</span>
            )}
            {user.phone && (
              <span className="text-xs text-gray-400">📱 {user.phone}</span>
            )}
            {!user.email && !user.phone && (
              <span className="text-xs text-gray-400 font-mono truncate">{user.userId}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-gray-400">{enabledCount}/{features.length} 功能</span>

          {/* Role selector */}
          <select
            value={user.role}
            onChange={e => onRoleChange(user.userId, e.target.value as UserRole)}
            disabled={saving === user.userId + '_role'}
            aria-label={`${user.name ?? user.userId} 的角色`}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
            <option value="superadmin">超级管理员</option>
          </select>

          <button
            onClick={onEdit}
            className="text-xs text-gray-500 hover:text-gray-800 font-medium px-2 py-1"
          >
            编辑
          </button>

          <button
            onClick={onExpand}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1"
          >
            {expanded ? '收起 ▲' : '权限 ▼'}
          </button>

          {confirmingDelete ? (
            <span className="flex items-center gap-1">
              <button onClick={() => onDelete(user.userId)} className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded hover:bg-red-100">确认删除</button>
              <button onClick={onCancelDelete} className="text-xs text-gray-400 hover:text-gray-600 px-1">取消</button>
            </span>
          ) : (
            <button
              onClick={() => onConfirmDelete(user.userId)}
              className="text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              删除
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail + feature toggles */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50">

          {/* ── User info ── */}
          <div className="px-5 pt-4 pb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">用户信息</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              <InfoRow icon="📧" label="邮箱" value={user.email} mono={false} />
              <InfoRow icon="📱" label="手机" value={user.phone} mono={false} />
              <InfoRow icon="🆔" label="飞书 User ID" value={user.feishuUserId} mono />
              <InfoRow icon="🔗" label="Open ID" value={user.openId} mono />
              <InfoRow
                icon="📅"
                label="注册时间"
                value={user.createdAt ? new Date(user.createdAt).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : null}
                mono={false}
              />
            </div>
          </div>

          {/* ── Feature toggles ── */}
          <div className="px-5 pb-4 pt-2 border-t border-gray-200">
          <p className="text-xs text-gray-500 mb-3">
            ✦ 灰色 = 由角色决定的默认值 &nbsp;|&nbsp; 彩色 = 手动覆盖
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {features.map((feat) => {
              const isEnabled = resolved[feat.id] ?? false;
              const isOverridden = feat.id in overrides;
              const isSaving = saving === user.userId + '_' + feat.id;

              return (
                <label
                  key={feat.id}
                  className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    isEnabled ? 'bg-green-50 hover:bg-green-100' : 'bg-white hover:bg-gray-100'
                  } border ${isEnabled ? 'border-green-200' : 'border-gray-200'}`}
                >
                  <div className="mt-0.5">
                    {isSaving ? (
                      <div className="w-4 h-4 rounded border border-gray-300 flex items-center justify-center">
                        <div className="w-3 h-3 animate-spin rounded-full border-b border-blue-500" />
                      </div>
                    ) : (
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={e => onFeatureToggle(user.userId, feat.id, e.target.checked)}
                        className="w-4 h-4 rounded text-blue-600"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-800">{feat.label}</span>
                      {isOverridden && (
                        <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded">
                          已覆盖
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{feat.description}</p>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Reset overrides button */}
          {Object.keys(overrides).length > 0 && (
            <ResetOverridesButton userId={user.userId} onActionError={onActionError} />
          )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResetOverridesButton({ userId, onActionError }: { userId: string; onActionError: (msg: string | null) => void }) {
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    setResetting(true);
    try {
      await api.updateUser(userId, { configs: { features: {} } });
      mutate(SWR_KEYS.users);
    } catch (e: unknown) {
      onActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  }

  return (
    <button
      onClick={handleReset}
      disabled={resetting}
      className="mt-3 text-xs text-orange-500 hover:text-orange-700 disabled:opacity-50"
    >
      {resetting ? '重置中...' : '↩ 清除所有覆盖，恢复角色默认值'}
    </button>
  );
}

// ── InfoRow helper ────────────────────────────────────────────────────────────

function InfoRow({ icon, label, value, mono }: { icon: string; label: string; value: string | null | undefined; mono: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-gray-400 text-xs w-4 flex-shrink-0">{icon}</span>
      <span className="text-xs text-gray-500 flex-shrink-0">{label}:</span>
      <span className={`text-xs text-gray-700 truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ── Focus trap hook ───────────────────────────────────────────────────────────

function useFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;

      const focusable = el!.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [ref, onClose]);
}

// ── EditUserModal ─────────────────────────────────────────────────────────────

function EditUserModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: user.name ?? '',
    email: user.email ?? '',
    phone: user.phone ?? '',
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, onClose);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr('');
    try {
      await api.updateUser(user.userId, {
        name: form.name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
      });
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose} role="dialog" aria-modal="true">
      <div ref={dialogRef} tabIndex={-1} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-1">编辑用户信息</h3>
        <p className="text-xs text-gray-400 font-mono mb-4 truncate">{user.userId}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="显示名称">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="input"
              placeholder="张三"
              autoFocus
            />
          </Field>
          <Field label="邮箱" hint="修改后将用于飞书账号关联匹配">
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="input"
              placeholder="user@company.com"
            />
          </Field>
          <Field label="手机号">
            <input
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className="input"
              placeholder="+86 138 0000 0000"
            />
          </Field>

          {err && <p className="text-red-500 text-sm">{err}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2 text-sm hover:bg-gray-50">
              取消
            </button>
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── AddUserModal ──────────────────────────────────────────────────────────────

function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'user' as UserRole });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, onClose);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!email) { setErr('邮箱必填'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('邮箱格式不正确'); return; }
    setLoading(true);
    try {
      // email is the canonical userId for admin-provisioned users
      await api.upsertUser({ userId: email, email, name: form.name || undefined, role: form.role });
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose} role="dialog" aria-modal="true">
      <div ref={dialogRef} tabIndex={-1} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-4">添加用户</h3>
        <p className="text-sm text-gray-500 mb-4">
          按邮箱添加用户。用户首次发送飞书消息时系统会自动将其邮箱与飞书账号关联。
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="邮箱 *" hint="用于识别用户身份，需与飞书账号邮箱一致">
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="input"
              placeholder="user@company.com"
              autoFocus
            />
          </Field>
          <Field label="显示名称">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="input"
              placeholder="可选"
            />
          </Field>
          <Field label="角色">
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}
              className="input"
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
              <option value="superadmin">超级管理员</option>
            </select>
          </Field>

          {err && <p className="text-red-500 text-sm">{err}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2 text-sm hover:bg-gray-50">
              取消
            </button>
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? '保存中...' : '添加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement<{ id?: string }> }) {
  const generatedId = useId();
  const id = children.props.id || generatedId;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      {cloneElement(children, { id })}
    </div>
  );
}

