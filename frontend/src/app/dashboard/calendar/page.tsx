'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { getCalendarTasks, getCalendarMeetings, updateTask, CalendarTask, CalendarMeeting, getApiErrorMessage } from '@/lib/api';
import CalendarToolbar, { EventTypeFilter } from '@/components/calendar/CalendarToolbar';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import { TaskBlockContent } from '@/components/calendar/TaskBlock';
import TaskDetailDrawer from '@/components/calendar/TaskDetailDrawer';
import QuickCreateDrawer, { QuickCreatePrefill } from '@/components/calendar/QuickCreateDrawer';
import MeetingDetailModal from '@/components/meetings/MeetingDetailModal';
import {
  buildRangeDays,
  toApiDate,
  toApiDateTime,
  parseApiDate,
  formatRangeLabel,
  topToTimeOfDay,
  combineDateAndTime,
  startOfWeekMonday,
  addDays,
  EVENT_HEIGHT,
} from '@/components/calendar/dateUtils';

export default function CalendarPage() {
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [rangeDays, setRangeDays] = useState<4 | 7>(4);
  // Task id -> scheduled_at override applied instantly on drop, while the
  // PATCH is in flight. Cleared on success (refetch already landed the real
  // value by then) or on failure (falls back to the untouched server data —
  // that IS the rollback, nothing else to restore since the PATCH never
  // committed). See specs/008-task-calendar-overview/plan.md section 0.
  const [overrides, setOverrides] = useState<Record<number, string | null>>({});
  const [activeTask, setActiveTask] = useState<CalendarTask | null>(null);
  const [detailTask, setDetailTask] = useState<CalendarTask | null>(null);
  const [detailMeeting, setDetailMeeting] = useState<CalendarMeeting | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreatePrefill, setQuickCreatePrefill] = useState<QuickCreatePrefill | null>(null);
  // Personal Calendar event-type filter — UI-only, never sent to the API
  // (the /calendar/tasks and /calendar/meetings scopes stay exactly as
  // they are; this only hides already-fetched items client-side). All 3
  // on by default so the default view is unchanged from before this filter
  // existed.
  const [filters, setFilters] = useState<Set<EventTypeFilter>>(new Set<EventTypeFilter>(['meeting', 'assigned', 'support']));
  // dnd-kit repositions blocks with a CSS transform, not a DOM move, so the
  // browser still fires a native click on the same element right after a
  // real drag-and-drop. Suppress that one synthetic click so finishing a
  // drag doesn't also pop the detail drawer open.
  const suppressClickRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // 4-day mode: rolling window starting at the picked date. 7-day mode:
  // always the full Mon→Sun calendar week containing the picked date — never
  // a rolling 7-day window (chốt: "7 ngày = luôn là một tuần lịch chuẩn Thứ 2
  // → Chủ nhật"). The picked date itself (anchorDate) is never snapped to
  // Monday — only the displayed range is derived from it.
  const days = useMemo(
    () => (rangeDays === 7 ? buildRangeDays(startOfWeekMonday(anchorDate), 7) : buildRangeDays(anchorDate, 4)),
    [anchorDate, rangeDays]
  );
  const from = toApiDate(days[0]);
  const to = toApiDate(days[days.length - 1]);

  const { data: tasks, isFetching, error, refetch } = useQuery({
    queryKey: ['calendar-tasks', from, to],
    queryFn: () => getCalendarTasks(from, to),
    staleTime: 30_000,
  });

  // Meeting is a separate Personal Calendar event type — own endpoint, own
  // query, own data source (the existing Meeting model) — merged with Task
  // only for display, never combined server-side. See "Chốt thêm
  // requirement: ... hai loại dữ liệu và quyền xử lý độc lập."
  const { data: meetings } = useQuery({
    queryKey: ['calendar-meetings', from, to],
    queryFn: () => getCalendarMeetings(from, to),
    staleTime: 30_000,
  });

  const displayTasks = useMemo(
    () => (tasks || []).map(t => (t.id in overrides ? { ...t, scheduled_at: overrides[t.id] } : t)),
    [tasks, overrides]
  );
  // UI-only filter (spec: "Filter chỉ xử lý ở UI, không thay đổi scope của
  // API") — applied on top of whatever the server already scoped to this
  // member, never sent as a request param.
  const roleFilteredTasks = useMemo(
    () => displayTasks.filter(t => filters.has(t.calendar_role)),
    [displayTasks, filters]
  );
  const filteredMeetings = useMemo(() => (filters.has('meeting') ? meetings || [] : []), [meetings, filters]);
  const scheduledTasks = useMemo(() => roleFilteredTasks.filter(t => !!t.scheduled_at), [roleFilteredTasks]);
  // Has a date (start_date) but no time (scheduled_at IS NULL) — shows in
  // the fixed row under that day's header. Only when its start_date
  // actually falls within the days currently on screen (there's no column
  // to place it under otherwise) — a task whose start_date falls outside
  // the visible range simply isn't shown at all (no Unscheduled Tray
  // fallback anymore; it's still in the system, just not on this view —
  // 2026-09 "Bỏ Task chưa xếp lịch" chốt). Within each day, Assigned always
  // sorts before Support, each group keeping its existing relative order
  // (Array.sort is stable) — 2026-09 "Thứ tự Task chỉ có ngày" chốt.
  const visibleDateKeys = useMemo(() => new Set(days.map(toApiDate)), [days]);
  const dateOnlyTasksByDay = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const t of roleFilteredTasks) {
      if (t.scheduled_at || !t.start_date) continue;
      const key = t.start_date.slice(0, 10);
      if (!visibleDateKeys.has(key)) continue;
      map.set(key, [...(map.get(key) || []), t]);
    }
    map.forEach((list, key) => {
      map.set(key, [...list].sort((a, b) => (a.calendar_role === 'assigned' ? 0 : 1) - (b.calendar_role === 'assigned' ? 0 : 1)));
    });
    return map;
  }, [roleFilteredTasks, visibleDateKeys]);

  const goToday = () => setAnchorDate(new Date());
  // 4-day mode: ±4 days. 7-day mode: ±7 days (a full week) — since
  // startOfWeekMonday derives the displayed range from anchorDate, shifting
  // by exactly 7 keeps the same weekday and lands on the prev/next week.
  const goPrev = () => setAnchorDate(d => addDays(d, -rangeDays));
  const goNext = () => setAnchorDate(d => addDays(d, rangeDays));
  const goPickDate = (dateStr: string) => {
    const picked = parseApiDate(dateStr);
    if (picked) setAnchorDate(picked);
  };

  const handleToggleDone = async (task: CalendarTask) => {
    // Only Assigned may toggle from the Calendar (UI-level gate — backend
    // permission unchanged, spec.md section 2.6). TaskBlock already hides
    // the checkbox for Support; this is a defensive second check.
    if (task.calendar_role !== 'assigned') return;
    const nextStatus = (task.status || '').toLowerCase() === 'done' ? 'Waiting' : 'Done';
    try {
      await updateTask(task.task_group_id, task.id, { status: nextStatus });
      await refetch();
      setDetailTask(prev => (prev && prev.id === task.id ? { ...prev, status: nextStatus } : prev));
    } catch (err) {
      alert(getApiErrorMessage(err, 'Không thể cập nhật trạng thái task.'));
    }
  };

  const applyScheduledAtChange = async (task: CalendarTask, newValue: string | null) => {
    setOverrides(prev => ({ ...prev, [task.id]: newValue }));
    try {
      // Drag only ever touches scheduled_at — never start_date/end_date_est/
      // sort_order (spec.md FR-CAL-16), and always the same PATCH endpoint
      // Task Management already uses (plan.md section 0 — no calendar-only
      // write path).
      await updateTask(task.task_group_id, task.id, { scheduled_at: newValue });
      await refetch();
    } catch (err) {
      alert(getApiErrorMessage(err, 'Không thể cập nhật giờ làm task — đã khôi phục vị trí cũ.'));
    } finally {
      setOverrides(prev => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as CalendarTask | undefined;
    setActiveTask(task || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    const task = active.data.current?.task as CalendarTask | undefined;
    if (!task || task.calendar_role !== 'assigned' || !over) return; // no valid drop → snaps back on its own

    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 150);

    if (typeof over.id === 'string' && over.id.startsWith('day:')) {
      const activeRect = active.rect.current.translated;
      if (!activeRect) return;
      const relativeTop = activeRect.top - over.rect.top;
      const { hours, minutes } = topToTimeOfDay(relativeTop);
      const [y, m, d] = over.id.slice(4).split('-').map(Number);
      const newDate = combineDateAndTime(new Date(y, m - 1, d), hours, minutes);
      applyScheduledAtChange(task, toApiDateTime(newDate));
    }
  };

  const handleOpenDetail = (task: CalendarTask) => {
    if (suppressClickRef.current) return;
    setDetailTask(task);
  };

  const handleOpenMeetingDetail = (meeting: CalendarMeeting) => {
    if (suppressClickRef.current) return;
    setDetailMeeting(meeting);
  };

  const handleEmptyCellClick = (day: Date, hours: number, minutes: number) => {
    setQuickCreatePrefill({ day, hours, minutes });
    setQuickCreateOpen(true);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 p-4 md:p-6">
          <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden h-full flex flex-col">
            <CalendarToolbar
              rangeLabel={formatRangeLabel(days)}
              rangeDays={rangeDays}
              onRangeDaysChange={setRangeDays}
              onPrev={goPrev}
              onNext={goNext}
              onToday={goToday}
              anchorDate={anchorDate}
              onPickDate={goPickDate}
              filters={filters}
              onFiltersChange={setFilters}
              onQuickCreate={() => { setQuickCreatePrefill(null); setQuickCreateOpen(true); }}
            />

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden border-t border-slate-100">
              {error ? (
                <p className="p-6 text-[13px] text-rose-600">{getApiErrorMessage(error, 'Không tải được lịch.')}</p>
              ) : (
                <CalendarGrid
                  days={days}
                  tasks={scheduledTasks}
                  meetings={filteredMeetings}
                  dateOnlyTasksByDay={dateOnlyTasksByDay}
                  onToggleDone={handleToggleDone}
                  onOpenDetail={handleOpenDetail}
                  onOpenMeetingDetail={handleOpenMeetingDetail}
                  onEmptyCellClick={handleEmptyCellClick}
                />
              )}
            </div>
          </div>
          {isFetching && (
            <p className="text-[11px] text-slate-400 mt-2 px-1">Đang tải…</p>
          )}
        </div>
      </div>

      <DragOverlay>
        {activeTask && (
          <div
            className="relative rounded-lg px-2 py-1 overflow-hidden shadow-lg bg-white"
            style={{ height: EVENT_HEIGHT, width: 200, borderLeft: `3px solid ${activeTask.project_color || '#565e74'}` }}
          >
            <TaskBlockContent task={activeTask} onToggleDone={() => {}} />
          </div>
        )}
      </DragOverlay>

      <TaskDetailDrawer task={detailTask} onClose={() => setDetailTask(null)} onToggleDone={handleToggleDone} />

      {/* Reuses the EXISTING Meeting Detail as-is — no separate Calendar-only
          Meeting Detail (see "Click Meeting → mở Meeting Detail hiện có").
          Edit/Summarize/Sync/Delete are intentionally omitted here (Calendar
          itself doesn't own those flows); the modal's own can_manage-gated
          quick actions (Assign Project/Add Member) still work unmodified. */}
      <MeetingDetailModal
        isOpen={!!detailMeeting}
        onClose={() => setDetailMeeting(null)}
        meeting={detailMeeting}
      />

      <QuickCreateDrawer
        isOpen={quickCreateOpen}
        prefill={quickCreatePrefill}
        onClose={() => setQuickCreateOpen(false)}
        onCreated={() => refetch()}
      />
    </DndContext>
  );
}
