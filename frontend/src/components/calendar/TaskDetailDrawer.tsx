'use client';

import { useRouter } from 'next/navigation';
import Portal from '@/components/Portal';
import { CalendarTask } from '@/lib/api';
import { parseScheduledAt } from './dateUtils';
import { FALLBACK_COLOR } from './TaskBlock';

const rowCls = 'flex items-start gap-2.5 py-2.5 border-t border-slate-100 first:border-t-0';
const kCls = 'text-[10px] font-extrabold text-slate-400 uppercase tracking-wider';
const vCls = 'text-[12.5px] font-semibold text-[#0b1c30] mt-0.5';

export default function TaskDetailDrawer({
  task,
  onClose,
  onToggleDone,
}: {
  task: CalendarTask | null;
  onClose: () => void;
  onToggleDone: (task: CalendarTask) => void;
}) {
  const router = useRouter();
  if (!task) return null;

  const color = task.project_color || FALLBACK_COLOR;
  const isDone = (task.status || '').toLowerCase() === 'done';
  const canToggle = task.calendar_role === 'assigned';
  const scheduledDate = task.scheduled_at ? parseScheduledAt(task.scheduled_at) : null;

  return (
    <Portal>
      <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-stretch justify-end" onClick={onClose}>
        <div className="w-full max-w-md bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200" onClick={e => e.stopPropagation()}>
          <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
            <h3 className="text-sm font-extrabold text-[#0b1c30] uppercase tracking-wider">📋 Chi tiết Task</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-200/60 rounded-lg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {task.task_code && <div className="text-[10.5px] font-bold text-slate-400">{task.task_code}</div>}
            <div className={`text-base font-extrabold text-[#0b1c30] mt-0.5 ${isDone ? 'line-through opacity-60' : ''}`}>{task.detail}</div>

            <div className="flex items-center gap-1.5 mt-2 text-[12px] font-bold" style={{ color }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              {task.project_name}
            </div>

            <div className="flex items-center gap-2 mt-3">
              <span className="text-[10.5px] font-extrabold uppercase tracking-wide px-2 py-1 rounded-full bg-slate-100 text-slate-600">{task.status || 'Waiting'}</span>
              <span className="text-[10.5px] font-extrabold uppercase tracking-wide px-2 py-1 rounded-full bg-amber-50 text-amber-700">{task.priority || 'Normal'}</span>
              <span
                className="text-[10.5px] font-extrabold uppercase tracking-wide px-2 py-1 rounded-full"
                style={{ color, background: `${color}1f` }}
              >
                {task.calendar_role === 'assigned' ? 'Assigned' : 'Support'}
              </span>
            </div>

            <div className="mt-1">
              <div className={rowCls}>
                <div className="flex-1">
                  <div className={kCls}>Giờ làm task</div>
                  <div className={vCls}>
                    {scheduledDate
                      ? `${String(scheduledDate.getHours()).padStart(2, '0')}:${String(scheduledDate.getMinutes()).padStart(2, '0')} · ${scheduledDate.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}`
                      : 'Chưa xếp lịch'}
                  </div>
                </div>
              </div>
              <div className={rowCls}>
                <div className="flex-1">
                  <div className={kCls}>Assigned</div>
                  <div className={vCls}>{task.assigned_name || '—'}</div>
                </div>
                <div className="flex-1">
                  <div className={kCls}>Support</div>
                  <div className={vCls}>{task.support_name || '—'}</div>
                </div>
              </div>
              <div className={rowCls}>
                <div className="flex-1">
                  <div className={kCls}>Manday EST</div>
                  <div className={vCls}>{task.manday_est ?? '—'}</div>
                </div>
              </div>
              <div className={rowCls}>
                <div className="flex-1">
                  <div className={kCls}>KPI Base</div>
                  <div className={vCls}>{task.kpi_base ?? 0}</div>
                </div>
                <div className="flex-1">
                  <div className={kCls}>KPI Perform</div>
                  <div className={vCls}>{task.kpi_perform ?? 0}</div>
                </div>
                <div className="flex-1">
                  <div className={kCls}>KPI Final</div>
                  <div className={vCls}>{task.kpi_final ?? 0}</div>
                </div>
              </div>
              {task.notes && (
                <div className={rowCls}>
                  <div className="flex-1">
                    <div className={kCls}>Ghi chú</div>
                    <div className="text-[12px] text-slate-600 mt-0.5 leading-relaxed">{task.notes}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-slate-200 flex flex-col gap-2 shrink-0">
            {canToggle && (
              <button
                onClick={() => onToggleDone(task)}
                className="text-[12.5px] font-bold text-white bg-[#0058be] px-4 py-2.5 rounded-lg text-center"
              >
                {isDone ? '↺ Bỏ đánh dấu hoàn thành' : '✓ Đánh dấu hoàn thành'}
              </button>
            )}
            <button
              onClick={() => router.push(`/project/detail/tasks?id=${task.project_id}`)}
              className="text-[12.5px] font-semibold text-[#0b1c30] border border-slate-200 px-4 py-2.5 rounded-lg hover:bg-slate-50"
            >
              Chỉnh sửa task trong tab Tasks
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
