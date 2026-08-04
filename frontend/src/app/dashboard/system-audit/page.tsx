'use client';

import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { getToken } from '@/lib/auth';
import KpiCard from '@/components/dashboard/KpiCard';
import ProgressBar from '@/components/dashboard/ProgressBar';
import BarChartCard from '@/components/dashboard/BarChartCard';
import { projectStatusBadge, projectBarColor } from '@/app/dashboard/constants';

export default function SystemAuditTab() {
  const [selectedMonth, setSelectedMonth] = useState('08/2026');
  const [activeProjectsProgress, setActiveProjectsProgress] = useState<any[]>([]);
  const [projectsAtRisk, setProjectsAtRisk] = useState<any[]>([]);
  const [taskStats, setTaskStats] = useState({ total: 0, done: 0, inProgress: 0, overdue: 0 });
  const [loading, setLoading] = useState(false);

  // System Audit Logs State
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditModule, setAuditModule] = useState('all');
  const [auditLoading, setAuditLoading] = useState(false);

  // Analytics Tables State (4 Top Tables)
  const [analytics, setAnalytics] = useState<{
    top_active_users: any[];
    top_updated_projects: any[];
    top_ai_users: any[];
    top_login_failures: any[];
  }>({
    top_active_users: [],
    top_updated_projects: [],
    top_ai_users: [],
    top_login_failures: []
  });

  // Infra vs Markee Distribution
  const [infraMembers, setInfraMembers] = useState<any[]>([]);
  const [markeeMembers, setMarkeeMembers] = useState<any[]>([]);

  // Phase distribution stats
  const [phaseStats, setPhaseStats] = useState<any[]>([]);

  const fetchSystemAuditData = useCallback(() => {
    setLoading(true);
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

    axios.get(`/api/projects?_t=${ts}`, config).then(projRes => {
      const projects = projRes.data || [];
      
      // Calculate Phase Distribution
      const phaseCounts: Record<string, number> = {
        '1. Tư vấn': 0,
        '2. Triển khai': 0,
        '3. Bàn giao': 0,
        '4. Bảo trì': 0,
        'Khác': 0
      };
      
      projects.forEach((p: any) => {
        const ph = p.current_phase || '1. Tư vấn';
        if (phaseCounts[ph] !== undefined) phaseCounts[ph]++;
        else phaseCounts['Khác']++;
      });

      setPhaseStats([
        { name: '1. Tư vấn', count: phaseCounts['1. Tư vấn'] },
        { name: '2. Triển khai', count: phaseCounts['2. Triển khai'] },
        { name: '3. Bàn giao', count: phaseCounts['3. Bàn giao'] },
        { name: '4. Bảo trì', count: phaseCounts['4. Bảo trì'] },
      ]);

      const taskPromises = projects.map((proj: any) => 
        axios.get(`/api/projects/${proj.id}/all-tasks?_t=${ts}`, config)
          .then(tRes => ({ proj, tasks: tRes.data || [] }))
          .catch(() => ({ proj, tasks: [] }))
      );

      Promise.all(taskPromises).then(results => {
        let allDone = 0, allInProg = 0, allOverdue = 0, allTasksCount = 0;
        const pRisk: any[] = [];
        
        const allProjectsProgressList = results.map(r => {
          const tasks = r.tasks;
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
              id: r.proj.id,
              name: r.proj.name,
              overdueTask: pOverdue,
              deadline: r.proj.end_date_est || 'N/A',
              risk: pOverdue > 3 ? 'Cao' : (pOverdue > 1 ? 'Trung bình' : 'Thấp')
            });
          }
          
          return { id: r.proj.id, name: r.proj.name, status: r.proj.status || 'Developing', current_phase: r.proj.current_phase || '1. Tư vấn', progress: prog, totalTasks: tasks.length, doneTasks: pDone };
        });

        setActiveProjectsProgress(allProjectsProgressList.sort((a,b) => b.progress - a.progress));
        setProjectsAtRisk(pRisk.sort((a,b) => b.overdueTask - a.overdueTask).slice(0, 5));
        setTaskStats({ total: allTasksCount, done: allDone, inProgress: allInProg, overdue: allOverdue });
      });
    }).finally(() => setLoading(false));

    // Fetch Infra & Markee member distribution
    axios.get(`/api/members?_t=${ts}`, config).then(res => {
      const list = res.data || [];
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
      setInfraMembers(infra.sort((a,b) => b.kpi - a.kpi));
      setMarkeeMembers(markee.sort((a,b) => b.kpi - a.kpi));
    });

    // Fetch Analytics (4 Top Tables)
    axios.get(`/api/system-audit/analytics?_t=${ts}`, config)
      .then(res => {
        if (res.data) {
          setAnalytics({
            top_active_users: res.data.top_active_users || [],
            top_updated_projects: res.data.top_updated_projects || [],
            top_ai_users: res.data.top_ai_users || [],
            top_login_failures: res.data.top_login_failures || []
          });
        }
      })
      .catch(() => {});
  }, []);

  const fetchAuditLogs = useCallback(() => {
    setAuditLoading(true);
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    
    let url = `/api/system-audit/logs?page=${auditPage}&page_size=15&_t=${ts}`;
    if (auditModule !== 'all') url += `&module_name=${auditModule}`;

    axios.get(url, config)
      .then(res => {
        setAuditLogs(res.data?.items || []);
        setAuditTotal(res.data?.total || 0);
      })
      .catch(() => {
        setAuditLogs([]);
      })
      .finally(() => setAuditLoading(false));
  }, [auditPage, auditModule]);

  useEffect(() => {
    fetchSystemAuditData();
  }, [fetchSystemAuditData]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const superAdminCards = [
    { label: 'Tổng Số Dự Án',      value: activeProjectsProgress.length, icon: '🏢', border: 'border-l-[#0058be]',  text: 'text-[#0058be]',  trend: 'Toàn hệ thống' },
    { label: 'Tổng Task Hệ Thống', value: taskStats.total,              icon: '📋', border: 'border-l-[#0058be]',  text: 'text-[#0058be]',  trend: 'Tất cả dự án' },
    { label: 'Dự Án Trễ/Rủi Ro',   value: projectsAtRisk.length,        icon: '⚠️', border: 'border-l-red-500',     text: 'text-red-600',    trend: 'Cần can thiệp' },
    { label: 'Task Hoàn Thành',    value: taskStats.done,               icon: '✅', border: 'border-l-emerald-500', text: 'text-emerald-600', trend: taskStats.total ? `${Math.round(taskStats.done/taskStats.total*100)}%` : '0%' },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Super Admin Control Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">System Audit & Super Admin Control Panel</h3>
          {loading && <span className="text-[10px] text-blue-600 font-semibold animate-pulse">Đang cập nhật dữ liệu hệ thống...</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchSystemAuditData(); fetchAuditLogs(); }}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm text-[11px] font-bold transition-all disabled:opacity-50"
          >
            <span>↻</span> Làm mới dữ liệu
          </button>
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1 shadow-sm">
            <span className="text-[11px] font-bold text-slate-500">Lọc Tháng:</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-xs font-bold text-[#0058be] bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="08/2026">Tháng 08/2026</option>
              <option value="07/2026">Tháng 07/2026</option>
              <option value="06/2026">Tháng 06/2026</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {superAdminCards.map(c => <KpiCard key={c.label} {...c} />)}
      </div>

      {/* FULL WIDTH: Tiến độ tất cả dự án */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 to-white flex justify-between items-center">
          <div>
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">📊 Tiến Độ Tất Cả Dự Án Trong Hệ Thống</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Hiển thị đầy đủ tiến độ triển khai thực tế của 100% dự án</p>
          </div>
          <span className="text-[10px] font-bold bg-blue-100 text-[#0058be] px-3 py-1 rounded-full">{activeProjectsProgress.length} dự án</span>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {activeProjectsProgress.length === 0 ? (
            <p className="col-span-3 text-center text-slate-400 text-xs py-6 font-semibold">Chưa có dữ liệu dự án.</p>
          ) : (
            activeProjectsProgress.map(p => (
              <div key={p.id} className="p-4 bg-slate-50/60 border border-slate-200/80 rounded-xl hover:shadow-md transition-all">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#0b1c30] truncate" title={p.name}>{p.name}</span>
                  <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${projectStatusBadge[p.status] || 'bg-slate-100 text-slate-500'}`}>{p.status}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 mb-2">
                  <span>Giai đoạn: <strong className="text-slate-700">{p.current_phase}</strong></span>
                  <span>{p.doneTasks}/{p.totalTasks} task</span>
                </div>
                <ProgressBar value={p.progress} color={projectBarColor[p.status] || 'bg-blue-500'} height="h-2.5" />
                <div className="flex justify-between items-center mt-2 text-[10px]">
                  <span className="font-bold text-slate-400">Tiến độ hoàn thành:</span>
                  <span className="font-extrabold text-[#0058be] text-xs">{p.progress}%</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Row 2: Phase Distribution & Projects at Risk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarChartCard
          title="Phân bố Giai đoạn Dự án (Settings Phase)"
          data={phaseStats}
          bars={[{ key: 'count', name: 'Số dự án trong giai đoạn', fill: '#0058be' }]}
          xKey="name"
        />

        <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden flex flex-col justify-between">
          <div>
            <div className="px-5 py-4 border-b border-red-100 bg-red-50/50 flex justify-between items-center">
              <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider">⚠️ Dự Án Có Mức Độ Rủi Ro / Trễ Hạn</h3>
              <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{projectsAtRisk.length} rủi ro</span>
            </div>
            <div className="p-4 space-y-3">
              {projectsAtRisk.length === 0 ? (
                <p className="text-xs text-slate-400 font-semibold text-center py-6">Tuyệt vời! Không có dự án nào bị rủi ro trễ hạn.</p>
              ) : (
                projectsAtRisk.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-red-50/60 rounded-xl border border-red-100">
                    <div>
                      <p className="text-xs font-bold text-[#0b1c30]">{p.name}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Số task trễ hạn: <strong className="text-red-600">{p.overdueTask} tasks</strong></p>
                    </div>
                    <span className="text-[10px] font-extrabold text-red-700 bg-red-100 px-2.5 py-1 rounded-full uppercase">Rủi ro {p.risk}</span>
                  </div>
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
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">🏢 Phân Bổ KPI — Team Infrastructure</h3>
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
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">🚀 Phân Bổ KPI — Team Markee</h3>
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
            <span className="text-base">🛡️</span>
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

      {/* BOTTOM SECTION: 4 ANALYTICS TABLES (Top Active Users, Top Updated Projects, Top AI Users, Top Failed Logins) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* 1. Top Active Users */}
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-blue-100 bg-blue-50/60 flex items-center justify-between">
            <h4 className="text-xs font-bold text-[#0058be] uppercase tracking-wider flex items-center gap-1.5">
              <span>🔥</span> Top Active Users
            </h4>
            <span className="text-[10px] font-extrabold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{analytics.top_active_users.length}</span>
          </div>
          <div className="p-3">
            {analytics.top_active_users.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4 font-semibold">Chưa có dữ liệu hoạt động.</p>
            ) : (
              <div className="space-y-2">
                {analytics.top_active_users.map((u, i) => (
                  <div key={u.user_id || i} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-extrabold text-[10px] flex items-center justify-center">{i + 1}</span>
                      <span className="text-xs font-bold text-[#0b1c30] truncate max-w-[120px]">{u.name}</span>
                    </div>
                    <span className="text-[11px] font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{u.total_actions} thao tác</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 2. Top Updated Projects */}
        <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-indigo-100 bg-indigo-50/60 flex items-center justify-between">
            <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-1.5">
              <span>📈</span> Top Updated Projects
            </h4>
            <span className="text-[10px] font-extrabold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{analytics.top_updated_projects.length}</span>
          </div>
          <div className="p-3">
            {analytics.top_updated_projects.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4 font-semibold">Chưa có cập nhật dự án.</p>
            ) : (
              <div className="space-y-2">
                {analytics.top_updated_projects.map((p, i) => (
                  <div key={p.project_id || i} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-extrabold text-[10px] flex items-center justify-center">{i + 1}</span>
                      <span className="text-xs font-bold text-[#0b1c30] truncate max-w-[120px]">{p.name}</span>
                    </div>
                    <span className="text-[11px] font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">{p.total_updates} lần đổi</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 3. Top AI Users */}
        <div className="bg-white rounded-2xl border border-purple-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-purple-100 bg-purple-50/60 flex items-center justify-between">
            <h4 className="text-xs font-bold text-purple-700 uppercase tracking-wider flex items-center gap-1.5">
              <span>🤖</span> Top AI Users
            </h4>
            <span className="text-[10px] font-extrabold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{analytics.top_ai_users.length}</span>
          </div>
          <div className="p-3">
            {analytics.top_ai_users.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4 font-semibold">Chưa có lượt gọi AI nào.</p>
            ) : (
              <div className="space-y-2">
                {analytics.top_ai_users.map((u, i) => (
                  <div key={u.user_id || i} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 font-extrabold text-[10px] flex items-center justify-center">{i + 1}</span>
                      <span className="text-xs font-bold text-[#0b1c30] truncate max-w-[120px]">{u.name}</span>
                    </div>
                    <span className="text-[11px] font-extrabold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md">{u.total_checks} lượt gọi</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 4. Top Failed Logins */}
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-red-100 bg-red-50/60 flex items-center justify-between">
            <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider flex items-center gap-1.5">
              <span>🔒</span> Top Failed Logins
            </h4>
            <span className="text-[10px] font-extrabold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{analytics.top_login_failures.length}</span>
          </div>
          <div className="p-3">
            {analytics.top_login_failures.length === 0 ? (
              <p className="text-xs text-emerald-600 text-center py-4 font-semibold">An toàn! Không có đăng nhập thất bại.</p>
            ) : (
              <div className="space-y-2">
                {analytics.top_login_failures.map((f, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-xl bg-red-50/60 border border-red-100">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-red-100 text-red-700 font-extrabold text-[10px] flex items-center justify-center">{i + 1}</span>
                      <span className="text-xs font-bold text-red-700 truncate max-w-[120px]">{f.ip_address}</span>
                    </div>
                    <span className="text-[11px] font-extrabold text-red-600 bg-white border border-red-200 px-2 py-0.5 rounded-md">{f.total_failures} lần lỗi</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
