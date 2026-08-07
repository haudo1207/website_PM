'use client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

export interface SelectOptionItem {
  id: string | number;
  name: string;
  icon?: string;
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
  className?: string;
}

export const DEFAULT_SEARCH_THRESHOLD = 8;

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

export default function SearchableSelect({
  label,
  icon = '🔍',
  options,
  value,
  onChange,
  placeholder,
  isMulti = false,
  searchThreshold = DEFAULT_SEARCH_THRESHOLD,
  disabled = false,
  className = ''
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounced search query (200ms)
  const debouncedSearch = useDebounce(search, 200);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setSearch('');
        setFocusedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Determine selected items array
  const selectedValues = useMemo(() => {
    if (value === undefined || value === null || value === 'all' || value === '') return [];
    if (Array.isArray(value)) return value;
    return [value];
  }, [value]);

  // Normalize options to object format
  const parsedOptions = useMemo<SelectOptionItem[]>(() => {
    return (options || []).map(opt => {
      if (typeof opt === 'string' || typeof opt === 'number') {
        return { id: opt, name: String(opt) };
      }
      return opt;
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

  // Always show search bar for 100% consistent Enterprise UX
  const showSearchBar = true;

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
        current.push(optionId);
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

    const totalItems = filteredOptions.length + (!isMulti && !debouncedSearch.trim() ? 1 : 0);

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
            if (filteredOptions[actualIdx]) {
              handleSelect(filteredOptions[actualIdx].id);
            }
          }
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
    onChange(isMulti ? [] : 'all');
    setSearch('');
    setFocusedIndex(-1);
  };

  // Button Trigger Label Text
  const buttonText = useMemo(() => {
    if (selectedValues.length === 0) {
      return `Tất cả ${label}`;
    }
    if (!isMulti) {
      const found = parsedOptions.find(o => String(o.id) === String(selectedValues[0]));
      return found ? found.name : `Tất cả ${label}`;
    }
    if (selectedValues.length === 1) {
      const found = parsedOptions.find(o => String(o.id) === String(selectedValues[0]));
      return found ? found.name : `1 ${label}`;
    }
    return `${selectedValues.length} ${label}`;
  }, [selectedValues, parsedOptions, label, isMulti]);

  return (
    <div
      className={`relative inline-block text-xs ${className}`}
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
        <span className="truncate flex items-center gap-1.5">
          {icon && <span>{icon}</span>}
          <span className="truncate max-w-[140px] text-left">{buttonText}</span>
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

      {/* Popup Menu */}
      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {/* Search Bar Input (if threshold met) */}
          {showSearchBar && (
            <div className="p-2 border-b border-slate-100 bg-slate-50/80 sticky top-0 z-10">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={placeholder || `🔍 Tìm ${label.toLowerCase()}...`}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md outline-none focus:border-[#0058be] focus:ring-1 focus:ring-[#0058be]/20 font-medium"
                />
                <span className="absolute left-2.5 top-2 text-[12px] text-slate-400">🔍</span>
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

            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-slate-400 italic text-xs">
                Không tìm thấy {label.toLowerCase()}.
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const itemIdx = !isMulti && !debouncedSearch.trim() ? idx + 1 : idx;
                const isSelected = selectedValues.some(v => String(v) === String(opt.id));
                const isFocused = focusedIndex === itemIdx;

                return (
                  <div
                    key={opt.id}
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
                );
              })
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
        </div>
      )}
    </div>
  );
}
