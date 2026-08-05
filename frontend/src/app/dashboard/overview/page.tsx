'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { getName, getToken } from '@/lib/auth';
import KpiCard from '@/components/dashboard/KpiCard';
import ProgressBar from '@/components/dashboard/ProgressBar';
import SvgIcon from '@/components/dashboard/Icons';
import PieChartCard from '@/components/dashboard/PieChartCard';
import { projectStatusBadge, projectBarColor } from '@/app/dashboard/constants';

let cachedOverviewData: any = null;

export default function OverviewTab() {
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [auditModuleFilter, setAuditModuleFilter] = useState('all');

  // Raw data from APIs
  const [rawMembers, setRawMembers] = useState<any[]>(cachedOverviewData?.rawMembers || []);
  const [rawTasks, setRawTasks] = useState<any[]>(cachedOverviewData?.rawTasks || []);
  const [rawProjects, setRawProjects] = useState<any[]>(cachedOverviewData?.rawProjects || []);
  const [rawAuditLogs, setRawAuditLogs] = useState<any[]>(cachedOverviewData?.rawAuditLogs || []);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(cachedOverviewData?.currentUserProfile || null);

  const fetchOverviewData = useCallback((forceRefresh = false) => {
    if (!forceRefresh && cachedOverviewData && cachedOverviewData.rawMembers?.length > 0) return;

    setLoading(true);
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

    Promise.all([
      axios.get(`/api/users/me?_t=${ts}`, config).catch(() => ({ data: {} })),
      axios.get(`/api/members?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/projects?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/all-tasks-global?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/system-audit/logs?page_size=20&_t=${ts}`, config).catch(() => ({ data: { items: [] } }))
    ]).then(([userRes, membersRes, projRes, tasksRes, auditRes]) => {
      const userProfile = userRes.data || {};
      const members = membersRes.data || [];
      const projects = projRes.data || [];
      const tasks = tasksRes.data || [];
      const logs = auditRes.data?.items || [];

      setCurrentUserProfile(userProfile);
      setRawMembers(members);
      setRawProjects(projects);
      setRawTasks(tasks);
      setRawAuditLogs(logs);

      cachedOverviewData = {
        currentUserProfile: userProfile,
        rawMembers: members,
        rawProjects: projects,
        rawTasks: tasks,
        rawAuditLogs: logs
      };
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchOverviewData();
  }, [fetchOverviewData]);

  // Derived data based on selectedDepartment and selectedTeam
  const {
    leaderCards,
    depMembers,
    realTaskStats,
    techLeaderStats,
    realProjects,
    teamMembers,
    topPerformer,
    lowestPerformer,
    teamAuditLogs,
    activeLeader
  } = useMemo(() => {
    // 1. Get all members
    const depList = rawMembers;

    // 2. Generate Leader Cards by grouping `leader_name`
    const rawUniqueLeaders = Array.from(new Set(depList.map((m: any) => m.leader_name).filter(Boolean))) as string[];
    const cards = rawUniqueLeaders.map(lName => {
      const tMembers = depList.filter((m: any) => m.leader_name === lName);
      let lId = null;
      const leaderObj = rawMembers.find((m: any) => m.full_name === lName || m.display_name === lName);
      if (leaderObj) lId = leaderObj.id;

      return {
        leaderName: lName,
        leaderId: lId,
        memberCount: tMembers.length
      };
    });

    // Handle activeLeader fallback to first leader
    let currentLeader = selectedTeam;
    if (!currentLeader || currentLeader === 'All' || !rawUniqueLeaders.includes(currentLeader)) {
      currentLeader = rawUniqueLeaders.length > 0 ? rawUniqueLeaders[0] : '';
    }

    // 3. Filter members by activeLeader
    let activeTeamList = depList.filter((m: any) => m.leader_name === currentLeader);

    // 4. Calculate Tech Leader Stats
    let tlDone = 0, tlInProg = 0, tlOverdue = 0, tlTotal = 0;
    let tlCritical = 0, tlHigh = 0, tlNormal = 0, tlInterrupt = 0;
    let tlStats = { name: 'Chưa có Leader', total: 0, done: 0, inProgress: 0, overdue: 0, critical: 0, high: 0, normal: 0, interrupt: 0 };
    
    const card = cards.find(c => c.leaderName === currentLeader);
    if (card && card.leaderId) {
      const tlTasks = rawTasks.filter((t: any) => t.assigned_id === card.leaderId || t.support_id === card.leaderId);
      tlTotal = tlTasks.length;
      tlTasks.forEach((t: any) => {
        if (t.status === 'Done') tlDone++;
        else { tlInProg++; if (t.days_late > 0) tlOverdue++; }

        const prio = (t.priority || '').toLowerCase();
        if (prio === 'critical') tlCritical++;
        else if (prio === 'high') tlHigh++;
        else if (prio === 'normal') tlNormal++;
        else if (prio === 'interrupt') tlInterrupt++;
      });
      tlStats = { name: card.leaderName, total: tlTotal, done: tlDone, inProgress: tlInProg, overdue: tlOverdue, critical: tlCritical, high: tlHigh, normal: tlNormal, interrupt: tlInterrupt };
    }

    // 5. Calculate Team Stats for the 6 KPI boxes
    const teamMemberIds = activeTeamList.map((m: any) => m.id);
    const teamTasks = rawTasks.filter((t: any) => teamMemberIds.includes(t.assigned_id) || teamMemberIds.includes(t.support_id));

    let pmDone = 0, pmInProg = 0, pmOverdue = 0, pmTotal = teamTasks.length, pmManday = 0, pmKpi = 0;
    teamTasks.forEach((t: any) => {
      if (t.status === 'Done') pmDone++;
      else { pmInProg++; if (t.days_late > 0) pmOverdue++; }
      pmManday += (t.manday_actual || 0);
    });
    activeTeamList.forEach((m: any) => {
      pmKpi += (m.kpi_total || 0);
    });

    const pmStats = { total: pmTotal, done: pmDone, inProgress: pmInProg, overdue: pmOverdue, manday: pmManday, kpi: pmKpi };

    // 6. Active Projects
    // (teamMemberIds and teamTasks already calculated above)
    const projectIds = Array.from(new Set(teamTasks.map((t: any) => t.project_id).filter(Boolean)));
    const activeProjects = rawProjects.filter((p: any) => projectIds.includes(p.id)).map((p: any) => {
      const projTasks = rawTasks.filter((t: any) => t.project_id === p.id);
      const total = projTasks.length;
      const done = projTasks.filter((t: any) => t.status === 'Done').length;
      const prog = total > 0 ? Math.round((done / total) * 100) : 0;
      return { id: p.id, name: p.name, status: p.status || 'Developing', progress: prog, tasks: total, done };
    });

    // 7. Member KPI Ranking
    const memberStats = activeTeamList.map((m: any) => {
      const mTasks = rawTasks.filter((t: any) => t.assigned_id === m.id || t.support_id === m.id);
      let done = 0, inProg = 0, overdue = 0;
      let manday = 0;
      mTasks.forEach((t: any) => {
        if (t.status === 'Done') done++;
        else { inProg++; if (t.days_late > 0) overdue++; }
        manday += (t.manday_actual || 0);
      });
      return {
        id: m.id,
        name: m.full_name || m.display_name || 'No Name',
        team: m.team || 'N/A',
        assigned: mTasks.length,
        done, inProgress: inProg, overdue, manday,
        kpi: m.kpi_total || 0,
      };
    }).sort((a: any, b: any) => b.kpi - a.kpi).map((m: any, idx: number) => ({ ...m, rank: idx + 1 }));

    let topP = null, lowP = null;
    if (memberStats.length > 0) {
      topP = memberStats[0];
      lowP = memberStats[memberStats.length - 1];
    }

    return {
      leaderCards: cards,
      depMembers: depList,
      realTaskStats: pmStats,
      techLeaderStats: tlStats,
      realProjects: activeProjects,
      teamMembers: memberStats,
      topPerformer: topP,
      lowestPerformer: lowP,
      teamAuditLogs: rawAuditLogs,
      activeLeader: currentLeader
    };
  }, [rawMembers, rawTasks, rawProjects, rawAuditLogs, selectedTeam, currentUserProfile]);


  const pmKpiCards = [
    { label: 'Task Được Giao',   value: realTaskStats.total,  icon: 'user',      border: 'border-l-[#0058be]',  text: 'text-[#0058be]',  trend: 'Tổng số task' },
    { label: 'Đã Hoàn Thành',    value: realTaskStats.done,   icon: 'check',     border: 'border-l-emerald-500', text: 'text-emerald-600', trend: realTaskStats.total ? `${Math.round(realTaskStats.done/realTaskStats.total*100)}%` : '0%' },
    { label: 'Đang Làm',      value: realTaskStats.inProgress,   icon: 'lightning', border: 'border-l-amber-500',   text: 'text-amber-600',  trend: realTaskStats.total ? `${Math.round(realTaskStats.inProgress/realTaskStats.total*100)}%` : '0%' },
    { label: 'Trễ Hạn',       value: realTaskStats.overdue,   icon: 'alert',     border: 'border-l-red-500',     text: 'text-red-600',    trend: 'Cần chú ý' },
    { label: 'Manday Thực Tế', value: Number(realTaskStats.manday).toFixed(1), icon: 'clock', border: 'border-l-cyan-500', text: 'text-cyan-600', trend: 'Ngày làm việc' },
    { label: 'KPI Đạt',       value: Number(realTaskStats.kpi).toFixed(1), icon: 'trending-up', border: 'border-l-purple-500', text: 'text-purple-600', trend: 'Điểm tích lũy' },
  ];

  const filteredAuditLogs = teamAuditLogs.filter(log => {
    if (auditModuleFilter !== 'all') {
      return log.module?.toLowerCase() === auditModuleFilter.toLowerCase();
    }
    return true;
  });

  const displayedProjects = realProjects;

  return (
    <div className="p-6 space-y-5">
      {/* Overview Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tổng quan Team Leader</h3>
          {loading && <span className="text-[10px] text-blue-600 font-semibold animate-pulse ml-2">Đang cập nhật...</span>}
        </div>
        <button
          onClick={() => fetchOverviewData(true)}
          className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm text-[11px] font-bold transition-all active:scale-95 cursor-pointer"
        >
          <SvgIcon name="refresh" className="w-3.5 h-3.5 text-slate-500" />
          <span>Làm mới dữ liệu</span>
        </button>
      </div>

      {/* Leader Selection Cards */}
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {leaderCards.map(c => (
          <button
            key={c.leaderName}
            onClick={() => setSelectedTeam(c.leaderName)}
            className={`flex-shrink-0 p-3 rounded-xl border text-left min-w-[140px] transition-all ${activeLeader === c.leaderName ? 'border-[#0058be] bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-blue-300'}`}
          >
            <p className={`text-xs font-bold ${activeLeader === c.leaderName ? 'text-[#0058be]' : 'text-[#0b1c30]'}`}>{c.leaderName}</p>
            <p className="text-[10px] text-slate-500 mt-1">{c.memberCount} member</p>
          </button>
        ))}
      </div>


      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {pmKpiCards.map(c => <KpiCard key={c.label} {...c} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <PieChartCard title="Trạng thái Task (PM)" data={[
          { name: 'Hoàn Thành', value: realTaskStats.done, fill: '#10b981' },
          { name: 'Đang Làm', value: Math.max(0, realTaskStats.inProgress - realTaskStats.overdue), fill: '#f59e0b' },
          { name: 'Trễ Hạn', value: realTaskStats.overdue, fill: '#ef4444' }
        ]} />

        <div className="lg:col-span-2 bg-white rounded-2xl border border-blue-200 p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Technical Leader — {activeLeader}</p>
            </div>
            <p className="text-sm font-extrabold text-[#0b1c30]">{techLeaderStats.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">Tổng task phụ trách: {techLeaderStats.total}</p>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
              <p className="text-lg font-extrabold text-emerald-600">{techLeaderStats.done}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Đã Xong</p>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">
              <p className="text-lg font-extrabold text-amber-600">{techLeaderStats.inProgress}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Đang làm</p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-center">
              <p className="text-lg font-extrabold text-red-600">{techLeaderStats.overdue}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Trễ Hạn</p>
            </div>
          </div>
          
          <div className="mt-3 grid grid-cols-4 gap-2">
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-2 text-center">
              <p className="text-sm font-extrabold text-purple-600">{techLeaderStats.critical}</p>
              <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Critical</p>
            </div>
            <div className="bg-orange-50 border border-orange-100 rounded-lg p-2 text-center">
              <p className="text-sm font-extrabold text-orange-600">{techLeaderStats.high}</p>
              <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">High</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-2 text-center">
              <p className="text-sm font-extrabold text-blue-600">{techLeaderStats.normal}</p>
              <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Normal</p>
            </div>
            <div className="bg-slate-100 border border-slate-200 rounded-lg p-2 text-center">
              <p className="text-sm font-extrabold text-slate-600">{techLeaderStats.interrupt}</p>
              <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Interrupt</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Row: Active Projects */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden p-5 flex flex-col justify-between">
        <div>
          <div className="px-1 py-1 pb-4 border-b border-slate-100 flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <SvgIcon name="folder" className="w-4 h-4 text-slate-700" />
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Dự Án Đang Triển Khai</h3>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5 max-h-[400px] overflow-y-auto pr-2 pb-2 custom-scrollbar">
            {displayedProjects.length === 0 ? (
              <p className="col-span-4 text-center text-slate-400 text-xs py-4 font-semibold">Chưa có dự án nào đang hoạt động.</p>
            ) : (
              displayedProjects.map(p => (
                <Link
                  key={p.id}
                  href={`/project/detail?id=${p.id}`}
                  className="group p-4 bg-slate-50/50 border border-slate-100 rounded-xl hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer block"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-[#0b1c30] group-hover:text-blue-600 transition-colors truncate" title={p.name}>{p.name}</span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ${projectStatusBadge[p.status] || 'bg-slate-100 text-slate-500'}`}>{p.status}</span>
                  </div>
                  <div className="mt-3">
                    <ProgressBar value={p.progress} color={projectBarColor[p.status] || 'bg-slate-400'} height="h-2" />
                    <p className="text-[10px] text-slate-400 mt-2 font-semibold">{p.done}/{p.tasks} tasks hoàn thành ({p.progress}%)</p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* TEAM AUDIT LOG SECTION */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 to-white">
          <div className="flex items-center gap-2">
            <SvgIcon name="history" className="w-4 h-4 text-blue-600" />
            <div>
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Audit Log — {activeLeader}</h3>
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
              {teamAuditLogs.length === 0 ? (
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
          <div className="flex items-center gap-2">
            <SvgIcon name="user" className="w-4 h-4 text-indigo-600" />
            <div>
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Bảng Xếp Hạng KPI Thành Viên — {activeLeader}</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Dữ liệu thực tế</p>
            </div>
          </div>
          <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full border border-indigo-100">{teamMembers.length} thành viên</span>
        </div>
        <div className="max-h-[400px] overflow-y-auto overflow-x-auto custom-scrollbar">
          <table className="w-full text-xs relative">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50/95 backdrop-blur-sm text-slate-400 border-b border-slate-100 uppercase text-[10px] tracking-wider shadow-sm">
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
                  return (
                    <tr key={m.id} className={`border-b border-slate-50 hover:bg-indigo-50/30 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/20'}`}>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`text-xs font-bold ${m.rank <= 3 ? 'text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200' : 'text-slate-400'}`}>#{m.rank}</span>
                      </td>
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
            <div className="absolute -right-4 -bottom-4 opacity-10 select-none">
              <SvgIcon name="crown" className="w-32 h-32 text-white" />
            </div>
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
