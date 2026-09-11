'use client';

import { useDroppable } from '@dnd-kit/core';
import { CalendarTask } from '@/lib/api';
import TaskBlock from './TaskBlock';
import {
  HOUR_START,
  HOUR_END,
  HOUR_HEIGHT,
  formatDayLabel,
  isSameDay,
  minutesToTop,
  layoutDayTasks,
  parseScheduledAt,
  toApiDate,
  topToQuarterHour,
  buildHourTicks,
} from './dateUtils';

// 30-minute marks from 06:00 to 23:00 (inclusive) — shared by the hour rail
// and the grid lines so they always line up. Pure function of the module's
// own constants, safe to compute once at module scope.
const TICKS = buildHourTicks();

function DayColumn({
  day,
  isToday,
  dayTasks,
  onToggleDone,
  onOpenDetail,
  onEmptyCellClick,
  gridHeight,
}: {
  day: Date;
  isToday: boolean;
  dayTasks: { task: CalendarTask; date: Date; top: number }[];
  onToggleDone: (task: CalendarTask) => void;
  onOpenDetail: (task: CalendarTask) => void;
  onEmptyCellClick: (day: Date, hours: number, minutes: number) => void;
  gridHeight: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${toApiDate(day)}`, data: { day } });
  const positioned = layoutDayTasks(dayTasks);
  const { dow, dom } = formatDayLabel(day);

  return (
    <div className="border-r border-slate-100 last:border-r-0">
      <div className={`h-9 flex flex-col justify-center px-3 border-b border-slate-100 ${isToday ? 'bg-[#eaf2fc]' : ''}`}>
        <span className="text-[9.5px] font-bold tracking-wider text-slate-400">{dow}</span>
        <span className={`text-[13px] font-bold leading-tight ${isToday ? 'text-[#0058be]' : 'text-[#0b1c30]'}`}>{dom}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`relative transition-colors cursor-pointer ${isOver ? 'bg-[#eaf2fc]/70' : ''}`}
        style={{ height: gridHeight }}
        title="Click để tạo task nhanh tại khung giờ này"
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          // Click position snaps to the nearest 15-minute mark (00/15/30/45)
          // — never a free/exact minute. Drag & Drop on this same grid snaps
          // to 30 minutes instead (topToTimeOfDay); the two are deliberately
          // different granularities.
          const { hours, minutes } = topToQuarterHour(e.clientY - rect.top);
          onEmptyCellClick(day, hours, minutes);
        }}
      >
        {TICKS.filter(t => !t.isHour).map(t => (
          <div key={`half-${t.label}`} className="absolute left-0 right-0 border-t border-dashed border-slate-50" style={{ top: t.top }} />
        ))}
        {TICKS.filter(t => t.isHour && t.hours > HOUR_START).map(t => (
          <div key={`hour-${t.label}`} className="absolute left-0 right-0 border-t border-slate-100" style={{ top: t.top }} />
        ))}
        {positioned.map(p => (
          <TaskBlock
            key={p.task.id}
            task={p.task}
            top={p.top}
            lane={p.lane}
            laneCount={p.laneCount}
            onToggleDone={onToggleDone}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>
    </div>
  );
}

export default function CalendarGrid({
  days,
  tasks,
  onToggleDone,
  onOpenDetail,
  onEmptyCellClick,
}: {
  days: Date[];
  tasks: CalendarTask[]; // already filtered to scheduled_at != null
  onToggleDone: (task: CalendarTask) => void;
  onOpenDetail: (task: CalendarTask) => void;
  onEmptyCellClick: (day: Date, hours: number, minutes: number) => void;
}) {
  const today = new Date();
  const gridHeight = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

  return (
    <div className="flex bg-white">
      {/* Hour rail — a label at every 30-minute mark, 06:00 through 23:00
          (the calendar's own hard bottom boundary — spec.md "chốt 3 vấn đề
          về thời gian": "06:00 → 23:00", "Timeline chia mốc 30 phút"). */}
      <div className="w-14 shrink-0 border-r border-slate-100 relative" style={{ height: gridHeight + 36 }}>
        <div className="h-9 border-b border-slate-100" />
        <div className="relative" style={{ height: gridHeight }}>
          {TICKS.map(t => (
            <div
              key={t.label}
              className={`absolute right-2 text-right ${t.isHour ? 'text-[10.5px] font-semibold text-slate-500' : 'text-[9px] text-slate-300'}`}
              style={{ top: t.top, transform: 'translateY(-6px)' }}
            >
              {t.label}
            </div>
          ))}
        </div>
      </div>

      {/* Day columns */}
      <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map(day => {
          const dayTasks = tasks
            .map(task => {
              if (!task.scheduled_at) return null;
              const dt = parseScheduledAt(task.scheduled_at);
              if (!dt || !isSameDay(dt, day)) return null;
              return { task, date: dt, top: minutesToTop(dt.getHours(), dt.getMinutes()) };
            })
            .filter((x): x is { task: CalendarTask; date: Date; top: number } => x !== null);

          return (
            <DayColumn
              key={day.toISOString()}
              day={day}
              isToday={isSameDay(day, today)}
              dayTasks={dayTasks}
              onToggleDone={onToggleDone}
              onOpenDetail={onOpenDetail}
              onEmptyCellClick={onEmptyCellClick}
              gridHeight={gridHeight}
            />
          );
        })}
      </div>
    </div>
  );
}
