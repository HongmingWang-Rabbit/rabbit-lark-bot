'use client';

/**
 * UserCombobox
 *
 * Searchable dropdown that filters users by name or email.
 * Displays the selected user's name; submits their openId as the value.
 *
 * Props:
 *   value       — currently selected openId (ou_xxx) or null
 *   onChange    — called with the selected openId when a user is picked, or null on clear
 *   users       — full user list from /api/users
 *   placeholder — input placeholder text
 *   required    — whether the field is required
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { User } from '@/lib/api';

interface Props {
  value: string | null;
  onChange: (openId: string | null) => void;
  users: User[];
  placeholder?: string;
  required?: boolean;
}

type SelectableUser = User & { openId: string };

export default function UserCombobox({ value, onChange, users, placeholder = '搜索用户…', required }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Derive display label for the current value
  const selectedUser = useMemo(
    () => users.find(u => u.openId === value) ?? null,
    [users, value]
  );

  // Only show users that have an openId (required for task assignment / messaging)
  const selectableUsers = useMemo(
    () => users.filter((u): u is SelectableUser => !!u.openId),
    [users]
  );

  // Filter users by name or email
  const filtered = useMemo(() => {
    if (!query.trim()) return selectableUsers.slice(0, 20);   // show first 20 when empty
    const q = query.toLowerCase();
    return selectableUsers
      .filter(u =>
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [selectableUsers, query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleSelect(user: SelectableUser) {
    onChange(user.openId);
    setQuery('');
    setOpen(false);
    setHighlightIdx(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => (i <= 0 ? filtered.length - 1 : i - 1));
    } else if (e.key === 'Enter' && highlightIdx >= 0 && highlightIdx < filtered.length) {
      e.preventDefault();
      handleSelect(filtered[highlightIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
    setQuery('');
  }

  // If a user is selected and not searching, show their name as a badge
  if (selectedUser && !open) {
    return (
      <div
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full border rounded-lg px-3 py-2 cursor-pointer hover:border-blue-400 transition-colors"
      >
        <span className="flex-1 text-gray-800">{selectedUser.name || selectedUser.email || selectedUser.openId}</span>
        {selectedUser.email && (
          <span className="text-xs text-gray-400">{selectedUser.email}</span>
        )}
        <button
          type="button"
          onClick={handleClear}
          className="text-gray-400 hover:text-gray-600 ml-1 text-lg leading-none"
          title="清除"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        autoComplete="off"
        required={required && !value}
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHighlightIdx(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />

      {open && (
        <ul className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-auto" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">没有匹配的用户</li>
          ) : (
            filtered.map((u, idx) => (
              <li
                key={u.openId}
                role="option"
                aria-selected={idx === highlightIdx}
                onMouseDown={() => handleSelect(u)}
                onMouseEnter={() => setHighlightIdx(idx)}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${idx === highlightIdx ? 'bg-blue-50' : 'hover:bg-blue-50'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">
                    {u.name || <span className="text-gray-400 italic">未命名</span>}
                  </div>
                  {u.email && (
                    <div className="text-xs text-gray-400 truncate">{u.email}</div>
                  )}
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  u.role === 'superadmin' ? 'bg-purple-100 text-purple-700' :
                  u.role === 'admin'      ? 'bg-blue-100 text-blue-700' :
                                           'bg-gray-100 text-gray-500'
                }`}>
                  {u.role}
                </span>
              </li>
            ))
          )}
        </ul>
      )}

    </div>
  );
}
