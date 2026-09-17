'use client';

// "Calendar Summary", not a Calendar-only KPI engine — every number here
// reuses the same Task Management definitions already used elsewhere
// (Dashboard Overview's pmStats cards), not a new Calendar-invented rule:
//   Done      = status === 'Done' | 'done' (Overview/System Audit's exact-
//               match definition, not project/detail's broader fuzzy one).
//   Trễ hạn   = calculateDaysLate(task) > 0 — the SAME function Overview
//               uses (dashboard/constants.ts), NOT Task.days_late (that
//               column is a Done-only KPI metric, frozen null until a task
//               is marked Done — see kpi_engine.py calc_days_late).
//   Đang làm  = total - done - overdue (System Audit's residual split).
//   Tổng      = task count only, Meeting excluded (Meeting has no
//               Done/Overdue concept, doesn't fit this card set).
// Scoped to the current event-type Filter (Assigned/Support toggles) but
// NOT to the search query — searching "CRM" must not make "Tổng công
// việc" jump from 20 to 3 (spec: "search 'CRM' không làm card Tổng công
// việc nhảy ... một cách khó hiểu").
export interface CalendarSummaryStats {
  total: number;
  done: number;
  inProgress: number;
  overdue: number;
}

const CARDS: { key: keyof CalendarSummaryStats; label: string; accent: string }[] = [
  { key: 'total', label: 'Tổng công việc', accent: 'text-[#0b1c30]' },
  { key: 'done', label: 'Đã hoàn thành', accent: 'text-emerald-600' },
  { key: 'inProgress', label: 'Đang làm', accent: 'text-amber-600' },
  { key: 'overdue', label: 'Trễ hạn', accent: 'text-rose-600' },
];

export default function SummaryCards({ stats }: { stats: CalendarSummaryStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
      {CARDS.map(c => (
        <div key={c.key} className="bg-white rounded-xl border border-[#c2c6d6]/60 shadow-sm px-4 py-3">
          <div className="text-[10.5px] font-extrabold text-slate-400 uppercase tracking-wider">{c.label}</div>
          <div className={`text-2xl font-extrabold mt-1 ${c.accent}`}>{stats[c.key]}</div>
        </div>
      ))}
    </div>
  );
}
