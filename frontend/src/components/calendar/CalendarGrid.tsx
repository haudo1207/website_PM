'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { CalendarTask, CalendarMeeting } from '@/lib/api';
import TaskBlock, { DateOnlyChip } from './TaskBlock';
import MeetingBlock from './MeetingBlock';
import {
  HOUR_START,
  HOUR_END,
  HOUR_HEIGHT,
  EVENT_HEIGHT,
  formatDayLabel,
  isSameDay,
  minutesToTop,
  layoutDayItems,
  parseScheduledAt,
  parseHHMM,
  toApiDate,
  topToQuarterHour,
  buildHourTicks,
} from './dateUtils';

// A day column's timeline mixes two independent event types — Task
// (draggable, project-colored) and Meeting (read-only, fixed indigo style)
// — positioned/lane-packed together by time via the shared, type-agnostic
// layoutDayItems(). See "Chốt thêm requirement": Meeting has its own data
// source and permission scope, merged with Task only for display.
type DayItem =
  | { kind: 'task'; task: CalendarTask; top: number; height: number }
  | { kind: 'meeting'; meeting: CalendarMeeting; top: number; height: number };

// 30-minute marks from 06:00 to 23:00 (inclusive) — shared by the hour rail
// and the grid lines so they always line up. Pure function of the module's
// own constants, safe to compute once at module scope.
const TICKS = buildHourTicks();
const gridColsStyle = (n: number) => ({ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` });

function DayHeaderCell({ day, isToday }: { day: Date; isToday: boolean }) {
  const { dow, dom } = formatDayLabel(day);
  return (
    <div className={`h-9 flex flex-col justify-center px-3 border-r border-slate-100 last:border-r-0 ${isToday ? 'bg-[#eaf2fc]' : ''}`}>
      <span className="text-[9.5px] font-bold tracking-wider text-slate-400">{dow}</span>
      <span className={`text-[13px] font-bold leading-tight ${isToday ? 'text-[#0058be]' : 'text-[#0b1c30]'}`}>{dom}</span>
    </div>
  );
}

// Fixed row directly under the day header — tasks that have a date
// (start_date) but no time (scheduled_at IS NULL) land here instead of the
// Unscheduled Tray, on whichever day column matches their start_date. See
// the 2026-09 "Task đã chọn ngày nhưng chưa chọn giờ" design note.
//
// Chốt UX (2026-09-15): this row must stay compact so it never pushes the
// Timeline down — only the FIRST task (already Assigned-before-Support
// sorted upstream, in page.tsx) shows by default, with a "+N task" toggle
// to expand/collapse the rest. Collapse state is local per day column
// (uncontrolled) — nothing about it needs to survive a day-range change.
function DateOnlyCell({
  day,
  tasks,
  onToggleDone,
  onOpenDetail,
}: {
  day: Date;
  tasks: CalendarTask[];
  onToggleDone: (task: CalendarTask) => void;
  onOpenDetail: (task: CalendarTask) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleTasks = expanded ? tasks : tasks.slice(0, 1);
  const hiddenCount = tasks.length - 1;

  return (
    <div className="border-r border-b border-slate-100 last:border-r-0 px-1.5 py-1.5 min-h-[34px]">
      {visibleTasks.map(task => (
        <DateOnlyChip key={task.id} task={task} onToggleDone={onToggleDone} onOpenDetail={onOpenDetail} />
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
          className="text-[10px] font-semibold text-slate-400 hover:text-[#0058be] px-0.5"
        >
          {expanded ? 'Thu gọn ▲' : `+ ${hiddenCount} task`}
        </button>
      )}
    </div>
  );
}

function DayColumnBody({
  day,
  dayItems,
  onToggleDone,
  onOpenDetail,
  onOpenMeetingDetail,
  onEmptyCellClick,
  gridHeight,
}: {
  day: Date;
  dayItems: DayItem[];
  onToggleDone: (task: CalendarTask) => void;
  onOpenDetail: (task: CalendarTask) => void;
  onOpenMeetingDetail: (meeting: CalendarMeeting) => void;
  onEmptyCellClick: (day: Date, hours: number, minutes: number) => void;
  gridHeight: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${toApiDate(day)}`, data: { day } });
  const positioned = layoutDayItems(dayItems);

  return (
    <div className="border-r border-slate-100 last:border-r-0">
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
        {positioned.map(p =>
          p.kind === 'task' ? (
            <TaskBlock
              key={`task-${p.task.id}`}
              task={p.task}
              top={p.top}
              lane={p.lane}
              laneCount={p.laneCount}
              onToggleDone={onToggleDone}
              onOpenDetail={onOpenDetail}
            />
          ) : (
            <MeetingBlock
              key={`meeting-${p.meeting.id}`}
              meeting={p.meeting}
              top={p.top}
              height={p.height}
              lane={p.lane}
              laneCount={p.laneCount}
              onOpenDetail={onOpenMeetingDetail}
            />
          )
        )}
      </div>
    </div>
  );
}

export default function CalendarGrid({
  days,
  tasks,
  meetings,
  dateOnlyTasksByDay,
  onToggleDone,
  onOpenDetail,
  onOpenMeetingDetail,
  onEmptyCellClick,
}: {
  days: Date[];
  tasks: CalendarTask[]; // already filtered to scheduled_at != null
  meetings: CalendarMeeting[];
  dateOnlyTasksByDay: Map<string, CalendarTask[]>; // key = toApiDate(day); has a date, no time
  onToggleDone: (task: CalendarTask) => void;
  onOpenDetail: (task: CalendarTask) => void;
  onOpenMeetingDetail: (meeting: CalendarMeeting) => void;
  onEmptyCellClick: (day: Date, hours: number, minutes: number) => void;
}) {
  const today = new Date();
  const gridHeight = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
  const cols = gridColsStyle(days.length);

  return (
    <div className="flex flex-col h-full">
      {/* Header + date-only-tasks rows stay fixed on scroll — only the
          06:00+ hour grid below scrolls (spec: "Hàng đầu tiên phải cố
          định"). w-14 spacers keep both rows aligned with the hour rail. */}
      <div className="flex bg-white shrink-0">
        <div className="w-14 shrink-0 border-r border-b border-slate-100" />
        <div className="flex-1 grid" style={cols}>
          {days.map(day => (
            <DayHeaderCell key={day.toISOString()} day={day} isToday={isSameDay(day, today)} />
          ))}
        </div>
      </div>
      <div className="flex bg-white shrink-0">
        <div className="w-14 shrink-0 border-r border-b border-slate-100" />
        <div className="flex-1 grid" style={cols}>
          {days.map(day => (
            <DateOnlyCell
              key={day.toISOString()}
              day={day}
              tasks={dateOnlyTasksByDay.get(toApiDate(day)) || []}
              onToggleDone={onToggleDone}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex bg-white">
          {/* Hour rail — a label at every 30-minute mark, 06:00 through 23:00
              (the calendar's own hard bottom boundary — spec.md "chốt 3 vấn đề
              về thời gian": "06:00 → 23:00", "Timeline chia mốc 30 phút"). */}
          <div className="w-14 shrink-0 border-r border-slate-100 relative" style={{ height: gridHeight }}>
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

          {/* Day columns */}
          <div className="flex-1 grid" style={cols}>
            {days.map(day => {
              type TaskItem = Extract<DayItem, { kind: 'task' }>;
              type MeetingItem = Extract<DayItem, { kind: 'meeting' }>;
              const dayTaskItems: DayItem[] = tasks
                .map((task): TaskItem | null => {
                  if (!task.scheduled_at) return null;
                  const dt = parseScheduledAt(task.scheduled_at);
                  if (!dt || !isSameDay(dt, day)) return null;
                  return { kind: 'task', task, top: minutesToTop(dt.getHours(), dt.getMinutes()), height: EVENT_HEIGHT };
                })
                .filter((x): x is TaskItem => x !== null);
              const dayMeetingItems: DayItem[] = meetings
                .map((meeting): MeetingItem | null => {
                  if (meeting.date !== toApiDate(day)) return null;
                  const t = parseHHMM(meeting.time);
                  if (!t) return null;
                  const top = minutesToTop(t.hours, t.minutes);
                  // No end_time on this meeting → same fixed height as a Task
                  // block, same fallback rule the spec calls out ("Thời
                  // lượng ... nếu Meeting đang có").
                  const height = meeting.duration ? meeting.duration * (HOUR_HEIGHT / 60) : EVENT_HEIGHT;
                  return { kind: 'meeting', meeting, top, height };
                })
                .filter((x): x is MeetingItem => x !== null);

              return (
                <DayColumnBody
                  key={day.toISOString()}
                  day={day}
                  dayItems={[...dayTaskItems, ...dayMeetingItems]}
                  onToggleDone={onToggleDone}
                  onOpenDetail={onOpenDetail}
                  onOpenMeetingDetail={onOpenMeetingDetail}
                  onEmptyCellClick={onEmptyCellClick}
                  gridHeight={gridHeight}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
