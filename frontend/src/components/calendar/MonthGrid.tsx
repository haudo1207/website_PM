'use client';

import { CalendarTask, CalendarMeeting, CalendarLeaveBlock } from '@/lib/api';
import { hexToRgba, FALLBACK_COLOR } from './TaskBlock';
import { isSameDay, toApiDate } from './dateUtils';

// Month view is a coarse overview, not a scheduling surface — no hourly
// timeline, no drag. A task lands on scheduled_at's date if it has one,
// else start_date (same "which day does this task belong to" rule as the
// week views' date-only row, just merged into one flat per-day list since
// there's no timeline to split it from). Sorted by time, date-only tasks
// (no time) last within their day.
export interface MonthItem {
  kind: 'task' | 'meeting' | 'leave';
  task?: CalendarTask;
  meeting?: CalendarMeeting;
  leave?: CalendarLeaveBlock;
  timeLabel: string | null;
  sortMin: number;
}

const MAX_VISIBLE = 3;
const DOW_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function MonthItemChip({
  item,
  onOpenDetail,
  onOpenMeetingDetail,
}: {
  item: MonthItem;
  onOpenDetail: (task: CalendarTask) => void;
  onOpenMeetingDetail: (meeting: CalendarMeeting) => void;
}) {
  if (item.kind === 'task' && item.task) {
    const t = item.task;
    const color = t.project_color || FALLBACK_COLOR;
    const isCritical = (t.priority || '').toLowerCase() === 'critical';
    return (
      <div
        onClick={e => { e.stopPropagation(); onOpenDetail(t); }}
        className="flex items-center gap-1 px-1 py-[1px] rounded text-[10px] leading-[15px] cursor-pointer hover:brightness-95"
        style={{ background: hexToRgba(color, 0.14) }}
        title={`${item.timeLabel ? item.timeLabel + ' · ' : ''}${t.detail}`}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
        {item.timeLabel && <span className="text-slate-400 shrink-0">{item.timeLabel}</span>}
        <span className={`truncate ${isCritical ? 'font-bold' : 'font-medium'}`} style={{ color: '#0b1c30' }}>{t.detail}</span>
      </div>
    );
  }
  if (item.kind === 'meeting' && item.meeting) {
    const m = item.meeting;
    return (
      <div
        onClick={e => { e.stopPropagation(); onOpenMeetingDetail(m); }}
        className="flex items-center gap-1 px-1 py-[1px] rounded text-[10px] leading-[15px] cursor-pointer bg-indigo-50 hover:bg-indigo-100"
        title={`${item.timeLabel ? item.timeLabel + ' · ' : ''}${m.title}`}
      >
        <span className="shrink-0">📅</span>
        {item.timeLabel && <span className="text-indigo-400 shrink-0">{item.timeLabel}</span>}
        <span className="truncate font-medium text-indigo-700">{m.title}</span>
      </div>
    );
  }
  if (item.kind === 'leave' && item.leave) {
    const block = item.leave;
    return (
      <div
        className="flex items-center gap-1 px-1 py-[1px] rounded text-[10px] leading-[15px] bg-rose-50"
        title={`${block.member_name} — ${block.title}`}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-rose-400" />
        <span className="truncate font-medium text-rose-700">{block.member_name || block.title}</span>
      </div>
    );
  }
  return null;
}

export default function MonthGrid({
  days,
  monthAnchor,
  itemsByDay,
  onOpenDetail,
  onOpenMeetingDetail,
  onGoToDay,
}: {
  days: Date[]; // full weeks, includes prev/next-month padding — buildMonthGridDays()
  monthAnchor: Date; // the month actually being viewed, for dimming padding days
  itemsByDay: Map<string, MonthItem[]>; // key = toApiDate(day)
  onOpenDetail: (task: CalendarTask) => void;
  onOpenMeetingDetail: (meeting: CalendarMeeting) => void;
  onGoToDay: (day: Date) => void; // "+N nữa" / click ngày → chuyển sang Day view, tận dụng timeline engine sẵn có thay vì popover riêng
}) {
  const today = new Date();
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="grid grid-cols-7 shrink-0 border-b border-slate-100 bg-white sticky top-0 z-10">
        {DOW_LABELS.map(l => (
          <div key={l} className="px-2 py-1.5 text-[10px] font-bold text-slate-400 text-center">{l}</div>
        ))}
      </div>
      <div className="flex-1 grid" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(104px, 1fr))` }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
            {week.map(day => {
              const key = toApiDate(day);
              const inMonth = day.getMonth() === monthAnchor.getMonth();
              const items = itemsByDay.get(key) || [];
              const visible = items.slice(0, MAX_VISIBLE);
              const hidden = items.length - visible.length;
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={key}
                  onClick={() => onGoToDay(day)}
                  className={`border-r border-slate-100 last:border-r-0 p-1.5 cursor-pointer hover:bg-slate-50/70 flex flex-col min-h-0 ${inMonth ? '' : 'bg-slate-50/40'}`}
                >
                  <span className={`text-[11px] font-bold w-5 h-5 flex items-center justify-center rounded-full shrink-0 ${isToday ? 'bg-[#0058be] text-white' : inMonth ? 'text-[#0b1c30]' : 'text-slate-300'}`}>
                    {day.getDate()}
                  </span>
                  <div className="flex-1 min-h-0 flex flex-col gap-0.5 mt-1 overflow-hidden">
                    {visible.map((item, idx) => (
                      <MonthItemChip key={idx} item={item} onOpenDetail={onOpenDetail} onOpenMeetingDetail={onOpenMeetingDetail} />
                    ))}
                    {hidden > 0 && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onGoToDay(day); }}
                        className="text-[10px] font-semibold text-slate-400 hover:text-[#0058be] text-left shrink-0"
                      >
                        + {hidden} nữa
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
