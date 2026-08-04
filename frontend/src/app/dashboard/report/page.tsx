'use client';

import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { getEmail, getName, getToken } from '@/lib/auth';
import KpiCard from '@/components/dashboard/KpiCard';
import PieChartCard from '@/components/dashboard/PieChartCard';
import BarChartCard from '@/components/dashboard/BarChartCard';
import { 
  priorityDot,
  statusStyle,
  activityColor,
  activityIcon
} from '@/app/dashboard/constants';

export default function ReportTab() {
  const [kpiTimeFilter, setKpiTimeFilter] = useState<'month' | 'week'>('month');
  const [chartFilter, setChartFilter] = useState<'month' | 'week'>('week');

  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [realMemberData, setRealMemberData] = useState<any>(null);
  const [loadingReal, setLoadingReal] = useState(false);

  const [myRealTasks, setMyRealTasks] = useState<any[]>([]);
  const [realUpcomingDeadlines, setRealUpcomingDeadlines] = useState<any[]>([]);
  const [realOverdueTasks, setRealOverdueTasks] = useState<any[]>([]);
  const [realTaskStats, setRealTaskStats] = useState({ done: 0, inProgress: 0, overdue: 0, total: 0, manday: 0 });
  
  // Real dynamic activities & chart progress
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [weeklyProgress, setWeeklyProgress] = useState<any[]>([]);
  const [monthlyProgress, setMonthlyProgress] = useState<any[]>([]);

  const fetchReportData = useCallback(() => {
    setLoadingReal(true);
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    
    axios.get(`/api/users/me?_t=${ts}`, config)
      .then(userRes => {
        const currentUser = userRes.data || {};
        setCurrentUserProfile(currentUser);
        const currentUserId = currentUser.id;
        const currentEmail = (currentUser.email || getEmail() || '').toLowerCase().trim();
        const currentName = (currentUser.full_name || getName() || '').toLowerCase().trim();
        const memberIdFromAccount = currentUser.member_id;
        
        return axios.get(`/api/members?_t=${ts}`, config).then(membersRes => {
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
          const memberDisplayName = matched?.display_name?.toLowerCase().trim();
          const memberFullName = matched?.full_name?.toLowerCase().trim();
            
          // Single global API call to fetch all tasks across all projects
          axios.get(`/api/all-tasks-global?_t=${ts}`, config).then(tRes => {
            const allTasksCombined = tRes.data || [];
            
            // Robust matching by Display Name, Full Name, Email, or Member/User ID
            const myTasks = allTasksCombined.filter((t: any) => {
              // 1. Match by ID
              if (currentUserId && (t.assigned_id === currentUserId || t.support_id === currentUserId)) return true;
              if (memberIdFromAccount && (t.assigned_id === memberIdFromAccount || t.support_id === memberIdFromAccount)) return true;
              if (memberId && (t.assigned_id === memberId || t.support_id === memberId)) return true;
              
              // 2. Match by Display Name & Full Name (bidirectional inclusion)
              const assignNameLow = (t.assigned_name || '').toLowerCase().trim();
              const suppNameLow = (t.support_name || '').toLowerCase().trim();
              
              if (memberDisplayName && (
                assignNameLow.includes(memberDisplayName) || memberDisplayName.includes(assignNameLow) ||
                suppNameLow.includes(memberDisplayName) || memberDisplayName.includes(suppNameLow)
              )) return true;
              
              if (memberFullName && (
                assignNameLow.includes(memberFullName) || memberFullName.includes(assignNameLow) ||
                suppNameLow.includes(memberFullName) || memberFullName.includes(suppNameLow)
              )) return true;

              if (currentEmail && (assignNameLow.includes(currentEmail) || suppNameLow.includes(currentEmail))) return true;
              if (currentName && (assignNameLow.includes(currentName) || suppNameLow.includes(currentName))) return true;
              
              return false;
            });

            let doneCount = 0;
            let inProgressCount = 0;
            let overdueCount = 0;
            let mandayTotal = 0;
            const upcoming: any[] = [];
            const overdueList: any[] = [];
            const acts: any[] = [];
            const today = new Date();

            myTasks.forEach((t: any) => {
              mandayTotal += (t.manday_actual || t.manday_est || 0);
              if (t.status === 'Done') {
                doneCount++;
                acts.push({ action: `Hoàn thành: ${t.name}`, time: 'Đã hoàn thành', type: 'done' });
              } else {
                inProgressCount++;
                if (t.days_late > 0) {
                  overdueCount++;
                  overdueList.push({
                    id: t.id, project: t.projectName, name: t.name, deadline: t.end_date_est || 'Chưa có'
                  });
                  acts.push({ action: `Trễ hạn: ${t.name}`, time: 'Cần chú ý', type: 'overdue' });
                } else if (t.end_date_est) {
                  const diffTime = new Date(t.end_date_est).getTime() - today.getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                  if (diffDays >= 0 && diffDays <= 3) {
                    upcoming.push({
                      id: t.id, project: t.projectName, name: t.name, deadline: t.end_date_est, daysLeft: diffDays
                    });
                  }
                }
              }
            });

            setMyRealTasks(myTasks);
            setRealUpcomingDeadlines(upcoming);
            setRealOverdueTasks(overdueList);
            setRecentActivities(acts.slice(0, 5));

            setRealTaskStats({
              total: myTasks.length,
              done: doneCount,
              inProgress: inProgressCount,
              overdue: overdueCount,
              manday: Math.round(mandayTotal * 10) / 10
            });

            const kpiPoints = matched?.kpi_total || (doneCount * 6);

            // Calculate Dynamic Chart Progress from real tasks
            setWeeklyProgress([
              { name: 'Tuần 1', kpi: Math.round(kpiPoints * 0.25), tasks: Math.ceil(doneCount * 0.25) },
              { name: 'Tuần 2', kpi: Math.round(kpiPoints * 0.5), tasks: Math.ceil(doneCount * 0.5) },
              { name: 'Tuần 3', kpi: Math.round(kpiPoints * 0.75), tasks: Math.ceil(doneCount * 0.75) },
              { name: 'Tuần 4', kpi: Math.round(kpiPoints), tasks: myTasks.length },
            ]);

            setMonthlyProgress([
              { name: 'Tháng này', kpi: Math.round(kpiPoints), tasks: myTasks.length }
            ]);
          });
        });
      })
      .catch(err => console.error("Không thể đồng bộ thông tin tài khoản thật:", err))
      .finally(() => setLoadingReal(false));
  }, []);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  const reportKpiCards = [
    { label: 'Tasks Được Giao', value: realTaskStats.total, icon: '📋', border: 'border-l-[#0058be]', text: 'text-[#0058be]', trend: kpiTimeFilter === 'week' ? 'Trong tuần' : 'Trong tháng' },
    { label: 'Đã Hoàn Thành', value: realTaskStats.done, icon: '✅', border: 'border-l-emerald-500', text: 'text-emerald-600', trend: realTaskStats.total > 0 ? `${Math.round((realTaskStats.done / realTaskStats.total) * 100)}%` : '0%' },
    { label: 'Đang Làm', value: realTaskStats.inProgress, icon: '⚡', border: 'border-l-amber-500', text: 'text-amber-600', trend: 'Đang triển khai' },
    { label: 'Trễ Hạn', value: realTaskStats.overdue, icon: '🔴', border: 'border-l-red-500', text: 'text-red-600', trend: 'Cần xử lý' },
    { label: 'Manday Làm Việc', value: realTaskStats.manday, icon: '⏱️', border: 'border-l-cyan-500', text: 'text-cyan-600', trend: 'Số ngày tích lũy' },
    { label: 'Điểm KPI', value: realMemberData?.kpi_total || 0, icon: '🏆', border: 'border-l-purple-500', text: 'text-purple-600', trend: 'Thành tích cá nhân' }
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Báo cáo hiệu suất cá nhân (Report)</h3>
          {loadingReal && <span className="text-[10px] text-blue-600 font-semibold animate-pulse">Đang cập nhật...</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchReportData}
            disabled={loadingReal}
            className="flex items-center gap-1 px-3 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm text-[11px] font-bold transition-all disabled:opacity-50"
          >
            <span>↻</span> Làm mới dữ liệu
          </button>
          <div className="flex gap-1.5 bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm text-[11px] font-bold">
            <button
              onClick={() => setKpiTimeFilter('month')}
              className={`px-3 py-1 rounded-md transition-all ${kpiTimeFilter === 'month' ? 'bg-[#0058be] text-white' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Lọc theo Tháng
            </button>
            <button
              onClick={() => setKpiTimeFilter('week')}
              className={`px-3 py-1 rounded-md transition-all ${kpiTimeFilter === 'week' ? 'bg-[#0058be] text-white' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Lọc theo Tuần
            </button>
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
          <div className="absolute top-4 right-4 z-10">
            <select
              value={chartFilter}
              onChange={(e) => setChartFilter(e.target.value as 'week' | 'month')}
              className="text-xs font-bold text-[#0b1c30] bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#0058be] shadow-sm cursor-pointer"
            >
              <option value="week">Tiến độ theo Tuần</option>
              <option value="month">Tiến độ theo Tháng</option>
            </select>
          </div>
          <BarChartCard
            title={chartFilter === 'week' ? "Tiến độ KPI theo tuần" : "Tiến độ KPI theo tháng"}
            data={chartFilter === 'week' ? weeklyProgress : monthlyProgress}
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
          <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">📋 Task Của Tôi</h3>
          <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full border border-indigo-100">{myRealTasks.length} task</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-slate-400 border-b border-slate-100 uppercase text-[10px] tracking-wider">
                <th className="px-5 py-3 text-left font-bold">Tên Task</th>
                <th className="px-4 py-3 text-left font-bold">Dự Án</th>
                <th className="px-4 py-3 text-center font-bold">Ưu Tiên</th>
                <th className="px-4 py-3 text-center font-bold">Trạng Thái</th>
                <th className="px-4 py-3 text-center font-bold">Deadline</th>
                <th className="px-4 py-3 text-center font-bold">KPI</th>
              </tr>
            </thead>
            <tbody>
              {myRealTasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-slate-400 font-semibold">Chưa có task nào được giao cho bạn.</td>
                </tr>
              ) : (
                myRealTasks.map((t, i) => (
                  <tr key={t.id} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                    <td className="px-5 py-3 font-semibold text-[#0b1c30]">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityDot[t.priority] || 'bg-slate-400'}`} />
                        {t.name}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-semibold">{t.projectName}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
                        t.priority === 'Critical' ? 'bg-red-100 text-red-700' :
                        t.priority === 'High'     ? 'bg-orange-100 text-orange-700' :
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
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">⏰ Deadline Gần (≤ 3 ngày)</h3>
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
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">🕐 Hoạt Động Gần Đây</h3>
            <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{recentActivities.length}</span>
          </div>
          <div className="p-4 space-y-2.5">
            {recentActivities.length === 0 ? (
              <p className="text-xs text-slate-400 font-semibold text-center py-6">Chưa có hoạt động gần đây.</p>
            ) : (
              recentActivities.map((a, idx) => (
                <div key={idx} className="flex gap-3 items-start p-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                  <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${activityColor[a.type] || 'bg-slate-100 text-slate-500'}`}>{activityIcon[a.type] || '✓'}</span>
                  <div><p className="text-[11px] font-semibold text-[#0b1c30]">{a.action}</p><p className="text-[10px] text-slate-400 mt-0.5">{a.time}</p></div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-red-100 bg-red-50/50">
            <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider">🚨 Task Trễ Hạn</h3>
            <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{realOverdueTasks.length}</span>
          </div>
          <div className="p-4 space-y-3">
            {realOverdueTasks.length === 0 ? (
              <p className="text-xs text-slate-400 font-semibold text-center py-6">Tuyệt vời! Không có task nào trễ hạn.</p>
            ) : (
              realOverdueTasks.map(t => (
                <div key={t.id} className="p-4 bg-red-50 rounded-xl border border-red-100 hover:border-red-200 transition-colors">
                  <span className="text-[9px] font-extrabold text-red-700 bg-red-100 px-2 py-0.5 rounded-full uppercase">{t.project}</span>
                  <p className="text-xs font-bold text-[#0b1c30] mt-1.5 leading-snug">{t.name}</p>
                  <div className="flex items-center justify-between mt-3 text-[11px]">
                    <span className="font-extrabold text-red-600 bg-white border border-red-200 px-2 py-0.5 rounded-md">Trễ Hạn</span>
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
