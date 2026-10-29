'use client';
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOptionItem {
  id: string | number;
  name: string;
  icon?: string;
  avatar_url?: string | null;
  badge?: string;
  subtext?: string;
}

export type SelectOption = SelectOptionItem | string;

export interface SearchableSelectProps {
  label: string;
  icon?: string;
  options: SelectOption[];
  value?: string | number | (string | number)[];
  onChange: (value: any) => void;
  placeholder?: string;
  isMulti?: boolean;
  searchThreshold?: number; // Configurable threshold (Default 8)
  disabled?: boolean;
  required?: boolean;
  align?: 'left' | 'right';
  className?: string;
  // Opt-in initials avatar next to each dropdown row — for people lists
  // (members/assignees), not generic option lists (channels, skills...).
  showAvatar?: boolean;
  // Render dropdown menu via createPortal to document.body so it is never
  // clipped by overflow-hidden/auto ancestors (e.g. the task table scroll
  // container). Uses getBoundingClientRect() for positioning.
  usePortal?: boolean;
  // Single-select only. When provided, a "+ Thêm nhanh ..." row appears
  // whenever the search text has no exact-name match — clicking it (or
  // pressing Enter with no match) awaits this, then selects the returned
  // id. Return null to signal a failed/cancelled create (selection is left
  // unchanged).
  onQuickCreate?: (name: string) => Promise<{ id: string | number } | null>;
}

// Lets a parent trigger the dropdown open programmatically — e.g. a
// standalone "+ Thêm người" button next to a members picker, instead of
// requiring the user to click the picker's own trigger button.
export interface SearchableSelectHandle {
  open: () => void;
}

export const DEFAULT_SEARCH_THRESHOLD = 8;

const AVATAR_COLORS = ['#0058be', '#E3000F', '#059669', '#d97706', '#7c3aed'];
function avatarColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function avatarInitialsFor(name: string): string {
  return name.split(' ').map(p => p[0]).filter(Boolean).slice(-2).join('').toUpperCase() || '?';
}

// Remove Vietnamese diacritics for smart matching
function removeDiacritics(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

// Generate initials for abbreviation matching (e.g., "L.N Linh Hân" -> "lnh", "ln")
function getInitials(str: string): string {
  return removeDiacritics(str)
    .split(/\s+/)
    .map(w => w[0])
    .join('');
}

// Highlight matched substring in item name
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;

  const textNorm = removeDiacritics(text);
  const queryNorm = removeDiacritics(query);
  const index = textNorm.indexOf(queryNorm);

  if (index === -1) return text;

  const before = text.substring(0, index);
  const match = text.substring(index, index + queryNorm.length);
  const after = text.substring(index + queryNorm.length);

  return (
    <span>
      {before}
      <mark className="bg-blue-100 text-[#0058be] font-extrabold px-0.5 rounded">{match}</mark>
      {after}
    </span>
  );
}

// Custom Debounce Hook (200ms)
function useDebounce<T>(val: T, delay: number = 200): T {
  const [debouncedVal, setDebouncedVal] = useState<T>(val);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedVal(val), delay);
    return () => clearTimeout(handler);
  }, [val, delay]);
  return debouncedVal;
}

const SearchableSelect = forwardRef<SearchableSelectHandle, SearchableSelectProps>(function SearchableSelect({
  label,
  icon = '🔍',
  options,
  value,
  onChange,
  placeholder,
  isMulti = false,
  searchThreshold = DEFAULT_SEARCH_THRESHOLD,
  disabled = false,
  align = 'left',
  className = '',
  showAvatar = false,
  usePortal = false,
  onQuickCreate
}, ref) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [creatingQuick, setCreatingQuick] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Portal positioning state — always populated while open (see effect
  // below); also carries the up/down flip decision (was a separate
  // `dropUp` state before the inline/non-portal render path was removed).
  const [portalPos, setPortalPos] = useState<{ top: number; left?: number; right?: number; width: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Portal positioning (chốt 2026-10-28, always on now — see note on
  // `usePortal` below) — compute fixed coordinates from the trigger's
  // bounding rect so the dropdown renders at document.body level: never
  // clipped by any ancestor overflow container, and always above the nav
  // sidebar (z-[1100]) via the fixed z-1050 on the portaled div itself.
  // `Math.max(256, rect.width)` matches the old inline path's
  // `w-[max(16rem,100%)]` floor so narrow trigger buttons (common in filter
  // bars) still get a readable-width menu instead of shrinking to the
  // trigger's own width.
  useEffect(() => {
    if (!open || !containerRef.current) {
      setPortalPos(null);
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const estimatedPopupHeight = 320;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldDropUp = spaceBelow < estimatedPopupHeight && spaceAbove > spaceBelow;
    const top = shouldDropUp ? rect.top - estimatedPopupHeight : rect.bottom + 4;
    setPortalPos({
      top: Math.max(4, top),
      left: align === 'left' ? rect.left : undefined,
      right: align === 'right' ? Math.max(4, window.innerWidth - rect.right) : undefined,
      width: Math.max(256, rect.width),
    });

    const reposition = () => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      const sb = window.innerHeight - r.bottom;
      const sa = r.top;
      const du = sb < estimatedPopupHeight && sa > sb;
      const t = du ? r.top - estimatedPopupHeight : r.bottom + 4;
      setPortalPos({
        top: Math.max(4, t),
        left: align === 'left' ? r.left : undefined,
        right: align === 'right' ? Math.max(4, window.innerWidth - r.right) : undefined,
        width: Math.max(256, r.width),
      });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, align]);

  // Debounced search query (200ms)
  const debouncedSearch = useDebounce(search, 200);

  useImperativeHandle(ref, () => ({
    open: () => { if (!disabled) setOpen(true); }
  }), [disabled]);

  // Close popup when clicking outside — also checks the portal menu
  // (menuRef) since it's rendered outside the container at document.body
  // level, not as a DOM descendant of containerRef.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const isInsideContainer = containerRef.current && containerRef.current.contains(event.target as Node);
      const isInsidePortalMenu = menuRef.current && menuRef.current.contains(event.target as Node);
      if (!isInsideContainer && !isInsidePortalMenu) {
        setOpen(false);
        setSearch('');
        setFocusedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Helper to identify default/reset values (should NEVER display clear '✕' button)
  const isDefaultValue = useCallback((v: any) => {
    if (v === undefined || v === null || v === '' || v === 0 || v === '0') return true;
    const str = String(v).trim().toLowerCase();
    return str === 'all' || str.includes('không liên kết') || str.startsWith('—');
  }, []);

  // Determine selected items array (Filters out default reset values)
  const selectedValues = useMemo(() => {
    if (isDefaultValue(value)) return [];
    if (Array.isArray(value)) return value.filter(v => !isDefaultValue(v));
    return [value];
  }, [value, isDefaultValue]);

  // Normalize options to object format with safety checks
  const parsedOptions = useMemo<SelectOptionItem[]>(() => {
    return (options || [])
      .filter(Boolean)
      .map(opt => {
        if (typeof opt === 'string' || typeof opt === 'number') {
          return { id: opt, name: String(opt) };
        }
        return {
          id: opt?.id ?? '',
          name: opt?.name || `Option #${opt?.id || ''}`,
          icon: opt?.icon,
          avatar_url: opt?.avatar_url,
          badge: opt?.badge,
          subtext: opt?.subtext
        };
      });
  }, [options]);

  // Smart Search Filter Logic
  const filteredOptions = useMemo(() => {
    if (!debouncedSearch.trim()) return parsedOptions;

    const q = removeDiacritics(debouncedSearch);
    const words = q.split(/\s+/).filter(Boolean);

    return parsedOptions.filter(opt => {
      const optNameNorm = removeDiacritics(opt.name);
      const optSubtextNorm = removeDiacritics(opt.subtext || '');
      const initials = getInitials(opt.name);

      return words.every(word => 
        optNameNorm.includes(word) || 
        optSubtextNorm.includes(word) ||
        initials.includes(word)
      );
    });
  }, [parsedOptions, debouncedSearch]);

  // Multi-select: selected items float to the top of the dropdown (grouped
  // under "ĐÃ CHỌN", unselected under "TẤT CẢ ...") instead of staying
  // scattered wherever they sit in the source list — otherwise a handful of
  // picks get lost among dozens of unpicked options. Within the selected
  // group, most-recently-picked sits first (selectedValues is kept in that
  // order by handleSelect below), so whatever the user just touched is
  // immediately visible without scrolling.
  const selectedCountInView = useMemo(() => {
    if (!isMulti) return 0;
    return filteredOptions.filter(opt => selectedValues.some(v => String(v) === String(opt.id))).length;
  }, [isMulti, filteredOptions, selectedValues]);

  const selectedOption = useMemo(
    () => !isMulti && selectedValues.length > 0
      ? parsedOptions.find(opt => String(opt.id) === String(selectedValues[0]))
      : undefined,
    [isMulti, parsedOptions, selectedValues]
  );

  const orderedOptions = useMemo(() => {
    if (!isMulti) return filteredOptions;
    const selected: SelectOptionItem[] = [];
    const unselected: SelectOptionItem[] = [];
    filteredOptions.forEach(opt => {
      if (selectedValues.some(v => String(v) === String(opt.id))) selected.push(opt);
      else unselected.push(opt);
    });
    selected.sort((a, b) => {
      const ai = selectedValues.findIndex(v => String(v) === String(a.id));
      const bi = selectedValues.findIndex(v => String(v) === String(b.id));
      return ai - bi;
    });
    return [...selected, ...unselected];
  }, [isMulti, filteredOptions, selectedValues]);

  // Always show search bar for 100% consistent Enterprise UX
  const showSearchBar = true;

  const trimmedSearch = debouncedSearch.trim();
  const hasExactMatch = trimmedSearch !== '' && parsedOptions.some(o => o.name.toLowerCase() === trimmedSearch.toLowerCase());
  const canQuickCreate = Boolean(onQuickCreate) && !isMulti && trimmedSearch !== '' && !hasExactMatch;

  const handleQuickCreate = useCallback(async () => {
    if (!onQuickCreate || !trimmedSearch || creatingQuick) return;
    setCreatingQuick(true);
    try {
      const created = await onQuickCreate(trimmedSearch);
      if (created) {
        onChange(created.id);
        setOpen(false);
        setSearch('');
        setFocusedIndex(-1);
      }
    } finally {
      setCreatingQuick(false);
    }
  }, [onQuickCreate, trimmedSearch, creatingQuick, onChange]);

  // Reset focus index when options change or dropdown opens
  useEffect(() => {
    if (open) {
      setFocusedIndex(-1);
      if (showSearchBar && searchInputRef.current) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    }
  }, [open, filteredOptions.length, showSearchBar]);

  const handleSelect = useCallback((optionId: string | number) => {
    if (isMulti) {
      const current = [...selectedValues];
      const idx = current.indexOf(optionId);
      if (idx > -1) {
        current.splice(idx, 1);
      } else {
        current.unshift(optionId); // newest pick first — see orderedOptions above
      }
      onChange(current);
    } else {
      onChange(optionId);
      setOpen(false);
      setSearch('');
      setFocusedIndex(-1);
    }
  }, [isMulti, selectedValues, onChange]);

  // Full Keyboard Navigation Handler (ArrowDown, ArrowUp, Enter, Escape)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    const totalItems = orderedOptions.length + (!isMulti && !debouncedSearch.trim() ? 1 : 0);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => (prev < totalItems - 1 ? prev + 1 : 0));
        break;

      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => (prev > 0 ? prev - 1 : totalItems - 1));
        break;

      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0) {
          const hasResetOpt = !isMulti && !debouncedSearch.trim();
          if (hasResetOpt && focusedIndex === 0) {
            handleSelect('all');
          } else {
            const actualIdx = hasResetOpt ? focusedIndex - 1 : focusedIndex;
            if (orderedOptions[actualIdx]) {
              handleSelect(orderedOptions[actualIdx].id);
            }
          }
        } else if (canQuickCreate) {
          handleQuickCreate();
        }
        break;

      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setSearch('');
        setFocusedIndex(-1);
        break;
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    const defaultOpt = parsedOptions.find(o => isDefaultValue(o.id) || o.name.startsWith('—'));
    const resetVal = defaultOpt ? defaultOpt.id : (isMulti ? [] : 'All');
    onChange(isMulti ? [] : resetVal);
    setSearch('');
    setFocusedIndex(-1);
  };

  // Button Trigger Label Text
  const buttonText = useMemo(() => {
    if (selectedValues.length === 0) {
      const defaultOpt = parsedOptions.find(o => isDefaultValue(o.id) || o.name.startsWith('—'));
      if (defaultOpt) return defaultOpt.name;
      return `Tất cả ${label}`;
    }
    if (!isMulti) {
      const found = parsedOptions.find(o => String(o.id) === String(selectedValues[0]));
      return found ? found.name : `Tất cả ${label}`;
    }
    // Multi-select: name the first couple of picks instead of just a bare
    // count, so the collapsed trigger tells the user WHO/WHAT is selected
    // without opening the dropdown — 1 name shown in full, 2 names shown in
    // full, 3+ shown as "first two · +N".
    const names = selectedValues
      .map(v => parsedOptions.find(o => String(o.id) === String(v))?.name)
      .filter(Boolean) as string[];
    if (names.length === 0) return `${selectedValues.length} ${label}`;
    if (names.length <= 2) return names.join(' · ');
    return `${names.slice(0, 2).join(' · ')} · +${names.length - 2}`;
  }, [selectedValues, parsedOptions, label, isMulti, isDefaultValue]);

  return (
    <div
      className={`relative inline-block text-xs ${open ? 'z-[999]' : ''} ${className}`}
      ref={containerRef}
      onKeyDown={handleKeyDown}
    >
      {/* Dropdown Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`w-full px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center justify-between gap-1.5 transition-all bg-white text-slate-700 cursor-pointer shadow-2xs ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-slate-300'
        } ${
          selectedValues.length > 0
            ? 'border-[#0058be] bg-[#eff4ff]/60 font-bold text-[#0058be]'
            : 'border-[#c2c6d6]/60'
        }`}
      >
        <span className="flex-1 min-w-0 flex items-center gap-1.5">
          {showAvatar && selectedOption && (
            selectedOption.avatar_url ? (
              <img src={selectedOption.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
            ) : (
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ background: avatarColorFor(selectedOption.name) }}>
                {avatarInitialsFor(selectedOption.name)}
              </span>
            )
          )}
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="truncate text-left">{buttonText}</span>
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {selectedValues.length > 0 && (
            <span
              onClick={handleClear}
              className="text-slate-400 hover:text-slate-700 p-0.5 rounded hover:bg-slate-200/60"
              title="Xóa lựa chọn"
            >
              ✕
            </span>
          )}
          <span className="text-[10px] text-slate-400 transition-transform duration-200">
            {open ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {/* Popup Menu — ALWAYS rendered via portal to document.body (chốt
          2026-10-28). Previously this only happened when a caller
          explicitly passed `usePortal={true}`; the default (false) path
          rendered a plain `position: absolute` div at z-[999] — not
          clipping-safe, AND below the nav sidebar's fixed z-[1100], so any
          caller that forgot `usePortal` (the vast majority, since it's an
          opt-in prop) could have its dropdown rendered UNDER the sidebar
          whenever the trigger sat close enough to the left edge (e.g. the
          first field in a filter bar on a narrower desktop width). Now
          every instance always portals at z-1150 — ABOVE the sidebar's
          z-[1100] (not just z-1050, which is still below it — see
          FloatingDropdown.tsx's file header for why that distinction
          matters) — so it's never hidden by the sidebar regardless of
          where the trigger sits. `usePortal` is kept as an accepted-but-
          unused prop so existing call sites don't need edits. */}
      {open && portalPos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: portalPos.top, left: portalPos.left, right: portalPos.right, width: portalPos.width, zIndex: 1150 }}
          className="bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Search Bar Input (if threshold met) */}
          {showSearchBar && (
            <div className="p-2 border-b border-slate-100 bg-slate-50/80 sticky top-0 z-10">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={(placeholder || `Tìm ${label.toLowerCase()}...`).replace(/^[🔍🔎]\s*/, '')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md outline-none focus:border-[#0058be] focus:ring-1 focus:ring-[#0058be]/20 font-medium"
                />
                <span className="absolute left-2.5 top-2 text-[12px] text-slate-400 pointer-events-none">🔍</span>
              </div>
            </div>
          )}

          {/* Options List */}
          <div ref={listRef} className="max-h-56 overflow-y-auto p-1.5 space-y-0.5 text-xs">
            {/* Single Select "All" reset option */}
            {!isMulti && !debouncedSearch.trim() && (
              <div
                onClick={() => handleSelect('all')}
                className={`px-2.5 py-1.5 rounded-lg cursor-pointer font-bold transition-colors flex items-center justify-between ${
                  focusedIndex === 0 ? 'bg-[#0058be]/10 text-[#0058be]' : ''
                } ${
                  selectedValues.length === 0
                    ? 'bg-[#eff4ff] text-[#0058be]'
                    : 'hover:bg-slate-50 text-slate-600'
                }`}
              >
                <span>Tất cả {label}</span>
                {selectedValues.length === 0 && <span>✓</span>}
              </div>
            )}

            {orderedOptions.length === 0 ? (
              <div className="py-4 text-center text-slate-400 italic text-xs">
                Không tìm thấy {label.toLowerCase()}.
              </div>
            ) : (
              orderedOptions.map((opt, idx) => {
                const itemIdx = !isMulti && !debouncedSearch.trim() ? idx + 1 : idx;
                const isSelected = selectedValues.some(v => String(v) === String(opt.id));
                const isFocused = focusedIndex === itemIdx;
                // Group dividers for multi-select: selected items are always
                // first in orderedOptions, so the "ĐÃ CHỌN" header goes above
                // idx 0 and "TẤT CẢ ..." goes right where the group flips.
                const showSelectedHeader = isMulti && idx === 0 && selectedCountInView > 0;
                const showAllHeader = isMulti && idx === selectedCountInView && orderedOptions.length > selectedCountInView;

                return (
                  <React.Fragment key={opt.id}>
                    {showSelectedHeader && (
                      <div className="px-2.5 pt-1 pb-1 text-[10px] font-bold text-[#0058be] uppercase tracking-wider">
                        Đã chọn · {selectedCountInView}
                      </div>
                    )}
                    {showAllHeader && (
                      <div className={`px-2.5 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider ${selectedCountInView > 0 ? 'pt-2 mt-1 border-t border-slate-100' : 'pt-1'}`}>
                        Tất cả {label} · {orderedOptions.length - selectedCountInView}
                      </div>
                    )}
                    <div
                      onClick={() => handleSelect(opt.id)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer font-medium transition-all ${
                        isFocused ? 'bg-[#0058be]/10 text-[#0058be]' : ''
                      } ${
                        isSelected
                          ? 'bg-[#eff4ff] text-[#0058be] font-bold'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {isMulti && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="rounded border-slate-300 text-[#0058be] focus:ring-[#0058be]"
                          />
                        )}
                        {showAvatar && (opt.avatar_url ? <img src={opt.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" /> : <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ background: avatarColorFor(opt.name) }}>{avatarInitialsFor(opt.name)}</span>)}
                        {opt.icon && <span>{opt.icon}</span>}
                        <span className="truncate">{highlightMatch(opt.name, debouncedSearch)}</span>
                        {opt.subtext && <span className="text-[10px] text-slate-400">({opt.subtext})</span>}
                      </div>

                      {opt.badge && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600">
                          {opt.badge}
                        </span>
                      )}

                      {!isMulti && isSelected && <span>✓</span>}
                    </div>
                  </React.Fragment>
                );
              })
            )}
            {canQuickCreate && (
              <div
                onClick={handleQuickCreate}
                className={`px-2.5 py-1.5 rounded-lg cursor-pointer font-bold transition-colors border-t border-slate-100 mt-1 pt-2 ${creatingQuick ? 'text-slate-300 pointer-events-none' : 'text-emerald-600 hover:bg-emerald-50'}`}
              >
                {creatingQuick ? 'Đang tạo...' : `+ Thêm nhanh "${trimmedSearch}"`}
              </div>
            )}
          </div>

          {/* Footer controls for Multi-select */}
          {isMulti && selectedValues.length > 0 && (
            <div className="p-1.5 border-t border-slate-100 bg-slate-50 flex justify-between items-center text-[10px]">
              <span className="text-slate-500 font-semibold">{selectedValues.length} đã chọn</span>
              <button
                type="button"
                onClick={handleClear}
                className="text-[#0058be] font-bold hover:underline"
              >
                Bỏ chọn tất cả
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
});

export default SearchableSelect;
