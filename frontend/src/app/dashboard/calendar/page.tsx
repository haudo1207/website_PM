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
import CalendarToolbar, { EventTypeFilter, CalendarViewMode } from '@/components/calendar/CalendarToolbar';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import MonthGrid, { MonthItem } from '@/components/calendar/MonthGrid';
import { TaskBlockContent } from '@/components/calendar/TaskBlock';
import TaskEditDrawer from '@/components/tasks/TaskEditDrawer';
import QuickCreateDrawer, { QuickCreatePrefill } from '@/components/calendar/QuickCreateDrawer';
import MeetingDetailModal from '@/components/meetings/MeetingDetailModal';
import SummaryCards, { CalendarSummaryStats } from '@/components/calendar/SummaryCards';
import { calculateDaysLate } from '@/app/dashboard/constants';
import {
  buildRangeDays,
  buildMonthGridDays,
  toApiDate,
  toApiDateTime,
  parseApiDate,
  parseScheduledAt,
  parseHHMM,
  formatRangeLabel,
  topToTimeOfDay,
  combineDateAndTime,
  startOfWeekMonday,
  addDays,
  EVENT_HEIGHT,
} from '@/components/calendar/dateUtils';

export default function CalendarPage() {
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('4day');
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
  // Client-side only (spec: "Search hoàn toàn là presentation/filter
  // layer") — filters whatever's already loaded for the current date
  // range, same as the event-type Filter above. Never triggers a new
  // /calendar/tasks or /calendar/meetings request; switching date range
  // still fetches exactly as before.
  const [searchQuery, setSearchQuery] = useState('');
  // dnd-kit repositions blocks with a CSS transform, not a DOM move, so the
  // browser still fires a native click on the same element right after a
  // real drag-and-drop. Suppress that one synthetic click so finishing a
  // drag doesn't also pop the detail drawer open.
  const suppressClickRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Day: single day (buildRangeDays(anchor,1) — same engine as 4-day/7-day,
  // just length 1, no new rendering code). 4-day: rolling window from the
  // picked date. 7-day (Tuần): always the full Mon→Sun calendar week
  // containing the picked date — never a rolling 7-day window (chốt: "7
  // ngày = luôn là một tuần lịch chuẩn Thứ 2 → Chủ nhật"). Month: full
  // weeks covering the picked date's month, including prev/next-month
  // padding days (buildMonthGridDays) — rendered by the separate MonthGrid,
  // not the hourly CalendarGrid. anchorDate itself is never snapped — only
  // the displayed range is derived from it.
  const days = useMemo(() => {
    if (viewMode === 'day') return buildRangeDays(anchorDate, 1);
    if (viewMode === '7day') return buildRangeDays(startOfWeekMonday(anchorDate), 7);
    if (viewMode === 'month') return buildMonthGridDays(anchorDate);
    return buildRangeDays(anchorDate, 4);
  }, [anchorDate, viewMode]);
  const from = toApiDate(days[0]);
  const to = toApiDate(days[days.length - 1]);
  const rangeLabel = useMemo(() => {
    if (viewMode === 'day') {
      return anchorDate.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    if (viewMode === 'month') {
      return `Tháng ${anchorDate.getMonth() + 1}, ${anchorDate.getFullYear()}`;
    }
    return formatRangeLabel(days);
  }, [viewMode, anchorDate, days]);

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

  // Calendar Summary — scoped like the rest of the page (current user via
  // /calendar/tasks, current date range, current event-type Filter) but
  // deliberately built from roleFilteredTasks, NOT searchedTasks: search
  // must never make "Tổng công việc" jump around (spec §Phase 3 "search
  // CRM không làm card Tổng công việc nhảy ... khó hiểu"). Task only —
  // Meeting has no Done/Overdue concept so it doesn't fit these 4 cards.
  const summaryStats: CalendarSummaryStats = useMemo(() => {
    const total = roleFilteredTasks.length;
    let done = 0;
    let overdue = 0;
    for (const t of roleFilteredTasks) {
      const status = (t.status || '').toLowerCase();
      if (status === 'done') { done++; continue; }
      if (calculateDaysLate(t) > 0) overdue++;
    }
    return { total, done, overdue, inProgress: Math.max(0, total - done - overdue) };
  }, [roleFilteredTasks]);

  // Search applies on top of the event-type Filter, same dataset already
  // in memory — task.detail / task.task_code / task.project_name for
  // Task, meeting.title / project name for Meeting. Case-insensitive,
  // trims whitespace. Clearing the query (empty string) returns the exact
  // pre-search arrays, not a re-filtered copy.
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchedTasks = useMemo(() => {
    if (!normalizedQuery) return roleFilteredTasks;
    return roleFilteredTasks.filter(task =>
      [task.detail, task.task_code, task.project_name].some(value => value?.toLowerCase().includes(normalizedQuery))
    );
  }, [roleFilteredTasks, normalizedQuery]);
  const searchedMeetings = useMemo(() => {
    if (!normalizedQuery) return filteredMeetings;
    return filteredMeetings.filter(meeting =>
      [meeting.title, meeting.project_name].some(value => value?.toLowerCase().includes(normalizedQuery))
    );
  }, [filteredMeetings, normalizedQuery]);
  const isSearchEmpty = !!normalizedQuery && searchedTasks.length === 0 && searchedMeetings.length === 0;

  const scheduledTasks = useMemo(() => searchedTasks.filter(t => !!t.scheduled_at), [searchedTasks]);
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
    for (const t of searchedTasks) {
      if (t.scheduled_at || !t.start_date) continue;
      const key = t.start_date.slice(0, 10);
      if (!visibleDateKeys.has(key)) continue;
      map.set(key, [...(map.get(key) || []), t]);
    }
    map.forEach((list, key) => {
      map.set(key, [...list].sort((a, b) => (a.calendar_role === 'assigned' ? 0 : 1) - (b.calendar_role === 'assigned' ? 0 : 1)));
    });
    return map;
  }, [searchedTasks, visibleDateKeys]);

  // Month view merges Task + Meeting into ONE flat per-day list (no
  // timeline to split scheduled-vs-date-only across, unlike the week
  // views) — a task's day is scheduled_at's date if it has one, else
  // start_date (same fallback rule, just not rendered as a separate row
  // here). Sorted by time; date-only tasks (no time) sort last within
  // their day. Only computed in Month mode.
  const monthItemsByDay = useMemo(() => {
    const map = new Map<string, MonthItem[]>();
    if (viewMode !== 'month') return map;
    for (const t of searchedTasks) {
      const scheduled = t.scheduled_at ? parseScheduledAt(t.scheduled_at) : null;
      const key = scheduled ? toApiDate(scheduled) : (t.start_date ? t.start_date.slice(0, 10) : null);
      if (!key) continue;
      const timeLabel = scheduled ? `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}` : null;
      const sortMin = scheduled ? scheduled.getHours() * 60 + scheduled.getMinutes() : 24 * 60;
      map.set(key, [...(map.get(key) || []), { kind: 'task', task: t, timeLabel, sortMin }]);
    }
    for (const m of searchedMeetings) {
      if (!m.date) continue;
      const t = parseHHMM(m.time);
      const timeLabel = t ? `${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')}` : null;
      const sortMin = t ? t.hours * 60 + t.minutes : 24 * 60;
      map.set(m.date, [...(map.get(m.date) || []), { kind: 'meeting', meeting: m, timeLabel, sortMin }]);
    }
    map.forEach((list, key) => map.set(key, [...list].sort((a, b) => a.sortMin - b.sortMin)));
    return map;
  }, [viewMode, searchedTasks, searchedMeetings]);

  const goToday = () => setAnchorDate(new Date());
  // Day: ±1. 4-day: ±4. 7-day (Tuần): ±7 (a full week — startOfWeekMonday
  // derives the displayed range from anchorDate, so shifting by exactly 7
  // keeps the same weekday and lands on the prev/next week). Month: ±1
  // calendar month (not ±days), landing on the same day-of-month.
  const goPrev = () => {
    if (viewMode === 'month') { setAnchorDate(d => new Date(d.getFullYear(), d.getMonth() - 1, d.getDate())); return; }
    const step = viewMode === 'day' ? 1 : viewMode === '7day' ? 7 : 4;
    setAnchorDate(d => addDays(d, -step));
  };
  const goNext = () => {
    if (viewMode === 'month') { setAnchorDate(d => new Date(d.getFullYear(), d.getMonth() + 1, d.getDate())); return; }
    const step = viewMode === 'day' ? 1 : viewMode === '7day' ? 7 : 4;
    setAnchorDate(d => addDays(d, step));
  };
  const goPickDate = (dateStr: string) => {
    const picked = parseApiDate(dateStr);
    if (picked) setAnchorDate(picked);
  };
  // Month view's "+N nữa" / click a day cell — jumps straight into Day view
  // for that date instead of a second popover UI, reusing the same hourly
  // timeline engine Day/4-day/Tuần already render with.
  const goToDay = (day: Date) => {
    setAnchorDate(day);
    setViewMode('day');
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
        <div className="flex-1 min-h-0 p-4 md:p-6 flex flex-col">
          <SummaryCards stats={summaryStats} />
          <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col">
            <CalendarToolbar
              rangeLabel={rangeLabel}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onPrev={goPrev}
              onNext={goNext}
              onToday={goToday}
              anchorDate={anchorDate}
              onPickDate={goPickDate}
              filters={filters}
              onFiltersChange={setFilters}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onQuickCreate={() => { setQuickCreatePrefill(null); setQuickCreateOpen(true); }}
            />

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden border-t border-slate-100">
              {error ? (
                <p className="p-6 text-[13px] text-rose-600">{getApiErrorMessage(error, 'Không tải được lịch.')}</p>
              ) : isSearchEmpty ? (
                // Distinct from "Calendar trống" — the data still exists,
                // it just doesn't match the current search (spec: "Không
                // nên hiện empty state kiểu Calendar trống").
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400">
                  <span className="text-2xl" aria-hidden>🔍</span>
                  <p className="text-[13px] font-semibold">Không tìm thấy task hoặc meeting phù hợp</p>
                </div>
              ) : viewMode === 'month' ? (
                <MonthGrid
                  days={days}
                  monthAnchor={anchorDate}
                  itemsByDay={monthItemsByDay}
                  onOpenDetail={handleOpenDetail}
                  onOpenMeetingDetail={handleOpenMeetingDetail}
                  onGoToDay={goToDay}
                />
              ) : (
                <CalendarGrid
                  days={days}
                  tasks={scheduledTasks}
                  meetings={searchedMeetings}
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

      {/* Click Task → edit directly, no separate Calendar-only edit UI — same
          fields/PATCH endpoint the Tasks tab drawer uses (2026-09 "Click
          Task → cho phép chỉnh sửa luôn" chốt). Save invalidates
          calendar-tasks itself; refetch() here is just the immediate,
          same-page feedback on top of that. */}
      <TaskEditDrawer task={detailTask} onClose={() => setDetailTask(null)} onSaved={() => refetch()} />

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
