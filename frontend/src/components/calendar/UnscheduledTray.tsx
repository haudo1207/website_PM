'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CalendarTask } from '@/lib/api';
import { FALLBACK_COLOR } from './TaskBlock';

function TrayChip({ task, onOpenDetail }: { task: CalendarTask; onOpenDetail: (task: CalendarTask) => void }) {
  const color = task.project_color || FALLBACK_COLOR;
  const canDrag = task.calendar_role === 'assigned';
  // Same Critical-bolds-the-name rule as TaskBlock.tsx — this tray is still
  // part of the Calendar, not a separate surface.
  const isCritical = (task.priority || '').toLowerCase() === 'critical';
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { task },
    disabled: !canDrag,
  });

  return (
    <div
      ref={setNodeRef}
      {...(canDrag ? { ...listeners, ...attributes } : {})}
      onClick={() => onOpenDetail(task)}
      className={`relative shrink-0 w-44 rounded-lg border border-slate-200 bg-white px-2.5 py-2 cursor-pointer ${canDrag ? 'active:cursor-grabbing' : ''}`}
      style={{
        borderLeft: `3px solid ${color}`,
        opacity: isDragging ? 0.25 : 1,
        transform: transform ? CSS.Translate.toString(transform) : undefined,
        touchAction: 'none',
      }}
      title={`${task.detail}${task.calendar_role === 'support' ? ' (Support)' : ''}`}
    >
      {task.calendar_role === 'support' && (
        <span
          className="absolute top-1.5 right-1.5 text-[8px] font-extrabold uppercase tracking-wide px-1 rounded-full leading-[13px]"
          style={{ color, background: `${color}26` }}
        >
          SP
        </span>
      )}
      <div className={`text-[11.5px] ${isCritical ? 'font-bold' : 'font-semibold'} text-[#0b1c30] leading-tight truncate pr-5`}>{task.detail}</div>
      <div className="text-[10px] font-semibold mt-0.5 truncate" style={{ color }}>
        {task.project_name}
      </div>
    </div>
  );
}

export default function UnscheduledTray({ tasks, onOpenDetail }: { tasks: CalendarTask[]; onOpenDetail: (task: CalendarTask) => void }) {
  // A single droppable covering the whole tray — dropping ANY scheduled task
  // here clears scheduled_at (spec.md FR-CAL-13), regardless of where in the
  // tray it lands.
  const { setNodeRef, isOver } = useDroppable({ id: 'tray' });

  return (
    <div ref={setNodeRef} className={`border-t border-slate-200 transition-colors ${isOver ? 'bg-[#eaf2fc]' : 'bg-slate-50/60'}`}>
      <div className="flex items-center justify-between px-5 py-2.5">
        <span className="text-[12px] font-bold text-[#0b1c30] flex items-center gap-1.5">
          📥 Task chưa xếp lịch ({tasks.length})
        </span>
      </div>
      {tasks.length === 0 ? (
        <p className="px-5 pb-3 text-[11px] text-slate-400 min-h-[40px]">
          {isOver ? 'Thả để bỏ lịch task này' : 'Không có task nào đang chờ xếp lịch.'}
        </p>
      ) : (
        <div className="flex gap-2.5 px-5 pb-3 overflow-x-auto min-h-[68px]">
          {tasks.map(task => <TrayChip key={task.id} task={task} onOpenDetail={onOpenDetail} />)}
        </div>
      )}
    </div>
  );
}
