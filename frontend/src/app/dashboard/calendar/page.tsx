'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { getDashboardCalendarEvents, updateTask, CalendarTask, CalendarMeeting, CalendarLeaveBlock, getApiErrorMessage, getLeaders, getMe, getMembers } from '@/lib/api';
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
  minutesToTop,
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
  const [filters, setFilters] = useState<Set<EventTypeFilter>>(new Set<EventTypeFilter>(['meeting', 'assigned', 'support', 'leave']));
  const [searchQuery, setSearchQuery] = useState('');
  // Dashboard Calendar scope: Super Admin may filter by Leader's team.
  const [selectedLeaderMemberId, setSelectedLeaderMemberId] = useState<number | null>(null);
  const [availableLeaders, setAvailableLeaders] = useState<{ member_id: number; name: string }[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  // Leader scope (requirement H): horizontal filter ALL | <members> | CỦA TÔI.
  // 'ALL' = directly managed members only (Leader's own calendar deliberately
  // excluded), number = one managed member's calendar, 'MINE' = own calendar.
  // Managed-member resolution mirrors the Leader Cards / Team Load rule
  // (leader_member_id FK or legacy leader_name/leader_email match) — the same
  // rule backend/app/routers/calendar.py::_leader_managed_member_ids enforces.
  const [leaderScope, setLeaderScope] = useState<'ALL' | 'MINE' | number>('ALL');
  const [myMemberId, setMyMemberId] = useState<number | null>(null);
  const [myTeam, setMyTeam] = useState<{ id: number; name: string }[]>([]);
  const suppressClickRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Load current role and available leaders for Super Admin.
  useEffect(() => {
    const role = (typeof window !== 'undefined' ? localStorage.getItem('role') : '') || '';
    setCurrentUserRole(role);
    if (role === 'super_admin') {
      getLeaders().then((res: any[]) => {
        setAvailableLeaders(
          (res || [])
            .filter((l: any) => l.member_id)
            .map((l: any) => ({ member_id: l.member_id, name: l.name }))
        );
      }).catch(() => {});
    }
    if (role === 'leader') {
      // Resolve my Member identity + directly managed roster for the filter
      // chips, with the SAME canonical rule as the Dashboard Leader Cards:
      // Member.leader_member_id FK, plus the legacy leader_name/leader_email
      // text match (the "Quản lý thành viên" UI persists assignments as text
      // fields only, so an FK-only check misses most real teams).
      getMe().then((me) => {
        const mid = me?.member_id ?? null;
        setMyMemberId(mid);
        if (mid == null) { setLeaderScope('MINE'); return; }
        getMembers({ light: true }).then((members: any[]) => {
          const list = members || [];
          const self = list.find((m: any) => m.id === mid);
          const leaderNames = new Set(
            [self?.display_name, self?.full_name]
              .map(v => String(v || '').trim().toLowerCase())
              .filter(Boolean)
          );
          const leaderEmails = new Set(
            [me?.email, self?.email]
              .map(v => String(v || '').trim().toLowerCase())
              .filter(Boolean)
          );
          const isManaged = (m: any): boolean => {
            if (m.leader_member_id != null) return m.leader_member_id === mid;
            const nameKey = String(m.leader_name || '').trim().toLowerCase();
            const emailKey = String(m.leader_email || '').trim().toLowerCase();
            return (!!nameKey && leaderNames.has(nameKey)) || (!!emailKey && leaderEmails.has(emailKey));
          };
          const team = list
            .filter((m: any) => m.id !== mid && isManaged(m))
            .map((m: any) => ({ id: m.id, name: m.full_name || m.display_name || `Member ${m.id}` }))
            .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
          setMyTeam(team);
          // No managed members → ALL would render an empty calendar; fall back
          // to the personal view so the page keeps its current behavior.
          if (team.length === 0) setLeaderScope('MINE');
        }).catch(() => setLeaderScope('MINE'));
      }).catch(() => {});
    }
  }, []);

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

  // Scope params per active filter. Super Admin path is untouched; the Leader
  // branches reuse the same endpoint's member_id / leader_member_id contract:
  // ALL → leader_member_id=own member id (backend resolves direct team and
  // rejects anyone else's), Member → member_id (already Leader-authorized for
  // direct reports), CỦA TÔI → no params (current-user default).
  const scopeParams = useMemo(() => {
    if (currentUserRole === 'super_admin') {
      return selectedLeaderMemberId ? { leader_member_id: selectedLeaderMemberId } : {};
    }
    if (currentUserRole === 'leader' && myMemberId != null) {
      if (leaderScope === 'MINE') return {};
      if (leaderScope === 'ALL') return { leader_member_id: myMemberId };
      return { member_id: leaderScope };
    }
    return {};
  }, [currentUserRole, selectedLeaderMemberId, myMemberId, leaderScope]);

  const { data: dashboardData, isFetching, error, refetch } = useQuery({
    queryKey: ['calendar-dashboard-events', from, to, selectedLeaderMemberId, currentUserRole, leaderScope, myMemberId],
    queryFn: () => getDashboardCalendarEvents(from, to, scopeParams),
    staleTime: 30_000,
  });

  const tasks = dashboardData?.tasks;
  const meetings = dashboardData?.meetings;
  const leaveBlocks = dashboardData?.leave_blocks || [];

  const displayTasks = useMemo(
    () => (tasks || []).map(t => (t.id in overrides ? { ...t, scheduled_at: overrides[t.id] } : t)),
    [tasks, overrides]
  );
  const roleFilteredTasks = useMemo(
    () => displayTasks.filter(t => filters.has(t.calendar_role)),
    [displayTasks, filters]
  );
  const filteredMeetings = useMemo(() => (filters.has('meeting') ? meetings || [] : []), [meetings, filters]);
  const filteredLeaveBlocks = useMemo(() => (filters.has('leave') ? leaveBlocks : []), [leaveBlocks, filters]);

  // A full-day/multi-day leave must show OFF on EVERY day it spans (24→26 =
  // three days), not just its start day: expand each range into one copy per
  // on-screen day. Single-day blocks pass through untouched (stable keys);
  // hourly blocks are always single-date, so their times ride along safely.
  const visibleLeaveBlocks = useMemo(() => {
    const out: CalendarLeaveBlock[] = [];
    for (const block of filteredLeaveBlocks) {
      if (!block.start) continue;
      if (!block.end || block.end === block.start) { out.push(block); continue; }
      for (const day of days) {
        const key = toApiDate(day);
        if (key >= block.start && key <= block.end) {
          out.push({ ...block, id: `${block.id}#${key}`, start: key, end: key });
        }
      }
    }
    return out;
  }, [filteredLeaveBlocks, days]);

  // A task "belongs" to the visible range the same way the Grid already
  // decides it does: scheduled tasks by scheduled_at's date, date-only
  // tasks by start_date (both checked against `days` — Day/4-day/Tuần's
  // own days, or Month's full grid including its padding days, whichever
  // is actually on screen), tasks with neither never belong anywhere (same
  // "not shown at all" rule as the date-only row). GET /calendar/tasks
  // itself only date-bounds scheduled_at server-side — every unscheduled
  // task in scope comes back regardless of range — so this local filter is
  // what actually keeps Summary in sync with what the Grid renders.
  const visibleDateKeys = useMemo(() => new Set(days.map(toApiDate)), [days]);
  const isTaskInVisibleRange = (t: CalendarTask): boolean => {
    if (t.scheduled_at) {
      const d = parseScheduledAt(t.scheduled_at);
      return !!d && visibleDateKeys.has(toApiDate(d));
    }
    if (t.start_date) return visibleDateKeys.has(t.start_date.slice(0, 10));
    return false;
  };

  // Calendar Summary — scoped like the rest of the page (current user via
  // /calendar/tasks, current visible date range, current event-type
  // Filter) but deliberately built from roleFilteredTasks, NOT
  // searchedTasks: search must never make "Tổng công việc" jump around
  // (spec §Phase 3 "search CRM không làm card Tổng công việc nhảy ...
  // khó hiểu"). Task only — Meeting has no Done/Overdue concept so it
  // doesn't fit these 4 cards.
  const summaryStats: CalendarSummaryStats = useMemo(() => {
    const visible = roleFilteredTasks.filter(isTaskInVisibleRange);
    const total = visible.length;
    let done = 0;
    let overdue = 0;
    for (const t of visible) {
      const status = (t.status || '').toLowerCase();
      if (status === 'done') { done++; continue; }
      if (calculateDaysLate(t) > 0) overdue++;
    }
    return { total, done, overdue, inProgress: Math.max(0, total - done - overdue) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilteredTasks, visibleDateKeys]);

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
  const searchedLeaveBlocks = useMemo(() => {
    if (!normalizedQuery) return visibleLeaveBlocks;
    return visibleLeaveBlocks.filter(block =>
      [block.title, block.member_name].some(value => value?.toLowerCase().includes(normalizedQuery))
    );
  }, [visibleLeaveBlocks, normalizedQuery]);
  const isSearchEmpty = !!normalizedQuery && searchedTasks.length === 0 && searchedMeetings.length === 0 && searchedLeaveBlocks.length === 0;

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
  // (visibleDateKeys is declared earlier, above summaryStats — shared here.)
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
    for (const block of searchedLeaveBlocks) {
      if (!block.start) continue;
      // Hourly OFF sorts/orders by its start time in Month view too.
      const t = block.start_time ? parseHHMM(block.start_time) : null;
      const timeLabel = t ? `${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')}` : null;
      const sortMin = t ? t.hours * 60 + t.minutes : 24 * 60 + 1;
      map.set(block.start, [...(map.get(block.start) || []), { kind: 'leave', leave: block, timeLabel, sortMin }]);
    }
    map.forEach((list, key) => map.set(key, [...list].sort((a, b) => a.sortMin - b.sortMin)));
    return map;
  }, [viewMode, searchedTasks, searchedMeetings, searchedLeaveBlocks]);

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
      const [y, m, d] = over.id.slice(4).split('-').map(Number);
      let hours: number, minutes: number;
      if (task.scheduled_at) {
        // Already-scheduled task: anchor on its KNOWN time-of-day (via
        // minutesToTop, derived from data — not a DOM rect) plus how far
        // the dragged element itself actually moved (translated - initial
        // rect, both measured by dnd-kit at the same instant, in the same
        // viewport coordinate space). This is immune to the drift a
        // scrolled-timeline drag showed when computed from `over.rect`
        // instead: dragging 14:00 by a clean +120px (2h) landed at 17:00
        // instead of 16:00 once the timeline had been scrolled first —
        // confirmed via a live pixel-delta test, not assumed. Using the
        // dragged element's own before/after rect sidesteps that class of
        // bug entirely, since it never depends on the drop column's rect
        // for the vertical/time component (only for which day, below).
        const original = parseScheduledAt(task.scheduled_at);
        const originalTop = original ? minutesToTop(original.getHours(), original.getMinutes()) : 0;
        const initialRect = active.rect.current.initial;
        const translatedRect = active.rect.current.translated;
        if (!initialRect || !translatedRect) return;
        const elementMovement = translatedRect.top - initialRect.top;
        ({ hours, minutes } = topToTimeOfDay(originalTop + elementMovement));
      } else {
        // Date-only task has no time-of-day origin to anchor from — still
        // needs the drop column's rect to place it on the timeline at all.
        const activeRect = active.rect.current.translated;
        if (!activeRect) return;
        const relativeTop = activeRect.top - over.rect.top;
        ({ hours, minutes } = topToTimeOfDay(relativeTop));
      }
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
        {/* Compact UI pass (2026-09): outer padding ~12px (was p-4 md:p-6) —
            Calendar is a workspace, not a modal/card that needs generous
            breathing room; the height it frees up goes straight to the
            timeline via flex-1 below. */}
        <div className="flex-1 min-h-0 p-3 flex flex-col">
          <SummaryCards stats={summaryStats} />
          <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col">
            {/* Super Admin Team filter — uses canonical Leader list from the
                same source as Dashboard Overview Leader Cards. */}
            {currentUserRole === 'super_admin' && availableLeaders.length > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/50">
                <span className="text-[11px] font-semibold text-slate-500">Team</span>
                <select
                  value={selectedLeaderMemberId ?? ''}
                  onChange={e => {
                    const val = e.target.value;
                    setSelectedLeaderMemberId(val ? Number(val) : null);
                  }}
                  className="h-8 text-[12px] font-semibold text-[#0b1c30] border border-slate-200 bg-white px-2 rounded-lg outline-none focus:border-[#0058be]"
                >
                  <option value="">Tất cả</option>
                  {availableLeaders.map(l => (
                    <option key={l.member_id} value={l.member_id}>{l.name}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Leader horizontal member filter — ALL | <members> | CỦA TÔI.
                Sits in the same scope-row slot as (never replacing) the Super
                Admin Team select below CalendarToolbar. */}
            {currentUserRole === 'leader' && myMemberId != null && (
              <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-100 bg-slate-50/50 overflow-x-auto shrink-0">
                <span className="text-[11px] font-semibold text-slate-500 shrink-0">Thành viên</span>
                {myTeam.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setLeaderScope('ALL')}
                    className={`h-8 shrink-0 text-[12px] font-semibold px-3 rounded-lg border transition-colors ${
                      leaderScope === 'ALL'
                        ? 'bg-[#0058be] text-white border-[#0058be]'
                        : 'bg-white text-[#0b1c30] border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    ALL
                  </button>
                )}
                {myTeam.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setLeaderScope(m.id)}
                    className={`h-8 shrink-0 text-[12px] font-semibold px-3 rounded-lg border transition-colors ${
                      leaderScope === m.id
                        ? 'bg-[#0058be] text-white border-[#0058be]'
                        : 'bg-white text-[#0b1c30] border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setLeaderScope('MINE')}
                  className={`h-8 shrink-0 text-[12px] font-semibold px-3 rounded-lg border transition-colors ${
                    leaderScope === 'MINE'
                      ? 'bg-[#0058be] text-white border-[#0058be]'
                      : 'bg-white text-[#0b1c30] border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  CỦA TÔI
                </button>
              </div>
            )}
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
                  leaveBlocks={searchedLeaveBlocks}
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
