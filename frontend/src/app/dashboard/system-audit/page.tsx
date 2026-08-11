'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import KpiCard from '@/components/dashboard/KpiCard';
import ProgressBar from '@/components/dashboard/ProgressBar';
import BarChartCard from '@/components/dashboard/BarChartCard';
import SvgIcon from '@/components/dashboard/Icons';
import { projectStatusBadge, projectBarColor } from '@/app/dashboard/constants';

export default function SystemAuditTab() {
  const [selectedMonth, setSelectedMonth] = useState('08/2026');
  const [showAllProjects, setShowAllProjects] = useState(false);

  // System Audit Logs State
  const [auditPage, setAuditPage] = useState(1);
  const [auditModule, setAuditModule] = useState('all');
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchSystemAuditData = useCallback(async () => {
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

    // Parallel fast fetch for projects, tasks, members, analytics, logs, AND master phases from Settings
    const [projRes, tasksRes, membersRes, analyticsRes, logsRes, masterPhasesRes] = await Promise.all([
      axios.get(`/api/projects?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/all-tasks-global?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/members?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/system-audit/analytics?_t=${ts}`, config).catch(() => ({ data: {} })),
      axios.get(`/api/system-audit/logs?page=${auditPage}&page_size=15&_t=${ts}`, config).catch(() => ({ data: { items: [], total: 0 } })),
      axios.get(`/api/system-categories/master-phases?_t=${ts}`, config).catch(() => ({ data: [] })),
    ]);
    const projects = projRes.data || [];
      const allTasksCombined = tasksRes.data || [];
      const masterPhases = masterPhasesRes.data || [];

      // Calculate Dynamic Phase Distribution using Master Phases from Settings
      const phaseCounts: Record<string, number> = {};
      
      // Initialize counts for all master phases defined in Settings
      masterPhases.forEach((mp: any) => {
        if (mp.name) phaseCounts[mp.name] = 0;
      });

      projects.forEach((p: any) => {
        const ph = p.current_phase || (masterPhases[0]?.name || '1. Tư vấn');
        if (phaseCounts[ph] !== undefined) {
          phaseCounts[ph]++;
        } else {
          phaseCounts[ph] = (phaseCounts[ph] || 0) + 1;
        }
      });

      // Filter phases to show in chart
      let pStats = masterPhases
        .map((mp: any) => ({
          name: mp.name,
          count: phaseCounts[mp.name] || 0
        }))
        .filter((item: any) => item.count > 0 || masterPhases.length <= 8);

      if (pStats.length === 0) {
        pStats = Object.keys(phaseCounts).map(k => ({ name: k, count: phaseCounts[k] }));
      }

      let allDone = 0, allInProg = 0, allOverdue = 0, allTasksCount = 0;
      const pRisk: any[] = [];
      
      const allProjectsProgressList = projects.map((p: any) => {
        const tasks = allTasksCombined.filter((t: any) => t.project_id === p.id);
        allTasksCount += tasks.length;
        
        let pDone = 0, pOverdue = 0;
        tasks.forEach((t: any) => {
          if (t.status === 'Done') { pDone++; allDone++; }
          else {
            allInProg++;
            if (t.days_late > 0) { pOverdue++; allOverdue++; }
          }
        });
        
        const prog = tasks.length > 0 ? Math.round((pDone / tasks.length) * 100) : 0;
        
        if (pOverdue > 0) {
          pRisk.push({
            id: p.id,
            name: p.name,
            overdueTask: pOverdue,
            deadline: p.end_date_est || 'N/A',
            risk: pOverdue > 3 ? 'Cao' : (pOverdue > 1 ? 'Trung bình' : 'Thấp')
          });
        }
        
        return { id: p.id, name: p.name, status: p.status || 'Developing', current_phase: p.current_phase || '1. Tư vấn', progress: prog, totalTasks: tasks.length, doneTasks: pDone };
      });

      const sortedProjects = allProjectsProgressList.sort((a: any, b: any) => b.progress - a.progress);
      const sortedRisk = pRisk.sort((a: any, b: any) => b.overdueTask - a.overdueTask).slice(0, 5);
      const tStats = { total: allTasksCount, done: allDone, inProgress: allInProg, overdue: allOverdue };

      // Members distribution
      const list = membersRes.data || [];
      const infra: any[] = [];
      const markee: any[] = [];
      
      list.forEach((m: any) => {
        const item = {
          name: m.full_name || m.display_name || 'No Name',
          role: m.position || 'Dev',
          kpi: m.kpi_total || 0,
        };
        if (m.team?.toLowerCase().includes('infra') || m.department?.toLowerCase().includes('infra') || infra.length < markee.length) {
          infra.push(item);
        } else {
          markee.push(item);
        }
      });
      const infraSorted = infra.sort((a,b) => b.kpi - a.kpi);
      const markeeSorted = markee.sort((a,b) => b.kpi - a.kpi);

      // Analytics
      const analyticsData = {
        top_active_users: analyticsRes.data?.top_active_users || [],
        top_updated_projects: analyticsRes.data?.top_updated_projects || [],
        top_ai_users: analyticsRes.data?.top_ai_users || [],
        top_login_failures: analyticsRes.data?.top_login_failures || []
      };

      // Logs
      const logs = logsRes.data?.items || [];
      const total = logsRes.data?.total || 0;

    return {
      activeProjectsProgress: sortedProjects,
      projectsAtRisk: sortedRisk,
      taskStats: tStats,
      phaseStats: pStats,
      infraMembers: infraSorted,
      markeeMembers: markeeSorted,
      analytics: analyticsData,
      auditLogs: logs,
      auditTotal: total,
    };
  }, [auditPage]);

  const { data: auditData, isFetching: loading, refetch } = useQuery({
    queryKey: ['dashboard-system-audit', auditPage],
    queryFn: fetchSystemAuditData,
    staleTime: 2 * 60_000,
  });

  const activeProjectsProgress: any[] = auditData?.activeProjectsProgress || [];
  const projectsAtRisk: any[] = auditData?.projectsAtRisk || [];
  const taskStats = auditData?.taskStats || { total: 0, done: 0, inProgress: 0, overdue: 0 };
  const phaseStats: any[] = auditData?.phaseStats || [];
  const infraMembers: any[] = auditData?.infraMembers || [];
  const markeeMembers: any[] = auditData?.markeeMembers || [];
  const analytics: {
    top_active_users: any[];
    top_updated_projects: any[];
    top_ai_users: any[];
    top_login_failures: any[];
  } = auditData?.analytics || {
    top_active_users: [],
    top_updated_projects: [],
    top_ai_users: [],
    top_login_failures: [],
  };
  const auditLogs: any[] = auditData?.auditLogs || [];
  const auditTotal = auditData?.auditTotal || 0;

  const superAdminCards = [
    { label: 'Tổng Số Dự Án',      value: activeProjectsProgress.length, icon: 'project',   border: 'border-l-[#0058be]',  text: 'text-[#0058be]',  trend: 'Toàn hệ thống' },
    { label: 'Tổng Task Hệ Thống', value: taskStats.total,              icon: 'tasks',     border: 'border-l-[#0058be]',  text: 'text-[#0058be]',  trend: 'Tất cả dự án' },
    { label: 'Dự Án Trễ/Rủi Ro',   value: projectsAtRisk.length,        icon: 'alert',     border: 'border-l-red-500',     text: 'text-red-600',    trend: 'Cần can thiệp' },
    { label: 'Task Hoàn Thành',    value: taskStats.done,               icon: 'check',     border: 'border-l-emerald-500', text: 'text-emerald-600', trend: taskStats.total ? `${Math.round(taskStats.done/taskStats.total*100)}%` : '0%' },
  ];

  const displayedProjects = activeProjectsProgress;

  return (
    <div className="p-6 space-y-5">
      {/* Super Admin Control Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">System Audit & Super Admin Control Panel</h3>
          {loading && <span className="text-[10px] text-blue-600 font-semibold animate-pulse">Đang cập nhật dữ liệu hệ thống...</span>}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 hidden sm:block">Bộ lọc thời gian:</span>
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm text-[11px] font-bold">
              <span className="text-slate-500">Tháng:</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent border-none text-[#0058be] font-bold focus:outline-none cursor-pointer"
              >
                <option value="08/2026">08/2026</option>
                <option value="07/2026">07/2026</option>
                <option value="06/2026">06/2026</option>
              </select>
            </div>
          </div>

          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm text-[11px] font-bold transition-all active:scale-95 cursor-pointer"
          >
            <SvgIcon name="refresh" className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#0058be]' : 'text-slate-500'}`} />
            LÀM MỚI
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {superAdminCards.map(c => <KpiCard key={c.label} {...c} />)}
      </div>

      {/* FULL WIDTH: Tiến độ tất cả dự án (Default 6 projects + Xem thêm toggle) */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden p-5">
        <div className="flex justify-between items-center pb-4 mb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <SvgIcon name="chart" className="w-4 h-4 text-[#0058be]" />
            <div>
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Tiến Độ Dự Án Trong Hệ Thống</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Hiển thị {activeProjectsProgress.length} dự án. Bấm vào dự án để xem chi tiết.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-h-[400px] overflow-y-auto pr-2 pb-2 custom-scrollbar">
          {displayedProjects.length === 0 ? (
            <p className="col-span-3 text-center text-slate-400 text-xs py-6 font-semibold">Chưa có dữ liệu dự án.</p>
          ) : (
            displayedProjects.map(p => (
              <Link
                key={p.id}
                href={`/project/detail?id=${p.id}`}
                className="group p-4 bg-slate-50/60 border border-slate-200/80 rounded-xl hover:border-blue-400 hover:shadow-md hover:bg-blue-50/30 transition-all cursor-pointer block"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#0b1c30] group-hover:text-blue-600 transition-colors truncate" title={p.name}>{p.name}</span>
                  <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${projectStatusBadge[p.status] || 'bg-slate-100 text-slate-500'}`}>{p.status}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 mb-2">
                  <span>Giai đoạn: <strong className="text-slate-700">{p.current_phase}</strong></span>
                  <span>{p.doneTasks}/{p.totalTasks} task</span>
                </div>
                <ProgressBar value={p.progress} color={projectBarColor[p.status] || 'bg-blue-500'} height="h-2.5" />
                <div className="flex justify-between items-center mt-2.5 text-[10px]">
                  <span className="font-bold text-slate-400">Tiến độ hoàn thành:</span>
                  <span className="font-extrabold text-[#0058be] text-xs">{p.progress}%</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Row 2: Phase Distribution & Projects at Risk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarChartCard
          title="Phân bố Giai đoạn Dự án (Danh mục Hệ thống - Settings)"
          data={phaseStats}
          bars={[{ key: 'count', name: 'Số dự án thuộc giai đoạn', fill: '#0058be' }]}
          xKey="name"
        />

        <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden flex flex-col justify-between">
          <div>
            <div className="px-5 py-4 border-b border-red-100 bg-red-50/50 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <SvgIcon name="alert" className="w-4 h-4 text-red-600" />
                <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider">Dự Án Có Mức Độ Rủi Ro / Trễ Hạn</h3>
              </div>
              <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{projectsAtRisk.length} rủi ro</span>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto max-h-[300px] custom-scrollbar">
              {projectsAtRisk.length === 0 ? (
                <p className="text-xs text-slate-400 font-semibold text-center py-6">Tuyệt vời! Không có dự án nào bị rủi ro trễ hạn.</p>
              ) : (
                projectsAtRisk.map(p => (
                  <Link
                    key={p.id}
                    href={`/project/detail?id=${p.id}`}
                    className="flex items-center justify-between p-3 bg-red-50/60 rounded-xl border border-red-100 hover:border-red-300 hover:bg-red-50 transition-all cursor-pointer block"
                  >
                    <div>
                      <p className="text-xs font-bold text-[#0b1c30] hover:text-red-700">{p.name}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Số task trễ hạn: <strong className="text-red-600">{p.overdueTask} tasks</strong></p>
                    </div>
                    <span className="text-[10px] font-extrabold text-red-700 bg-red-100 px-2.5 py-1 rounded-full uppercase">Rủi ro {p.risk}</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Member KPI Distribution (Infrastructure vs Markee) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Team Infrastructure */}
        <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <SvgIcon name="project" className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Phân Bổ KPI — Team Infrastructure</h3>
            </div>
            <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-full">{infraMembers.length} thành viên</span>
          </div>
          <div className="p-4 overflow-y-auto max-h-64 space-y-2">
            {infraMembers.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Chưa có thành viên nào.</p>
            ) : (
              infraMembers.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center">{idx + 1}</span>
                    <div>
                      <p className="text-xs font-bold text-[#0b1c30]">{m.name}</p>
                      <p className="text-[9px] text-slate-400">{m.role}</p>
                    </div>
                  </div>
                  <span className="text-xs font-extrabold text-[#0058be] bg-blue-50 px-2.5 py-1 rounded-lg">{m.kpi.toFixed(1)} KPI</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Team Markee */}
        <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-purple-50/50 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <SvgIcon name="crown" className="w-4 h-4 text-purple-600" />
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Phân Bổ KPI — Team Markee</h3>
            </div>
            <span className="text-[10px] font-bold bg-purple-100 text-purple-600 px-2.5 py-0.5 rounded-full">{markeeMembers.length} thành viên</span>
          </div>
          <div className="p-4 overflow-y-auto max-h-64 space-y-2">
            {markeeMembers.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Chưa có thành viên nào.</p>
            ) : (
              markeeMembers.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-purple-50/40 border border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center">{idx + 1}</span>
                    <div>
                      <p className="text-xs font-bold text-[#0b1c30]">{m.name}</p>
                      <p className="text-[9px] text-slate-400">{m.role}</p>
                    </div>
                  </div>
                  <span className="text-xs font-extrabold text-purple-600 bg-purple-50 px-2.5 py-1 rounded-lg">{m.kpi.toFixed(1)} KPI</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* SYSTEM AUDIT LOGS TABLE */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2">
            <SvgIcon name="lock" className="w-4 h-4 text-blue-600" />
            <div>
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">System Audit Logs (Nhật ký truy vết toàn hệ thống)</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Tổng số bản ghi: {auditTotal}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={auditModule}
              onChange={(e) => { setAuditModule(e.target.value); setAuditPage(1); }}
              className="text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1 focus:outline-none focus:ring-1 focus:ring-[#0058be]"
            >
              <option value="all">Tất cả Module</option>
              <option value="project">Project</option>
              <option value="task">Task</option>
              <option value="phase">Phase</option>
              <option value="user">User / Account</option>
              <option value="setting">Setting</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-400 border-b border-slate-100 uppercase text-[10px] tracking-wider">
                <th className="px-4 py-3 text-left font-bold">Thời Gian</th>
                <th className="px-4 py-3 text-left font-bold">Người Thực Hiện</th>
                <th className="px-4 py-3 text-center font-bold">Thao Tác</th>
                <th className="px-4 py-3 text-center font-bold">Module</th>
                <th className="px-5 py-3 text-left font-bold">Nội Dung Chi Tiết</th>
              </tr>
            </thead>
            <tbody>
              {auditLoading ? (
                <tr><td colSpan={5} className="text-center py-6 text-slate-400 font-semibold">Đang tải nhật ký kiểm toán...</td></tr>
              ) : auditLogs.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-6 text-slate-400 font-semibold">Không tìm thấy bản ghi kiểm toán nào.</td></tr>
              ) : (
                auditLogs.map((log, idx) => (
                  <tr key={log.id || idx} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                      {log.created_at ? new Date(log.created_at).toLocaleString('vi-VN') : '—'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#0b1c30]">
                      {log.user_name || 'System Auto'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                        log.action === 'CREATE' ? 'bg-emerald-100 text-emerald-700' :
                        log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
                        log.action === 'DELETE' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                      }`}>{log.action}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold">{log.module}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600 leading-snug">
                      {log.description || `${log.action} trên ${log.module}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {auditTotal > 15 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40 text-xs">
            <span className="text-slate-400 font-semibold">Trang {auditPage} / {Math.ceil(auditTotal / 15)}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                disabled={auditPage === 1}
                className="px-3 py-1 bg-white border border-slate-200 rounded text-slate-600 font-bold disabled:opacity-40"
              >
                Trước
              </button>
              <button
                onClick={() => setAuditPage(p => p + 1)}
                disabled={auditPage * 15 >= auditTotal}
                className="px-3 py-1 bg-white border border-slate-200 rounded text-slate-600 font-bold disabled:opacity-40"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM SECTION: 4 ANALYTICS TABLES */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. TOP ACTIVE USERS */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm min-h-[140px] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <SvgIcon name="chart" className="w-4 h-4 text-[#0058be]" />
              <h4 className="text-[11px] font-extrabold text-[#0058be] tracking-wider uppercase">TOP ACTIVE USERS</h4>
            </div>
            <div className="space-y-2">
              {analytics.top_active_users.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-4">Không có dữ liệu.</p>
              ) : (
                analytics.top_active_users.slice(0, 5).map((u, i) => (
                  <div key={u.user_id || i} className="flex items-center justify-between p-2 px-3 rounded-lg bg-[#f8fafc] border border-slate-100/80">
                    <span className="text-xs font-bold text-[#0b1c30]">{i + 1}. {u.name}</span>
                    <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded whitespace-nowrap">{u.total_actions} tác vụ</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 2. TOP UPDATED PROJECTS */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm min-h-[140px] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <SvgIcon name="folder" className="w-4 h-4 text-amber-500" />
              <h4 className="text-[11px] font-extrabold text-amber-700 tracking-wider uppercase">TOP UPDATED PROJECTS</h4>
            </div>
            <div className="space-y-2">
              {analytics.top_updated_projects.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-4">Không có dữ liệu.</p>
              ) : (
                analytics.top_updated_projects.slice(0, 5).map((p, i) => (
                  <Link
                    key={p.project_id || i}
                    href={`/project/detail?id=${p.project_id}`}
                    className="flex items-center justify-between p-2 px-3 rounded-lg bg-[#f8fafc] border border-slate-100/80 hover:border-amber-300 hover:bg-amber-50/50 transition-all cursor-pointer block"
                  >
                    <span className="text-xs font-bold text-[#0b1c30] truncate max-w-[130px]">{i + 1}. {p.name}</span>
                    <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded whitespace-nowrap">{p.total_updates} lượt sửa</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 3. TOP AI USERS */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm min-h-[140px] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <SvgIcon name="ai" className="w-4 h-4 text-purple-600" />
              <h4 className="text-[11px] font-extrabold text-purple-700 tracking-wider uppercase">TOP AI USERS</h4>
            </div>
            <div className="space-y-2">
              {analytics.top_ai_users.length === 0 ? (
                <div className="py-6"></div>
              ) : (
                analytics.top_ai_users.slice(0, 5).map((u, i) => (
                  <div key={u.user_id || i} className="flex items-center justify-between p-2 px-3 rounded-lg bg-[#f8fafc] border border-slate-100/80">
                    <span className="text-xs font-bold text-[#0b1c30]">{i + 1}. {u.name}</span>
                    <span className="text-[11px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded whitespace-nowrap">{u.total_checks} lượt dùng</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 4. TOP FAILED LOGINS (IPS) */}
        <div className="bg-white rounded-xl border border-red-200 p-4 shadow-sm min-h-[140px] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <SvgIcon name="alert" className="w-4 h-4 text-red-600" />
              <h4 className="text-[11px] font-extrabold text-red-600 tracking-wider uppercase">TOP FAILED LOGINS (IPS)</h4>
            </div>
            <div className="space-y-2">
              {analytics.top_login_failures.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-6">Không có cảnh báo thất bại.</p>
              ) : (
                analytics.top_login_failures.slice(0, 5).map((f, i) => (
                  <div key={i} className="flex items-center justify-between p-2 px-3 rounded-lg bg-red-50/50 border border-red-100">
                    <span className="text-xs font-bold text-red-700">{i + 1}. {f.ip_address}</span>
                    <span className="text-[11px] font-semibold text-red-600 bg-white border border-red-200 px-2 py-0.5 rounded whitespace-nowrap">{f.total_failures} lần lỗi</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
