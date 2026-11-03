'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllProjectTasks } from '@/lib/api';
import { formatProjectCardTitle } from '@/lib/projectDisplay';
import { useSidebarCollapse } from '@/lib/sidebarCollapse';

export interface ProjectTaskListPanelProps {
  project: any;
  onClose: () => void;
  onNavigateToProject?: (projectId: number | string) => void;
}

export default function ProjectTaskListPanel({
  project,
  onClose,
  onNavigateToProject,
}: ProjectTaskListPanelProps) {
  const { collapsed: sidebarCollapsed } = useSidebarCollapse();
  const projectId = project?.id != null ? Number(project.id) : null;

  // Fetch tasks of this project using the existing getAllProjectTasks API endpoint
  const {
    data: rawTasks = [],
    isLoading,
    isError,
    error,
  } = useQuery<any[]>({
    queryKey: ['project-all-tasks', projectId],
    queryFn: () => (projectId ? getAllProjectTasks(projectId) : Promise.resolve([])),
    enabled: projectId != null && !isNaN(projectId),
    staleTime: 30_000,
  });

  const [taskFilter, setTaskFilter] = useState<'all' | 'open' | 'done' | 'critical' | 'overdue'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [contentVisible, setContentVisible] = useState(true);
  const prevProjectIdRef = useRef(projectId);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Soft crossfade & scroll reset on project switch (pattern "ghi đè trực tiếp, không đóng/mở lại")
  useEffect(() => {
    if (prevProjectIdRef.current === projectId) return;
    prevProjectIdRef.current = projectId;
    setTaskFilter('all');
    setSearchQuery('');
    drawerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setContentVisible(false);
    const raf = requestAnimationFrame(() => setContentVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [projectId]);

  const crossfadeClass = `transition-opacity duration-200 ${contentVisible ? 'opacity-100' : 'opacity-0'}`;

  // Statistics
  const stats = useMemo(() => {
    const total = rawTasks.length;
    let done = 0;
    let open = 0;
    let critical = 0;
    let overdue = 0;
    let totalManday = 0;

    const todayStr = new Date().toISOString().slice(0, 10);

    for (const t of rawTasks) {
      const isDone = t.status === 'Done' || t.status === 'done';
      if (isDone) {
        done++;
      } else {
        open++;
        const dl = t.end_date_est || t.deadline;
        if (dl && String(dl).slice(0, 10) < todayStr) {
          overdue++;
        }
      }

      if ((t.priority || '').toLowerCase() === 'critical') {
        critical++;
      }

      const md = Number(t.manday_est ?? t.manday_actual ?? 0);
      if (!isNaN(md)) {
        totalManday += md;
      }
    }

    return { total, done, open, critical, overdue, totalManday: Math.round(totalManday * 10) / 10 };
  }, [rawTasks]);

  // Filtered task list
  const filteredTasks = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const q = searchQuery.trim().toLowerCase();

    return rawTasks.filter((t) => {
      // 1. Status/Priority Filter
      const isDone = t.status === 'Done' || t.status === 'done';
      if (taskFilter === 'open' && isDone) return false;
      if (taskFilter === 'done' && !isDone) return false;
      if (taskFilter === 'critical' && (t.priority || '').toLowerCase() !== 'critical') return false;
      if (taskFilter === 'overdue') {
        if (isDone) return false;
        const dl = t.end_date_est || t.deadline;
        if (!dl || String(dl).slice(0, 10) >= todayStr) return false;
      }

      // 2. Search query filter
      if (q) {
        const detail = (t.detail || t.name || '').toLowerCase();
        const code = (t.task_code || '').toLowerCase();
        const assigned = (t.assigned_name || '').toLowerCase();
        const support = (t.support_name || '').toLowerCase();
        const group = (t.task_group_name || '').toLowerCase();
        if (!detail.includes(q) && !code.includes(q) && !assigned.includes(q) && !support.includes(q) && !group.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [rawTasks, taskFilter, searchQuery]);

  // Priority badge styling
  const renderPriorityBadge = (priority?: string) => {
    const prio = (priority || 'normal').toLowerCase();
    switch (prio) {
      case 'critical':
        return <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-purple-100 text-purple-700 border border-purple-200">Critical</span>;
      case 'high':
        return <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-orange-100 text-orange-700 border border-orange-200">High</span>;
      case 'interrupt':
        return <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-indigo-100 text-indigo-700 border border-indigo-200">Interrupt</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200">Normal</span>;
    }
  };

  // Status badge styling
  const renderStatusBadge = (status?: string) => {
    const st = (status || 'waiting').toLowerCase();
    if (st === 'done') {
      return <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Done</span>;
    }
    if (st.includes('progress') || st.includes('doing')) {
      return <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-blue-50 text-blue-700 border border-blue-200">In Progress</span>;
    }
    if (st.includes('review')) {
      return <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-purple-50 text-purple-700 border border-purple-200">Review</span>;
    }
    if (st.includes('cancel')) {
      return <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-rose-50 text-rose-600 border border-rose-200">Cancel</span>;
    }
    return <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Waiting</span>;
  };

  // Format date helper
  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      const parts = dateStr.slice(0, 10).split('-');
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  if (!project) return null;

  const projectTitle = formatProjectCardTitle(project);

  return (
    <div className="fixed inset-0 z-40 overflow-hidden pointer-events-none">
      {/* 
        LEFT SIDE DRAWER PANEL
        - Docked after sidebar on desktop: `md:left-[230px]` (or `md:left-16` if collapsed).
        - Does NOT cover the navigation sidebar (z-30).
        - z-40 sits cleanly above in-page content, below right panel (z-50).
      */}
      <div
        ref={drawerRef}
        className={`pointer-events-auto fixed inset-y-0 ${
          sidebarCollapsed ? 'md:left-16' : 'md:left-[230px]'
        } left-0 z-40 w-full max-w-xl xl:max-w-2xl bg-white h-full shadow-2xl overflow-y-auto custom-scrollbar flex flex-col border-r border-slate-200 transition-[left] duration-200 animate-in slide-in-from-left duration-200`}
      >
        {/* HEADER */}
        <div className="sticky top-0 z-20 bg-white px-5 py-4 border-b border-slate-100 flex items-center justify-between shadow-xs">
          <div className={`flex items-center gap-3 min-w-0 ${crossfadeClass}`}>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0058be] border border-blue-200 flex items-center justify-center font-black text-base shrink-0 shadow-xs">
              📁
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-extrabold text-[#0b1c30] tracking-tight truncate max-w-md" title={projectTitle}>
                  {projectTitle}
                </h2>
                {project.data_scope && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase">
                    {project.data_scope}
                  </span>
                )}
              </div>
              <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                Danh sách Task của Dự án · {stats.total} task · {stats.totalManday} MD
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onNavigateToProject && (
              <button
                type="button"
                onClick={() => onNavigateToProject(project.id)}
                className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold text-[#0058be] bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer border border-blue-200"
                title="Mở trang chi tiết dự án"
              >
                <span>Xem dự án</span>
                <span>➔</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors flex items-center justify-center font-bold text-sm cursor-pointer shrink-0"
              title="Đóng panel danh sách task (✕)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* BODY */}
        <div className={`p-5 space-y-4 flex-1 ${crossfadeClass}`}>
          {/* 1. Quick Stats */}
          <div className="grid grid-cols-5 gap-2">
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 text-center">
              <span className="text-base font-black text-[#0b1c30] leading-none block">{stats.total}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-1">Tổng task</span>
            </div>
            <div className="bg-blue-50/60 border border-blue-200/60 rounded-xl p-2 text-center">
              <span className="text-base font-black text-[#0058be] leading-none block">{stats.open}</span>
              <span className="text-[8px] font-bold text-blue-500 uppercase tracking-tight block mt-1">Chưa xong</span>
            </div>
            <div className="bg-emerald-50/60 border border-emerald-200/60 rounded-xl p-2 text-center">
              <span className="text-base font-black text-emerald-600 leading-none block">{stats.done}</span>
              <span className="text-[8px] font-bold text-emerald-600 uppercase tracking-tight block mt-1">Đã xong</span>
            </div>
            <div className="bg-purple-50/60 border border-purple-200/60 rounded-xl p-2 text-center">
              <span className="text-base font-black text-purple-700 leading-none block">{stats.critical}</span>
              <span className="text-[8px] font-bold text-purple-600 uppercase tracking-tight block mt-1">Critical</span>
            </div>
            <div className="bg-rose-50/60 border border-rose-200/60 rounded-xl p-2 text-center">
              <span className="text-base font-black text-rose-600 leading-none block">{stats.overdue}</span>
              <span className="text-[8px] font-bold text-rose-500 uppercase tracking-tight block mt-1">Trễ hạn</span>
            </div>
          </div>

          {/* 2. Filter tabs & Search */}
          <div className="flex flex-col sm:flex-row gap-2 justify-between items-stretch sm:items-center">
            <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0 custom-scrollbar">
              {(
                [
                  { key: 'all', label: `Tất cả (${stats.total})` },
                  { key: 'open', label: `Chưa xong (${stats.open})` },
                  { key: 'critical', label: `Critical (${stats.critical})` },
                  { key: 'overdue', label: `Trễ (${stats.overdue})` },
                  { key: 'done', label: `Done (${stats.done})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setTaskFilter(tab.key)}
                  className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold transition-all whitespace-nowrap cursor-pointer ${
                    taskFilter === tab.key
                      ? 'bg-[#0058be] text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="relative shrink-0 sm:w-44">
              <input
                type="text"
                placeholder="Tìm task / người..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs font-semibold px-2.5 py-1.5 pl-7 border border-slate-200 rounded-lg outline-none focus:border-[#0058be] focus:ring-1 focus:ring-blue-100 transition-all placeholder:text-slate-400"
              />
              <span className="absolute left-2 top-2 text-xs text-slate-400">🔍</span>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1.5 text-xs text-slate-400 hover:text-slate-600 font-bold"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* 3. Task Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs font-medium">Đang tải danh sách task của dự án...</p>
              </div>
            ) : isError ? (
              <div className="p-6 text-center text-rose-600 text-xs font-semibold bg-rose-50/50">
                <p>⚠️ Không thể tải danh sách task của dự án này.</p>
                <p className="text-[10px] text-slate-400 mt-1">{(error as any)?.message || 'Vui lòng thử lại sau.'}</p>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs font-semibold">
                {rawTasks.length === 0 ? 'Dự án này chưa có task nào.' : 'Không có task nào khớp bộ lọc.'}
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[60vh] custom-scrollbar">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-200 sticky top-0 z-10">
                      <th className="px-3 py-2.5 min-w-[200px]">TÊN TASK</th>
                      <th className="px-3 py-2.5 text-center whitespace-nowrap">TRẠNG THÁI</th>
                      <th className="px-3 py-2.5 whitespace-nowrap">ASSIGNED</th>
                      <th className="px-3 py-2.5 text-center whitespace-nowrap">PRIORITY</th>
                      <th className="px-3 py-2.5 text-center whitespace-nowrap">DEADLINE</th>
                      <th className="px-3 py-2.5 text-right whitespace-nowrap">MD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTasks.map((t, idx) => {
                      const taskTitle = t.detail || t.name || t.task_code || `Task #${t.id}`;
                      const deadlineStr = formatDate(t.end_date_est || t.end_date_actual || t.deadline || t.start_date);
                      const mdVal = t.manday_est != null ? Number(t.manday_est).toFixed(1) : (t.manday_actual != null ? Number(t.manday_actual).toFixed(1) : '—');

                      return (
                        <tr key={t.id || idx} className="hover:bg-slate-50/80 transition-colors group">
                          {/* 1. TÊN TASK */}
                          <td className="px-3 py-2.5">
                            <div className="font-bold text-[#0b1c30] text-[12px] leading-snug line-clamp-2" title={taskTitle}>
                              {taskTitle}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {t.task_code && (
                                <span className="text-[9px] font-mono font-bold text-slate-500 bg-slate-100 px-1 rounded border border-slate-200">
                                  {t.task_code}
                                </span>
                              )}
                              {t.task_group_name && (
                                <span className="text-[9px] text-slate-400 font-medium truncate max-w-[130px]" title={t.task_group_name}>
                                  📁 {t.task_group_name}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 2. TRẠNG THÁI */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {renderStatusBadge(t.status)}
                          </td>

                          {/* 3. ASSIGNED */}
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 font-black text-[9px] flex items-center justify-center shrink-0">
                                {t.assigned_name ? t.assigned_name.charAt(0).toUpperCase() : '?'}
                              </span>
                              <div className="min-w-0">
                                <p className="text-[11px] font-bold text-slate-800 truncate max-w-[100px]" title={t.assigned_name || 'Chưa giao'}>
                                  {t.assigned_name || '—'}
                                </p>
                                {t.support_name && (
                                  <p className="text-[9px] text-slate-400 font-medium truncate max-w-[100px]" title={`Support: ${t.support_name}`}>
                                    + {t.support_name}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* 4. PRIORITY */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {renderPriorityBadge(t.priority)}
                          </td>

                          {/* 5. DEADLINE */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap font-semibold text-slate-700 text-[11px]">
                            {deadlineStr}
                          </td>

                          {/* 6. MD */}
                          <td className="px-3 py-2.5 text-right whitespace-nowrap font-bold text-[#0058be] text-[11px]">
                            {mdVal}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

