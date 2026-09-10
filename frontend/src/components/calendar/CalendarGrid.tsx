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
  topToTimeOfDay,
} from './dateUtils';

const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

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
          const { hours, minutes } = topToTimeOfDay(e.clientY - rect.top);
          onEmptyCellClick(day, hours, minutes);
        }}
      >
        {HOURS.map((h, i) => (
          <div key={h} className="absolute left-0 right-0 border-b border-slate-50" style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }} />
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
      {/* Hour rail */}
      <div className="w-14 shrink-0 border-r border-slate-100">
        <div className="h-9 border-b border-slate-100" />
        {HOURS.map(h => (
          <div
            key={h}
            className="text-[10.5px] text-slate-400 text-right pr-2 border-b border-slate-50"
            style={{ height: HOUR_HEIGHT, transform: 'translateY(-6px)' }}
          >
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
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
