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

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getMondayToSundayRange, getWeekOfMonth, CYCLE_TEMPLATE } from '@/app/dashboard/constants';
import { getTeamComparison, getWorkspaces, TeamComparisonProject, TeamComparisonTeam, TeamComparisonResponse } from '@/lib/api';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';
import SvgIcon from '@/components/dashboard/Icons';
import ProgressBar from '@/components/dashboard/ProgressBar';
import { projectStatusBadge, projectBarColor } from '@/app/dashboard/constants';

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
                              className="block p-3.5 bg-white border border-slate-200 rounded-xl hover:border-[#0058be]/40 hover:shadow-md transition-all"
                            >
                              <div className="flex items-center justify-between mb-2 gap-2">
                                <span className="text-[11px] font-bold text-[#0b1c30] truncate" title={p.name}>{p.name}</span>
                                <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full whitespace-nowrap ${projectStatusBadge[p.status || ''] || 'bg-slate-100 text-slate-500'}`}>
                                  {p.status || '—'}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 mb-2">
                                Giai đoạn: <strong className="text-slate-700">{p.current_phase || '—'}</strong>
                              </div>
                              <ProgressBar value={p.progress_pct} color={projectBarColor[p.status || ''] || 'bg-blue-500'} height="h-2" />
                              <div className="grid grid-cols-2 gap-2 mt-2.5 text-[10px]">
                                <div>
                                  <span className="text-slate-400 block">Progress</span>
                                  <span className="font-extrabold text-[#0058be]">{p.progress_pct.toFixed(0)}%</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block">Timeline</span>
                                  <span className="font-extrabold text-slate-700">{p.timeline_pct.toFixed(0)}%</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block">Task</span>
                                  <span className="font-bold text-slate-700">{p.done}/{p.total}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block">Trễ</span>
                                  <span className={`font-bold ${p.overdue > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{p.overdue}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block">MD</span>
                                  <span className="font-bold text-slate-700">{p.manday_actual.toFixed(1)}/{p.manday_est.toFixed(1)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block">Health</span>
                                  <span className={`font-bold ${p.health === 'Critical' ? 'text-rose-600' : p.health === 'Risk' ? 'text-amber-600' : p.health === 'On Track' ? 'text-emerald-600' : 'text-slate-500'}`}>
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
    </div>
  );
}
