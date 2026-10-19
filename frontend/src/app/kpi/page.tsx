'use client';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import { useRouter } from 'next/navigation';
import { isAdmin, getToken } from '@/lib/auth';
import { getMembers, getMemberLeaders, getTeams, getDepartments, getWorkspaces, getMe, getProjects } from '@/lib/api';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';
import { CYCLE_TEMPLATE, checkTaskInPeriod, calculateDaysLate } from '@/app/dashboard/constants';
import axios from 'axios';
import { useSidebarCollapse, SIDEBAR_PAD_EXPANDED, SIDEBAR_PAD_COLLAPSED } from '@/lib/sidebarCollapse';
import { Copy, Check } from 'lucide-react';

// ── Hover-to-copy control for KPI ranking cells (UI-only) ────────────
// Copies the EXACT value currently displayed (no recalculation, no
// reformatting). The number itself keeps its original markup/position;
// the compact copy button is absolutely positioned in the cell's right
// padding so the table layout never shifts. Appears on cell hover,
// disappears on mouse leave (pure CSS group-hover), and shows a brief
// check icon as feedback. Clipboard failures are handled gracefully.
const KpiCopyValue = ({ value }: { value: number }) => {
    const [copied, setCopied] = useState(false);
    // Same string React renders for the number — exactly what the user sees.
    const displayed = String(value);
    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation(); // rows are clickable (open member detail)
        e.preventDefault();
        navigator.clipboard?.writeText(displayed).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => { /* graceful: no-op, table stays intact */ });
    };
    return (
        <span className="relative inline-flex items-center justify-end">
            {displayed}
            <button
                type="button"
                onClick={handleCopy}
                title={copied ? 'Đã sao chép' : 'Sao chép giá trị'}
                className={`absolute left-full ml-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded-md border transition-opacity duration-150 cursor-pointer opacity-0 group-hover/copy:opacity-100 focus:opacity-100 ${copied ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-white text-slate-400 hover:text-[#0058be] hover:border-blue-200'}`}
            >
                {copied ? <Check size={11} strokeWidth={2.5} /> : <Copy size={11} />}
            </button>
        </span>
    );
};


// ── KPI Member Detail Modal (Year/Month only, one-way sync) ─────────
// Canonical KPI helper: mirrors backend UNION behavior for dual-role tasks.
// If member is both assigned AND support on the same task, both kpi_assigned
// and kpi_support are counted (same as the backend's UNION ALL approach).
const getCanonicalTaskKpi = (t: any, memberId: any): number => {
  const isDone = t.status === 'Done' || t.status === 'done';
  if (!isDone) return 0;
  const isAssigned = t.assigned_id != null && String(t.assigned_id) === String(memberId);
  const isSupport = t.support_id != null && String(t.support_id) === String(memberId);
  if (isAssigned && isSupport) {
    return (t.kpi_assigned || 0) + (t.kpi_support || 0);
  }
  if (isAssigned) return (t.kpi_assigned || 0);
  if (isSupport) return (t.kpi_support || 0);
  return 0;
};

// Shared look for every /kpi filter field: small label above a same-height
// control, laid out on a grid so the bar stays tidy at any width.
const FILTER_FIELD_CLS = "flex flex-col gap-1 min-w-0";
const FILTER_LABEL_CLS = "text-[11px] font-bold text-blue-800/70 uppercase tracking-wider";
const FILTER_INPUT_CLS = "w-full h-10 border-2 border-blue-200 rounded-lg px-3 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white shadow-sm transition-all cursor-pointer hover:border-blue-300";

const KpiMemberDetailModal = ({ member, tasks, projects, onClose, onNavigate, initialYear, initialMonth, workspaceCode }: {
  member: any, tasks: any[], projects: any[], onClose: () => void, onNavigate: (projectId: string | number, memberName?: string, memberId?: string | number, taskId?: string | number) => void,
  initialYear: number, initialMonth: number, workspaceCode?: string | null,
}) => {
  const [detailYear, setDetailYear] = useState<number>(initialYear);
  const [detailMonth, setDetailMonth] = useState<number>(initialMonth);
  const [taskFilter, setTaskFilter] = useState<'all' | 'overdue' | 'critical' | 'high'>('all');
  const [projectSort, setProjectSort] = useState<'kpi_desc' | 'kpi_asc' | 'task_desc' | 'task_asc' | 'done_desc' | 'done_asc'>('kpi_desc');
  const memberName = member.display_name || member.full_name || '';

  // Compute fiscal cycle dates for the selected month
  const fiscalRange = useMemo(() => {
    const cycle = CYCLE_TEMPLATE[detailMonth];
    if (!cycle) return null;
    const s = `${detailYear + cycle.startYo}-${cycle.startMd}`;
    const e = `${detailYear + cycle.endYo}-${cycle.endMd}`;
    return { start: s, end: e };
  }, [detailYear, detailMonth]);

  // Filter tasks by member AND fiscal period AND workspace scope
  // Workspace scope: filter tasks by the selected workspace (same scope as External KPI Ranking)
  const scopedProjects = useMemo(() => {
    if (!workspaceCode) return null;
    return new Set(
      projects
        .filter(p => (p.data_scope || '').toLowerCase() === workspaceCode.toLowerCase() || (p.business || '').toLowerCase() === 'all')
        .map(p => String(p.id))
    );
  }, [projects, workspaceCode]);

  const memberAllTasks = tasks.filter(t => {
    const matchesMember = (t.assigned_id != null && String(t.assigned_id) === String(member.id)) ||
      (t.support_id != null && String(t.support_id) === String(member.id));
    if (!matchesMember) return false;
    // Apply workspace scope if a specific workspace is selected
    if (scopedProjects && t.project_id != null) {
      return scopedProjects.has(String(t.project_id));
    }
    return true;
  });
  const memberTasks = memberAllTasks.filter(t => {
    if (!fiscalRange) return true;
    // Use end_date_actual for Done tasks, end_date_est for others
    const isDone = t.status === 'Done' || t.status === 'done';
    const dateStr = isDone ? (t.end_date_actual || t.end_date_est) : (t.end_date_est || t.created_at);
    if (!dateStr) return false;
    return dateStr >= fiscalRange.start && dateStr <= fiscalRange.end;
  });

  const openTasks = memberTasks.filter(t => t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel');
  const doneTasks = memberTasks.filter(t => t.status === 'Done' || t.status === 'done');
  const overdueTasks = openTasks.filter(t => calculateDaysLate(t) > 0);
  const criticalTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'critical');
  const highTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'high');
  const normalTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'normal');
  const interruptTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'interrupt');

  // Canonical KPI: use the pre-aggregated backend value (same as External KPI Ranking)
  const periodKpi = typeof member.kpi_total === 'number' ? member.kpi_total : 0;

  const activeProjects = projects.filter(p => memberTasks.some(t => String(t.project_id) === String(p.id)));

  // Precompute per-project stats using canonical KPI formula
  const projectRows = activeProjects.map(p => {
    const pTasks = memberTasks.filter(t => String(t.project_id) === String(p.id));
    const pDone = pTasks.filter(t => t.status === 'Done' || t.status === 'done');
    const pOpen = pTasks.filter(t => t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel').length;
    const pCritical = pTasks.filter(t => (t.priority || '').toLowerCase() === 'critical').length;
    const pKpi = pDone.reduce((acc, t) => acc + getCanonicalTaskKpi(t, member.id), 0);
    return { project: p, pTasks, pDone, pOpen, pCritical, pKpi };
  });
  const sortedProjectRows = [...projectRows].sort((a, b) => {
    switch (projectSort) {
      case 'kpi_asc': return a.pKpi - b.pKpi;
      case 'task_desc': return b.pTasks.length - a.pTasks.length;
      case 'task_asc': return a.pTasks.length - b.pTasks.length;
      case 'done_desc': return b.pDone.length - a.pDone.length;
      case 'done_asc': return a.pDone.length - b.pDone.length;
      case 'kpi_desc':
      default: return b.pKpi - a.pKpi;
    }
  });
  const PROJECT_SORT_OPTIONS: { value: typeof projectSort; label: string }[] = [
    { value: 'kpi_desc', label: 'KPI cao nhất' },
    { value: 'kpi_asc', label: 'KPI thấp nhất' },
    { value: 'task_desc', label: 'Task nhiều nhất' },
    { value: 'task_asc', label: 'Task ít nhất' },
    { value: 'done_desc', label: 'Done nhiều nhất' },
    { value: 'done_asc', label: 'Done ít nhất' },
  ];

  const periodLabel = `Tháng ${detailMonth}/${detailYear}`;

  const filteredTasks = memberTasks.filter(t => {
    if (taskFilter === 'overdue') return (t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel') && calculateDaysLate(t) > 0;
    if (taskFilter === 'critical') return (t.priority || '').toLowerCase() === 'critical';
    if (taskFilter === 'high') return (t.priority || '').toLowerCase() === 'high';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div onClick={onClose} className="fixed inset-0" />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white h-full shadow-2xl overflow-y-auto custom-scrollbar flex flex-col border-l border-slate-200">
        {/* HEADER */}
        <div className="sticky top-0 z-20 bg-white px-6 py-4 border-b border-slate-100 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#0058be] text-white flex items-center justify-center font-black text-lg shadow-sm shrink-0">
              {member.display_name ? member.display_name.charAt(0).toUpperCase() : 'M'}
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-[#0b1c30] tracking-tight">{member.display_name}</h2>
              <p className="text-xs font-semibold text-slate-400 mt-0.5">
                {(member.team || member.department || '').toUpperCase()} · {member.workspace || ''} · {periodLabel}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors flex items-center justify-center font-bold text-sm cursor-pointer shrink-0">✕</button>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-6 flex-1">
          {/* 1. KPI SUMMARY CARDS */}
          <div className="grid grid-cols-6 gap-2">
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0b1c30] leading-none">{activeProjects.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Dự án</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0b1c30] leading-none">{memberTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Task kỳ</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-emerald-600 leading-none">{doneTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Done</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-red-600 leading-none">{overdueTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Trễ</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-purple-700 leading-none">{criticalTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Critical</span>
            </div>
            <div className="bg-slate-50 border border-blue-200 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0058be] leading-none">{periodKpi.toFixed(1)}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">KPI kỳ</span>
            </div>
          </div>

          {/* 2. YEAR/MONTH FILTER (one-way sync from KPI ranking) */}
          <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
            <span className="text-[10px] font-bold text-slate-500">Kỳ:</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400">Năm:</span>
              <select value={detailYear} onChange={e => setDetailYear(Number(e.target.value))} className="bg-transparent border-none text-[#0058be] font-bold text-[11px] focus:outline-none cursor-pointer">
                {[...Array(5)].map((_, i) => <option key={i} value={new Date().getFullYear() - 2 + i}>{new Date().getFullYear() - 2 + i}</option>)}
              </select>
            </div>
            <div className="w-px h-3 bg-slate-200"></div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400">Tháng:</span>
              <select value={detailMonth} onChange={e => setDetailMonth(Number(e.target.value))} className="bg-transparent border-none text-[#0058be] font-bold text-[11px] focus:outline-none cursor-pointer">
                {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
            </div>
          </div>

          {/* 3. PRIORITY DISTRIBUTION */}
          <div>
            <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-3">Phân bố priority</h3>
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

          {/* 4. PROJECTS */}
          <div>
            <div className="flex items-center justify-between mb-3 gap-2">
              <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider">Dự án đang tham gia</h3>
              {activeProjects.length > 0 && (
                <select
                  value={projectSort}
                  onChange={(e) => setProjectSort(e.target.value as typeof projectSort)}
                  className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#0058be] cursor-pointer"
                >
                  {PROJECT_SORT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-3">
              {activeProjects.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center text-xs font-semibold text-slate-400">Chưa có dự án nào.</div>
              ) : (
                sortedProjectRows.map(({ project: p, pTasks, pDone, pOpen, pCritical, pKpi }) => {
                  return (
                    <div key={p.id} onClick={() => { onClose(); onNavigate(p.id, memberName, member.id); }} className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-3 cursor-pointer hover:border-[#0058be] hover:shadow-md transition-all active:scale-[0.99]">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-extrabold text-[#0b1c30] hover:text-[#0058be] transition-colors">{p.name}</h4>
                        <span className="px-2.5 py-0.5 bg-blue-50 text-[#0058be] rounded-full text-[10px] font-bold border border-blue-100">{pOpen} task mở</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-[#0b1c30] block">{pTasks.length}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">TASK</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-emerald-600 block">{pDone.length}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">DONE</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-purple-700 block">{pCritical}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">CRITICAL</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-[#0058be] block">{pKpi.toFixed(1)}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">KPI</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-[#0058be] font-bold text-right">Xem task của bạn trong dự án ➔</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 5. TASK TABLE */}
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
              <div>
                <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider">Task trong kỳ</h3>
                <p className="text-[10px] text-slate-400 font-medium">KPI kỳ = Tổng KPI từ Bảng Xếp Hạng (tính theo workspace và chu kỳ tài chính)</p>
              </div>
              <div className="flex gap-1">
                {(['all', 'overdue', 'critical', 'high'] as const).map(filter => (
                  <button key={filter} onClick={() => setTaskFilter(filter)}
                    className={`px-3 py-1 rounded-full text-[10px] font-extrabold transition-all cursor-pointer ${taskFilter === filter ? 'bg-[#0058be] text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
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
                    <th className="px-4 py-2.5 text-center bg-slate-50 text-slate-500 sticky top-0 z-20 border-b border-slate-200">STATUS</th>
                    <th className="px-4 py-2.5 text-center bg-slate-50 text-slate-500 sticky top-0 z-20 border-b border-slate-200">KPI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTasks.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-6 text-xs text-slate-400 font-semibold">Không có task nào.</td></tr>
                  ) : (
                    filteredTasks.map((t: any) => {
                      const prio = (t.priority || 'normal').toUpperCase();
                      const isDone = t.status === 'Done' || t.status === 'done';
                      const dlStr = t.end_date_est ? t.end_date_est.split('-').reverse().slice(0, 2).join('/') : '-';
                      const taskKpi = getCanonicalTaskKpi(t, member.id);
                      const proj = projects.find((p: any) => String(p.id) === String(t.project_id));
                      return (
                        <tr key={t.id} onClick={() => { if (proj) { onClose(); onNavigate(proj.id, memberName, member.id, t.id); } }} className="hover:bg-slate-50/80 transition-colors cursor-pointer">
                          <td className="px-4 py-3">
                            <p className="font-bold text-[#0b1c30] text-xs">{t.name || t.detail || '-'}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600 font-medium text-xs">{t.projectName || t.project_name || proj?.name || '-'}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase ${prio === 'CRITICAL' ? 'bg-purple-100 text-purple-700' : prio === 'HIGH' ? 'bg-orange-100 text-orange-700' : prio === 'INTERRUPT' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>{prio}</span>
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-slate-700 text-xs">{dlStr}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isDone ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{isDone ? 'Done' : 'Đang làm'}</span>
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-[#0058be] text-xs">{taskKpi > 0 ? taskKpi.toFixed(1) : '-'}</td>
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
};

export default function KPIPage() {
    const router = useRouter();
    const { collapsed: sidebarCollapsed } = useSidebarCollapse();
    const [authorized, setAuthorized] = useState(false);
    useEffect(() => { setAuthorized(true); }, []);
    const [activeTab, setActiveTab] = useState<'KPItotal' | 'KPIweek'>('KPItotal');
    const [search, setSearch] = useState("");
    // Debounce ô tìm kiếm: gõ xong 400ms mới gọi API, không gọi theo từng ký tự.
    const [debouncedSearch, setDebouncedSearch] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 400);
        return () => clearTimeout(timer);
    }, [search]);
    const [month, setMonth] = useState("");
    // Defaults to the current year (not "Tất cả các năm") — KPI and Project
    // both default to the current year; "Tất cả" stays available as an
    // explicit choice via the "" option, same as before.
    const [year, setYear] = useState(() => String(new Date().getFullYear()));
    const defaultYear = String(new Date().getFullYear());
    const [level, setLevel] = useState("");
    const [workspace, setWorkspace] = useState("");
    const [team, setTeam] = useState("");
    // Leader's member id (string, "" = all): show only members whose
    // members.leader_member_id is this Leader. Clicking a row still opens
    // the usual KPI detail drawer.
    const [leaderFilter, setLeaderFilter] = useState("");
    const { data: leaderOptions = [] } = useQuery({
        queryKey: ['kpi-leader-options'],
        queryFn: getMemberLeaders,
        staleTime: 5 * 60_000,
    });
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [levelOptions, setLevelOptions] = useState<any[]>([]);
    // Shared ['workspaces'] react-query cache — same key/staleTime as Navbar/
    // Dashboard/ProjectListContent, so this doesn't fire a duplicate request.
    const { data: workspaceOptionsData } = useQuery({
        queryKey: ['workspaces'],
        queryFn: () => getWorkspaces(),
        staleTime: 5 * 60_000,
    });
    const workspaceOptions: any[] = workspaceOptionsData || [];
    const [teamOptions, setTeamOptions] = useState<any[]>([]);
    // Workspace data scope: for Leader/Member/Viewer the assigned Workspace(s)
    // are the effective KPI data scope. The full list (multi-Workspace aware)
    // is sourced from `me.workspace_ids[]` + `me.workspaces[]` — never the
    // legacy single-column `me.data_scope`, which only carries the first code.
    const [userRole, setUserRole] = useState("");
    const [authorizedWorkspaceCodes, setAuthorizedWorkspaceCodes] = useState<string[]>([]);
    const isScopedUser = (userRole === 'member' || userRole === 'viewer' || userRole === 'leader');
    // The list of Workspaces the current user is authorized to view. For a
    // single-Workspace Leader/Member/Viewer this is a 1-element array (locked);
    // for a multi-Workspace Leader it lists every granted Workspace, plus an
    // "All authorized Workspaces" pseudo-option. Super Admin gets an empty
    // array (treated as "no restriction", same as the existing pre-fix path).
    const lockedWorkspaceOptions = useMemo(() => {
        if (!isScopedUser) return [];
        const codes = authorizedWorkspaceCodes.filter(c => c && c !== 'all');
        return codes.map(code => {
            const w = workspaceOptions.find(o => (o.code || "").toLowerCase() === code.toLowerCase());
            return { code, name: w ? w.name : code };
        });
    }, [isScopedUser, authorizedWorkspaceCodes, workspaceOptions]);
    const lockedWorkspaceName = lockedWorkspaceOptions.length === 1 ? lockedWorkspaceOptions[0].name : "";
    // UI-shape flags derived from the authorized scope. Lifted to the
    // component scope so the "Clear filter" button can reuse them.
    const isMultiWs = isScopedUser && lockedWorkspaceOptions.length > 1;
    const isLockedSingle = isScopedUser && lockedWorkspaceOptions.length === 1;
    const [sortConfig, setSortConfig] = useState({
        key: "kpi_total",
        direction: "desc",
    });

    // Member Detail modal state
    const [selectedMemberModal, setSelectedMemberModal] = useState<any>(null);

    // Fetch tasks and projects for Member Detail drill-down
    const { data: allTasksData } = useQuery({
        queryKey: ['kpi-all-tasks'],
        queryFn: async () => {
            const token = getToken();
            const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
            const res = await axios.get(`/api/all-tasks-global?_t=${Date.now()}`, config);
            return res.data || [];
        },
        staleTime: 2 * 60_000,
    });
    const allTasks: any[] = allTasksData || [];

    const { data: allProjectsData } = useQuery({
        queryKey: ['kpi-all-projects'],
        queryFn: () => getProjects(),
        staleTime: 5 * 60_000,
    });
    const allProjects: any[] = allProjectsData || [];

    const handleSort = (key: string) => {
    let direction = "asc";

    if (
        sortConfig.key === key &&
        sortConfig.direction === "asc"
    ) {
        direction = "desc";
    }

    setSortConfig({
        key,
        direction,
    });
};

    useEffect(() => {
        getTeams().then(setLevelOptions).catch(() => {});
        getDepartments().then(setTeamOptions).catch(() => {});
        getMe().then(me => {
            setUserRole(me.role);
            // Prefer the new multi-Workspace grant list; fall back to the
            // legacy single-column `data_scope` if `workspace_ids` is missing
            // (older backend responses / defensive default).
            const ids: string[] = Array.isArray(me.workspace_ids) && me.workspace_ids.length > 0
                ? me.workspace_ids
                : (me.data_scope ? [me.data_scope] : []);
            setAuthorizedWorkspaceCodes(ids);
        }).catch(() => {});
    }, []);

    // Member/Viewer: keep the Workspace filter pinned to the single assigned Workspace.
    // Multi-Workspace Leaders are not auto-pinned — they get an "All authorized
    // Workspaces" option as default so they see the union of their granted data.
    useEffect(() => {
        if (!isScopedUser) return;
        if (lockedWorkspaceOptions.length === 1 && workspace !== lockedWorkspaceOptions[0].name) {
            setWorkspace(lockedWorkspaceOptions[0].name);
        }
    }, [isScopedUser, lockedWorkspaceOptions, workspace]);

    // Company selection is shared app-wide via WorkspaceFilterProvider (see
    // Navbar's Workspace switcher) — picking a Workspace there filters this
    // page too, converting the shared code into the name this page's filter
    // (and its `?workspace=` API param) already expects.
    const { workspaceCode: ctxWorkspaceCode, setWorkspaceCode } = useWorkspaceFilter();
    useEffect(() => {
        if (isScopedUser) return;
        const name = ctxWorkspaceCode
            ? (workspaceOptions.find(o => (o.code || '').toLowerCase() === ctxWorkspaceCode.toLowerCase())?.name || '')
            : '';
        setWorkspace(name);
    }, [ctxWorkspaceCode, workspaceOptions, isScopedUser]);

    const handleWorkspaceChange = (name: string) => {
        setWorkspace(name);
        const code = name ? (workspaceOptions.find(o => o.name === name)?.code || null) : null;
        setWorkspaceCode(code);
    };

    // Restore KPI state (filters + tab + the member drawer that was open)
    // after a KPI → Project → "Quay lại KPI" round trip. Scoped to exactly
    // that round trip, not a persistent/global memory: the snapshot is
    // written only when navigating away to /project (see
    // handleNavigateToProject below) and is consumed (read + deleted) here
    // on mount, so a normal sidebar click into /kpi — which explicitly
    // clears this key first, see Navbar.tsx — always lands on the default
    // (current year) view instead of silently reusing a stale snapshot.
    useEffect(() => {
        try {
            const raw = sessionStorage.getItem('kpiNavSnapshot');
            if (!raw) return;
            sessionStorage.removeItem('kpiNavSnapshot');
            const snap = JSON.parse(raw);
            if (snap.activeTab === 'KPItotal' || snap.activeTab === 'KPIweek') setActiveTab(snap.activeTab);
            if (typeof snap.search === 'string') setSearch(snap.search);
            if (typeof snap.month === 'string') setMonth(snap.month);
            if (typeof snap.year === 'string') setYear(snap.year);
            if (typeof snap.level === 'string') setLevel(snap.level);
            if (typeof snap.team === 'string') setTeam(snap.team);
            if (typeof snap.leaderFilter === 'string') setLeaderFilter(snap.leaderFilter);
            if (typeof snap.startDate === 'string') setStartDate(snap.startDate);
            if (typeof snap.endDate === 'string') setEndDate(snap.endDate);
            if (snap.selectedMember) setSelectedMemberModal(snap.selectedMember);
        } catch { /* corrupt/old snapshot shape — ignore, fall back to defaults */ }
        // Runs once on mount only — this is a one-time consume, not a
        // continuous sync with sessionStorage.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleNavigateToProject = (projectId: string | number, memberName?: string, memberId?: string | number, taskId?: string | number) => {
        try {
            sessionStorage.setItem('kpiNavSnapshot', JSON.stringify({
                activeTab, search, month, year, level, team, leaderFilter, startDate, endDate,
                selectedMember: selectedMemberModal,
            }));
        } catch { /* sessionStorage unavailable (private mode, quota) — restoration just won't be offered */ }
        const params = new URLSearchParams();
        params.set('id', String(projectId));
        if (memberName) params.set('member', memberName);
        if (memberId != null) params.set('member_id', String(memberId));
        if (taskId != null) params.set('highlightTask', String(taskId));
        if (month) params.set('month', month);
        if (year) params.set('year', year);
        params.set('from', 'kpi');
        router.push(`/project/detail/tasks?${params.toString()}`);
    };

    // Effective workspace code for Member Detail scope alignment
    const effectiveWorkspaceCode = useMemo(() => {
        if (isScopedUser) {
            if (lockedWorkspaceOptions.length === 1) return lockedWorkspaceOptions[0].code;
            if (workspace) {
                const found = workspaceOptions.find(o => o.name === workspace);
                return found ? found.code : null;
            }
            return null;
        }
        return ctxWorkspaceCode || null;
    }, [isScopedUser, lockedWorkspaceOptions, workspace, workspaceOptions, ctxWorkspaceCode]);

    const memberParams = useMemo(() => {
        const params: any = {};
        // For scoped users, the Workspace filter is only sent when a SPECIFIC
        // Workspace is picked. The "All authorized Workspaces" pseudo-option
        // resolves to `workspace = ""` and is intentionally NOT forwarded —
        // the backend's `member_query_for_user` already clamps to the union of
        // the caller's granted Workspaces (multi-Workspace aware), so omitting
        // the param yields the combined dataset instead of one workspace only.
        const effectiveWorkspace = isScopedUser
            ? (lockedWorkspaceOptions.length > 1 ? workspace : lockedWorkspaceName)
            : workspace;
        if (activeTab === 'KPItotal') {
            if (month) params.month = parseInt(month);
            if (year) params.year = parseInt(year);
            if (level) params.team = level;
            if (effectiveWorkspace) params.workspace = effectiveWorkspace;
            if (team) params.department = team;
            if (leaderFilter) params.leader_member_id = parseInt(leaderFilter);
            if (debouncedSearch) params.search = debouncedSearch;
        } else {
            // KPI Tuần: gửi date range thay vì tháng/năm
            if (startDate) params.start_date = startDate;
            if (endDate) params.end_date = endDate;
            if (level) params.team = level;
            if (effectiveWorkspace) params.workspace = effectiveWorkspace;
            if (team) params.department = team;
            if (leaderFilter) params.leader_member_id = parseInt(leaderFilter);
            if (debouncedSearch) params.search = debouncedSearch;
        }
        return params;
    }, [activeTab, month, year, level, workspace, team, leaderFilter, debouncedSearch, startDate, endDate, isScopedUser, lockedWorkspaceName, lockedWorkspaceOptions]);

    const { data: members = [], isLoading } = useQuery({
        queryKey: ['kpi-members', memberParams],
        queryFn: () => getMembers(memberParams),
        staleTime: 2 * 60_000,
    });

    const sortedMembers = useMemo(() => {
        let sortableItems = [...members];
        if (sortConfig.key !== "") {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key] || 0;
                let bValue = b[sortConfig.key] || 0;

                // Handle derived percentage sorting for KPIweek tab
                if (sortConfig.key === 'kpi_achieved') {
                    const aEst = a.kpi_base_total || 0;
                    const aAct = a.kpi_total || 0;
                    aValue = aEst > 0 ? Math.round((aAct / aEst) * 100) : 0;
                    
                    const bEst = b.kpi_base_total || 0;
                    const bAct = b.kpi_total || 0;
                    bValue = bEst > 0 ? Math.round((bAct / bEst) * 100) : 0;
                }

                if (aValue < bValue) {
                    return sortConfig.direction === "asc" ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === "asc" ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [members, sortConfig]);

    if (!authorized) return null;

    return (
        <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] flex" style={{ fontFamily: "'Inter', sans-serif" }}>
            <Navbar />
            <div className={`flex-1 min-w-0 pl-0 ${sidebarCollapsed ? SIDEBAR_PAD_COLLAPSED : SIDEBAR_PAD_EXPANDED} pt-14 md:pt-0 flex flex-col min-h-screen transition-[padding] duration-200`}>
                {/* Header */}
                <div className="h-[56px] bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 sticky top-14 md:top-0 z-30 shadow-sm">
                    <h2 className="text-sm font-bold tracking-wider text-[#0f172a] uppercase">Thống Kê KPI Toàn Dự Án</h2>
                </div>

                {/* Tabbar Navigation */}
                <div className="bg-white border-b border-slate-200 px-4 md:px-8 flex gap-4 md:gap-6 z-20 overflow-x-auto">
                    <button
                        onClick={() => setActiveTab('KPItotal')}
                        className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${activeTab === 'KPItotal'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >   Tổng hợp KPI
                    </button>
                    <button
                        onClick={() => setActiveTab('KPIweek')}
                        className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${activeTab === 'KPIweek'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >   Tổng hợp KPI tuần
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 md:p-8 max-w-7xl w-full mx-auto space-y-6 min-w-0">

                    {/* Header Bảng */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">Bảng Xếp Hạng KPI Tổng</h1>
                            <p className="text-sm text-slate-500 mt-0.5">Thống kê tổng KPI của toàn bộ thành viên từ các Dự án và Meeting</p>
                        </div>
                    </div>

                    {/* Bộ lọc nổi bật */}
                    {(() => {
                        // Year's baseline is the current year (not ""), so
                        // "active filter" and the reset target both compare/
                        // restore against defaultYear instead of empty string.
                        const hasActiveFilter = activeTab === 'KPItotal'
                            ? !!(month || year !== defaultYear || search || level || team || leaderFilter || (!isLockedSingle && workspace))
                            : !!(startDate || endDate || leaderFilter);
                        const clearFilters = () => {
                            if (activeTab === 'KPItotal') {
                                setMonth(''); setYear(defaultYear); setSearch(''); setLevel(''); setTeam('');
                                if (!isLockedSingle) setWorkspace('');
                            } else {
                                setStartDate(''); setEndDate('');
                            }
                            setLeaderFilter('');
                        };
                        const leaderField = (
                            <label className={`${FILTER_FIELD_CLS} col-span-2`}>
                                <span className={FILTER_LABEL_CLS}>Leader</span>
                                <select value={leaderFilter} onChange={e => setLeaderFilter(e.target.value)} className={FILTER_INPUT_CLS}>
                                    <option value="">Tất cả</option>
                                    {leaderOptions.map(l => <option key={l.id} value={l.id}>{l.display_name} ({l.member_count})</option>)}
                                </select>
                            </label>
                        );
                        return (
                            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl px-5 py-4 shadow-sm flex flex-col gap-3">
                                <div className="flex items-center justify-between gap-2 border-b border-blue-100 pb-2 min-h-[34px]">
                                    <div className="flex items-center gap-2">
                                        <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                        </svg>
                                        <span className="text-sm font-bold text-blue-800 uppercase tracking-wider">Bộ lọc dữ liệu</span>
                                    </div>
                                    {hasActiveFilter && (
                                        <button onClick={clearFilters}
                                            className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-bold transition-all bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg border border-red-200">
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                            Xóa bộ lọc
                                        </button>
                                    )}
                                </div>

                                {activeTab === 'KPItotal' ? (
                                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                                        <label className={`${FILTER_FIELD_CLS} col-span-2 xl:col-span-1`}>
                                            <span className={FILTER_LABEL_CLS}>Tìm kiếm</span>
                                            <input
                                                type="text"
                                                placeholder="Tên thành viên..."
                                                value={search}
                                                onChange={e => setSearch(e.target.value)}
                                                className={FILTER_INPUT_CLS}
                                            />
                                        </label>

                                        <label className={FILTER_FIELD_CLS}>
                                            <span className={FILTER_LABEL_CLS}>Tháng</span>
                                            <select value={month} onChange={e => setMonth(e.target.value)} className={FILTER_INPUT_CLS}>
                                                <option value="">Tất cả</option>
                                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                                    <option key={m} value={m}>Tháng {m}</option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className={FILTER_FIELD_CLS}>
                                            <span className={FILTER_LABEL_CLS}>Năm</span>
                                            <select value={year} onChange={e => setYear(e.target.value)} className={FILTER_INPUT_CLS}>
                                                <option value="">Tất cả</option>
                                                {[2023, 2024, 2025, 2026, 2027].map(y => (
                                                    <option key={y} value={y}>Năm {y}</option>
                                                ))}
                                            </select>
                                        </label>

                                        {/* Workspace — three UI shapes depending on the
                                            user's authorized scope:
                                             - Super Admin → full dropdown
                                             - Single-Ws scoped user (Member/Viewer or
                                               single-Workspace Leader) → locked dropdown
                                               with the single assigned option
                                             - Multi-Ws Leader → "All authorized
                                               Workspaces" + one option per granted one */}
                                        <label className={FILTER_FIELD_CLS}>
                                            <span className={FILTER_LABEL_CLS}>Workspace</span>
                                            <select
                                                value={isLockedSingle ? lockedWorkspaceOptions[0].name : workspace}
                                                onChange={e => handleWorkspaceChange(e.target.value)}
                                                disabled={isLockedSingle}
                                                title={isLockedSingle
                                                    ? `Workspace cố định theo tài khoản: ${lockedWorkspaceOptions[0].name}`
                                                    : isMultiWs
                                                        ? 'Chọn một Workspace được gán hoặc kết hợp tất cả'
                                                        : undefined}
                                                className={`${FILTER_INPUT_CLS} disabled:cursor-not-allowed disabled:opacity-70`}
                                            >
                                                {isLockedSingle ? (
                                                    <option value={lockedWorkspaceOptions[0].name}>{lockedWorkspaceOptions[0].name}</option>
                                                ) : isMultiWs ? (
                                                    <>
                                                        <option value="">Tất cả được gán ({lockedWorkspaceOptions.length})</option>
                                                        {lockedWorkspaceOptions.map(w => (
                                                            <option key={w.code} value={w.name}>{w.name}</option>
                                                        ))}
                                                    </>
                                                ) : (
                                                    <>
                                                        <option value="">Tất cả</option>
                                                        {workspaceOptions.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                                                    </>
                                                )}
                                            </select>
                                        </label>

                                        <label className={FILTER_FIELD_CLS}>
                                            <span className={FILTER_LABEL_CLS}>Team</span>
                                            <select value={team} onChange={e => setTeam(e.target.value)} className={FILTER_INPUT_CLS}>
                                                <option value="">Tất cả</option>
                                                {teamOptions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                                            </select>
                                        </label>

                                        <label className={FILTER_FIELD_CLS}>
                                            <span className={FILTER_LABEL_CLS}>Level</span>
                                            <select value={level} onChange={e => setLevel(e.target.value)} className={FILTER_INPUT_CLS}>
                                                <option value="">Tất cả</option>
                                                {levelOptions.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                                            </select>
                                        </label>

                                        {leaderField}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                                        <label className={`${FILTER_FIELD_CLS} col-span-1 xl:col-span-2`}>
                                            <span className={FILTER_LABEL_CLS}>Từ ngày</span>
                                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={FILTER_INPUT_CLS} />
                                        </label>
                                        <label className={`${FILTER_FIELD_CLS} col-span-1 xl:col-span-2`}>
                                            <span className={FILTER_LABEL_CLS}>Đến ngày</span>
                                            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={FILTER_INPUT_CLS} />
                                        </label>
                                        {leaderField}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Table */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm relative">
                        {isLoading && (
                            <div className="absolute inset-0 z-50 bg-white/60 backdrop-blur-[2px] flex items-center justify-center rounded-xl">
                                <div className="flex flex-col items-center gap-3">
                                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                    <p className="text-sm font-semibold text-blue-900">Đang tải dữ liệu...</p>
                                </div>
                            </div>
                        )}
                        <div className="overflow-x-auto overflow-y-auto max-h-[60vh] relative">
                            <table className="w-full text-xs text-[#0f172a] whitespace-nowrap">
                                {activeTab === 'KPItotal' ? (
                                    <>
                                        <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
                                            <tr className="divide-x divide-slate-200">
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-12 bg-slate-50">STT</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 min-w-[200px]">Display Name</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Level</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Workspace</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Team</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("manday_total")}>
                                                    Manday <span className="ml-1 opacity-60">{sortConfig.key === 'manday_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_avg")}>
                                                    Trung bình KPI <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_avg' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_bonus")}>
                                                    KPI Bonus <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_bonus' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-blue-600 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_total")}>
                                                    Tổng KPI <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 border-t border-slate-200">
                                            {sortedMembers.map((m, idx) => (
                                                <tr key={m.id} onClick={() => setSelectedMemberModal(m)} className="hover:bg-slate-50/60 transition-colors group divide-x divide-slate-200 cursor-pointer">
                                                    <td className="px-4 py-3 text-slate-400 font-medium w-12 text-center">{idx + 1}</td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2.5">
                                                            <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px] border border-blue-100 group-hover:bg-blue-100 transition-colors">{m.display_name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-600 font-medium">{m.team || '-'}</td>
                                                    <td className="px-4 py-3 text-slate-600 font-medium">{m.workspace || '-'}</td>
                                                    <td className="px-4 py-3 text-slate-600 font-medium">{m.department || '-'}</td>
                                                    <td className={`px-4 py-3 text-center font-semibold tabular-nums ${(m.manday_total || 0) === 0 ? 'text-red-500' : 'text-slate-600'}`}>{(m.manday_total || 0).toFixed(1)}</td>
                                                    <td className={`group/copy px-4 py-3 text-center font-semibold tabular-nums ${(m.kpi_avg || 0) === 0 ? 'text-red-500' : 'text-slate-600'}`}><KpiCopyValue value={m.kpi_avg || 0} /></td>
                                                    <td className={`px-4 py-3 text-center font-semibold tabular-nums ${(m.kpi_bonus || 0) === 0 ? 'text-red-500' : 'text-slate-600'}`}>{m.kpi_bonus || 0}</td>
                                                    <td className={`group/copy px-4 py-3 text-center font-extrabold tabular-nums ${(m.kpi_total || 0) === 0 ? 'text-red-500' : 'text-blue-600'}`}><KpiCopyValue value={m.kpi_total || 0} /></td>
                                                </tr>
                                            ))}
                                            {members.length === 0 && (
                                                <tr>
                                                    <td colSpan={9} className="text-center py-16 text-slate-400 font-medium">
                                                        Đang tải danh sách thành viên...
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </>
                                ) : (
                                    <>
                                        <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
                                            <tr className="divide-x divide-slate-200">
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-12 bg-slate-50">STT</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 min-w-[200px]">Display Name</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("manday_est_total")}>
                                                    (P) MANDAY EST <span className="ml-1 opacity-60">{sortConfig.key === 'manday_est_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("manday_total")}>
                                                    (P) MANDAY ACTUAL <span className="ml-1 opacity-60">{sortConfig.key === 'manday_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_base_total")}>
                                                    (P) KPI EST <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_base_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_total")}>
                                                    (P) KPI ACTUAL <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_achieved")}>
                                                    (P) % KPI ACHIEVED <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_achieved' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">
                                                    (P) TASKS PROGRESS
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 border-t border-slate-200">
                                            {sortedMembers.map((m, idx) => {
                                                const md_est = m.manday_est_total || 0;
                                                const md_act = m.manday_total || 0;
                                                const kpi_est = m.kpi_base_total || 0;
                                                const kpi_act = m.kpi_total || 0;
                                                const achieved = kpi_est > 0 ? Math.round((kpi_act / kpi_est) * 100) : 0;
                                                return (
                                                    <tr key={m.id} onClick={() => setSelectedMemberModal(m)} className="hover:bg-slate-50/60 transition-colors group divide-x divide-slate-200 cursor-pointer">
                                                        <td className="px-4 py-3 text-slate-400 font-medium w-12 text-center">{idx + 1}</td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-2.5">
                                                                <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px] border border-blue-100 group-hover:bg-blue-100 transition-colors">{m.display_name}</span>
                                                            </div>
                                                        </td>
                                                        
                                                        <td className={`px-4 py-3 text-center font-semibold tabular-nums ${md_est === 0 ? 'text-slate-400' : 'text-slate-600'}`}>{md_est === 0 ? '0' : md_est.toFixed(1)}</td>
                                                        <td className={`px-4 py-3 text-center font-semibold tabular-nums ${md_act === 0 ? 'text-slate-400' : 'text-slate-600'}`}>{md_act === 0 ? '0' : md_act.toFixed(1)}</td>
                                                        <td className={`px-4 py-3 text-center font-semibold tabular-nums ${kpi_est === 0 ? 'text-slate-400' : 'text-slate-600'}`}>{kpi_est === 0 ? '0' : kpi_est.toFixed(2)}</td>
                                                        <td className={`px-4 py-3 text-center font-semibold tabular-nums ${kpi_act === 0 ? 'text-slate-400' : 'text-slate-600'}`}>{kpi_act === 0 ? '0' : kpi_act.toFixed(2)}</td>
                                                        
                                                        <td className={`px-4 py-3 text-center font-bold tabular-nums ${achieved === 0 ? 'text-slate-400' : (achieved >= 100 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50')}`}>
                                                            {`${achieved}%`}
                                                        </td>
                                                        
                                                        <td className="px-4 py-3 text-center font-semibold text-slate-400">-</td>
                                                    </tr>
                                                );
                                            })}
                                            {members.length === 0 && (
                                                <tr>
                                                    <td colSpan={8} className="text-center py-16 text-slate-400 font-medium">
                                                        Đang tải danh sách thành viên...
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </>
                                )}
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* KPI MEMBER DETAIL MODAL */}
            {selectedMemberModal && (
                <KpiMemberDetailModal
                    member={selectedMemberModal}
                    tasks={allTasks}
                    projects={allProjects}
                    onClose={() => setSelectedMemberModal(null)}
                    onNavigate={handleNavigateToProject}
                    initialYear={year ? parseInt(year) : new Date().getFullYear()}
                    initialMonth={month ? parseInt(month) : new Date().getMonth() + 1}
                    workspaceCode={effectiveWorkspaceCode}
                />
            )}
        </div>
    );
}