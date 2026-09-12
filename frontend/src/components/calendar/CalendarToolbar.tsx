'use client';

import { useState } from 'react';
import { toApiDate } from './dateUtils';

// Personal Calendar event-type filter — UI-only (spec: "Filter chỉ xử lý ở
// UI, không thay đổi scope của API"). Task is split into Assigned/Support
// so a user can e.g. hide their own Support-only tasks while keeping
// Meeting + their Assigned work visible.
export type EventTypeFilter = 'meeting' | 'assigned' | 'support';

const FILTER_OPTIONS: { key: EventTypeFilter; label: string }[] = [
  { key: 'meeting', label: 'Meeting' },
  { key: 'assigned', label: 'Task – Assigned' },
  { key: 'support', label: 'Task – Support' },
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
        className="text-[12.5px] font-semibold text-[#0b1c30] border border-slate-200 bg-white px-3 py-1.5 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
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

export default function CalendarToolbar({
  rangeLabel,
  rangeDays,
  onRangeDaysChange,
  onPrev,
  onNext,
  onToday,
  anchorDate,
  onPickDate,
  filters,
  onFiltersChange,
  onQuickCreate,
}: {
  rangeLabel: string;
  rangeDays: 4 | 7;
  onRangeDaysChange: (n: 4 | 7) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  anchorDate: Date;
  onPickDate: (dateStr: string) => void;
  filters: Set<EventTypeFilter>;
  onFiltersChange: (next: Set<EventTypeFilter>) => void;
  onQuickCreate: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 flex-wrap">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToday}
          className="text-[12.5px] font-semibold text-[#0b1c30] border border-slate-200 bg-white px-3 py-1.5 rounded-lg hover:bg-slate-50"
        >
          Hôm nay
        </button>
        <button
          type="button"
          onClick={onPrev}
          aria-label="Khoảng trước"
          className="w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Khoảng sau"
          className="w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50"
        >
          ›
        </button>
        <span className="text-[14.5px] font-bold text-[#0b1c30] ml-1">{rangeLabel}</span>
        <label className="flex items-center gap-1.5 border border-slate-200 bg-white pl-2.5 pr-2 py-1.5 rounded-lg ml-1 cursor-pointer hover:bg-slate-50">
          <span className="text-[13px] leading-none" aria-hidden>📅</span>
          <input
            type="date"
            aria-label="Lọc ngày"
            value={toApiDate(anchorDate)}
            onChange={e => e.target.value && onPickDate(e.target.value)}
            className="text-[12.5px] font-semibold text-[#0b1c30] outline-none bg-transparent cursor-pointer"
          />
        </label>
      </div>

      {/* Chốt: Lọc nằm ngay bên trái 4 ngày / 7 ngày (không đặt cạnh Date
          Picker ở khu bên trái). */}
      <div className="flex items-center gap-2">
        <FilterDropdown filters={filters} onFiltersChange={onFiltersChange} />
        <div className="inline-flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {([4, 7] as const).map(n => (
            <button
              key={n}
              type="button"
              onClick={() => onRangeDaysChange(n)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors ${
                rangeDays === n ? 'bg-white text-[#0058be] shadow-sm' : 'text-slate-500 hover:text-[#0b1c30]'
              }`}
            >
              {n} ngày
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onQuickCreate}
          className="text-[12.5px] font-bold text-white bg-[#0058be] px-3.5 py-2 rounded-lg flex items-center gap-1.5 hover:bg-[#00459a]"
        >
          <span className="text-[15px] leading-none">+</span> Tạo task
        </button>
      </div>
    </div>
  );
}
