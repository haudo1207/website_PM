'use client';

// MemberDetailModal — extracted verbatim from the Overview page's KPI Member
// Ranking drill-down (formerly overview/page.tsx lines 146–553). Behavior,
// layout, calculations and time-filter behavior are intentionally identical
// to the original implementation so existing Overview flows are unaffected.
//
// Reused by both Dashboard → Overview (KPI Member Ranking click) and
// Dashboard → Team Load (Section 4 member click).

import { useMemo, useState } from 'react';
import FormulaTooltip from '@/components/dashboard/FormulaTooltip';
import {
  MONTH_WEEKS_COUNT,
  checkTaskInPeriod,
  isTaskDoneInPeriod,
  calculateDaysLate,
} from '@/app/dashboard/constants';
import { getKpiGiaoForMember } from '@/lib/kpiPotential';

const getTaskKpiForMember = (t: any, memberId: any) => {
  const isDone = t.status === 'Done' || t.status === 'done';
  if (!isDone) return 0;
  // Strictly match Backend /api/members KPI requirement: task MUST have an actual end date
  if (!t.end_date_actual) return 0;

  const isAssigned = t.assigned_id != null && String(t.assigned_id) === String(memberId);
  const isSupport = t.support_id != null && String(t.support_id) === String(memberId);

  if (isAssigned && isSupport) {
    if (typeof t.kpi_assigned === 'number' && typeof t.kpi_support === 'number') {
      return t.kpi_assigned + t.kpi_support;
    }
    return t.kpi_final != null ? t.kpi_final : (t.kpi_base || 0);
  }
  if (isAssigned) {
    if (typeof t.kpi_assigned === 'number') return t.kpi_assigned;
    const kpiVal = t.kpi_final != null ? t.kpi_final : (t.kpi_base || 0);
    const ratio = t.kpi_ratio_assign != null ? t.kpi_ratio_assign : (t.support_id != null ? 90 : 100);
    return kpiVal * (ratio / 100);
  }
  if (isSupport) {
    if (typeof t.kpi_support === 'number') return t.kpi_support;
    const kpiVal = t.kpi_final != null ? t.kpi_final : (t.kpi_base || 0);
    const ratio = t.kpi_ratio_support != null ? t.kpi_ratio_support : 10;
    return kpiVal * (ratio / 100);
  }
  return 0;
};

export interface MemberDetailModalProps {
  member: any;
  tasks: any[];
  projects: any[];
  onClose: () => void;
  onNavigate: (projectId: string | number) => void;
  selectedYear: number | 'all';
  selectedMonth: number | 'all';
  selectedWeek: number | 'all';
  activeQuickFilter: string | null;
  onApplyQuickFilter: (type: string) => void;
  onYearChange: (v: number | 'all') => void;
  onMonthChange: (v: number | 'all') => void;
  onWeekChange: (v: number | 'all') => void;
}

export default function MemberDetailModal({
  member,
  tasks,
  projects,
  onClose,
  onNavigate,
  selectedYear,
  selectedMonth,
  selectedWeek,
  activeQuickFilter,
  onApplyQuickFilter,
  onYearChange,
  onMonthChange,
  onWeekChange,
}: MemberDetailModalProps) {
  const [taskFilter, setTaskFilter] = useState<'all' | 'overdue' | 'critical' | 'high'>('all');

  if (!member) return null;

  const rawMemberObj = member.rawMember || member;
  // Filter tasks by member AND by the selected period
  const memberAllTasks = tasks.filter(t => (t.assigned_id != null && String(t.assigned_id) === String(member.id)) || (t.support_id != null && String(t.support_id) === String(member.id)));
  const memberTasks = memberAllTasks.filter(t => checkTaskInPeriod(t, selectedYear, selectedMonth, selectedWeek, activeQuickFilter));
  const openTasks = memberTasks.filter(t => t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel');
  const doneTasks = memberTasks.filter(t => t.status === 'Done' || t.status === 'done');
  const overdueTasks = openTasks.filter(t => calculateDaysLate(t) > 0);
  const openCriticalTasks = openTasks.filter(t => (t.priority || '').toLowerCase() === 'critical');
  const criticalTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'critical');
  const highTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'high');
  const normalTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'normal');
  const interruptTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'interrupt');

  // Recompute KPI from the member's own tasks (workspace-scoped) to avoid
  // data-scope mismatch when parent uses rawTasksAll for drilled-in members.
  // This is the SAME Total KPI calculation as Section 4 of Team Load
  // (backend `system_audit.py:_aggregate_team_comparison`'s
  // `per_member_period_kpi`): Σ kpi_assigned + Σ kpi_support over the
  // member's tasks whose end_date_actual falls INSIDE the selected period.
  //
  // Deliberately uses `isTaskDoneInPeriod` here instead of `memberTasks`
  // (which is filtered by the lenient `checkTaskInPeriod` — a task whose
  // planned window merely overlaps the period, kept lenient on purpose so
  // Giao/task-count figures don't depend on completion status/date). A
  // Done task can appear in `memberTasks` via that overlap even though it
  // was actually finished in a DIFFERENT period; summing HT over
  // `memberTasks` directly would double it into every such period instead
  // of the one it actually finished in. `isTaskDoneInPeriod` re-checks
  // end_date_actual strictly against the period, matching the backend
  // exactly, so this number can't drift from Team Load's Total KPI again.
  const localKpi = useMemo(() => {
    let k = 0;
    for (const t of memberAllTasks) {
      if (isTaskDoneInPeriod(t, selectedYear, selectedMonth, selectedWeek, activeQuickFilter)) {
        k += getTaskKpiForMember(t, member.id);
      }
    }
    return Math.round(k * 10) / 10;
  }, [memberAllTasks, member.id, selectedYear, selectedMonth, selectedWeek, activeQuickFilter]);

  // KPI Giao — assigned KPI regardless of completion status (same
  // status-agnostic priority_kpi_base × manday_est formula as the
  // ranking table's "Giao" column, `@/lib/kpiPotential`). Summed over
  // `memberTasks` (the LENIENT, planned-window candidate set) on purpose:
  // unlike HT above, Giao must reflect everything assigned/due this
  // period even if it's still open, so a Leader can see how much is
  // actually on this person's plate — not just what's already finished.
  const localKpiGiao = useMemo(() => {
    let g = 0;
    for (const t of memberTasks) {
      g += getKpiGiaoForMember(t, member.id);
    }
    return Math.round(g * 10) / 10;
  }, [memberTasks, member.id]);

  const activeProjects = projects.filter(p => memberTasks.some(t => String(t.project_id) === String(p.id)));

  // Period label for the header
  const periodLabel = useMemo(() => {
    if (activeQuickFilter) return activeQuickFilter;
    if (selectedWeek !== 'all' && selectedMonth !== 'all' && selectedYear !== 'all') return `Tuần ${selectedWeek} / ${selectedMonth}/${selectedYear}`;
    if (selectedMonth !== 'all' && selectedYear !== 'all') return `Tháng ${selectedMonth}/${selectedYear}`;
    if (selectedYear !== 'all') return `Năm ${selectedYear}`;
    return 'Tất cả';
  }, [activeQuickFilter, selectedYear, selectedMonth, selectedWeek]);

  // THỜI GIAN BỘ LỌC — number of weeks the selected period represents.
  // Mirrors the backend `weeks_divisor` calculation in
  // backend/app/routers/system_audit.py:_aggregate_team_comparison.
  const filterDuration = useMemo(() => {
    if (selectedWeek !== 'all' || (activeQuickFilter && activeQuickFilter.startsWith('Tuần'))) {
      return 1;
    }
    if (typeof selectedMonth === 'number') {
      return MONTH_WEEKS_COUNT[selectedMonth] || 4;
    }
    if (typeof selectedYear === 'number') {
      return 52;
    }
    return 52;
  }, [selectedYear, selectedMonth, selectedWeek, activeQuickFilter]);

  // KPI TRUNG BÌNH = KPI TỔNG / THỜI GIAN BỘ LỌC (displayed as percentage).
  // Uses localKpi recomputed from memberTasks (workspace-scoped + period-filtered)
  // to avoid data-scope mismatch when parent uses rawTasksAll for drilled-in members.
  const kpiTrungBinhText = useMemo(() => {
    const kpi = typeof localKpi === 'number' ? localKpi : 0;
    const divisor = filterDuration > 0 ? filterDuration : 1;
    return `${(kpi / divisor).toFixed(1)}%`;
  }, [localKpi, filterDuration]);

  // GIAO TRUNG BÌNH = KPI GIAO / THỜI GIAN BỘ LỌC — same divisor as KPI
  // TRUNG BÌNH above, but based on Giao (assigned, status-agnostic)
  // instead of HT (completed-only). This is the figure that should drive
  // "quá tải" (overload) judgment: KPI TRUNG BÌNH stays at 0% until
  // something is actually marked Done, so a person already holding 3
  // tasks worth well over 100%'s worth of assigned work would still look
  // "not overloaded" by that metric alone. Mirrors the same >120%/>=90%
  // thresholds Team Load's Leader card already uses for `leader_giao_pct`.
  const giaoPct = useMemo(() => {
    const divisor = filterDuration > 0 ? filterDuration : 1;
    return localKpiGiao / divisor;
  }, [localKpiGiao, filterDuration]);
  const giaoTrungBinhText = `${giaoPct.toFixed(1)}%`;
  const giaoOverloadColor = giaoPct > 120 ? 'text-rose-600' : giaoPct >= 90 ? 'text-emerald-600' : 'text-[#0058be]';

  const totalPossible = openTasks.length + doneTasks.length;
  const workload = totalPossible > 0 ? Math.min(100, Math.round((openTasks.length / Math.max(5, totalPossible)) * 100)) : 67;

  // Skill Area / Skill breakdown — which Skill Area (skill_solution) and
  // which Skill (skill_vendor) this member's tasks in the current period
  // concentrate in the most, and how their total Manday splits across
  // Skills. Same "task count + manday per bucket, sorted desc" shape as
  // mandayByWs on the ranking table, just bucketed by Skill instead of
  // Workspace.
  const skillAreaBreakdown = useMemo(() => {
    const map: Record<string, { name: string; count: number; manday: number }> = {};
    memberTasks.forEach(t => {
      const name = t.skill_solution_name;
      if (!name) return;
      if (!map[name]) map[name] = { name, count: 0, manday: 0 };
      map[name].count++;
      map[name].manday += (t.manday_actual || t.manday_est || 0);
    });
    return Object.values(map).sort((a, b) => b.manday - a.manday);
  }, [memberTasks]);

  const skillBreakdown = useMemo(() => {
    const map: Record<string, { name: string; count: number; manday: number }> = {};
    memberTasks.forEach(t => {
      const name = t.skill_vendor_name;
      if (!name) return;
      if (!map[name]) map[name] = { name, count: 0, manday: 0 };
      map[name].count++;
      map[name].manday += (t.manday_actual || t.manday_est || 0);
    });
    return Object.values(map).sort((a, b) => b.manday - a.manday);
  }, [memberTasks]);

  const filteredTasks = memberTasks.filter(t => {
    if (taskFilter === 'overdue') return (t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel') && calculateDaysLate(t) > 0;
    if (taskFilter === 'critical') return (t.priority || '').toLowerCase() === 'critical';
    if (taskFilter === 'high') return (t.priority || '').toLowerCase() === 'high';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* BACKDROP */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
      />

      {/* RIGHT SIDE DRAWER PANEL (FLUSH TOP TO BOTTOM) */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white h-full shadow-2xl overflow-y-auto custom-scrollbar flex flex-col border-l border-slate-200">

        {/* HEADER */}
        <div className="sticky top-0 z-20 bg-white px-6 py-4 border-b border-slate-100 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#0058be] text-white flex items-center justify-center font-black text-lg shadow-sm shrink-0">
              {member.name ? member.name.charAt(0).toUpperCase() : 'M'}
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-[#0b1c30] tracking-tight">{member.name}</h2>
              <p className="text-xs font-semibold text-slate-400 mt-0.5">
                {(rawMemberObj.team || rawMemberObj.department || 'INFRA').toUpperCase()} · {rawMemberObj.leader_name || 'Khác'} · {periodLabel}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors flex items-center justify-center font-bold text-sm cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>

        {/* DRAWER BODY CONTENT */}
        <div className="p-6 space-y-6 flex-1">

          {/* 1. TOP METRIC SUMMARY (6 CARDS IN A ROW) */}
          <div className="grid grid-cols-6 gap-2">
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0b1c30] leading-none">{activeProjects.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Dự án active</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0b1c30] leading-none">{openTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Task mở</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0b1c30] leading-none">{criticalTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Critical</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-red-600 leading-none">{overdueTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Trễ</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0058be] leading-none">{kpiTrungBinhText}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5 flex items-center justify-center gap-0.5">
                KPI TRUNG BÌNH
                <FormulaTooltip align="right">
                  <p className="font-bold text-white/90 mb-1">KPI trung bình</p>
                  <p className="text-white/80 mb-1">Công thức:</p>
                  <p className="text-white font-mono">KPI TRUNG BÌNH = KPI TỔNG ÷ THỜI GIAN BỘ LỌC</p>
                  <p className="text-white/60 mt-1.5">Trong đó:</p>
                  <ul className="text-white/70 list-disc ml-3 mt-0.5 space-y-0.5">
                    <li><b>KPI TỔNG:</b> Tổng KPI từ các task đã hoàn thành (Done) trong kỳ lọc, tính theo kpi_assigned + kpi_support</li>
                    <li><b>THỜI GIAN BỘ LỌC:</b> Số tuần của kỳ lọc — Tuần = 1, Tháng = 4–5 (tùy lịch tài chính), Năm = 52</li>
                  </ul>
                  <p className="text-white/50 mt-1.5">Ví dụ: KPI tổng = 574.1, lọc Tuần 1 → 574.1 ÷ 1 = 574.1%</p>
                </FormulaTooltip>
              </span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0058be] leading-none">{localKpi.toFixed(1)}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5 flex items-center justify-center gap-0.5">
                Total KPI
                <FormulaTooltip align="right">
                  <p className="font-bold text-white/90 mb-1">Total KPI</p>
                  <p className="text-white/80 mb-1">Công thức (đã được Portal tính sẵn):</p>
                  <p className="text-white font-mono">Total KPI = Σ kpi_assigned + Σ kpi_support</p>
                  <p className="text-white/60 mt-1.5">Trong đó:</p>
                  <ul className="text-white/70 list-disc ml-3 mt-0.5 space-y-0.5">
                    <li><b>kpi_assigned / kpi_support:</b> Tính từ <code>utils/kpi_engine.py</code> cho từng task <b>Done</b> (Cancel = 0). Task chưa hoàn thành không mang giá trị, nên tổng này thực tế là KPI của task Done trong kỳ lọc.</li>
                    <li><b>Phạm vi:</b> Task của Member trong Workspace + kỳ lọc (Tuần/Tháng/Năm) hiện tại.</li>
                  </ul>
                  <p className="text-white/50 mt-1.5">Đây là cùng giá trị được Portal tính trong Section 4 của Team Load; không có phép tính thứ hai ở UI.</p>
                </FormulaTooltip>
              </span>
            </div>
          </div>

          {/* 1a. KPI GIAO (assigned, status-agnostic) — separate from HT
              above on purpose. Powers workload/overload judgment: unlike
              KPI TRUNG BÌNH (0% until something is Done), Giao reflects
              everything currently assigned regardless of status, so it
              can flag a person as loaded/overloaded even before they've
              finished anything this period. */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className={`text-lg font-black leading-none ${giaoOverloadColor}`}>{giaoTrungBinhText}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5 flex items-center justify-center gap-0.5">
                GIAO TRUNG BÌNH
                <FormulaTooltip align="right">
                  <p className="font-bold text-white/90 mb-1">Giao trung bình</p>
                  <p className="text-white/80 mb-1">Công thức:</p>
                  <p className="text-white font-mono">GIAO TRUNG BÌNH = KPI GIAO ÷ THỜI GIAN BỘ LỌC</p>
                  <p className="text-white/60 mt-1.5">Khác với KPI TRUNG BÌNH (chỉ tính task Done), chỉ số này tính TOÀN BỘ task được giao — kể cả đang làm/chưa Done — nên phản ánh đúng khối lượng đang ôm, dùng để đánh giá quá tải. Ngưỡng: <b className="text-rose-300">&gt;120% = quá tải</b>, <b className="text-emerald-300">&ge;90% = tốt</b>.</p>
                </FormulaTooltip>
              </span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0058be] leading-none">{localKpiGiao.toFixed(1)}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5 flex items-center justify-center gap-0.5">
                KPI Giao
                <FormulaTooltip align="right">
                  <p className="font-bold text-white/90 mb-1">KPI Giao</p>
                  <p className="text-white/80 mb-1">Công thức:</p>
                  <p className="text-white font-mono">KPI Giao = Σ (priority_kpi_base × manday_est)</p>
                  <p className="text-white/60 mt-1.5">Tính cho MỌI task được giao trong kỳ, bất kể trạng thái (Done/Doing/chưa làm) — không giống Total KPI (chỉ tính task Done).</p>
                </FormulaTooltip>
              </span>
            </div>
          </div>

          {/* 1b. TIME FILTER (synced with Dashboard Overview) */}
          <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <span className="text-[10px] font-bold text-slate-500">Kỳ:</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400">Năm:</span>
              <select value={selectedYear} onChange={e => onYearChange(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="bg-transparent border-none text-[#0058be] font-bold text-[11px] focus:outline-none cursor-pointer">
                <option value="all">Tất cả</option>
                {[...Array(5)].map((_, i) => <option key={i} value={new Date().getFullYear() - 2 + i}>{new Date().getFullYear() - 2 + i}</option>)}
              </select>
            </div>
            <div className="w-px h-3 bg-slate-200"></div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400">Tháng:</span>
              <select value={selectedMonth} onChange={e => onMonthChange(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="bg-transparent border-none text-[#0058be] font-bold text-[11px] focus:outline-none cursor-pointer">
                <option value="all">Tất cả</option>
                {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
            </div>
            <div className="w-px h-3 bg-slate-200"></div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400">Tuần:</span>
              <select value={selectedWeek} onChange={e => onWeekChange(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="bg-transparent border-none text-[#0058be] font-bold text-[11px] focus:outline-none cursor-pointer">
                <option value="all">Tất cả</option>
                {[...Array(5)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
            </div>
            <div className="w-px h-3 bg-slate-200"></div>
            <div className="flex flex-wrap items-center gap-1">
              {['Tuần trước', 'Tuần này', 'Tuần tới', 'Tháng trước', 'Tháng này', 'Tháng tới'].map(label => (
                <button key={label} onClick={() => onApplyQuickFilter(label)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${activeQuickFilter === label ? 'bg-[#0058be] text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. CẢNH BÁO ĐIỀU PHỐI (3 BOXES) */}
          <div>
            <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-3">Cảnh báo điều phối</h3>
            <div className="grid grid-cols-3 gap-3">
              {/* Task trễ */}
              <div className="bg-red-50/40 border border-red-100 rounded-2xl p-4 flex flex-col justify-between min-h-[100px]">
                <div>
                  <span className="text-[9px] font-extrabold text-red-400 uppercase tracking-wider">Task trễ</span>
                  <p className="text-2xl font-black text-red-600 mt-1">{overdueTasks.length}</p>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight mt-3">Task cần leader follow-up hoặc xử lý blocker.</p>
              </div>

              {/* Critical mở */}
              <div className="bg-amber-50/40 border border-amber-100 rounded-2xl p-4 flex flex-col justify-between min-h-[100px]">
                <div>
                  <span className="text-[9px] font-extrabold text-amber-500 uppercase tracking-wider">Critical mở</span>
                  <p className="text-2xl font-black text-amber-700 mt-1">{openCriticalTasks.length}</p>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight mt-3">Task ưu tiên cao, ảnh hưởng trực tiếp tiến độ dự án.</p>
              </div>

              {/* Tải công việc */}
              <div className="bg-blue-50/40 border border-blue-100 rounded-2xl p-4 flex flex-col justify-between min-h-[100px]">
                <div>
                  <span className="text-[9px] font-extrabold text-blue-500 uppercase tracking-wider flex items-center gap-1">
                    Tải công việc
                    <FormulaTooltip align="left">
                      <p className="font-bold text-white/90 mb-1">Tải công việc</p>
                      <p className="text-white/80 mb-1">Công thức:</p>
                      <p className="text-white font-mono">Tải = min(100, round((Task mở ÷ max(5, Tổng task)) × 100))</p>
                      <p className="text-white/60 mt-1.5">Trong đó:</p>
                      <ul className="text-white/70 list-disc ml-3 mt-0.5 space-y-0.5">
                        <li><b>Task mở:</b> Số task chưa hoàn thành (không Done/Hủy) trong kỳ lọc</li>
                        <li><b>Tổng task:</b> Task mở + Task đã hoàn thành trong kỳ</li>
                        <li><b>max(5, Tổng task):</b> Nếu tổng task {"<"} 5, dùng 5 làm mẫu số (tránh % quá cao khi ít task)</li>
                      </ul>
                      <p className="text-white/50 mt-1.5">Nếu không có task → mặc định 67%. Kết quả capped ở 100%.</p>
                    </FormulaTooltip>
                  </span>
                  <p className="text-2xl font-black text-[#0058be] mt-1">{workload}%</p>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight mt-3">Tải trung bình — có thể nhận thêm task nếu ưu tiên rõ.</p>
              </div>
            </div>
          </div>

          {/* 3. PHÂN BỔ PRIORITY (4 PILLS) */}
          <div>
            <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-3">Phân bổ priority</h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-purple-50/80 border border-purple-100 rounded-xl p-3 text-center">
                <span className="text-base font-black text-purple-700 block">{criticalTasks.length}</span>
                <span className="text-[9px] font-extrabold text-purple-600 uppercase tracking-wider mt-0.5 block">CRITICAL</span>
              </div>
              <div className="bg-orange-50/80 border border-orange-100 rounded-xl p-3 text-center">
                <span className="text-base font-black text-orange-700 block">{highTasks.length}</span>
                <span className="text-[9px] font-extrabold text-orange-600 uppercase tracking-wider mt-0.5 block">HIGH</span>
              </div>
              <div className="bg-blue-50/80 border border-blue-100 rounded-xl p-3 text-center">
                <span className="text-base font-black text-blue-700 block">{normalTasks.length}</span>
                <span className="text-[9px] font-extrabold text-blue-600 uppercase tracking-wider mt-0.5 block">NORMAL</span>
              </div>
              <div className="bg-slate-100/80 border border-slate-200/80 rounded-xl p-3 text-center">
                <span className="text-base font-black text-slate-700 block">{interruptTasks.length}</span>
                <span className="text-[9px] font-extrabold text-slate-600 uppercase tracking-wider mt-0.5 block">INTERRUPT</span>
              </div>
            </div>
          </div>

          {/* 3b. PHÂN BỔ THEO SKILL AREA / SKILL — Skill Area/Skill làm nhiều
              nhất và Manday tổng chia theo từng Skill, trong đúng kỳ đang xem. */}
          {(skillAreaBreakdown.length > 0 || skillBreakdown.length > 0) && (
            <div>
              <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-3">Phân bổ theo Skill Area / Skill</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-500 uppercase">Skill Area</span>
                    {skillAreaBreakdown[0] && (
                      <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Nhiều nhất: {skillAreaBreakdown[0].name}</span>
                    )}
                  </div>
                  <div className="max-h-[160px] overflow-y-auto custom-scrollbar">
                    {skillAreaBreakdown.length === 0 ? (
                      <p className="text-[11px] text-slate-400 font-semibold text-center py-3">Không có task nào gán Skill Area trong kỳ.</p>
                    ) : (
                      skillAreaBreakdown.map((s, idx) => (
                        <div key={idx} className="flex items-center justify-between px-3 py-1.5 text-[11px] border-t border-slate-100 first:border-t-0">
                          <span className="font-bold text-slate-700 truncate">{s.name}</span>
                          <span className="text-slate-400 font-semibold shrink-0 ml-2">{s.count} task · <span className="text-amber-600">{s.manday.toFixed(1)} MD</span></span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-500 uppercase">Skill</span>
                    {skillBreakdown[0] && (
                      <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Nhiều nhất: {skillBreakdown[0].name}</span>
                    )}
                  </div>
                  <div className="max-h-[160px] overflow-y-auto custom-scrollbar">
                    {skillBreakdown.length === 0 ? (
                      <p className="text-[11px] text-slate-400 font-semibold text-center py-3">Không có task nào gán Skill trong kỳ.</p>
                    ) : (
                      skillBreakdown.map((s, idx) => (
                        <div key={idx} className="flex items-center justify-between px-3 py-1.5 text-[11px] border-t border-slate-100 first:border-t-0">
                          <span className="font-bold text-slate-700 truncate">{s.name}</span>
                          <span className="text-slate-400 font-semibold shrink-0 ml-2">{s.count} task · <span className="text-amber-600">{s.manday.toFixed(1)} MD</span></span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. DỰ ÁN ĐANG THAM GIA */}
          <div>
            <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-3">Dự án đang tham gia</h3>
            <div className="space-y-3">
              {activeProjects.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center text-xs font-semibold text-slate-400">
                  Chưa có dự án nào đang tham gia.
                </div>
              ) : (
                activeProjects.map(p => {
                  const pTasks = memberTasks.filter(t => String(t.project_id) === String(p.id));
                  const pOpen = pTasks.filter(t => t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel').length;
                  const pCritical = pTasks.filter(t => (t.priority || '').toLowerCase() === 'critical').length;
                  const nextTask = pTasks.find(t => t.end_date_est || t.created_at);
                  const deadlineStr = nextTask ? (nextTask.end_date_est || '11/08').split('-').reverse().slice(0, 2).join('/') : '11/08';
                  const pManday = pTasks.reduce((acc, t) => acc + (t.manday_actual || t.manday_est || 0), 0);
                  const pKpi = pTasks.reduce((acc, t) => acc + (t.status === 'Done' || t.status === 'done' ? getTaskKpiForMember(t, member.id) : 0), 0);

                  return (
                    <div
                      key={p.id}
                      onClick={() => { onClose(); onNavigate(p.id); }}
                      className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-3 cursor-pointer hover:border-[#0058be] hover:shadow-md transition-all active:scale-[0.99]"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-extrabold text-[#0b1c30] hover:text-[#0058be] transition-colors">{p.name}</h4>
                        <span className="px-2.5 py-0.5 bg-blue-50 text-[#0058be] rounded-full text-[10px] font-bold border border-blue-100">
                          {pOpen} task mở
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-[#0b1c30] block">{pOpen}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">TASK MỜ</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-[#0b1c30] block">{pCritical}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">CRITICAL</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-[#0b1c30] block">{deadlineStr}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">DEADLINE</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-amber-600 block">{pManday.toFixed(1)}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">MANDAY</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-[#0058be] block">{pKpi.toFixed(1)}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">KPI</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-[#0058be] font-bold text-right">Xem dự án ➔</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 5. TASK TRONG KỲ ĐANG XEM */}
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
              <div>
                <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider">Task trong kỳ đang xem</h3>
                <p className="text-[10px] text-slate-400 font-medium">Sắp xếp: Deadline gần nhất → Critical → High → Normal → Interrupt</p>
              </div>
              <div className="flex gap-1">
                {(['all', 'overdue', 'critical', 'high'] as const).map(filter => (
                  <button
                    key={filter}
                    onClick={() => setTaskFilter(filter)}
                    className={`px-3 py-1 rounded-full text-[10px] font-extrabold transition-all cursor-pointer ${taskFilter === filter
                        ? 'bg-[#0058be] text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                  >
                    {filter === 'all' ? 'Tất cả' : filter === 'overdue' ? 'Trễ' : filter === 'critical' ? 'Critical' : 'High'}
                  </button>
                ))}
              </div>
            </div>

            <div className="border border-slate-200 rounded-2xl bg-white shadow-sm max-h-[380px] overflow-auto custom-scrollbar">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="text-slate-400 uppercase text-[9px] font-extrabold tracking-wider">
                    <th className="px-4 py-2.5 text-left bg-slate-50 text-slate-500 sticky top-0 z-20 border-b border-slate-200">TASK</th>
                    <th className="px-4 py-2.5 text-left bg-slate-50 text-slate-500 sticky top-0 z-20 border-b border-slate-200">DỰ ÁN</th>
                    <th className="px-4 py-2.5 text-center bg-slate-50 text-slate-500 sticky top-0 z-20 border-b border-slate-200">PRIORITY</th>
                    <th className="px-4 py-2.5 text-center bg-slate-50 text-slate-500 sticky top-0 z-20 border-b border-slate-200">DEADLINE</th>
                    <th className="px-4 py-2.5 text-center bg-slate-50 text-slate-500 sticky top-0 z-20 border-b border-slate-200">TRẠNG THÁI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-xs text-slate-400 font-semibold">
                        Không có task nào.
                      </td>
                    </tr>
                  ) : (
                    filteredTasks.map((t: any) => {
                      const prio = (t.priority || 'normal').toUpperCase();
                      const isDone = t.status === 'Done' || t.status === 'done';
                      const dlStr = t.end_date_est ? t.end_date_est.split('-').reverse().slice(0, 2).join('/') : '11/08';

                      return (
                        <tr key={t.id} onClick={() => { const proj = projects.find((p: any) => String(p.id) === String(t.project_id)); if (proj) { onClose(); onNavigate(proj.id); } }} className="hover:bg-slate-50/80 transition-colors cursor-pointer">
                          <td className="px-4 py-3">
                            <p className="font-bold text-[#0b1c30] text-xs">{t.name}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Task đang được triển khai trong kỳ.</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600 font-medium text-xs">
                            {t.projectName || t.project_name || 'Dự án Timetech'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase ${prio === 'CRITICAL' ? 'bg-purple-100 text-purple-700' :
                                prio === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                  prio === 'INTERRUPT' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                              {prio}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-slate-700 text-xs">
                            {dlStr}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isDone ? 'bg-emerald-50 text-emerald-600' : 'bg-emerald-50 text-emerald-600'
                              }`}>
                              {isDone ? 'Đã xong' : 'Đang làm'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}