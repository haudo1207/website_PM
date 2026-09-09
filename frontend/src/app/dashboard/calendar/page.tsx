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
import { getCalendarTasks, updateTask, CalendarTask, getApiErrorMessage } from '@/lib/api';
import CalendarToolbar from '@/components/calendar/CalendarToolbar';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import UnscheduledTray from '@/components/calendar/UnscheduledTray';
import { TaskBlockContent } from '@/components/calendar/TaskBlock';
import TaskDetailDrawer from '@/components/calendar/TaskDetailDrawer';
import QuickCreateDrawer, { QuickCreatePrefill } from '@/components/calendar/QuickCreateDrawer';
import {
  buildRangeDays,
  toApiDate,
  toApiDateTime,
  formatRangeLabel,
  topToTimeOfDay,
  combineDateAndTime,
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
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreatePrefill, setQuickCreatePrefill] = useState<QuickCreatePrefill | null>(null);
  // dnd-kit repositions blocks with a CSS transform, not a DOM move, so the
  // browser still fires a native click on the same element right after a
  // real drag-and-drop. Suppress that one synthetic click so finishing a
  // drag doesn't also pop the detail drawer open.
  const suppressClickRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const days = useMemo(() => buildRangeDays(anchorDate, rangeDays), [anchorDate, rangeDays]);
  const from = toApiDate(days[0]);
  const to = toApiDate(days[days.length - 1]);

  const { data: tasks, isFetching, error, refetch } = useQuery({
    queryKey: ['calendar-tasks', from, to],
    queryFn: () => getCalendarTasks(from, to),
    staleTime: 30_000,
  });

  const displayTasks = useMemo(
    () => (tasks || []).map(t => (t.id in overrides ? { ...t, scheduled_at: overrides[t.id] } : t)),
    [tasks, overrides]
  );
  const scheduledTasks = useMemo(() => displayTasks.filter(t => !!t.scheduled_at), [displayTasks]);
  const unscheduledTasks = useMemo(() => displayTasks.filter(t => !t.scheduled_at), [displayTasks]);

  const goToday = () => setAnchorDate(new Date());
  const goPrev = () => setAnchorDate(d => {
    const c = new Date(d);
    c.setDate(c.getDate() - rangeDays);
    return c;
  });
  const goNext = () => setAnchorDate(d => {
    const c = new Date(d);
    c.setDate(c.getDate() + rangeDays);
    return c;
  });

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

    if (over.id === 'tray') {
      if (!task.scheduled_at) return; // already unscheduled
      applyScheduledAtChange(task, null);
      return;
    }

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
              onQuickCreate={() => { setQuickCreatePrefill(null); setQuickCreateOpen(true); }}
            />

            <div className="flex-1 min-h-0 overflow-y-auto border-t border-slate-100">
              {error ? (
                <p className="p-6 text-[13px] text-rose-600">{getApiErrorMessage(error, 'Không tải được lịch.')}</p>
              ) : (
                <CalendarGrid
                  days={days}
                  tasks={scheduledTasks}
                  onToggleDone={handleToggleDone}
                  onOpenDetail={handleOpenDetail}
                  onEmptyCellClick={handleEmptyCellClick}
                />
              )}
            </div>

            <UnscheduledTray tasks={unscheduledTasks} onOpenDetail={handleOpenDetail} />
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

      <QuickCreateDrawer
        isOpen={quickCreateOpen}
        prefill={quickCreatePrefill}
        onClose={() => setQuickCreateOpen(false)}
        onCreated={() => refetch()}
      />
    </DndContext>
  );
}
