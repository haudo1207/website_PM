'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { getEmail, getName, getToken, getRole } from '@/lib/auth';
import KpiCard from '@/components/dashboard/KpiCard';
import ProgressBar from '@/components/dashboard/ProgressBar';
import SvgIcon from '@/components/dashboard/Icons';
import BarChartCard from '@/components/dashboard/BarChartCard';
import { projectStatusBadge, projectBarColor } from '@/app/dashboard/constants';

let cachedOverviewData: any = null;

function getISOWeek(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
}

function isTaskInDateRange(task: any, filterType: string, date1: string, date2: string) {
  if (filterType === 'all') return true;
  const tDate = new Date(task.end_date_est || task.created_at || Date.now());
  if (isNaN(tDate.getTime())) return true;
  
  if (filterType === 'month' && date1) {
     const [y, m] = date1.split('-');
     return tDate.getFullYear() === parseInt(y) && (tDate.getMonth() + 1) === parseInt(m);
  }
  if (filterType === 'year' && date1) {
     return tDate.getFullYear() === parseInt(date1);
  }
  if (filterType === 'week' && date1) {
     const [y, w] = date1.split('-W');
     return tDate.getFullYear() === parseInt(y) && getISOWeek(tDate) === parseInt(w);
  }
  if (filterType === 'custom' && date1 && date2) {
     const ds = new Date(date1);
     const de = new Date(date2);
     de.setHours(23, 59, 59, 999);
     return tDate >= ds && tDate <= de;
  }
  return true;
}

export default function OverviewTab() {
  const [loading, setLoading] = useState(false);
  const [rawMembers, setRawMembers] = useState<any[]>(cachedOverviewData?.rawMembers || []);
  const [rawProjects, setRawProjects] = useState<any[]>(cachedOverviewData?.rawProjects || []);
  const [rawTasks, setRawTasks] = useState<any[]>(cachedOverviewData?.rawTasks || []);
  
  // Workspace Filter
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('all');
  
  // Unified Date Filter
  const [filterType, setFilterType] = useState<string>('all'); // all, week, month, year, custom
  const [date1, setDate1] = useState<string>(''); 
  const [date2, setDate2] = useState<string>('');

  // Matrix Filter
  const [matrixYear, setMatrixYear] = useState<number>(new Date().getFullYear());

  const fetchOverviewData = useCallback((forceRefresh = false) => {
    if (!forceRefresh && cachedOverviewData) return;
    setLoading(true);
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

    Promise.all([
      axios.get(`/api/members?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/projects?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/all-tasks-global?_t=${ts}`, config).catch(() => ({ data: [] }))
    ]).then(([membersRes, projRes, tasksRes]) => {
      setRawMembers(membersRes.data || []);
      setRawProjects(projRes.data || []);
      setRawTasks(tasksRes.data || []);
      cachedOverviewData = {
        rawMembers: membersRes.data || [],
        rawProjects: projRes.data || [],
        rawTasks: tasksRes.data || []
      };
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchOverviewData(false);
  }, [fetchOverviewData]);

  // Derived Data
  const { 
    workspaces, 
    activeTeamMembers, 
    filteredTasks, 
    pmStats, 
    priorityStats, 
    overdueTasksList, 
    memberRanking,
    activeProjects
  } = useMemo(() => {
    // 1. Get Workspaces (Teams)
    const wsMap = new Map();
    rawMembers.forEach(m => {
      const wsName = m.team || m.department || 'Khác';
      if (!wsMap.has(wsName)) wsMap.set(wsName, { name: wsName, count: 0 });
      wsMap.get(wsName).count++;
    });
    const wList = Array.from(wsMap.values()).sort((a,b) => b.count - a.count);
    
    // Set default workspace if not set
    if (selectedWorkspace === 'all' && wList.length > 0) {
       // if we want to default to the first one, uncomment:
       // setSelectedWorkspace(wList[0].name);
    }

    // 2. Filter Members by Workspace
    let activeTeamList = rawMembers;
    if (selectedWorkspace && selectedWorkspace !== 'all') {
      activeTeamList = rawMembers.filter(m => (m.team || m.department || 'Khác') === selectedWorkspace);
    }
    const teamMemberIds = activeTeamList.map(m => m.id);

    // 3. Filter Tasks by Team & Date
    let fTasks = rawTasks.filter(t => teamMemberIds.includes(t.assigned_id) || teamMemberIds.includes(t.support_id));
    fTasks = fTasks.filter(t => isTaskInDateRange(t, filterType, date1, date2));

    // 4. Calculate Stats (PM)
    let pmDone = 0, pmInProg = 0, pmOverdue = 0, pmTotal = fTasks.length, pmManday = 0, pmKpi = 0;
    const pStats = { critical: 0, high: 0, normal: 0, interrupt: 0 };
    const overdueList: any[] = [];

    fTasks.forEach(t => {
      pmManday += (t.manday_actual || t.manday_est || 0);
      pmKpi += (t.kpi_base || 0); // approximation, actual KPI calculation might differ
      const isDone = t.status === 'Done' || t.status === 'done';
      const isCancel = t.status === 'Cancel' || t.status === 'cancel';
      const isOverdue = !isDone && !isCancel && (t.days_late > 0);

      if (isDone) pmDone++;
      else { 
        pmInProg++; 
        if (isOverdue) {
          pmOverdue++;
          overdueList.push({
            id: t.id,
            name: t.name,
            assignee: t.assigned_name || 'Unassigned',
            daysLate: t.days_late,
            deadline: t.end_date_est || 'N/A'
          });
        }
      }

      const prio = (t.priority || '').toLowerCase();
      if (prio === 'critical') pStats.critical++;
      else if (prio === 'high') pStats.high++;
      else if (prio === 'interrupt') pStats.interrupt++;
      else pStats.normal++;
    });

    // 5. Ranking
    let ranking = activeTeamList.map(m => {
      const myTasks = fTasks.filter(t => t.assigned_id === m.id || t.support_id === m.id);
      let d = 0, i = 0, o = 0, md = 0, k = 0;
      myTasks.forEach(t => {
        md += (t.manday_actual || t.manday_est || 0);
        const done = t.status === 'Done' || t.status === 'done';
        if (done) { d++; k += (t.kpi_base || 0); }
        else {
           i++;
           if (t.days_late > 0) o++;
        }
      });
      // Just an approximation for KPI if it's not pre-calculated
      // If we want total kpi from db we'd use m.kpi_total but it's not date-filtered.
      // So we use calculated k.
      return { id: m.id, name: m.display_name || m.full_name, assigned: myTasks.length, done: d, inProgress: i, overdue: o, manday: md, kpi: k };
    });
    ranking.sort((a,b) => b.kpi - a.kpi);
    ranking = ranking.map((r, idx) => ({...r, rank: idx + 1}));

    // 6. Active Projects
    const projectIds = Array.from(new Set(fTasks.map((t: any) => t.project_id).filter(Boolean)));
    const aProjects = rawProjects.filter((p: any) => projectIds.includes(p.id)).map((p: any) => {
      const pTasks = fTasks.filter(t => t.project_id === p.id);
      const done = pTasks.filter(t => t.status === 'Done' || t.status === 'done').length;
      return {
        id: p.id, name: p.name, status: p.status || 'Developing', current_phase: p.current_phase || '1. Tư vấn',
        progress: pTasks.length ? Math.round((done / pTasks.length) * 100) : 0,
        totalTasks: pTasks.length, doneTasks: done
      };
    }).sort((a,b) => b.progress - a.progress);

    return { 
      workspaces: wList, 
      activeTeamMembers: activeTeamList, 
      filteredTasks: fTasks,
      pmStats: { total: pmTotal, done: pmDone, inProgress: pmInProg, overdue: pmOverdue, manday: Math.round(pmManday*10)/10, kpi: Math.round(pmKpi) },
      priorityStats: pStats,
      overdueTasksList: overdueList.sort((a,b) => b.daysLate - a.daysLate),
      memberRanking: ranking,
      activeProjects: aProjects
    };
  }, [rawMembers, rawProjects, rawTasks, selectedWorkspace, filterType, date1, date2]);

  // KPI Matrices Generation
  const { summaryMatrix, averageMatrix, bonusMatrix } = useMemo(() => {
     let sumM: any[] = [];
     let avgM: any[] = [];
     let bonM: any[] = [];
     
     if(activeTeamMembers.length === 0) return { summaryMatrix: [], averageMatrix: [], bonusMatrix: [] };

     activeTeamMembers.forEach(m => {
       const mSum: any = { name: m.display_name || m.full_name, total: 0 };
       const mAvg: any = { name: m.display_name || m.full_name, total: 0 };
       const mBon: any = { name: m.display_name || m.full_name, total: 0 };
       
       let grandKpi = 0;
       let grandCount = 0;

       for(let i=1; i<=12; i++) {
         const mTasks = rawTasks.filter(t => (t.assigned_id === m.id || t.support_id === m.id) && t.status === 'Done');
         let mkpi = 0;
         let mcount = 0;
         mTasks.forEach(t => {
           const td = new Date(t.end_date_est || t.created_at || Date.now());
           if(td.getFullYear() === matrixYear && (td.getMonth()+1) === i) {
             mkpi += (t.kpi_base || 0);
             mcount++;
           }
         });
         mSum[`m${i}`] = mkpi;
         mAvg[`m${i}`] = mcount > 0 ? (mkpi / mcount).toFixed(1) : 0;
         // mock bonus logic: if kpi > 100 then bonus is (kpi - 100) * 0.1
         const bonus = mkpi > 100 ? (mkpi - 100) * 0.1 : 0;
         mBon[`m${i}`] = bonus.toFixed(1);

         grandKpi += mkpi;
         grandCount += mcount;
       }
       mSum.total = grandKpi;
       mAvg.total = grandCount > 0 ? (grandKpi / grandCount).toFixed(1) : 0;
       sumM.push(mSum);
       avgM.push(mAvg);
       bonM.push(mBon);
     });
     
     return { summaryMatrix: sumM, averageMatrix: avgM, bonusMatrix: bonM };
  }, [rawTasks, activeTeamMembers, matrixYear]);


  return (
    <div className="p-6 space-y-6">
      {/* HEADER & WORKSPACE SELECTOR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-lg font-extrabold text-[#0b1c30]">Dashboard Tổng Quan</h2>
          <p className="text-xs text-slate-500 mt-1">Theo dõi tiến độ, hiệu suất và phân bổ KPI theo Workspace</p>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedWorkspace('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${selectedWorkspace === 'all' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            Toàn Công Ty ({rawMembers.length} người)
          </button>
          {workspaces.map(ws => (
            <button
              key={ws.name}
              onClick={() => setSelectedWorkspace(ws.name)}
              className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${selectedWorkspace === ws.name ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {ws.name} ({ws.count})
            </button>
          ))}
        </div>
      </div>

      {/* FILTER TOOLBAR */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <SvgIcon name="filter" className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold text-slate-600">Bộ lọc thời gian:</span>
        </div>
        <select 
          value={filterType} 
          onChange={(e) => { setFilterType(e.target.value); setDate1(''); setDate2(''); }}
          className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-400 cursor-pointer"
        >
          <option value="all">Tất cả thời gian</option>
          <option value="week">Theo Tuần</option>
          <option value="month">Theo Tháng</option>
          <option value="year">Theo Năm</option>
          <option value="custom">Tùy chọn khoảng ngày</option>
        </select>

        {filterType === 'week' && <input type="week" value={date1} onChange={e => setDate1(e.target.value)} className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none cursor-pointer" />}
        {filterType === 'month' && <input type="month" value={date1} onChange={e => setDate1(e.target.value)} className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none cursor-pointer" />}
        {filterType === 'year' && <input type="number" placeholder="YYYY" value={date1} onChange={e => setDate1(e.target.value)} className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none w-24 cursor-pointer" />}
        {filterType === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={date1} onChange={e => setDate1(e.target.value)} className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none cursor-pointer" />
            <span className="text-slate-400">-</span>
            <input type="date" value={date2} onChange={e => setDate2(e.target.value)} className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none cursor-pointer" />
          </div>
        )}
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Tasks Phụ Trách" value={pmStats.total} icon="tasks" border="border-l-[#0058be]" text="text-[#0058be]" trend="Tổng" />
        <KpiCard label="Đã Hoàn Thành" value={pmStats.done} icon="check" border="border-l-emerald-500" text="text-emerald-600" trend={pmStats.total ? `${Math.round(pmStats.done/pmStats.total*100)}%` : '0%'} />
        <KpiCard label="Đang Làm" value={Math.max(0, pmStats.inProgress - pmStats.overdue)} icon="lightning" border="border-l-amber-500" text="text-amber-600" trend="Trong tiến độ" />
        <KpiCard label="Trễ Hạn" value={pmStats.overdue} icon="alert" border="border-l-red-500" text="text-red-600" trend="Cần xử lý" />
        <KpiCard label="Manday Thực Tế" value={pmStats.manday} icon="clock" border="border-l-cyan-500" text="text-cyan-600" trend="Đã tiêu hao" />
        <KpiCard label="KPI Đạt Được" value={pmStats.kpi} icon="trophy" border="border-l-purple-500" text="text-purple-600" trend="Tổng điểm" />
      </div>

      {/* CHARTS & LISTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* BAR CHART STATUS */}
        <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm p-5 flex flex-col justify-between">
           <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-4">Trạng thái Task</h3>
           <BarChartCard 
              title="" 
              data={[
                { name: 'Hoàn Thành', count: pmStats.done, fill: '#10b981' },
                { name: 'Đang Làm', count: Math.max(0, pmStats.inProgress - pmStats.overdue), fill: '#f59e0b' },
                { name: 'Trễ Hạn', count: pmStats.overdue, fill: '#ef4444' }
              ]} 
              bars={[{ key: 'count', name: 'Số lượng', fill: '#0058be' }]}
              xKey="name"
           />
        </div>

        {/* PRIORITY TABLE */}
        <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Mức Độ Ưu Tiên (Priority)</h3>
          </div>
          <div className="p-4 space-y-3">
             {[
               { label: 'Critical (Khẩn cấp)', val: priorityStats.critical, cls: 'bg-red-50 text-red-600 border-red-200' },
               { label: 'High (Cao)', val: priorityStats.high, cls: 'bg-orange-50 text-orange-600 border-orange-200' },
               { label: 'Normal (Bình thường)', val: priorityStats.normal, cls: 'bg-blue-50 text-blue-600 border-blue-200' },
               { label: 'Interrupt (Phát sinh)', val: priorityStats.interrupt, cls: 'bg-purple-50 text-purple-600 border-purple-200' }
             ].map(item => (
                <div key={item.label} className={`flex items-center justify-between p-3 rounded-xl border ${item.cls}`}>
                  <span className="text-xs font-bold">{item.label}</span>
                  <span className="text-sm font-extrabold">{item.val} tasks</span>
                </div>
             ))}
          </div>
        </div>

        {/* OVERDUE LIST */}
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-red-100 bg-red-50/50 flex justify-between items-center">
            <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider">Task Trễ Hạn ({overdueTasksList.length})</h3>
          </div>
          <div className="p-4 overflow-y-auto max-h-[300px] space-y-2 custom-scrollbar">
            {overdueTasksList.length === 0 ? (
               <p className="text-xs text-slate-400 font-semibold text-center py-6">Không có task trễ hạn.</p>
            ) : (
               overdueTasksList.map((t, idx) => (
                 <div key={idx} className="p-3 bg-white rounded-xl border border-red-100 hover:border-red-300">
                    <p className="text-xs font-bold text-[#0b1c30] leading-snug">{t.name}</p>
                    <div className="flex justify-between items-center mt-2">
                       <span className="text-[10px] font-semibold text-slate-500">Phụ trách: <span className="text-slate-700">{t.assignee}</span></span>
                       <span className="text-[10px] font-extrabold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200">Trễ {t.daysLate} ngày</span>
                    </div>
                 </div>
               ))
            )}
          </div>
        </div>
      </div>

      {/* MEMBER KPI RANKING */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <SvgIcon name="crown" className="w-4 h-4 text-indigo-600" />
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Bảng Xếp Hạng KPI Thành Viên</h3>
          </div>
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
                <th className="px-4 py-3 font-bold min-w-[140px]">Tiến Độ</th>
              </tr>
            </thead>
            <tbody>
              {memberRanking.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-6 text-slate-400 font-semibold">Chưa có thành viên nào.</td></tr>
              ) : (
                memberRanking.map((m, i) => {
                  const rate = m.assigned > 0 ? Math.round((m.done / m.assigned) * 100) : 0;
                  return (
                    <tr key={m.id} className={`border-b border-slate-50 hover:bg-indigo-50/30 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/20'}`}>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`text-xs font-bold ${m.rank <= 3 ? 'text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200' : 'text-slate-400'}`}>#{m.rank}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-[#0b1c30]">{m.name}</span>
                      </td>
                      <td className="px-4 py-3.5 text-center font-semibold text-slate-600">{m.assigned}</td>
                      <td className="px-4 py-3.5 text-center"><span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{m.done}</span></td>
                      <td className="px-4 py-3.5 text-center font-semibold text-blue-600">{m.inProgress}</td>
                      <td className="px-4 py-3.5 text-center">{m.overdue > 0 ? <span className="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">{m.overdue}</span> : <span className="text-slate-300 font-bold">—</span>}</td>
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

      {/* KPI MATRICES */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden p-5 space-y-6">
         <div className="flex flex-col sm:flex-row justify-between items-center border-b border-slate-100 pb-4 gap-4">
           <h3 className="text-sm font-bold text-[#0b1c30] uppercase tracking-wider">Ma Trận KPI Thành Viên</h3>
           <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600">Lọc theo năm:</span>
              <input type="number" value={matrixYear} onChange={e => setMatrixYear(parseInt(e.target.value))} className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 w-24 outline-none cursor-pointer" />
           </div>
         </div>

         {/* 1. Summary Matrix */}
         <div>
           <h4 className="text-xs font-bold text-indigo-700 mb-2">1. Tổng Hợp KPI (Summary Matrix)</h4>
           <div className="overflow-x-auto custom-scrollbar">
             <table className="w-full text-[10px] text-center border-collapse">
               <thead>
                 <tr className="bg-slate-100 text-slate-600 font-bold">
                   <th className="p-2 border border-slate-200 text-left min-w-[120px]">Thành Viên</th>
                   {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <th key={m} className="p-2 border border-slate-200">T{m}</th>)}
                   <th className="p-2 border border-slate-200 bg-indigo-50 text-indigo-700">Tổng</th>
                 </tr>
               </thead>
               <tbody>
                 {summaryMatrix.map((r,i) => (
                   <tr key={i} className="hover:bg-slate-50">
                     <td className="p-2 border border-slate-200 text-left font-bold text-[#0b1c30]">{r.name}</td>
                     {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <td key={m} className="p-2 border border-slate-200 font-semibold">{r[`m${m}`]}</td>)}
                     <td className="p-2 border border-slate-200 bg-indigo-50/30 font-extrabold text-indigo-700">{r.total}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
         </div>

         {/* 2. Average Matrix */}
         <div>
           <h4 className="text-xs font-bold text-emerald-700 mb-2">2. Trung Bình KPI / Task (Average Matrix)</h4>
           <div className="overflow-x-auto custom-scrollbar">
             <table className="w-full text-[10px] text-center border-collapse">
               <thead>
                 <tr className="bg-slate-100 text-slate-600 font-bold">
                   <th className="p-2 border border-slate-200 text-left min-w-[120px]">Thành Viên</th>
                   {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <th key={m} className="p-2 border border-slate-200">T{m}</th>)}
                   <th className="p-2 border border-slate-200 bg-emerald-50 text-emerald-700">Trung bình</th>
                 </tr>
               </thead>
               <tbody>
                 {averageMatrix.map((r,i) => (
                   <tr key={i} className="hover:bg-slate-50">
                     <td className="p-2 border border-slate-200 text-left font-bold text-[#0b1c30]">{r.name}</td>
                     {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <td key={m} className="p-2 border border-slate-200 font-semibold">{r[`m${m}`]}</td>)}
                     <td className="p-2 border border-slate-200 bg-emerald-50/30 font-extrabold text-emerald-700">{r.total}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
         </div>

         {/* 3. Bonus Matrix */}
         <div>
           <h4 className="text-xs font-bold text-amber-700 mb-2">3. KPI Thưởng (Bonus Matrix)</h4>
           <div className="overflow-x-auto custom-scrollbar">
             <table className="w-full text-[10px] text-center border-collapse">
               <thead>
                 <tr className="bg-slate-100 text-slate-600 font-bold">
                   <th className="p-2 border border-slate-200 text-left min-w-[120px]">Thành Viên</th>
                   {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <th key={m} className="p-2 border border-slate-200">T{m}</th>)}
                 </tr>
               </thead>
               <tbody>
                 {bonusMatrix.map((r,i) => (
                   <tr key={i} className="hover:bg-slate-50">
                     <td className="p-2 border border-slate-200 text-left font-bold text-[#0b1c30]">{r.name}</td>
                     {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <td key={m} className="p-2 border border-slate-200 font-semibold text-amber-600">{r[`m${m}`]}</td>)}
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
         </div>
      </div>
    </div>
  );
}
