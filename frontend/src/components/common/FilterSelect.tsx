'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface FilterSelectOption {
  value: string;
  label: string;
  // Small muted text after the label, e.g. a member count.
  hint?: string;
}

interface FilterSelectProps {
  value: string;
  options: FilterSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  // Show a search box once the list is longer than this (default 8).
  searchThreshold?: number;
  searchPlaceholder?: string;
}

// Styled replacement for a native <select> on filter bars: same h-10 blue
// trigger as the other filter fields, with a rounded popover list instead of
// the browser's own dropdown. Closes on outside click / Escape.
export default function FilterSelect({
  value, options, onChange, disabled, title, searchThreshold = 8, searchPlaceholder = 'Tìm...',
}: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Bring the current choice into view in long lists.
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => { if (!open) setQuery(''); }, [open]);

  const selected = options.find(o => o.value === value) ?? options[0];
  const showSearch = options.length > searchThreshold;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const pick = (v: string) => { onChange(v); setOpen(false); };

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        title={title}
        onClick={() => setOpen(o => !o)}
        className={`w-full h-10 flex items-center justify-between gap-2 border-2 rounded-lg px-3 text-sm font-semibold text-blue-900 bg-white shadow-sm transition-all outline-none disabled:cursor-not-allowed disabled:opacity-70 ${
          open ? 'border-blue-500 ring-4 ring-blue-500/10' : 'border-blue-200 hover:border-blue-300'
        } ${disabled ? '' : 'cursor-pointer'}`}
      >
        <span className="truncate text-left">
          {selected?.label}
          {selected?.hint && <span className="ml-1 text-blue-900/40 font-medium">{selected.hint}</span>}
        </span>
        <svg className={`w-4 h-4 shrink-0 text-blue-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-full min-w-[180px] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          {showSearch && (
            <div className="p-2 border-b border-slate-100">
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full h-8 px-2.5 text-sm border border-slate-200 rounded-md outline-none focus:border-blue-400"
              />
            </div>
          )}
          <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
            {shown.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-400 text-center">Không tìm thấy</div>
            ) : shown.map(o => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  data-selected={active}
                  onClick={() => pick(o.value)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    active ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 font-medium hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate">
                    {o.label}
                    {o.hint && <span className={`ml-1 ${active ? 'text-blue-500' : 'text-slate-400'} font-medium`}>{o.hint}</span>}
                  </span>
                  {active && (
                    <svg className="w-4 h-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
