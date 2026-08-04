'use client';

import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { getName, getToken } from '@/lib/auth';
import KpiCard from '@/components/dashboard/KpiCard';
import ProgressBar from '@/components/dashboard/ProgressBar';
import { projectStatusBadge, projectBarColor } from '@/app/dashboard/constants';

export default function OverviewTab() {
  const [realTaskStats, setRealTaskStats] = useState({ done: 0, inProgress: 0, overdue: 0, total: 0 });
  const [techLeaderStats, setTechLeaderStats] = useState({ name: 'Chưa xác định', total: 0, done: 0, inProgress: 0, overdue: 0 });
  const [realProjects, setRealProjects] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [topPerformer, setTopPerformer] = useState<any>(null);
  const [lowestPerformer, setLowestPerformer] = useState<any>(null);
  const [leaderTeamName, setLeaderTeamName] = useState<string>('Dev Team');
  const [loading, setLoading] = useState(false);
  
  // Team Audit Log states
  const [teamAuditLogs, setTeamAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditModuleFilter, setAuditModuleFilter] = useState('all');

  const fetchOverviewData = useCallback(() => {
    setLoading(true);
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

    axios.get(`/api/users/me?_t=${ts}`, config).then(userRes => {
      const currentUser = userRes.data || {};
      const currentEmail = currentUser.email;
      const currentName = currentUser.full_name || getName();
      const memberIdFromAccount = currentUser.member_id;

      axios.get(`/api/members?_t=${ts}`, config).then(membersRes => {
        const list = membersRes.data || [];
        let matched = null;
        if (memberIdFromAccount) matched = list.find((m: any) => m.id === memberIdFromAccount);
        if (!matched && currentEmail) matched = list.find((m: any) => m.email?.toLowerCase() === currentEmail.toLowerCase());
        if (!matched && currentName) matched = list.find((m: any) => m.display_name?.toLowerCase() === currentName.toLowerCase() || m.full_name?.toLowerCase() === currentName.toLowerCase());

        const teamName = matched?.team || currentUser?.department || 'Infrastructure';
        setLeaderTeamName(teamName);

        let tl = list.find((m: any) => m.position?.toLowerCase().includes('tech') || m.position?.toLowerCase().includes('leader'));
        if (!tl && list.length > 0) tl = list[0];
        
        axios.get(`/api/projects?_t=${ts}`, config).then(projRes => {
          const projects = projRes.data || [];
          const taskPromises = projects.map((proj: any) => 
            axios.get(`/api/projects/${proj.id}/all-tasks?_t=${ts}`, config)
              .then(tRes => ({ proj, tasks: tRes.data || [] }))
              .catch(() => ({ proj, tasks: [] }))
          );

          Promise.all(taskPromises).then(results => {
            const allTasksCombined = results.flatMap(r => r.tasks);
            
            let pmDone = 0, pmInProg = 0, pmOverdue = 0, pmTotal = 0;
            if (matched) {
              const myTasks = allTasksCombined.filter((t: any) => t.assigned_id === matched.id || t.support_id === matched.id);
              pmTotal = myTasks.length;
              myTasks.forEach((t: any) => {
                if (t.status === 'Done') pmDone++;
                else {
                  pmInProg++;
                  if (t.days_late > 0) pmOverdue++;
                }
              });
            }
            setRealTaskStats({ total: pmTotal, done: pmDone, inProgress: pmInProg, overdue: pmOverdue });

            let tlDone = 0, tlInProg = 0, tlOverdue = 0, tlTotal = 0;
            if (tl) {
              const tlTasks = allTasksCombined.filter((t: any) => t.assigned_id === tl.id || t.support_id === tl.id);
              tlTotal = tlTasks.length;
              tlTasks.forEach((t: any) => {
                if (t.status === 'Done') tlDone++;
                else {
                  tlInProg++;
                  if (t.days_late > 0) tlOverdue++;
                }
              });
              setTechLeaderStats({ name: `${tl.full_name || tl.display_name} (Tech Leader)`, total: tlTotal, done: tlDone, inProgress: tlInProg, overdue: tlOverdue });
            }

            const activeProjects = results.map(r => {
              const total = r.tasks.length;
              const done = r.tasks.filter((t: any) => t.status === 'Done').length;
              const prog = total > 0 ? Math.round((done / total) * 100) : 0;
              return { id: r.proj.id, name: r.proj.name, status: r.proj.status || 'Developing', progress: prog, tasks: total, done };
            });
            setRealProjects(activeProjects);

            const memberStats = list.map((m: any) => {
              const mTasks = allTasksCombined.filter((t: any) => t.assigned_id === m.id || t.support_id === m.id);
              let done = 0, inProg = 0, overdue = 0;
              let manday = 0;
              mTasks.forEach((t: any) => {
                if (t.status === 'Done') done++;
                else {
                  inProg++;
                  if (t.days_late > 0) overdue++;
                }
                manday += (t.manday_actual || 0);
              });
              return {
                id: m.id,
                name: m.full_name || m.display_name || 'No Name',
                team: m.team || 'N/A',
                assigned: mTasks.length,
                done,
                inProgress: inProg,
                overdue,
                manday,
                kpi: m.kpi_total || 0,
              };
            }).sort((a: any, b: any) => b.kpi - a.kpi).map((m: any, idx: number) => ({ ...m, rank: idx + 1 }));
            
            setTeamMembers(memberStats);
            if (memberStats.length > 0) {
              setTopPerformer(memberStats[0]);
              setLowestPerformer(memberStats[memberStats.length - 1]);
            }
          });
        });
      }).finally(() => setLoading(false));
    });

    // Fetch Team Audit Logs
    setAuditLoading(true);
    axios.get(`/api/system-audit/logs?page_size=20&_t=${ts}`, config)
      .then(res => {
        const items = res.data?.items || [];
        setTeamAuditLogs(items);
      })
      .catch(() => {
        setTeamAuditLogs([]);
      })
      .finally(() => setAuditLoading(false));
  }, []);

  useEffect(() => {
    fetchOverviewData();
  }, [fetchOverviewData]);

  const pmKpiCards = [
    { label: 'Task PM làm',   value: realTaskStats.total,  icon: '👤', border: 'border-l-[#0058be]',  text: 'text-[#0058be]',  trend: 'Đảm nhận trực tiếp' },
    { label: 'Hoàn Thành',    value: realTaskStats.done,   icon: '✅', border: 'border-l-emerald-500', text: 'text-emerald-600', trend: realTaskStats.total ? `${Math.round(realTaskStats.done/realTaskStats.total*100)}%` : '0%' },
    { label: 'Đang Làm',      value: realTaskStats.inProgress,   icon: '⚡', border: 'border-l-amber-500',   text: 'text-amber-600',  trend: realTaskStats.total ? `${Math.round(realTaskStats.inProgress/realTaskStats.total*100)}%` : '0%' },
    { label: 'Trễ Hạn',       value: realTaskStats.overdue,   icon: '🔴', border: 'border-l-red-500',     text: 'text-red-600',    trend: 'Cần chú ý' },
  ];

  const filteredAuditLogs = teamAuditLogs.filter(log => {
    if (auditModuleFilter !== 'all') {
      return log.module?.toLowerCase() === auditModuleFilter.toLowerCase();
    }
    return true;
  });

  return (
    <div className="p-6 space-y-5">
      {/* Overview Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tổng quan Team Leader — {leaderTeamName}</h3>
          {loading && <span className="text-[10px] text-blue-600 font-semibold animate-pulse">Đang cập nhật...</span>}
        </div>
        <button
          onClick={fetchOverviewData}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm text-[11px] font-bold transition-all disabled:opacity-50"
        >
          <span>↻</span> Làm mới dữ liệu
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {pmKpiCards.map(c => <KpiCard key={c.label} {...c} />)}
      </div>

      {/* Main Row: Active Projects + Technical Leader Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex justify-between items-center">
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">📂 Dự Án Đang Triển Khai</h3>
            <span className="text-[10px] font-bold text-[#0058be] bg-blue-50 px-2 py-0.5 rounded-full">{realProjects.length} dự án</span>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
            {realProjects.length === 0 ? (
              <p className="col-span-3 text-center text-slate-400 text-xs py-4 font-semibold">Chưa có dự án nào đang hoạt động.</p>
            ) : (
              realProjects.map(p => (
                <div key={p.name} className="p-4 bg-slate-50/50 border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-[#0b1c30] truncate" title={p.name}>{p.name}</span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ${projectStatusBadge[p.status] || 'bg-slate-100 text-slate-500'}`}>{p.status}</span>
                  </div>
                  <div className="mt-3">
                    <ProgressBar value={p.progress} color={projectBarColor[p.status] || 'bg-slate-400'} height="h-2" />
                    <p className="text-[10px] text-slate-400 mt-2 font-semibold">{p.done}/{p.tasks} tasks hoàn thành ({p.progress}%)</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-blue-200 p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Technical Leader</p>
            </div>
            <p className="text-sm font-extrabold text-[#0b1c30]">{techLeaderStats.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">Tổng task phụ trách: {techLeaderStats.total}</p>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2 text-center">
              <p className="text-sm font-extrabold text-emerald-600">{techLeaderStats.done}</p>
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-0.5">Đã Xong</p>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-2 text-center">
              <p className="text-sm font-extrabold text-amber-600">{techLeaderStats.inProgress}</p>
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-0.5">Đang làm</p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-2 text-center">
              <p className="text-sm font-extrabold text-red-600">{techLeaderStats.overdue}</p>
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-0.5">Trễ Hạn</p>
            </div>
          </div>
        </div>
      </div>

      {/* TEAM AUDIT LOG SECTION — Audit log riêng cho team leader */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 to-white">
          <div className="flex items-center gap-2">
            <span className="text-base">📜</span>
            <div>
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Audit Log — Team {leaderTeamName}</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Nhật ký hoạt động & thay đổi của các thành viên trong team</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={auditModuleFilter}
              onChange={(e) => setAuditModuleFilter(e.target.value)}
              className="text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-[#0058be]"
            >
              <option value="all">Tất cả Module</option>
              <option value="task">Task</option>
              <option value="project">Project</option>
              <option value="phase">Phase</option>
              <option value="setting">Setting</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-slate-400 border-b border-slate-100 uppercase text-[10px] tracking-wider">
                <th className="px-4 py-3 text-left font-bold">Thời gian</th>
                <th className="px-4 py-3 text-left font-bold">Thành viên</th>
                <th className="px-4 py-3 text-center font-bold">Hành động</th>
                <th className="px-4 py-3 text-center font-bold">Module</th>
                <th className="px-5 py-3 text-left font-bold">Chi tiết thay đổi</th>
              </tr>
            </thead>
            <tbody>
              {auditLoading ? (
                <tr><td colSpan={5} className="text-center py-6 text-slate-400 font-semibold">Đang tải nhật ký hoạt động...</td></tr>
              ) : filteredAuditLogs.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-6 text-slate-400 font-semibold">Chưa có nhật ký hoạt động nào cho team này.</td></tr>
              ) : (
                filteredAuditLogs.slice(0, 8).map((log, idx) => (
                  <tr key={log.id || idx} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                      {log.created_at ? new Date(log.created_at).toLocaleString('vi-VN') : 'Mới đây'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#0b1c30]">
                      {log.user_name || 'Hệ thống'}
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
      </div>

      {/* Member KPI Ranking */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">👥 Bảng Xếp Hạng KPI Thành Viên — Team {leaderTeamName}</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Dữ liệu thực tế</p>
          </div>
          <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full border border-indigo-100">{teamMembers.length} thành viên</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-slate-400 border-b border-slate-100 uppercase text-[10px] tracking-wider">
                <th className="px-4 py-3 text-center font-bold w-14">Hạng</th>
                <th className="px-4 py-3 text-left font-bold">Thành Viên</th>
                <th className="px-4 py-3 text-center font-bold">Giao</th>
                <th className="px-4 py-3 text-center font-bold">Xong</th>
                <th className="px-4 py-3 text-center font-bold">Đang Làm</th>
                <th className="px-4 py-3 text-center font-bold">Trễ</th>
                <th className="px-4 py-3 text-center font-bold">Manday</th>
                <th className="px-4 py-3 text-center font-bold text-[#0058be]">KPI</th>
                <th className="px-4 py-3 font-bold min-w-[140px]">Tiến độ</th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-6 text-slate-400 font-semibold">Chưa có thành viên nào.</td>
                </tr>
              ) : (
                teamMembers.map((m, i) => {
                  const rate = m.assigned > 0 ? Math.round((m.done / m.assigned) * 100) : 0;
                  const rankEmoji = m.rank === 1 ? '🥇' : m.rank === 2 ? '🥈' : m.rank === 3 ? '🥉' : null;
                  return (
                    <tr key={m.id} className={`border-b border-slate-50 hover:bg-indigo-50/30 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/20'}`}>
                      <td className="px-4 py-3.5 text-center">{rankEmoji ? <span className="text-lg">{rankEmoji}</span> : <span className="text-xs font-bold text-slate-400">{m.rank}</span>}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-blue-500 flex items-center justify-center text-white text-[10px] font-extrabold shrink-0">{m.name.split(' ').pop()?.charAt(0) || '?'}</div>
                          <span className="font-semibold text-[#0b1c30]">{m.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center font-semibold text-slate-600">{m.assigned}</td>
                      <td className="px-4 py-3.5 text-center"><span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{m.done}</span></td>
                      <td className="px-4 py-3.5 text-center font-semibold text-blue-600">{m.inProgress}</td>
                      <td className="px-4 py-3.5 text-center">{m.overdue > 0 ? <span className="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{m.overdue}</span> : <span className="text-slate-300 font-bold">—</span>}</td>
                      <td className="px-4 py-3.5 text-center text-slate-500 tabular-nums">{m.manday.toFixed(1)}</td>
                      <td className="px-4 py-3.5 text-center font-extrabold text-[#0058be] text-[13px]">{m.kpi.toFixed(1)}</td>
                      <td className="px-4 py-3.5">
                        <ProgressBar value={rate} color={rate >= 80 ? 'bg-emerald-500' : rate >= 60 ? 'bg-amber-500' : 'bg-red-500'} height="h-1.5" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {topPerformer && lowestPerformer && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl p-5 shadow-md text-white relative overflow-hidden">
            <div className="absolute -right-4 -bottom-4 text-8xl opacity-10 select-none">🥇</div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Xuất Sắc Nhất</p>
            <p className="text-lg font-extrabold mt-1">{topPerformer.name}</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[{ label: 'KPI', value: topPerformer.kpi.toFixed(1) }, { label: 'Hoàn thành', value: topPerformer.done }, { label: 'Manday', value: topPerformer.manday.toFixed(1) }].map(s => (
                <div key={s.label} className="bg-white/20 backdrop-blur rounded-xl p-2.5 text-center">
                  <p className="text-base font-extrabold">{s.value}</p>
                  <p className="text-[9px] font-semibold opacity-70 uppercase mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-red-200 p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-500">⚠️ Cần Cải Thiện</p>
            <p className="text-base font-extrabold mt-1 text-[#0b1c30]">{lowestPerformer.name}</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[{ label: 'KPI', value: lowestPerformer.kpi.toFixed(1), cls: 'text-red-600' }, { label: 'Xong', value: lowestPerformer.done, cls: 'text-slate-600' }, { label: 'Trễ', value: lowestPerformer.overdue, cls: 'text-red-500' }].map(s => (
                <div key={s.label} className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
                  <p className={`text-base font-extrabold ${s.cls}`}>{s.value}</p>
                  <p className="text-[9px] font-semibold text-slate-400 uppercase mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
