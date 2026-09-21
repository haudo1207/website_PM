'use client';

import { useState } from 'react';
import { toApiDate } from './dateUtils';

// Personal Calendar event-type filter — UI-only (spec: "Filter chỉ xử lý ở
// UI, không thay đổi scope của API"). Task is split into Assigned/Support
// so a user can e.g. hide their own Support-only tasks while keeping
// Meeting + their Assigned work visible.
export type EventTypeFilter = 'meeting' | 'assigned' | 'support' | 'leave';

const FILTER_OPTIONS: { key: EventTypeFilter; label: string }[] = [
  { key: 'meeting', label: 'Meeting' },
  { key: 'assigned', label: 'Task – Assigned' },
  { key: 'support', label: 'Task – Support' },
  { key: 'leave', label: 'Nghỉ / Off' },
];

function FilterDropdown({
  filters,
  onFiltersChange,
}: {
  filters: Set<EventTypeFilter>;
  onFiltersChange: (next: Set<EventTypeFilter>) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (key: EventTypeFilter) => {
    const next = new Set(filters);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onFiltersChange(next);
  };
  const allChecked = filters.size === FILTER_OPTIONS.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="h-8 text-[12.5px] font-semibold text-[#0b1c30] border border-slate-200 bg-white px-3 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
      >
        Lọc
        {!allChecked && <span className="w-1.5 h-1.5 rounded-full bg-[#0058be]" aria-hidden />}
        <span className="text-[8px] text-slate-400" aria-hidden>▼</span>
      </button>
      {open && (
        <>
          {/* Click-outside-to-close overlay — same pattern as the other
              anchored popovers on this page (ProjectColorPicker etc). */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 left-0 mt-1.5 w-52 p-2 border border-slate-200 rounded-lg bg-white shadow-lg">
            {FILTER_OPTIONS.map(opt => (
              <label
                key={opt.key}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-[12.5px] text-[#0b1c30]"
              >
                <input
                  type="checkbox"
                  checked={filters.has(opt.key)}
                  onChange={() => toggle(opt.key)}
                  className="accent-[#0058be] w-3.5 h-3.5"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export type CalendarViewMode = 'day' | '4day' | '7day' | 'month';
const VIEW_MODE_OPTIONS: { key: CalendarViewMode; label: string }[] = [
  { key: 'day', label: 'Ngày' },
  { key: '4day', label: '4 ngày' },
  { key: '7day', label: 'Tuần' },
  { key: 'month', label: 'Tháng' },
];

export default function CalendarToolbar({
  rangeLabel,
  viewMode,
  onViewModeChange,
  onPrev,
  onNext,
  onToday,
  anchorDate,
  onPickDate,
  filters,
  onFiltersChange,
  searchQuery,
  onSearchQueryChange,
  onQuickCreate,
}: {
  rangeLabel: string;
  viewMode: CalendarViewMode;
  onViewModeChange: (m: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  anchorDate: Date;
  onPickDate: (dateStr: string) => void;
  filters: Set<EventTypeFilter>;
  onFiltersChange: (next: Set<EventTypeFilter>) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onQuickCreate: () => void;
}) {
  return (
    // Compact UI pass (2026-09): one row on desktop instead of two — date
    // nav + picker on the left, search/filter/view-mode/+Tạo task on the
    // right. Fixed h-12 (48px) so Summary(44-48px) + Toolbar(48px) +
    // date header(40-44px) leaves the timeline the rest of the box's
    // height via flex-1 (see page.tsx). No behavior change, layout only.
    <div className="flex items-center justify-between gap-3 px-4 h-12 flex-wrap shrink-0">
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onToday}
          className="h-8 text-[12.5px] font-semibold text-[#0b1c30] border border-slate-200 bg-white px-3 rounded-lg hover:bg-slate-50"
        >
          Hôm nay
        </button>
        <button
          type="button"
          onClick={onPrev}
          aria-label="Khoảng trước"
          className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Khoảng sau"
          className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50"
        >
          ›
        </button>
        <label className="flex items-center gap-1.5 h-8 border border-slate-200 bg-white pl-2.5 pr-2 rounded-lg cursor-pointer hover:bg-slate-50">
          <span className="text-[13px] leading-none" aria-hidden>📅</span>
          <input
            type="date"
            aria-label="Lọc ngày"
            value={toApiDate(anchorDate)}
            onChange={e => e.target.value && onPickDate(e.target.value)}
            className="text-[12.5px] font-semibold text-[#0b1c30] outline-none bg-transparent cursor-pointer"
          />
        </label>
        {/* Day/4-day/Tuần use the date picker itself as the anchor — no
            redundant "Tháng 9, 2026" title next to it. Month view has no
            other anchor indicator, so it keeps its own title (spec: "Bỏ
            title tháng khỏi toolbar ... Month view mới hiển thị title
            tháng khi cần"). */}
        {viewMode === 'month' && (
          <span className="text-[14.5px] font-bold text-[#0b1c30] ml-1">{rangeLabel}</span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Client-side only — never triggers a new /calendar/tasks or
            /calendar/meetings request. Filters whatever's already loaded
            for the current date range (spec: "Search hoàn toàn là
            presentation/filter layer"). */}
        <div className="relative w-[280px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 pointer-events-none" aria-hidden>🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchQueryChange(e.target.value)}
            placeholder="Tìm kiếm task, meeting..."
            className="w-full h-9 text-[12.5px] text-[#0b1c30] border border-slate-200 bg-white rounded-lg pl-7 pr-7 outline-none focus:border-[#0058be]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQueryChange('')}
              aria-label="Xoá tìm kiếm"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[13px] leading-none"
            >
              ×
            </button>
          )}
        </div>
        <FilterDropdown filters={filters} onFiltersChange={onFiltersChange} />
        <div className="inline-flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {VIEW_MODE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => onViewModeChange(opt.key)}
              className={`h-8 text-[12px] font-semibold px-3 rounded-md transition-colors ${
                viewMode === opt.key ? 'bg-white text-[#0058be] shadow-sm' : 'text-slate-500 hover:text-[#0b1c30]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onQuickCreate}
          className="h-9 text-[12.5px] font-bold text-white bg-[#0058be] px-3.5 rounded-lg flex items-center gap-1.5 hover:bg-[#00459a]"
        >
          <span className="text-[15px] leading-none">+</span> Tạo task
        </button>
      </div>
    </div>
  );
}
