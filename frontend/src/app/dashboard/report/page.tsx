'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { getEmail, getName, getToken } from '@/lib/auth';
import KpiCard from '@/components/dashboard/KpiCard';
import PieChartCard from '@/components/dashboard/PieChartCard';
import BarChartCard from '@/components/dashboard/BarChartCard';
import SvgIcon from '@/components/dashboard/Icons';

const formatVNDate = (dStr: string) => {
  if (!dStr) return '—';
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return dStr;
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
};

import { 
  priorityDot,
  statusStyle,
  activityColor
} from '@/app/dashboard/constants';

let cachedReportData: any = null;

function getWeekOfMonth(date: Date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  return Math.ceil((date.getDate() + firstDay) / 7);
}

export default function ReportTab() {
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>('all');
  const [selectedWeek, setSelectedWeek] = useState<number | 'all'>('all');

  const [searchTaskName, setSearchTaskName] = useState<string>('');
  const [filterCustomer, setFilterCustomer] = useState<string>('all');
  const [filterProject, setFilterProject] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const [sortDeadline, setSortDeadline] = useState<'default'|'asc'|'desc'>('default');
  const [sortKPI, setSortKPI] = useState<'default'|'desc'|'asc'>('default');

  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [realMemberData, setRealMemberData] = useState<any>(cachedReportData?.realMemberData || null);
  const [loadingReal, setLoadingReal] = useState(false);

  const [rawMyTasks, setRawMyTasks] = useState<any[]>(cachedReportData?.rawMyTasks || []);
  
  const fetchReportData = useCallback((forceRefresh = false) => {
    if (!forceRefresh && cachedReportData && cachedReportData.rawMyTasks?.length > 0) {
      return;
    }

    setLoadingReal(true);
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    
    Promise.all([
      axios.get(`/api/users/me?_t=${ts}`, config).catch(() => ({ data: {} })),
      axios.get(`/api/members?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/all-tasks-global?_t=${ts}`, config).catch(() => ({ data: [] }))
    ]).then(([userRes, membersRes, tasksRes]) => {
      const currentUser = userRes.data || {};
      setCurrentUserProfile(currentUser);
      const currentEmail = (currentUser.email || getEmail() || '').toLowerCase().trim();
      const currentName = (currentUser.full_name || getName() || '').toLowerCase().trim();
      const memberIdFromAccount = currentUser.member_id;

      const list = membersRes.data || [];
      let matched = null;
      if (memberIdFromAccount) matched = list.find((m: any) => m.id === memberIdFromAccount);
      if (!matched && currentEmail) matched = list.find((m: any) => m.email?.toLowerCase() === currentEmail);
      if (!matched && currentName) matched = list.find((m: any) => 
        m.display_name?.toLowerCase() === currentName || 
        m.full_name?.toLowerCase() === currentName
      );

      setRealMemberData(matched);
      const memberId = matched?.id || memberIdFromAccount;
      const memberDisplayName = (matched?.display_name || '').toLowerCase().trim();
      const memberFullName = (matched?.full_name || '').toLowerCase().trim();

      const allTasksCombined = tasksRes.data || [];

      const myTasks = allTasksCombined.filter((t: any) => {
        if (memberId && (t.assigned_id === memberId || t.support_id === memberId)) return true;
        const assignNameLow = (t.assigned_name || '').toLowerCase().trim();
        const suppNameLow = (t.support_name || '').toLowerCase().trim();

        if (assignNameLow || suppNameLow) {
          if (memberDisplayName && (assignNameLow === memberDisplayName || suppNameLow === memberDisplayName)) return true;
          if (memberFullName && (assignNameLow === memberFullName || suppNameLow === memberFullName)) return true;
        }

        return false;
      });

      setRawMyTasks(myTasks);

      cachedReportData = {
        realMemberData: matched,
        rawMyTasks: myTasks,
      };
    }).finally(() => setLoadingReal(false));
  }, []);

  useEffect(() => {
    fetchReportData(false);
  }, [fetchReportData]);

  // Derived state based on filters
  const {
    myRealTasks,
    realUpcomingDeadlines,
    realOverdueTasks,
    realTaskStats,
    filteredActivities,
    weeklyProgress,
    monthlyProgress
  } = useMemo(() => {
    let doneCount = 0;
    let inProgressCount = 0;
    let overdueCount = 0;
    let mandayTotal = 0;
    let dynamicKpi = 0;
    const upcoming: any[] = [];
    const overdueList: any[] = [];
    const acts: any[] = [];
    const now = new Date();

    const filteredTasks = rawMyTasks.filter(t => {
      if (!t.end_date_est) return true;
      const taskDate = new Date(t.end_date_est);
      if (isNaN(taskDate.getTime())) return true;

      if (selectedYear !== 'all' && taskDate.getFullYear() !== selectedYear) return false;
      if (selectedMonth !== 'all' && (taskDate.getMonth() + 1) !== selectedMonth) return false;

      if (selectedWeek !== 'all') {
        const taskWeek = getWeekOfMonth(taskDate);
        if (taskWeek !== selectedWeek) return false;
      }
      return true;
    });

    filteredTasks.forEach((t: any) => {
      mandayTotal += (t.manday_actual || t.manday_est || 0);
      
      const isDone = t.status === 'Done' || t.status === 'done';
      const isCancel = t.status === 'Cancel' || t.status === 'cancel';
      const daysLateNum = typeof t.days_late === 'number' ? t.days_late : 0;

      const isOverdue = !isDone && !isCancel && daysLateNum > 0;

      if (isDone) {
        doneCount++;
        dynamicKpi += (t.kpi_base || 0);
        acts.push({ action: `Hoàn thành: ${t.name}`, time: 'Đã hoàn thành', type: 'done' });
      } else if (isCancel) {
        acts.push({ action: `Đã hủy: ${t.name}`, time: 'Hủy tác vụ', type: 'cancel' });
      } else {
        inProgressCount++;
        if (isOverdue) {
          overdueCount++;
          overdueList.push({
            id: t.id,
            project: t.projectName,
            customer: t.customerName,
            year: t.year,
            name: t.name,
            deadline: t.end_date_est || 'Chưa có',
            daysLate: daysLateNum
          });
          acts.push({ action: `Trễ hạn ${daysLateNum} ngày: ${t.name}`, time: 'Cần chú ý', type: 'overdue' });
        } else if (t.end_date_est) {
          const diffTime = new Date(t.end_date_est).getTime() - now.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays <= 3) {
            upcoming.push({
              id: t.id, project: t.projectName, name: t.name, deadline: t.end_date_est, daysLeft: diffDays
            });
          }
        }
      }
    });

    const stats = {
      total: filteredTasks.length,
      done: doneCount,
      inProgress: inProgressCount,
      overdue: overdueCount,
      manday: Math.round(mandayTotal * 10) / 10,
      kpi: dynamicKpi
    };

    const kpiPoints = dynamicKpi;

    const wProg = [
      { name: 'Tuần 1', kpi: Math.round(kpiPoints * 0.25), tasks: Math.ceil(doneCount * 0.25) },
      { name: 'Tuần 2', kpi: Math.round(kpiPoints * 0.5), tasks: Math.ceil(doneCount * 0.5) },
      { name: 'Tuần 3', kpi: Math.round(kpiPoints * 0.75), tasks: Math.ceil(doneCount * 0.75) },
      { name: 'Tuần 4', kpi: Math.round(kpiPoints), tasks: filteredTasks.length },
    ];
    
    const mProg = [{ name: `Tháng ${selectedMonth}`, kpi: Math.round(kpiPoints), tasks: filteredTasks.length }];

    return {
      myRealTasks: filteredTasks,
      realUpcomingDeadlines: upcoming,
      realOverdueTasks: overdueList,
      realTaskStats: stats,
      filteredActivities: acts.slice(0, 5),
      weeklyProgress: wProg,
      monthlyProgress: mProg
    };
  }, [rawMyTasks, selectedYear, selectedMonth, selectedWeek, realMemberData]);

  const reportKpiCards = [
    { label: 'Tasks Được Giao', value: realTaskStats.total, icon: 'tasks',     border: 'border-l-[#0058be]', text: 'text-[#0058be]', trend: selectedWeek === 'all' ? 'Trong tháng' : 'Trong tuần' },
    { label: 'Đã Hoàn Thành', value: realTaskStats.done, icon: 'check',     border: 'border-l-emerald-500', text: 'text-emerald-600', trend: realTaskStats.total > 0 ? `${Math.round((realTaskStats.done / realTaskStats.total) * 100)}%` : '0%' },
    { label: 'Đang Làm', value: realTaskStats.inProgress, icon: 'lightning', border: 'border-l-amber-500', text: 'text-amber-600', trend: 'Đang triển khai' },
    { label: 'Trễ Hạn', value: realTaskStats.overdue, icon: 'alert',     border: 'border-l-red-500', text: 'text-red-600', trend: 'Cần xử lý' },
    { label: 'Manday Làm Việc', value: realTaskStats.manday, icon: 'clock',     border: 'border-l-cyan-500', text: 'text-cyan-600', trend: 'Số ngày tích lũy' },
    { label: 'Điểm KPI', value: realTaskStats.kpi || 0, icon: 'trophy',    border: 'border-l-purple-500', text: 'text-purple-600', trend: 'Trong kỳ đánh giá' }
  ];

  const tableTasks = useMemo(() => {
    let filtered = myRealTasks.filter((t: any) => {
      if (searchTaskName && !t.name?.toLowerCase().includes(searchTaskName.toLowerCase())) return false;
      if (filterCustomer !== 'all' && (t.customerName || 'Không có') !== filterCustomer) return false;
      if (filterProject !== 'all' && (t.projectName || 'Không có') !== filterProject) return false;
      if (filterPriority !== 'all' && (t.priority || 'Normal') !== filterPriority) return false;
      if (filterStatus !== 'all' && (t.status || 'Chưa rõ') !== filterStatus) return false;
      return true;
    });

    if (sortDeadline !== 'default') {
      filtered.sort((a: any, b: any) => {
        const da = a.end_date_est ? new Date(a.end_date_est).getTime() : Infinity;
        const db = b.end_date_est ? new Date(b.end_date_est).getTime() : Infinity;
        return sortDeadline === 'asc' ? da - db : db - da;
      });
    } else if (sortKPI !== 'default') {
      filtered.sort((a: any, b: any) => {
        const ka = a.kpi_base || 0;
        const kb = b.kpi_base || 0;
        return sortKPI === 'desc' ? kb - ka : ka - kb;
      });
    }
    return filtered;
  }, [myRealTasks, searchTaskName, filterCustomer, filterProject, filterPriority, filterStatus, sortDeadline, sortKPI]);

  const uniqueCustomers = Array.from(new Set(myRealTasks.map((t: any) => t.customerName || 'Không có')));
  const uniqueProjects = Array.from(new Set(myRealTasks.map((t: any) => t.projectName || 'Không có')));
  const uniquePriorities = Array.from(new Set(myRealTasks.map((t: any) => t.priority || 'Normal')));
  const uniqueStatuses = Array.from(new Set(myRealTasks.map((t: any) => t.status || 'Chưa rõ')));

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Báo cáo hiệu suất cá nhân</h3>
          {loadingReal && <span className="text-[10px] text-blue-600 font-semibold animate-pulse">Đang cập nhật...</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchReportData(true)}
            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm text-[11px] font-bold transition-all active:scale-95 cursor-pointer"
          >
            <SvgIcon name="refresh" className="w-3.5 h-3.5 text-slate-500" />
            <span>Làm mới dữ liệu</span>
          </button>
          
          <div className="flex gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm text-[11px] font-bold">
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
                {[...Array(12)].map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
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
                {[...Array(5)].map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {reportKpiCards.map(c => <KpiCard key={c.label} {...c} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PieChartCard title="Trạng thái Task" data={[
          { name: 'Hoàn Thành', value: realTaskStats.done, fill: '#10b981' },
          { name: 'Đang Làm', value: Math.max(0, realTaskStats.inProgress - realTaskStats.overdue), fill: '#f59e0b' },
          { name: 'Trễ Hạn', value: realTaskStats.overdue, fill: '#ef4444' }
        ]} />
        
        <div className="relative">
          <BarChartCard
            title={selectedWeek === 'all' ? "Tiến độ KPI theo tuần trong tháng" : "Tiến độ KPI tuần này"}
            data={selectedWeek === 'all' ? weeklyProgress : monthlyProgress}
            bars={[
              { key: 'kpi',   name: 'Điểm KPI',  fill: '#6366f1' },
              { key: 'tasks', name: 'Số Task', fill: '#10b981' },
            ]}
            xKey="name"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <SvgIcon name="tasks" className="w-4 h-4 text-[#0058be]" />
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Task Của Tôi</h3>
          </div>
          <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full border border-indigo-100">{myRealTasks.length} task</span>
        </div>
        <div className="overflow-x-auto overflow-y-auto max-h-[500px] custom-scrollbar relative">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur shadow-sm">
              <tr className="text-slate-500 border-b border-slate-200 text-[10px] tracking-wider">
                <th className="px-4 py-2 min-w-[150px] max-w-[250px] w-1/4 align-top bg-slate-100">
                  <div className="flex flex-col gap-1.5">
                    <span className="font-bold uppercase text-slate-500 text-left">Tên Task</span>
                    <input 
                      type="text" 
                      placeholder="🔍 Tìm task..." 
                      value={searchTaskName} 
                      onChange={e => setSearchTaskName(e.target.value)} 
                      className="w-full text-[11px] font-semibold border border-slate-300 rounded px-2 py-1 outline-none focus:border-[#0058be] bg-white text-slate-700" 
                    />
                  </div>
                </th>
                <th className="px-4 py-2 align-top bg-slate-100">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between group">
                      <span className="font-bold uppercase text-slate-500">Khách Hàng</span>
                      <div className="relative">
                        <button className="p-1 rounded group-hover:bg-slate-200 transition-colors">
                          <SvgIcon name="filter" className={`w-3 h-3 ${filterCustomer !== 'all' ? 'text-[#0058be]' : 'text-slate-400'}`} />
                        </button>
                        <select 
                          value={filterCustomer} 
                          onChange={e => setFilterCustomer(e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        >
                          <option value="all">Tất cả</option>
                          {uniqueCustomers.map((c: any) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    {filterCustomer !== 'all' && <div className="text-[10px] text-[#0058be] font-semibold truncate max-w-[120px]" title={filterCustomer}>{filterCustomer}</div>}
                  </div>
                </th>
                <th className="px-4 py-2 align-top bg-slate-100">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between group">
                      <span className="font-bold uppercase text-slate-500">Dự Án</span>
                      <div className="relative">
                        <button className="p-1 rounded group-hover:bg-slate-200 transition-colors">
                          <SvgIcon name="filter" className={`w-3 h-3 ${filterProject !== 'all' ? 'text-[#0058be]' : 'text-slate-400'}`} />
                        </button>
                        <select 
                          value={filterProject} 
                          onChange={e => setFilterProject(e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        >
                          <option value="all">Tất cả</option>
                          {uniqueProjects.map((p: any) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                    {filterProject !== 'all' && <div className="text-[10px] text-[#0058be] font-semibold truncate max-w-[120px]" title={filterProject}>{filterProject}</div>}
                  </div>
                </th>
                <th className="px-4 py-2 align-top w-[110px] bg-slate-100">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between group">
                      <span className="font-bold uppercase text-slate-500">Ưu Tiên</span>
                      <div className="relative">
                        <button className="p-1 rounded group-hover:bg-slate-200 transition-colors">
                          <SvgIcon name="filter" className={`w-3 h-3 ${filterPriority !== 'all' ? 'text-[#0058be]' : 'text-slate-400'}`} />
                        </button>
                        <select 
                          value={filterPriority} 
                          onChange={e => setFilterPriority(e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        >
                          <option value="all">Tất cả</option>
                          {uniquePriorities.map((p: any) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                    {filterPriority !== 'all' && <div className="text-[10px] text-[#0058be] font-semibold truncate max-w-[100px]" title={filterPriority}>{filterPriority}</div>}
                  </div>
                </th>
                <th className="px-4 py-2 align-top w-[110px] bg-slate-100">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between group">
                      <span className="font-bold uppercase text-slate-500">Trạng Thái</span>
                      <div className="relative">
                        <button className="p-1 rounded group-hover:bg-slate-200 transition-colors">
                          <SvgIcon name="filter" className={`w-3 h-3 ${filterStatus !== 'all' ? 'text-[#0058be]' : 'text-slate-400'}`} />
                        </button>
                        <select 
                          value={filterStatus} 
                          onChange={e => setFilterStatus(e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        >
                          <option value="all">Tất cả</option>
                          {uniqueStatuses.map((s: any) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    {filterStatus !== 'all' && <div className="text-[10px] text-[#0058be] font-semibold truncate max-w-[100px]" title={filterStatus}>{filterStatus}</div>}
                  </div>
                </th>
                <th className="px-4 py-2 align-top text-center w-[100px] bg-slate-100">
                  <button 
                    onClick={() => {
                      if (sortDeadline === 'default') { setSortDeadline('asc'); setSortKPI('default'); }
                      else if (sortDeadline === 'asc') setSortDeadline('desc');
                      else setSortDeadline('default');
                    }}
                    className="font-bold uppercase hover:text-[#0058be] transition-colors inline-flex items-center justify-center w-full gap-1 pt-0.5"
                  >
                    Deadline
                    <span className="text-[12px] leading-none text-[#0058be]">
                      {sortDeadline === 'asc' ? '↑' : sortDeadline === 'desc' ? '↓' : '↕'}
                    </span>
                  </button>
                </th>
                <th className="px-4 py-2 align-top text-center w-[80px] bg-slate-100">
                  <button 
                    onClick={() => {
                      if (sortKPI === 'default') { setSortKPI('desc'); setSortDeadline('default'); }
                      else if (sortKPI === 'desc') setSortKPI('asc');
                      else setSortKPI('default');
                    }}
                    className="font-bold uppercase hover:text-[#0058be] transition-colors inline-flex items-center justify-center w-full gap-1 pt-0.5"
                  >
                    KPI
                    <span className="text-[12px] leading-none text-[#0058be]">
                      {sortKPI === 'desc' ? '↓' : sortKPI === 'asc' ? '↑' : '↕'}
                    </span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {tableTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-slate-400 font-semibold">Chưa có task nào phù hợp bộ lọc.</td>
                </tr>
              ) : (
                tableTasks.map((t: any, i: number) => (
                  <tr key={t.id} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                    <td className="px-4 py-3 font-semibold text-[#0b1c30] whitespace-normal break-words max-w-[250px]">
                      <div className="flex items-start gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${priorityDot[t.priority] || 'bg-slate-400'}`} />
                        <span className="leading-tight">{t.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-semibold">{t.customerName || 'Không có'}</td>
                    <td className="px-4 py-3 text-slate-500 font-semibold">{t.projectName}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
                        t.priority === 'Critical' ? 'bg-red-100 text-red-700' :
                        t.priority === 'High'     ? 'bg-orange-100 text-orange-700' :
                        t.priority === 'Interrupt'? 'bg-purple-100 text-purple-700' :
                        t.priority === 'Normal'   ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                      }`}>{t.priority || 'Normal'}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${statusStyle[t.status] || ''}`}>{t.status}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-500 tabular-nums">{formatVNDate(t.end_date_est)}</td>
                    <td className="px-4 py-3 text-center font-extrabold text-[#0058be]">{t.kpi_base || 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-amber-50/40 to-white">
            <div className="flex items-center gap-2">
              <SvgIcon name="clock" className="w-4 h-4 text-amber-600" />
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Deadline Gần (≤ 3 ngày)</h3>
            </div>
            <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-100">{realUpcomingDeadlines.length}</span>
          </div>
          <div className="p-4 space-y-3">
            {realUpcomingDeadlines.length === 0 ? (
              <p className="text-xs text-slate-400 font-semibold text-center py-6">Không có task nào sắp hết hạn.</p>
            ) : (
              realUpcomingDeadlines.map(d => (
                <div key={d.id} className="rounded-xl p-4 border border-amber-200 bg-amber-50/50 hover:bg-amber-50 transition-colors">
                  <span className="text-[9px] font-extrabold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full uppercase">{d.project}</span>
                  <p className="text-xs font-bold text-[#0b1c30] mt-1.5 leading-snug">{d.name}</p>
                  <div className="flex items-center justify-between mt-3 text-[11px] text-slate-500">
                    <span className="font-semibold tabular-nums">Hạn: {formatVNDate(d.deadline)}</span>
                    <span className="font-extrabold text-red-600">Còn {d.daysLeft} ngày</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <SvgIcon name="history" className="w-4 h-4 text-slate-600" />
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Hoạt Động Gần Đây</h3>
            </div>
            <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{filteredActivities.length}</span>
          </div>
          <div className="p-4 space-y-2.5">
            {filteredActivities.length === 0 ? (
              <p className="text-xs text-slate-400 font-semibold text-center py-6">Chưa có hoạt động gần đây.</p>
            ) : (
              filteredActivities.map((a, idx) => (
                <div key={idx} className="flex gap-3 items-start p-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                  <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${activityColor[a.type] || 'bg-slate-100 text-slate-500'}`}>✓</span>
                  <div><p className="text-[11px] font-semibold text-[#0b1c30]">{a.action}</p><p className="text-[10px] text-slate-400 mt-0.5">{a.time}</p></div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-red-100 bg-red-50/50">
            <div className="flex items-center gap-2">
              <SvgIcon name="alert" className="w-4 h-4 text-red-600" />
              <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider">Task Trễ Hạn</h3>
            </div>
            <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{realOverdueTasks.length}</span>
          </div>
          <div className="p-4 space-y-3">
            {realOverdueTasks.length === 0 ? (
              <p className="text-xs text-slate-400 font-semibold text-center py-6">Tuyệt vời! Không có task nào trễ hạn.</p>
            ) : (
              realOverdueTasks.map(t => (
                <div key={t.id} className="p-4 bg-red-50 rounded-xl border border-red-100 hover:border-red-200 transition-colors">
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    <span className="text-[9px] font-extrabold text-red-700 bg-red-100 px-2 py-0.5 rounded-full uppercase">{t.project} {t.year ? `(${t.year})` : ''}</span>
                    <span className="text-[9px] font-extrabold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full uppercase">{t.customer || 'Không có'}</span>
                  </div>
                  <p className="text-xs font-bold text-[#0b1c30] leading-snug">{t.name}</p>
                  <div className="flex items-center justify-between mt-3 text-[11px]">
                    <span className="font-extrabold text-red-600 bg-white border border-red-200 px-2 py-0.5 rounded-md">Trễ {t.daysLate} ngày</span>
                    <span className="text-slate-400 font-semibold tabular-nums">Hạn: {formatVNDate(t.deadline)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
