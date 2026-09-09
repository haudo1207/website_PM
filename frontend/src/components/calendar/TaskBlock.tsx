'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CalendarTask } from '@/lib/api';
import { EVENT_HEIGHT } from './dateUtils';

export const FALLBACK_COLOR = '#565e74';

export function hexToRgba(hex: string | null | undefined, alpha: number): string {
  const h = (hex || FALLBACK_COLOR).replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Shared visual content — used both for the in-grid block and the floating
// DragOverlay clone, so the two stay pixel-identical while dragging.
export function TaskBlockContent({
  task,
  onToggleDone,
}: {
  task: CalendarTask;
  onToggleDone: (task: CalendarTask) => void;
}) {
  const color = task.project_color || FALLBACK_COLOR;
  const isDone = (task.status || '').toLowerCase() === 'done';
  const canToggle = task.calendar_role === 'assigned';

  return (
    <>
      {task.calendar_role === 'support' && (
        <span
          className="absolute top-1 right-1 text-[8px] font-extrabold uppercase tracking-wide px-1 rounded-full leading-[13px] shrink-0"
          style={{ color, background: hexToRgba(color, 0.18) }}
        >
          SP
        </span>
      )}
      <div className={`flex items-start gap-1.5 min-w-0 ${task.calendar_role === 'support' ? 'pr-5' : ''}`}>
        {canToggle ? (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onToggleDone(task); }}
            onPointerDown={e => e.stopPropagation()}
            className="mt-0.5 shrink-0 w-3 h-3 rounded-[4px] border-[1.5px] flex items-center justify-center"
            style={{ borderColor: color, background: isDone ? color : 'transparent' }}
            aria-label={isDone ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'}
          >
            {isDone && <span className="block w-1.5 h-1.5 rounded-[1px] bg-white" />}
          </button>
        ) : (
          <span className="mt-0.5 shrink-0 w-3 h-3 rounded-[4px] border-[1.5px] opacity-40" style={{ borderColor: color }} />
        )}
        <span
          className={`text-[11px] font-bold leading-[1.25] truncate ${isDone ? 'line-through opacity-60' : ''}`}
          style={{ color: '#0b1c30' }}
        >
          {task.detail}
        </span>
      </div>
      <div className="text-[10px] font-semibold truncate mt-0.5" style={{ color }}>
        {task.project_name}
      </div>
    </>
  );
}

export default function TaskBlock({
  task,
  top,
  lane,
  laneCount,
  onToggleDone,
  onOpenDetail,
}: {
  task: CalendarTask;
  top: number;
  lane: number;
  laneCount: number;
  onToggleDone: (task: CalendarTask) => void;
  onOpenDetail: (task: CalendarTask) => void;
}) {
  const color = task.project_color || FALLBACK_COLOR;
  // Only Assigned may drag on the Calendar — Support is read-only. UI-level
  // gate only; backend authorization is unchanged (plan.md section 2.6).
  const canDrag = task.calendar_role === 'assigned';

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { task },
    disabled: !canDrag,
  });

  const widthPct = 100 / laneCount;
  const leftPct = lane * widthPct;

  return (
    <div
      ref={setNodeRef}
      {...(canDrag ? { ...listeners, ...attributes } : {})}
      onClick={e => { e.stopPropagation(); onOpenDetail(task); }}
      className={`absolute rounded-lg px-2 py-1 overflow-hidden shadow-sm ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      style={{
        top,
        height: EVENT_HEIGHT,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        background: hexToRgba(color, 0.12),
        borderLeft: `3px solid ${color}`,
        opacity: isDragging ? 0.25 : 1,
        transform: transform ? CSS.Translate.toString(transform) : undefined,
        touchAction: 'none',
      }}
      title={`${task.detail} — ${task.project_name}${task.calendar_role === 'support' ? ' (Support)' : ''}`}
    >
      <TaskBlockContent task={task} onToggleDone={onToggleDone} />
    </div>
  );
}
