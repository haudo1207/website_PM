'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { getEmail, getName, getToken } from '@/lib/auth';
import KpiCard from '@/components/dashboard/KpiCard';
import PieChartCard from '@/components/dashboard/PieChartCard';
import BarChartCard from '@/components/dashboard/BarChartCard';
import SvgIcon from '@/components/dashboard/Icons';
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
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedWeek, setSelectedWeek] = useState<number | 'all'>('all');

  const [searchTaskName, setSearchTaskName] = useState<string>('');
  const [filterCustomer, setFilterCustomer] = useState<string>('all');
  const [filterProject, setFilterProject] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

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

      if (taskDate.getFullYear() !== selectedYear) return false;
      const taskMonth = taskDate.getMonth() + 1;
      if (taskMonth !== selectedMonth) return false;

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
    return myRealTasks.filter((t: any) => {
      if (searchTaskName && !t.name?.toLowerCase().includes(searchTaskName.toLowerCase())) return false;
      if (filterCustomer !== 'all' && (t.customerName || 'Không có') !== filterCustomer) return false;
      if (filterProject !== 'all' && (t.projectName || 'Không có') !== filterProject) return false;
      if (filterPriority !== 'all' && (t.priority || 'Normal') !== filterPriority) return false;
      if (filterStatus !== 'all' && (t.status || 'Chưa rõ') !== filterStatus) return false;
      return true;
    });
  }, [myRealTasks, searchTaskName, filterCustomer, filterProject, filterPriority, filterStatus]);

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
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="bg-transparent border-none text-[#0058be] font-bold focus:outline-none cursor-pointer"
              >
                {[...Array(5)].map((_, i) => <option key={i} value={new Date().getFullYear() - 2 + i}>{new Date().getFullYear() - 2 + i}</option>)}
              </select>
            </div>
            <div className="w-px h-4 bg-slate-200 self-center"></div>
            <div className="flex items-center gap-1">
              <span className="text-slate-500">Tháng:</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="bg-transparent border-none text-[#0058be] font-bold focus:outline-none cursor-pointer"
              >
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
              <tr className="text-slate-400 border-b border-slate-100 uppercase text-[10px] tracking-wider">
                <th className="px-5 py-3 text-left font-bold min-w-[200px]">Tên Task</th>
                <th className="px-4 py-3 text-left font-bold">Khách hàng</th>
                <th className="px-4 py-3 text-left font-bold">Dự Án</th>
                <th className="px-4 py-3 text-center font-bold">Ưu Tiên</th>
                <th className="px-4 py-3 text-center font-bold">Trạng Thái</th>
                <th className="px-4 py-3 text-center font-bold">Deadline</th>
                <th className="px-4 py-3 text-center font-bold">KPI</th>
              </tr>
              <tr className="bg-white/95 border-b border-slate-100">
                <th className="px-2 py-1.5">
                  <input type="text" placeholder="🔍 Tìm task..." value={searchTaskName} onChange={e => setSearchTaskName(e.target.value)} className="w-full text-[11px] font-semibold border border-slate-200 rounded px-2 py-1 outline-none focus:border-indigo-400" />
                </th>
                <th className="px-2 py-1.5">
                  <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} className="w-full text-[11px] font-semibold border border-slate-200 rounded px-1 py-1 outline-none">
                    <option value="all">Tất cả</option>
                    {uniqueCustomers.map((c: any) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </th>
                <th className="px-2 py-1.5">
                  <select value={filterProject} onChange={e => setFilterProject(e.target.value)} className="w-full text-[11px] font-semibold border border-slate-200 rounded px-1 py-1 outline-none">
                    <option value="all">Tất cả</option>
                    {uniqueProjects.map((p: any) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </th>
                <th className="px-2 py-1.5">
                  <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="w-full text-[11px] font-semibold border border-slate-200 rounded px-1 py-1 outline-none">
                    <option value="all">Tất cả</option>
                    {uniquePriorities.map((p: any) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </th>
                <th className="px-2 py-1.5">
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="w-full text-[11px] font-semibold border border-slate-200 rounded px-1 py-1 outline-none">
                    <option value="all">Tất cả</option>
                    {uniqueStatuses.map((s: any) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </th>
                <th colSpan={2}></th>
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
                    <td className="px-5 py-3 font-semibold text-[#0b1c30]">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityDot[t.priority] || 'bg-slate-400'}`} />
                        {t.name}
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
                    <td className="px-4 py-3 text-center text-slate-500 tabular-nums">{t.end_date_est || '—'}</td>
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
                    <span className="font-semibold tabular-nums">Hạn: {d.deadline}</span>
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
                    <span className="text-slate-400 font-semibold tabular-nums">Hạn: {t.deadline}</span>
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
