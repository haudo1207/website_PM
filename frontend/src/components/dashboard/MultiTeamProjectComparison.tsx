'use client';

// Multi-Team Project Comparison — relocated verbatim from System Audit
// Section 3 ("So sánh Project theo nhiều Team"). All business logic, formulas,
// data flow, and UI behavior are intentionally identical to the original
// implementation in `frontend/src/app/dashboard/system-audit/page.tsx`
// (lines 632–834 of the pre-move codebase).
//
// The component reuses the shared Workspace filter via `useWorkspaceFilter()`
// (same provider mounted at app root that System Audit already uses) so the
// workspace scope is synchronized with the rest of the Dashboard without
// introducing a second independent filter.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getMondayToSundayRange, getWeekOfMonth, CYCLE_TEMPLATE, projectStatusBadge, projectBarColor } from '@/app/dashboard/constants';
import { getTeamComparison, getTeamDetail, getWorkspaces, TeamComparisonProject, TeamComparisonTeam, TeamComparisonMember, TeamComparisonResponse, WorkloadSetting } from '@/lib/api';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';
import SvgIcon from '@/components/dashboard/Icons';
import ProgressBar from '@/components/dashboard/ProgressBar';

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function MultiTeamProjectComparison() {
  // ── Time-range filter (independent state for this tab — matches the same
  //    default seed System Audit uses, "Tuần này", so the comparison window
  //    opens at the current week).
  const initialNow = new Date();
  const [selectedYear, setSelectedYear] = useState<number | 'all'>(initialNow.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>(initialNow.getMonth() + 1);
  const [selectedWeek, setSelectedWeek] = useState<number | 'all'>(getWeekOfMonth(initialNow));
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>('Tuần này');

  // Mirror Overview's `applyQuickFilter` shortcut — keeps the dashboard
  // sections speaking the same vocabulary as Overview / System Audit.
  const applyQuickFilter = (type: string) => {
    setActiveQuickFilter(type);
    const now = new Date();
    if (type === 'Tuần trước') {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setSelectedYear(d.getFullYear()); setSelectedMonth(d.getMonth() + 1); setSelectedWeek(getWeekOfMonth(d));
    } else if (type === 'Tuần này') {
      setSelectedYear(now.getFullYear()); setSelectedMonth(now.getMonth() + 1); setSelectedWeek(getWeekOfMonth(now));
    } else if (type === 'Tuần tới') {
      const d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      setSelectedYear(d.getFullYear()); setSelectedMonth(d.getMonth() + 1); setSelectedWeek(getWeekOfMonth(d));
    } else if (type === 'Tháng trước') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      setSelectedYear(d.getFullYear()); setSelectedMonth(d.getMonth() + 1); setSelectedWeek('all');
    } else if (type === 'Tháng này') {
      setSelectedYear(now.getFullYear()); setSelectedMonth(now.getMonth() + 1); setSelectedWeek('all');
    } else if (type === 'Tháng tới') {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      setSelectedYear(d.getFullYear()); setSelectedMonth(d.getMonth() + 1); setSelectedWeek('all');
    }
  };

  // ── Workspace filter — reuse the SAME shared provider the rest of the
  //    Dashboard uses. No second independent filter.
  const { workspaceCode: sharedWorkspaceCode } = useWorkspaceFilter();
  const teamWsParam = sharedWorkspaceCode && sharedWorkspaceCode !== 'all'
    ? sharedWorkspaceCode
    : undefined;
  const { data: workspacesData } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => getWorkspaces(),
    staleTime: 5 * 60_000,
  });
  const currentWsLabel = useMemo(() => {
    if (!sharedWorkspaceCode || sharedWorkspaceCode === 'all') return 'All Workspaces';
    const w = (workspacesData || []).find((x: any) => x.code === sharedWorkspaceCode);
    return w?.name || sharedWorkspaceCode;
  }, [sharedWorkspaceCode, workspacesData]);

  // ── Time-range window — identical derivation as System Audit Sections 2/3/4.
  const timeWindow = useMemo(() => {
    if (activeQuickFilter === 'Tuần này') {
      const r = getMondayToSundayRange(new Date());
      return { start_date: formatYMD(r.monday), end_date: formatYMD(r.sunday) };
    }
    if (activeQuickFilter === 'Tuần trước') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      const r = getMondayToSundayRange(d);
      return { start_date: formatYMD(r.monday), end_date: formatYMD(r.sunday) };
    }
    if (activeQuickFilter === 'Tuần tới') {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      const r = getMondayToSundayRange(d);
      return { start_date: formatYMD(r.monday), end_date: formatYMD(r.sunday) };
    }
    if (typeof selectedMonth === 'number') {
      const cycle = CYCLE_TEMPLATE[selectedMonth];
      const yr = typeof selectedYear === 'number' ? selectedYear : new Date().getFullYear();
      if (cycle) {
        const s = new Date(`${yr + cycle.startYo}-${cycle.startMd}T00:00:00`);
        const e = new Date(`${yr + cycle.endYo}-${cycle.endMd}T23:59:59`);
        return { start_date: formatYMD(s), end_date: formatYMD(e) };
      }
      const s = new Date(yr, selectedMonth - 1, 1);
      const e = new Date(yr, selectedMonth, 0);
      return { start_date: formatYMD(s), end_date: formatYMD(e) };
    }
    if (typeof selectedYear === 'number') {
      return {
        start_date: `${selectedYear}-01-01`,
        end_date: `${selectedYear}-12-31`,
      };
    }
    return {} as { start_date?: string; end_date?: string };
  }, [selectedYear, selectedMonth, activeQuickFilter]);

  // ── Backend query — same endpoint, same shape as the System Audit Section 2/3/4 use.
  const {
    data: teamComparison,
    isFetching: teamComparisonLoading,
    refetch: refetchTeamComparison,
  } = useQuery<TeamComparisonResponse>({
    queryKey: ['system-audit-team-comparison', teamWsParam || 'all', timeWindow.start_date || '', timeWindow.end_date || ''],
    queryFn: () => getTeamComparison({
      workspace: teamWsParam,
      start_date: timeWindow.start_date,
      end_date: timeWindow.end_date,
    }),
    staleTime: 60_000,
  });
  const teamComparisonData: TeamComparisonResponse | null = teamComparison || null;
  const teamsList: TeamComparisonTeam[] = teamComparisonData?.teams || [];
  const weeksDivisor: number = teamComparisonData?.weeks_divisor || 52;
  const workloadSettings: WorkloadSetting[] = teamComparisonData?.workload_settings || [];

  // ── Multi-Leader selection state (relocated from System Audit) ─────────
  const [selectedLeaderIds, setSelectedLeaderIds] = useState<number[]>([]);
  const [appliedLeaderIds, setAppliedLeaderIds] = useState<number[]>([]);
  // Reset selection when the underlying eligible-Leader set changes
  // (workspace switch / fresh data load) so we never keep a Leader that's
  // no longer eligible.
  useEffect(() => {
    const eligible = new Set(teamsList.map(t => t.leader_user_id));
    setSelectedLeaderIds(prev => prev.filter(id => eligible.has(id)));
    setAppliedLeaderIds(prev => prev.filter(id => eligible.has(id)));
  }, [teamsList]);

  // Health badges — identical to the System Audit helpers, kept local so this
  // component is self-contained.
  const healthBadge = (h: string) => {
    const x = (h || '').toLowerCase();
    if (x === 'critical') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (x === 'risk') return 'bg-amber-100 text-amber-800 border-amber-200';
    if (x === 'on track') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    return 'bg-slate-100 text-slate-600 border-slate-200';
  };
  const healthLabel = (h: string) => {
    const x = (h || '').toLowerCase();
    if (x === 'critical') return '🛑 Critical';
    if (x === 'risk') return '⚠️ Risk';
    if (x === 'on track') return '🟢 On Track';
    return h || '—';
  };

  // Detail drawer (Section 2 — "Chi tiết")
  const [detailTeam, setDetailTeam] = useState<TeamComparisonTeam | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const openTeamDetail = useCallback(async (leaderUserId: number) => {
    setDetailLoading(true);
    try {
      const res = await getTeamDetail(leaderUserId, {
        start_date: timeWindow.start_date,
        end_date: timeWindow.end_date,
      });
      setDetailTeam(res.team);
    } catch (err) {
      console.error('Failed to load team detail', err);
      setDetailTeam(null);
    } finally {
      setDetailLoading(false);
    }
  }, [timeWindow.start_date, timeWindow.end_date]);
  const closeTeamDetail = useCallback(() => setDetailTeam(null), []);

  // Section 4 helpers — member workload classification (KPI%-based)
  // KPI% = period_kpi / weeks_divisor. 100 KPI points per fiscal week = 100%.
  const memberKpiPct = (m: TeamComparisonMember): number => {
    return m.kpi_pct ?? 0;
  };

  // Classify using workload_settings from backend, with hardcoded fallback
  const classifyKpiPct = (pct: number): 'overload' | 'normal' | 'capacity' | 'not_working' => {
    if (workloadSettings.length === 4) {
      // Use backend thresholds — sorted by sort_order
      const sorted = [...workloadSettings].sort((a, b) => (a.min_kpi ?? 0) - (b.min_kpi ?? 0));
      for (const ws of sorted) {
        const lo = ws.min_kpi ?? -Infinity;
        const hi = ws.max_kpi ?? Infinity;
        if (pct >= lo && pct <= hi) {
          return ws.status_key as 'overload' | 'normal' | 'capacity' | 'not_working';
        }
      }
    }
    // Fallback: hardcoded default thresholds
    if (pct > 120) return 'overload';
    if (pct >= 90) return 'normal';
    if (pct >= 50) return 'capacity';
    return 'not_working';
  };

  const memberStatus = (m: TeamComparisonMember): 'overload' | 'normal' | 'capacity' | 'not_working' => {
    return classifyKpiPct(memberKpiPct(m));
  };

  // Leader's individual workload status (from own tasks, NOT team aggregate)
  const leaderStatus = (t: TeamComparisonTeam): 'overload' | 'normal' | 'capacity' | 'not_working' => {
    return classifyKpiPct(t.leader_kpi_pct ?? 0);
  };

  const STATUS_RANK: Record<string, number> = {
    overload: 0,
    normal: 1,
    capacity: 2,
    not_working: 3,
  };
  const memberSortComparator = (a: TeamComparisonMember, b: TeamComparisonMember): number => {
    const sa = memberStatus(a);
    const sb = memberStatus(b);
    if (sa !== sb) return (STATUS_RANK[sa] ?? 9) - (STATUS_RANK[sb] ?? 9);
    return memberKpiPct(b) - memberKpiPct(a);
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header — page title + time filter (kept identical to System Audit so
          the Super Admin sees the same vocabulary and shortcut chips). */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Team Load · Super Admin</h3>
          {teamComparisonLoading && <span className="text-[10px] text-blue-600 font-semibold animate-pulse">Đang cập nhật dữ liệu…</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 hidden sm:block">Bộ lọc thời gian:</span>
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm text-[11px] font-bold">
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Năm:</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="bg-transparent border-none text-[#0058be] font-bold focus:outline-none cursor-pointer"
                >
                  <option value="all">Tất cả</option>
                  {[...Array(5)].map((_, i) => <option key={i} value={new Date().getFullYear() - 2 + i}>{new Date().getFullYear() - 2 + i}</option>)}
                </select>
              </div>
              <div className="w-px h-4 bg-slate-200 self-center"></div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Tháng:</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="bg-transparent border-none text-[#0058be] font-bold focus:outline-none cursor-pointer"
                >
                  <option value="all">Tất cả</option>
                  {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                </select>
              </div>
              <div className="w-px h-4 bg-slate-200 self-center"></div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Tuần:</span>
                <select
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="bg-transparent border-none text-[#0058be] font-bold focus:outline-none cursor-pointer"
                >
                  <option value="all">Tất cả</option>
                  {[...Array(5)].map((_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto">
            {['Tuần trước', 'Tuần này', 'Tuần tới', 'Tháng trước', 'Tháng này', 'Tháng tới'].map(label => (
              <button
                key={label}
                onClick={() => applyQuickFilter(label)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap shadow-sm active:scale-95 ${activeQuickFilter === label
                    ? 'bg-[#0058be] text-white border border-[#0058be] shadow-md font-black'
                    : 'bg-white border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 text-slate-600'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={() => refetchTeamComparison()}
            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm text-[11px] font-bold transition-all active:scale-95 cursor-pointer"
          >
            <SvgIcon name="refresh" className={`w-3.5 h-3.5 ${teamComparisonLoading ? 'animate-spin text-[#0058be]' : 'text-slate-500'}`} />
            LÀM MỚI
          </button>
        </div>
      </div>

      {/* ── SECTION 2: So sánh Team trong Workspace ────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SvgIcon name="project" className="w-4 h-4 text-[#0058be]" />
            <div>
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">
                2. So sánh Team trong Workspace
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                So sánh KPI, Manday, Utilization, hiệu suất và sức khỏe team từ các Leader — Workspace hiện tại: <strong className="text-[#0058be]">{currentWsLabel}</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-semibold">
            {teamComparisonLoading && (
              <span className="text-blue-600 animate-pulse">Đang tải dữ liệu team…</span>
            )}
            <button
              onClick={() => refetchTeamComparison()}
              className="flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-50 rounded-md shadow-sm"
            >
              <SvgIcon name="refresh" className={`w-3 h-3 ${teamComparisonLoading ? 'animate-spin text-[#0058be]' : 'text-slate-500'}`} />
              <span className="font-bold">Refresh</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#eff4ff]/50 text-slate-500 border-b border-[#c2c6d6]/60 uppercase text-[10px] tracking-wider">
                <th className="px-4 py-3 text-left font-bold">Leader / Team</th>
                <th className="px-3 py-3 text-right font-bold">KPI</th>
                <th className="px-3 py-3 text-right font-bold">Plan MD</th>
                <th className="px-3 py-3 text-right font-bold">Actual MD</th>
                <th className="px-3 py-3 text-right font-bold">Util.</th>
                <th className="px-3 py-3 text-right font-bold">Efficiency</th>
                <th className="px-3 py-3 text-right font-bold">On-time</th>
                <th className="px-3 py-3 text-right font-bold">Trễ</th>
                <th className="px-3 py-3 text-center font-bold">Health</th>
                <th className="px-3 py-3 text-center font-bold">Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {!teamComparisonLoading && teamsList.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-slate-400 font-semibold">
                    Workspace hiện tại chưa có Leader nào có thành viên được quản lý.
                  </td>
                </tr>
              ) : teamComparisonLoading ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-slate-400 font-semibold">
                    Đang tải dữ liệu team…
                  </td>
                </tr>
              ) : (
                teamsList.map(t => (
                  <tr key={t.leader_user_id} className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-bold text-[#0b1c30]">{t.leader_name}</span>
                        <span className="text-[10px] text-slate-500 mt-0.5">
                          {t.leader_name} • {t.member_count} thành viên
                        </span>
                        <span className="text-[9px] text-slate-400 mt-0.5 uppercase tracking-wider">
                          Workspace: {t.workspace}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-extrabold text-[#0058be]">{t.kpi.toFixed(1)}</td>
                    <td className="px-3 py-3 text-right font-mono text-slate-700">{t.plan_md.toFixed(1)}</td>
                    <td className="px-3 py-3 text-right font-mono text-slate-700">{t.actual_md.toFixed(1)}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={`font-bold ${t.util >= 100 ? 'text-rose-600' : t.util >= 80 ? 'text-emerald-600' : 'text-slate-600'}`}>
                        {t.util.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-bold text-slate-700">{t.efficiency.toFixed(1)}%</td>
                    <td className="px-3 py-3 text-right font-bold text-emerald-600">{t.on_time}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={`font-bold ${t.overdue > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{t.overdue}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${healthBadge(t.health)}`}>
                        {healthLabel(t.health)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        onClick={() => openTeamDetail(t.leader_user_id)}
                        className="text-[10px] font-bold text-[#0058be] hover:bg-[#eff4ff] px-2.5 py-1 rounded-md transition-colors"
                      >
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3 — moved here verbatim from System Audit */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SvgIcon name="chart" className="w-4 h-4 text-purple-600" />
            <div>
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">
                3. So sánh Project theo nhiều Team
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Chọn nhiều Leader để so sánh các Project đang được team phụ trách — Workspace hiện tại: <strong className="text-[#0058be]">{currentWsLabel}</strong>
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-b border-slate-100 bg-[#f8fafc] space-y-3">
          {teamsList.length === 0 ? (
            <p className="text-xs text-slate-400 italic text-center py-2">
              Chưa có Leader đủ điều kiện trong Workspace hiện tại.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {teamsList.map(t => {
                  const checked = selectedLeaderIds.includes(t.leader_user_id);
                  const projectCount = t.projects?.length || 0;
                  return (
                    <button
                      key={t.leader_user_id}
                      onClick={() => {
                        setSelectedLeaderIds(prev => checked
                          ? prev.filter(id => id !== t.leader_user_id)
                          : [...prev, t.leader_user_id]);
                      }}
                      className={`flex items-center gap-2 text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                        checked
                          ? 'bg-[#0058be] text-white border-[#0058be] shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-[#0058be]/40 hover:text-[#0058be]'
                      }`}
                    >
                      <span className={`flex items-center justify-center w-4 h-4 rounded border ${checked ? 'bg-white border-white' : 'bg-white border-slate-300'}`}>
                        {checked && <span className="material-symbols-outlined text-[12px] text-[#0058be] font-black">check</span>}
                      </span>
                      <span className="truncate max-w-[160px]">{t.leader_name}</span>
                      <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${checked ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {projectCount} project
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                  <span>Đã chọn: <strong className="text-[#0058be]">{selectedLeaderIds.length}</strong> / {teamsList.length} team</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedLeaderIds(teamsList.map(t => t.leader_user_id))}
                    className="text-[11px] font-bold text-[#0058be] hover:bg-[#eff4ff] px-3 py-1.5 rounded-md transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => { setSelectedLeaderIds([]); setAppliedLeaderIds([]); }}
                    className="text-[11px] font-bold text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-md transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setAppliedLeaderIds([...selectedLeaderIds])}
                    disabled={selectedLeaderIds.length === 0}
                    className="text-[11px] font-bold text-white bg-[#0058be] hover:bg-[#004499] disabled:opacity-50 disabled:cursor-not-allowed px-3.5 py-1.5 rounded-md shadow-sm transition-all"
                  >
                    Apply Comparison
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-5">
          {appliedLeaderIds.length === 0 ? (
            <p className="text-xs text-slate-400 italic text-center py-6">
              Chọn ít nhất một Leader rồi bấm "Apply Comparison" để xem so sánh project.
            </p>
          ) : (
            // Each selected Team becomes ONE comparison column. The row
            // scrolls horizontally when there are more teams than fit on
            // screen (xl = 2 columns, lg = 1). Inside each column, list that
            // team's projects vertically, capped at the 4 newest projects
            // (sorted by project_id desc — the project's auto-increment PK
            // is the existing ordering field that mirrors creation order).
            <div className="flex gap-4 overflow-x-auto pb-3 custom-scrollbar">
              {appliedLeaderIds
                .map(id => teamsList.find(t => t.leader_user_id === id))
                .filter((t): t is TeamComparisonTeam => Boolean(t))
                .map(t => {
                  const newestProjects: TeamComparisonProject[] = [...(t.projects || [])]
                    .sort((a, b) => Number(b.project_id) - Number(a.project_id))
                    .slice(0, 4);
                  return (
                    <div
                      key={t.leader_user_id}
                      className="border border-slate-200 rounded-xl overflow-hidden bg-white shrink-0 w-[340px] xl:w-[calc((100%-1rem)/2)]"
                    >
                      {/* Column header: Leader / Workspace / counts / health */}
                      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                        <h4 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider truncate" title={t.leader_name}>
                          {t.leader_name}
                        </h4>
                        <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                          Leader: <strong>{t.leader_name}</strong>
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                          Workspace: <strong className="text-slate-700">{t.workspace || '—'}</strong>
                        </p>
                        <div className="flex items-center gap-2 text-[10px] font-bold mt-2">
                          <span className="px-2 py-0.5 rounded-full bg-[#eff4ff] text-[#0058be] border border-[#0058be]/20">
                            {t.projects.length} Projects
                          </span>
                          <span className={`px-2 py-0.5 rounded-full border ${healthBadge(t.health)}`}>
                            {healthLabel(t.health)}
                          </span>
                        </div>
                      </div>

                      {/* Project list (vertical) — max 4 newest projects */}
                      <div className="p-4 space-y-3 max-h-[640px] overflow-y-auto custom-scrollbar">
                        {newestProjects.length === 0 ? (
                          <p className="text-xs text-slate-400 italic text-center py-6">
                            Team này chưa có Project nào trong kỳ đang xem.
                          </p>
                        ) : (
                          newestProjects.map(p => (
                            <Link
                              key={p.project_id}
                              href={`/project/detail/overview?id=${p.project_id}`}
                              className="block p-3 bg-white border border-slate-200 rounded-xl hover:border-[#0058be]/40 hover:shadow-md transition-all"
                            >
                              <div className="flex items-center justify-between mb-1.5 gap-2">
                                <span className="text-[11px] font-bold text-[#0b1c30] truncate" title={p.name}>{p.name}</span>
                                <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full whitespace-nowrap ${projectStatusBadge[p.status || ''] || 'bg-slate-100 text-slate-500'}`}>
                                  {p.status || '—'}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 mb-1.5 truncate">
                                Giai đoạn: <strong className="text-slate-700">{p.current_phase || '—'}</strong>
                              </div>
                              <ProgressBar value={p.progress_pct} color={projectBarColor[p.status || ''] || 'bg-blue-500'} height="h-1.5" />
                              {/* Compact single-row metric strip — preserves all
                                  six existing metrics (Progress / Timeline /
                                  Task / Trễ / MD / Health) with their existing
                                  values/formulas, only their layout density
                                  changed. */}
                              <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-x-2 gap-y-1 text-[10px]">
                                <div className="flex items-baseline gap-1 min-w-0">
                                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[8.5px]">Progress</span>
                                  <span className="font-extrabold text-[#0058be] truncate">{p.progress_pct.toFixed(0)}%</span>
                                </div>
                                <div className="flex items-baseline gap-1 min-w-0">
                                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[8.5px]">Timeline</span>
                                  <span className="font-extrabold text-slate-700 truncate">{p.timeline_pct.toFixed(0)}%</span>
                                </div>
                                <div className="flex items-baseline gap-1 min-w-0">
                                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[8.5px]">Task</span>
                                  <span className="font-bold text-slate-700 truncate">{p.done}/{p.total}</span>
                                </div>
                                <div className="flex items-baseline gap-1 min-w-0">
                                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[8.5px]">Trễ</span>
                                  <span className={`font-bold truncate ${p.overdue > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{p.overdue}</span>
                                </div>
                                <div className="flex items-baseline gap-1 min-w-0">
                                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[8.5px]">MD</span>
                                  <span className="font-bold text-slate-700 truncate">{p.manday_actual.toFixed(1)}/{p.manday_est.toFixed(1)}</span>
                                </div>
                                <div className="flex items-baseline gap-1 min-w-0">
                                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[8.5px]">Health</span>
                                  <span className={`font-bold truncate ${p.health === 'Critical' ? 'text-rose-600' : p.health === 'Risk' ? 'text-amber-600' : p.health === 'On Track' ? 'text-emerald-600' : 'text-slate-500'}`}>
                                    {p.health}
                                  </span>
                                </div>
                              </div>
                            </Link>
                          ))
                        )}
                        {/* Show total project count when capped at 4 newest */}
                        {t.projects.length > newestProjects.length && (
                          <p className="text-[10px] text-slate-400 italic text-center pt-2 border-t border-slate-100">
                            Hiển thị {newestProjects.length} / {t.projects.length} project mới nhất trong kỳ
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 4: So sánh Member giữa các Team ───────────────────── */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SvgIcon name="user" className="w-4 h-4 text-emerald-600" />
            <div>
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">
                4. So sánh Member giữa các Team
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Đánh giá tải KPI của từng Member theo từng Leader — phát hiện Quá tải, Bình thường, Còn capacity, Không làm việc — Workspace hiện tại: <strong className="text-[#0058be]">{currentWsLabel}</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-semibold">
            {teamComparisonLoading && (
              <span className="text-blue-600 animate-pulse">Đang tải dữ liệu member…</span>
            )}
          </div>
        </div>

        <div className="p-5">
          {teamComparisonLoading ? (
            <p className="text-xs text-slate-400 italic text-center py-6">
              Đang tải dữ liệu team…
            </p>
          ) : teamsList.length === 0 ? (
            <p className="text-xs text-slate-400 italic text-center py-6">
              Workspace hiện tại chưa có Leader nào có thành viên được quản lý.
            </p>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {teamsList.map(t => {
                const teamMembers = t.members || [];
                const totalMembers = teamMembers.length;
                const emptyMembers = teamMembers.filter(m => (m.total || 0) === 0).length;
                const overloadedMembers = teamMembers.filter(m => memberStatus(m) === 'overload').length;
                const normalMembers = teamMembers.filter(m => memberStatus(m) === 'normal').length;
                const capacityMembers = teamMembers.filter(m => memberStatus(m) === 'capacity').length;
                const notWorkingMembers = teamMembers.filter(m => memberStatus(m) === 'not_working').length;
                const sortedMembers = [...teamMembers].sort(memberSortComparator);
                return (
                  <div key={t.leader_user_id} className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/30">
                    <div className="px-4 py-3 border-b border-slate-200 bg-blue-100">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <h4 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider truncate" title={t.leader_name}>
                            {t.leader_name}
                          </h4>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            Leader: <strong className="text-slate-700">{t.leader_name}</strong> • {totalMembers} Members • Workspace: {t.workspace}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-bold">
                          <span className="px-2 py-0.5 rounded-full bg-[#eff4ff] text-[#0058be] border border-[#0058be]/20">
                            Avg Util: <strong className="ml-1">{t.util.toFixed(1)}%</strong>
                          </span>
                          <span className={`px-2 py-0.5 rounded-full border ${healthBadge(t.health)}`}>
                            {healthLabel(t.health)}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mt-3">
                        <CounterChip label="Members"  value={totalMembers}     tone="slate" />
                        <CounterChip label="Không làm việc" value={notWorkingMembers} tone="slate" />
                        <CounterChip label="Còn capacity" value={capacityMembers} tone="emerald" />
                        <CounterChip label="Quá tải" value={overloadedMembers} tone="rose" />
                      </div>
                      <div className="mt-2 text-[9px] text-slate-400 font-semibold uppercase tracking-wider">
                        Bình thường: <strong className="text-blue-600">{normalMembers}</strong>
                      </div>
                    </div>

                    <div className="p-3 space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar">
                      <div className="p-3 bg-white border border-blue-200 rounded-lg ring-1 ring-blue-100">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#0b1c30] truncate" title={t.leader_name}>
                              {t.leader_name}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {t.leader_email || '—'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <WorkloadBadge status={leaderStatus(t)} />
                            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full border bg-indigo-100 text-indigo-800 border-indigo-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span>
                              Leader
                            </span>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2.5 text-[10px]">
                          <SmallStat label="Done"   value={t.done}        color="text-emerald-600" />
                          <SmallStat label="Doing"  value={t.in_progress} color="text-blue-600" />
                          <SmallStat label="Trễ"    value={t.overdue}     color={t.overdue > 0 ? 'text-rose-600' : 'text-slate-400'} />
                          <SmallStat label="KPI"    value={t.kpi.toFixed(1)} color="text-[#0058be]" />
                          <SmallStat label="Manday" value={`${t.actual_md.toFixed(1)}/${t.plan_md.toFixed(1)}`} />
                          <SmallStat label="KPI%"   value={`${(t.leader_kpi_pct ?? 0).toFixed(1)}%`} color={(t.leader_kpi_pct ?? 0) > 120 ? 'text-rose-600' : (t.leader_kpi_pct ?? 0) >= 90 ? 'text-emerald-600' : 'text-slate-600'} />
                        </div>
                      </div>

                      {sortedMembers.length === 0 ? (
                        <p className="text-xs text-slate-400 italic text-center py-4">
                          Team chưa có thành viên.
                        </p>
                      ) : (
                        sortedMembers.map(m => {
                          const status = memberStatus(m);
                          const kpiPct = memberKpiPct(m);
                          return (
                            <div key={m.member_id} className="p-3 bg-white border border-slate-200 rounded-lg">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-[#0b1c30] truncate" title={m.name}>
                                    {m.name}
                                  </p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">
                                    {m.position || m.department || '—'}
                                  </p>
                                </div>
                                <WorkloadBadge status={status} />
                              </div>
                              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2.5 text-[10px]">
                                <SmallStat label="Done"   value={m.done}        color="text-emerald-600" />
                                <SmallStat label="Doing"  value={m.in_progress} color="text-blue-600" />
                                <SmallStat label="Trễ"    value={m.overdue}     color={m.overdue > 0 ? 'text-rose-600' : 'text-slate-400'} />
                                <SmallStat label="KPI"    value={m.kpi.toFixed(1)} color="text-[#0058be]" />
                                <SmallStat label="Manday" value={`${m.manday_actual.toFixed(1)}/${m.manday_est.toFixed(1)}`} />
                                <SmallStat label="KPI%"   value={`${kpiPct.toFixed(1)}%`} color={kpiPct > 120 ? 'text-rose-600' : kpiPct >= 90 ? 'text-emerald-600' : 'text-slate-600'} />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Section 2 detail drawer */}
      {(detailTeam || detailLoading) && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-[999] flex justify-end">
          <div className="fixed inset-0" onClick={closeTeamDetail} />
          <div className="relative w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col z-10 animate-in slide-in-from-right duration-250">
            <div className="p-5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 text-[#0058be]">
                <span className="material-symbols-outlined text-[24px]">groups</span>
                <div>
                  <h3 className="text-base font-bold text-[#0b1c30]">
                    {detailTeam ? detailTeam.leader_name : 'Đang tải chi tiết team…'}
                  </h3>
                  {detailTeam && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Leader: <strong className="text-slate-800">{detailTeam.leader_name}</strong> • Workspace: {detailTeam.workspace}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={closeTeamDetail}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors"
                title="Đóng Drawer"
              >
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>

            <div className="flex-1 p-6 space-y-5 overflow-y-auto text-xs">
              {detailLoading && !detailTeam && (
                <div className="text-center py-8 text-slate-400 font-semibold">Đang tải chi tiết…</div>
              )}
              {detailTeam && (
                <>
                  <div className="bg-[#eff4ff]/60 p-4 rounded-xl border border-[#0058be]/15 space-y-3">
                    <h4 className="text-[11px] font-extrabold text-[#0058be] uppercase tracking-wider">Team Summary</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <SummaryStat label="Members" value={detailTeam.member_count} />
                      <SummaryStat label="Total tasks" value={detailTeam.total} />
                      <SummaryStat label="Done" value={detailTeam.done} color="text-emerald-600" />
                      <SummaryStat label="In progress" value={detailTeam.in_progress} color="text-blue-600" />
                      <SummaryStat label="Overdue" value={detailTeam.overdue} color="text-rose-600" />
                      <SummaryStat label="On-time" value={detailTeam.on_time} color="text-emerald-600" />
                      <SummaryStat label="Plan MD" value={detailTeam.plan_md.toFixed(1)} />
                      <SummaryStat label="Actual MD" value={detailTeam.actual_md.toFixed(1)} />
                      <SummaryStat label="KPI" value={detailTeam.kpi.toFixed(1)} color="text-[#0058be]" />
                      <SummaryStat label="Efficiency" value={`${detailTeam.efficiency.toFixed(1)}%`} />
                      <SummaryStat label="Utilization" value={`${detailTeam.util.toFixed(1)}%`} />
                      <SummaryStat label="Health" value={healthLabel(detailTeam.health)} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Member Breakdown</h4>
                    <div className="space-y-2">
                      {detailTeam.members.length === 0 ? (
                        <p className="text-slate-400 italic">Team chưa có thành viên.</p>
                      ) : (
                        detailTeam.members.map(m => (
                          <div key={m.member_id} className="p-3 border border-slate-200 rounded-xl bg-slate-50/40">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <span className="font-bold text-[#0b1c30]">{m.name}</span>
                                <span className="text-[10px] text-slate-500 ml-1.5">{m.position || m.department || ''}</span>
                              </div>
                              <span className="text-[10px] font-extrabold text-[#0058be] bg-[#eff4ff] px-2 py-0.5 rounded">
                                {m.kpi.toFixed(1)} KPI
                              </span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-[10px]">
                              <SmallStat label="Assigned" value={m.assigned} />
                              <SmallStat label="Done" value={m.done} color="text-emerald-600" />
                              <SmallStat label="In-prog." value={m.in_progress} color="text-blue-600" />
                              <SmallStat label="Overdue" value={m.overdue} color="text-rose-600" />
                              <SmallStat label="MD plan" value={m.manday_est.toFixed(1)} />
                              <SmallStat label="MD actual" value={m.manday_actual.toFixed(1)} />
                              <SmallStat label="Progress" value={`${m.progress_pct.toFixed(0)}%`} color="text-[#0058be]" />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Projects / Workload Context</h4>
                    {detailTeam.projects.length === 0 ? (
                      <p className="text-slate-400 italic">Team chưa có dự án nào được giao.</p>
                    ) : (
                      <div className="space-y-2">
                        {detailTeam.projects.map(p => (
                          <Link
                            key={p.project_id}
                            href={`/project/detail/overview?id=${p.project_id}`}
                            className="block p-3 border border-slate-200 rounded-xl bg-white hover:border-[#0058be]/40 transition-all"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-[#0b1c30]">{p.name}</span>
                              <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ${projectStatusBadge[p.status || ''] || 'bg-slate-100 text-slate-500'}`}>
                                {p.status || '—'}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
                              <SmallStat label="Progress" value={`${p.progress_pct.toFixed(0)}%`} color="text-[#0058be]" />
                              <SmallStat label="Tasks" value={`${p.done}/${p.total}`} />
                              <SmallStat label="Overdue" value={p.overdue} color="text-rose-600" />
                              <SmallStat label="MD" value={`${p.manday_actual.toFixed(1)}/${p.manday_est.toFixed(1)}`} />
                              <SmallStat label="Health" value={p.health} />
                              <SmallStat label="Phase" value={p.current_phase || '—'} />
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex justify-end shrink-0">
              <button
                onClick={closeTeamDetail}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-5 py-2 rounded-lg shadow-sm transition-all"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div>
      <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">{label}</span>
      <span className={`text-base font-black ${color || 'text-slate-700'}`}>{value}</span>
    </div>
  );
}

function SmallStat({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div>
      <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">{label}</span>
      <span className={`text-[11px] font-extrabold ${color || 'text-slate-700'}`}>{value}</span>
    </div>
  );
}

function WorkloadBadge({ status }: { status: 'overload' | 'normal' | 'capacity' | 'not_working' }) {
  if (status === 'overload') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full border bg-rose-100 text-rose-800 border-rose-200">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block"></span>
        Quá tải
      </span>
    );
  }
  if (status === 'normal') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full border bg-blue-100 text-blue-800 border-blue-200">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span>
        Bình thường
      </span>
    );
  }
  if (status === 'not_working') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block"></span>
        Không làm việc
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
      Còn capacity
    </span>
  );
}

function CounterChip({ label, value, tone }: { label: string; value: number; tone: 'slate' | 'emerald' | 'rose' }) {
  const toneCls =
    tone === 'rose'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <div className={`flex flex-col items-center justify-center px-2 py-1.5 rounded-lg border ${toneCls}`}>
      <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">{label}</span>
      <span className="text-sm font-black leading-tight">{value}</span>
    </div>
  );
}
