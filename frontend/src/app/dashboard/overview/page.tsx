'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getEmail, getName, getToken, getRole } from '@/lib/auth';
import { getMyAlerts, remindLeaderBulk, getInboxNotifications, markNotificationRead, getWorkspaces } from '@/lib/api';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';
import KpiCard from '@/components/dashboard/KpiCard';
import ProgressBar from '@/components/dashboard/ProgressBar';
import SvgIcon from '@/components/dashboard/Icons';
import BarChartCard from '@/components/dashboard/BarChartCard';
import { projectStatusBadge, projectBarColor, MONTH_WEEKS_COUNT, getWeekOfMonth, getMondayToSundayRange, getWeekDateRange, checkTaskInPeriod, CYCLE_TEMPLATE, calculateDaysLate } from '@/app/dashboard/constants';

const getShortName = (name: string) => {
  if (!name) return 'Unknown';
  const parts = name.trim().split(' ');
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

const getKpiMultiplier = (kpi: number) => {
  if (kpi < 90) return 0;
  if (kpi < 95) return 0.9;
  if (kpi < 100) return 0.95;
  if (kpi < 105) return 1.0;
  if (kpi < 110) return 1.05;
  if (kpi < 115) return 1.10;
  if (kpi < 120) return 1.15;
  if (kpi < 125) return 1.20;
  if (kpi < 130) return 1.25;
  if (kpi < 135) return 1.30;
  if (kpi < 140) return 1.35;
  if (kpi < 145) return 1.40;
  if (kpi < 150) return 1.45;
  return 1.50;
};

const CircularProgress = ({ value, total }: { value: number, total: number }) => {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;
  return (
    <div className="relative flex items-center justify-center w-8 h-8 shrink-0">
      <svg className="w-8 h-8 transform -rotate-90">
        <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2.5" fill="transparent" className="text-slate-200" />
        <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2.5" fill="transparent" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} className="text-[#0058be] transition-all duration-500" />
      </svg>
      <span className="absolute text-[8px] font-extrabold text-[#0058be]">{percent}%</span>
    </div>
  );
};

const ProjectDistributionDonut = ({ activeCount, whiteCount }: { activeCount: number, whiteCount: number }) => {
  const total = activeCount + whiteCount;
  const activePercent = total > 0 ? Math.round((activeCount / total) * 100) : 0;
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (activePercent / 100) * circumference;

  return (
    <div className="flex items-center gap-3 bg-slate-50 border border-slate-200/80 px-3.5 py-1.5 rounded-xl shadow-xs">
      <div className="relative flex items-center justify-center w-9 h-9 shrink-0">
        <svg className="w-9 h-9 transform -rotate-90">
          <circle cx="18" cy="18" r="14" stroke="currentColor" strokeWidth="3.5" fill="transparent" className="text-slate-200" />
          <circle cx="18" cy="18" r="14" stroke="currentColor" strokeWidth="3.5" fill="transparent" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} className="text-[#0058be] transition-all duration-500" />
        </svg>
        <span className="absolute text-[8px] font-black text-[#0058be]">{activePercent}%</span>
      </div>
      <div className="text-[10px] space-y-0.5">
        <div className="flex items-center gap-1.5 font-extrabold text-[#0b1c30]">
          <span className="w-2 h-2 rounded-full bg-[#0058be] inline-block shrink-0"></span>
          <span>Đang hoạt động: <strong className="text-[#0058be]">{activeCount}</strong></span>
        </div>
        <div className="flex items-center gap-1.5 font-bold text-slate-500">
          <span className="w-2 h-2 rounded-full bg-slate-300 inline-block shrink-0"></span>
          <span>Dự án trắng: <strong className="text-slate-600">{whiteCount}</strong></span>
        </div>
      </div>
    </div>
  );
};

const getTaskKpiForMember = (t: any, memberId: any) => {
  const isDone = t.status === 'Done' || t.status === 'done';
  if (!isDone) return 0;
  // Strictly match Backend /api/members KPI requirement: task MUST have an actual end date
  if (!t.end_date_actual) return 0;

  const isAssigned = t.assigned_id != null && String(t.assigned_id) === String(memberId);
  const isSupport = t.support_id != null && String(t.support_id) === String(memberId);

  if (isAssigned && isSupport) {
    if (typeof t.kpi_assigned === 'number' && typeof t.kpi_support === 'number') {
      return t.kpi_assigned + t.kpi_support;
    }
    return t.kpi_final != null ? t.kpi_final : (t.kpi_base || 0);
  }
  if (isAssigned) {
    if (typeof t.kpi_assigned === 'number') return t.kpi_assigned;
    const kpiVal = t.kpi_final != null ? t.kpi_final : (t.kpi_base || 0);
    const ratio = t.kpi_ratio_assign != null ? t.kpi_ratio_assign : (t.support_id != null ? 90 : 100);
    return kpiVal * (ratio / 100);
  }
  if (isSupport) {
    if (typeof t.kpi_support === 'number') return t.kpi_support;
    const kpiVal = t.kpi_final != null ? t.kpi_final : (t.kpi_base || 0);
    const ratio = t.kpi_ratio_support != null ? t.kpi_ratio_support : 10;
    return kpiVal * (ratio / 100);
  }
  return 0;
};

// Same role-split as getTaskKpiForMember, but ignores the "Done" gate — the
// KPI a task is WORTH for a member regardless of completion, i.e. their
// "Giao" (target) side of the KPI HT/Giao ratio in the ranking table.
const getTaskKpiPotentialForMember = (t: any, memberId: any) => {
  const isAssigned = t.assigned_id != null && String(t.assigned_id) === String(memberId);
  const isSupport = t.support_id != null && String(t.support_id) === String(memberId);

  if (isAssigned && isSupport) {
    if (typeof t.kpi_assigned === 'number' && typeof t.kpi_support === 'number') {
      return t.kpi_assigned + t.kpi_support;
    }
    return t.kpi_final != null ? t.kpi_final : (t.kpi_base || 0);
  }
  if (isAssigned) {
    if (typeof t.kpi_assigned === 'number') return t.kpi_assigned;
    const kpiVal = t.kpi_final != null ? t.kpi_final : (t.kpi_base || 0);
    const ratio = t.kpi_ratio_assign != null ? t.kpi_ratio_assign : (t.support_id != null ? 90 : 100);
    return kpiVal * (ratio / 100);
  }
  if (isSupport) {
    if (typeof t.kpi_support === 'number') return t.kpi_support;
    const kpiVal = t.kpi_final != null ? t.kpi_final : (t.kpi_base || 0);
    const ratio = t.kpi_ratio_support != null ? t.kpi_ratio_support : 10;
    return kpiVal * (ratio / 100);
  }
  return 0;
};

const MemberDetailModal = ({ member, tasks, projects, onClose, onNavigate }: { member: any, tasks: any[], projects: any[], onClose: () => void, onNavigate: (projectId: string | number) => void }) => {
  const [taskFilter, setTaskFilter] = useState<'all' | 'overdue' | 'critical' | 'high'>('all');

  if (!member) return null;

  const rawMemberObj = member.rawMember || member;
  const memberTasks = tasks.filter(t => (t.assigned_id != null && String(t.assigned_id) === String(member.id)) || (t.support_id != null && String(t.support_id) === String(member.id)));
  const openTasks = memberTasks.filter(t => t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel');
  const doneTasks = memberTasks.filter(t => t.status === 'Done' || t.status === 'done');
  const overdueTasks = openTasks.filter(t => calculateDaysLate(t) > 0);
  const openCriticalTasks = openTasks.filter(t => (t.priority || '').toLowerCase() === 'critical');
  const criticalTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'critical');
  const highTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'high');
  const normalTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'normal');
  const interruptTasks = memberTasks.filter(t => (t.priority || '').toLowerCase() === 'interrupt');

  const activeProjects = projects.filter(p => memberTasks.some(t => String(t.project_id) === String(p.id)));

  const today = new Date();
  const dateStr = `Tuần ${today.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} - ${new Date(today.getTime() + 6 * 86400000).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

  const totalPossible = openTasks.length + doneTasks.length;
  const workload = totalPossible > 0 ? Math.min(100, Math.round((openTasks.length / Math.max(5, totalPossible)) * 100)) : 67;

  const filteredTasks = memberTasks.filter(t => {
    if (taskFilter === 'overdue') return (t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel') && calculateDaysLate(t) > 0;
    if (taskFilter === 'critical') return (t.priority || '').toLowerCase() === 'critical';
    if (taskFilter === 'high') return (t.priority || '').toLowerCase() === 'high';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* BACKDROP */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
      />

      {/* RIGHT SIDE DRAWER PANEL (FLUSH TOP TO BOTTOM) */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white h-full shadow-2xl overflow-y-auto custom-scrollbar flex flex-col border-l border-slate-200">

        {/* HEADER */}
        <div className="sticky top-0 z-20 bg-white px-6 py-4 border-b border-slate-100 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#0058be] text-white flex items-center justify-center font-black text-lg shadow-sm shrink-0">
              {member.name ? member.name.charAt(0).toUpperCase() : 'M'}
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-[#0b1c30] tracking-tight">{member.name}</h2>
              <p className="text-xs font-semibold text-slate-400 mt-0.5">
                {(rawMemberObj.team || rawMemberObj.department || 'INFRA').toUpperCase()} · {rawMemberObj.leader_name || 'Khác'} · {dateStr}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors flex items-center justify-center font-bold text-sm cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>

        {/* DRAWER BODY CONTENT */}
        <div className="p-6 space-y-6 flex-1">

          {/* 1. TOP METRIC SUMMARY (6 CARDS IN A ROW) */}
          <div className="grid grid-cols-6 gap-2">
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0b1c30] leading-none">{activeProjects.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Dự án active</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0b1c30] leading-none">{openTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Task mở</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0b1c30] leading-none">{criticalTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Critical</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-red-600 leading-none">{overdueTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Trễ</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0b1c30] leading-none">{memberTasks.length}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">Deadline kỳ</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center flex flex-col justify-center">
              <span className="text-lg font-black text-[#0058be] leading-none">{member.kpi?.toFixed(1) || '0.0'}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">KPI</span>
            </div>
          </div>

          {/* 2. CẢNH BÁO ĐIỀU PHỐI (3 BOXES) */}
          <div>
            <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-3">Cảnh báo điều phối</h3>
            <div className="grid grid-cols-3 gap-3">
              {/* Task trễ */}
              <div className="bg-red-50/40 border border-red-100 rounded-2xl p-4 flex flex-col justify-between min-h-[100px]">
                <div>
                  <span className="text-[9px] font-extrabold text-red-400 uppercase tracking-wider">Task trễ</span>
                  <p className="text-2xl font-black text-red-600 mt-1">{overdueTasks.length}</p>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight mt-3">Task cần leader follow-up hoặc xử lý blocker.</p>
              </div>

              {/* Critical mở */}
              <div className="bg-amber-50/40 border border-amber-100 rounded-2xl p-4 flex flex-col justify-between min-h-[100px]">
                <div>
                  <span className="text-[9px] font-extrabold text-amber-500 uppercase tracking-wider">Critical mở</span>
                  <p className="text-2xl font-black text-amber-700 mt-1">{openCriticalTasks.length}</p>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight mt-3">Task ưu tiên cao, ảnh hưởng trực tiếp tiến độ dự án.</p>
              </div>

              {/* Tải công việc */}
              <div className="bg-blue-50/40 border border-blue-100 rounded-2xl p-4 flex flex-col justify-between min-h-[100px]">
                <div>
                  <span className="text-[9px] font-extrabold text-blue-500 uppercase tracking-wider">Tải công việc</span>
                  <p className="text-2xl font-black text-[#0058be] mt-1">{workload}%</p>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight mt-3">Tải trung bình — có thể nhận thêm task nếu ưu tiên rõ.</p>
              </div>
            </div>
          </div>

          {/* 3. PHÂN BỐ PRIORITY (4 PILLS) */}
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

          {/* 4. DỰ ÁN ĐANG THAM GIA */}
          <div>
            <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-3">Dự án đang tham gia</h3>
            <div className="space-y-3">
              {activeProjects.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center text-xs font-semibold text-slate-400">
                  Chưa có dự án nào đang tham gia.
                </div>
              ) : (
                activeProjects.map(p => {
                  const pTasks = memberTasks.filter(t => String(t.project_id) === String(p.id));
                  const pOpen = pTasks.filter(t => t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel').length;
                  const pCritical = pTasks.filter(t => (t.priority || '').toLowerCase() === 'critical').length;
                  const nextTask = pTasks.find(t => t.end_date_est || t.created_at);
                  const deadlineStr = nextTask ? (nextTask.end_date_est || '11/08').split('-').reverse().slice(0, 2).join('/') : '11/08';
                  const pManday = pTasks.reduce((acc, t) => acc + (t.manday_actual || t.manday_est || 0), 0);
                  const pKpi = pTasks.reduce((acc, t) => acc + (t.status === 'Done' || t.status === 'done' ? getTaskKpiForMember(t, member.id) : 0), 0);

                  return (
                    <div
                      key={p.id}
                      onClick={() => { onClose(); onNavigate(p.id); }}
                      className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-3 cursor-pointer hover:border-[#0058be] hover:shadow-md transition-all active:scale-[0.99]"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-extrabold text-[#0b1c30] hover:text-[#0058be] transition-colors">{p.name}</h4>
                        <span className="px-2.5 py-0.5 bg-blue-50 text-[#0058be] rounded-full text-[10px] font-bold border border-blue-100">
                          {pOpen} task mở
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-[#0b1c30] block">{pOpen}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">TASK MỜ</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-[#0b1c30] block">{pCritical}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">CRITICAL</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-[#0b1c30] block">{deadlineStr}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">DEADLINE</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-amber-600 block">{pManday.toFixed(1)}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">MANDAY</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-xs font-black text-[#0058be] block">{pKpi.toFixed(1)}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block mt-0.5">KPI</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-[#0058be] font-bold text-right">Xem dự án ➔</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 5. TASK TRONG KỲ ĐANG XEM */}
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
              <div>
                <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider">Task trong kỳ đang xem</h3>
                <p className="text-[10px] text-slate-400 font-medium">Sắp xếp: Deadline gần nhất → Critical → High → Normal → Interrupt</p>
              </div>
              <div className="flex gap-1">
                {(['all', 'overdue', 'critical', 'high'] as const).map(filter => (
                  <button
                    key={filter}
                    onClick={() => setTaskFilter(filter)}
                    className={`px-3 py-1 rounded-full text-[10px] font-extrabold transition-all cursor-pointer ${taskFilter === filter
                        ? 'bg-[#0058be] text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                  >
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
                    <th className="px-4 py-2.5 text-center bg-slate-50 text-slate-500 sticky top-0 z-20 border-b border-slate-200">TRẠNG THÁI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-xs text-slate-400 font-semibold">
                        Không có task nào.
                      </td>
                    </tr>
                  ) : (
                    filteredTasks.map((t: any) => {
                      const prio = (t.priority || 'normal').toUpperCase();
                      const isDone = t.status === 'Done' || t.status === 'done';
                      const dlStr = t.end_date_est ? t.end_date_est.split('-').reverse().slice(0, 2).join('/') : '11/08';

                      return (
                        <tr key={t.id} onClick={() => { const proj = projects.find((p: any) => String(p.id) === String(t.project_id)); if (proj) { onClose(); onNavigate(proj.id); } }} className="hover:bg-slate-50/80 transition-colors cursor-pointer">
                          <td className="px-4 py-3">
                            <p className="font-bold text-[#0b1c30] text-xs">{t.name}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Task đang được triển khai trong kỳ.</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600 font-medium text-xs">
                            {t.projectName || t.project_name || 'Dự án Timetech'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase ${prio === 'CRITICAL' ? 'bg-purple-100 text-purple-700' :
                                prio === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                  prio === 'INTERRUPT' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                              {prio}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-slate-700 text-xs">
                            {dlStr}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isDone ? 'bg-emerald-50 text-emerald-600' : 'bg-emerald-50 text-emerald-600'
                              }`}>
                              {isDone ? 'Đã xong' : 'Đang làm'}
                            </span>
                          </td>
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

const PriorityDetailModal = ({
  initialFilter = 'overdue',
  tasks,
  onClose,
  onNavigate,
}: {
  initialFilter?: 'overdue' | 'critical' | 'high' | 'normal' | 'interrupt';
  tasks: any[];
  onClose: () => void;
  onNavigate?: (projectId: string | number) => void;
}) => {
  const filterList = useMemo(() => {
    if (initialFilter === 'overdue') {
      return tasks.filter(t => {
        const isDone = t.status === 'Done' || t.status === 'done';
        const isCancel = t.status === 'Cancel' || t.status === 'cancel';
        return !isDone && !isCancel && calculateDaysLate(t) > 0;
      });
    }
    return tasks.filter(t => (t.priority || '').toLowerCase() === initialFilter);
  }, [tasks, initialFilter]);

  const configMap: Record<string, {
    label: string;
    description: string;
    tone: string;
    softBg: string;
    borderColor: string;
    badgeBg: string;
  }> = {
    overdue: {
      label: 'Task trễ hạn',
      description: 'Danh sách công việc đã quá thời hạn',
      tone: '#df2b30',
      softBg: '#fff3f3',
      borderColor: '#ffb8ba',
      badgeBg: '#df2b30',
    },
    critical: {
      label: 'Critical task',
      description: 'Danh sách công việc có mức ưu tiên Critical',
      tone: '#df2b30',
      softBg: '#fff3f3',
      borderColor: '#ffb8ba',
      badgeBg: '#df2b30',
    },
    high: {
      label: 'High task',
      description: 'Danh sách công việc có mức ưu tiên High',
      tone: '#e9540c',
      softBg: '#fff7ed',
      borderColor: '#fdc98f',
      badgeBg: '#e9540c',
    },
    normal: {
      label: 'Normal task',
      description: 'Danh sách công việc có mức ưu tiên Normal',
      tone: '#2864e8',
      softBg: '#eff6ff',
      borderColor: '#acd0ff',
      badgeBg: '#2864e8',
    },
    interrupt: {
      label: 'Interrupt task',
      description: 'Công việc phát sinh cần xử lý ngay',
      tone: '#8a2be2',
      softBg: '#faf5ff',
      borderColor: '#dfc2ff',
      badgeBg: '#8a2be2',
    },
  };

  const currentConfig = configMap[initialFilter] || configMap.overdue;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* BACKDROP */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
      />

      {/* DRAWER PANEL SLIDE OUT FROM RIGHT */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200">
        {/* MODAL HEADER */}
        <div className="sticky top-0 z-30 bg-white px-6 py-4 border-b border-slate-100 flex items-center justify-between shadow-sm">
          <div>
            <h2 className="text-lg font-black text-[#0b1c30] uppercase tracking-wider">{currentConfig.label}</h2>
            <p className="text-xs font-semibold text-slate-400 mt-0.5">{currentConfig.description}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors flex items-center justify-center font-bold text-sm cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>

        {/* COLORED HEADER BANNER (PINNED STICKY AT TOP) */}
        <div
          className="sticky top-[65px] z-20 p-5 border-b flex items-center justify-between transition-colors shadow-sm shrink-0"
          style={{
            backgroundColor: currentConfig.softBg,
            borderColor: currentConfig.borderColor,
            color: currentConfig.tone,
          }}
        >
          <div>
            <h3 className="text-base font-black tracking-tight uppercase" style={{ color: currentConfig.tone }}>
              {currentConfig.label}
            </h3>
            <p className="text-xs font-semibold text-slate-600 mt-0.5">
              Tổng số công việc: <strong className="font-extrabold">{filterList.length} task</strong>
            </p>
          </div>
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-lg text-white shadow-sm shrink-0"
            style={{ backgroundColor: currentConfig.badgeBg }}
          >
            {filterList.length}
          </div>
        </div>

        {/* TASK LIST CONTAINER */}
        <div className="flex-1 p-5 overflow-y-auto space-y-3.5 custom-scrollbar bg-[#f4f6f9]">
          {filterList.length === 0 ? (
            <div className="py-16 text-center text-slate-400 font-semibold text-sm">
              Không có task nào trong danh mục này.
            </div>
          ) : (
            filterList.map((t: any, idx: number) => {
              const daysLate = calculateDaysLate(t);
              const isDone = t.status === 'Done' || t.status === 'done';
              const isCancel = t.status === 'Cancel' || t.status === 'cancel';
              const pName = t.projectName || t.project_name || 'Chưa rõ';
              const cName = t.customerName || t.customer_name || 'Chưa rõ';
              const assignee = t.assigned_name || t.assignee || 'Chưa giao';
              const taskTitle = t.name || t.detail_task || t.detail || 'Nhiệm vụ không tên';

              let statusText = isDone ? 'Đã xong' : isCancel ? 'Đã hủy' : daysLate > 0 ? `Trễ ${daysLate} ngày` : 'Đang làm';
              let statusCls = isDone
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : isCancel
                ? 'bg-slate-100 text-slate-500 border-slate-200'
                : daysLate > 0
                ? 'bg-red-50 text-red-600 border-red-200 font-bold'
                : 'bg-blue-50 text-blue-700 border-blue-200';

              return (
                <div
                  key={t.id || idx}
                  onClick={() => {
                    if (t.project_id && onNavigate) {
                      onClose();
                      onNavigate(t.project_id);
                    }
                  }}
                  className={`bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-all space-y-2.5 ${
                    t.project_id && onNavigate ? 'cursor-pointer hover:border-[#0058be]' : ''
                  }`}
                >
                  {/* TAGS */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-extrabold bg-blue-50 text-blue-700 border border-blue-100 truncate max-w-[180px]" title={pName}>
                      Dự án: {pName}
                    </span>
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200 truncate max-w-[180px]" title={cName}>
                      KH: {cName}
                    </span>
                    <span
                      className="px-2.5 py-0.5 rounded text-[10px] font-black uppercase border"
                      style={{
                        backgroundColor: currentConfig.softBg,
                        color: currentConfig.tone,
                        borderColor: currentConfig.borderColor,
                      }}
                    >
                      {t.priority || initialFilter.toUpperCase()}
                    </span>
                  </div>

                  {/* TITLE */}
                  <h4 className="text-sm font-bold text-[#0b1c30] leading-relaxed break-words" title={taskTitle}>
                    {taskTitle}
                  </h4>

                  {/* FOOTER */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                    <span className="text-slate-500 font-medium">
                      Phụ trách: <strong className="text-slate-800 font-bold">{assignee}</strong>
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-extrabold border ${statusCls}`}>
                      {statusText}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default function OverviewTab() {
  // Recent Activity (cross-project) filter
  const [auditModuleFilter, setAuditModuleFilter] = useState('all');

  // Workspace/Leader Filter
  const [selectedLeader, setSelectedLeader] = useState<string>('all');
  const [projectFilterMode, setProjectFilterMode] = useState<'all' | 'owned' | 'external'>('all');
  const [externalProjectsCollapsed, setExternalProjectsCollapsed] = useState(false);
  const [contributionModalProject, setContributionModalProject] = useState<any>(null);
  const [selectedWorkspaceCode, setSelectedWorkspaceCode] = useState<string>('');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('all');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const code = localStorage.getItem('active_workspace_code') || '';
      setSelectedWorkspaceCode(code);
      const handleWsChanged = (e: any) => {
        setSelectedWorkspaceCode(e.detail || localStorage.getItem('active_workspace_code') || '');
      };
      window.addEventListener('workspace-changed', handleWsChanged);
      return () => window.removeEventListener('workspace-changed', handleWsChanged);
    }
  }, []);

  // Unified Date Filter
  // Default to "This Week" on initial mount (Requirement 1). Existing
  // Overview filtering logic (checkTaskInPeriod) already understands the
  // `activeQuickFilter='Tuần này'` shortcut and computes Monday→Sunday from
  // `new Date()`, so we simply seed the same shape that `applyQuickFilter`
  // produces — no new filtering mechanism is introduced.
  const initialNow = new Date();
  const [selectedYear, setSelectedYear] = useState<number | 'all'>(initialNow.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>(initialNow.getMonth() + 1);
  const [selectedWeek, setSelectedWeek] = useState<number | 'all'>(getWeekOfMonth(initialNow));

  // Quick Filter Highlight state
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>('Tuần này');

  // Alerts for current member
  const [myAlerts, setMyAlerts] = useState<{ overdue_count: number; pending_approval_count: number; total: number } | null>(null);
  const [sendingBulkRemind, setSendingBulkRemind] = useState(false);
  const [bulkRemindMsg, setBulkRemindMsg] = useState<string | null>(null);

  // Inbox (Hộp thư) for Leader/Admin
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxItems, setInboxItems] = useState<any[]>([]);
  const [inboxUnread, setInboxUnread] = useState(0);
  const inboxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Matrix Filter
  const [matrixYear, setMatrixYear] = useState<number>(new Date().getFullYear());

  // Filter & Modal States
  const [selectedMemberModal, setSelectedMemberModal] = useState<any>(null);
  const [selectedPriorityModal, setSelectedPriorityModal] = useState<'overdue' | 'critical' | 'high' | 'normal' | 'interrupt' | null>(null);
  const [aiCheckStatus, setAiCheckStatus] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

    // Fetch my-alerts in parallel — not part of the cached bundle below.
    getMyAlerts().then(data => setMyAlerts(data)).catch(() => { });

    let memberApiUrl = `/api/members?_t=${ts}&scope=true`;
    if (selectedWorkspaceCode) memberApiUrl += `&workspace=${encodeURIComponent(selectedWorkspaceCode)}`;
    if (selectedMonth !== 'all' && typeof selectedMonth === 'number') memberApiUrl += `&month=${selectedMonth}`;
    if (selectedYear !== 'all' && typeof selectedYear === 'number') memberApiUrl += `&year=${selectedYear}`;

    let projApiUrl = `/api/projects?_t=${ts}`;
    if (selectedWorkspaceCode) projApiUrl += `&workspace=${encodeURIComponent(selectedWorkspaceCode)}`;

    let tasksApiUrl = `/api/all-tasks-global?_t=${ts}`;
    if (selectedWorkspaceCode) tasksApiUrl += `&workspace=${encodeURIComponent(selectedWorkspaceCode)}`;

    let wsLeadersUrl = `/api/members/workspace-leaders?_t=${ts}`;
    if (selectedWorkspaceCode) wsLeadersUrl += `&workspace=${encodeURIComponent(selectedWorkspaceCode)}`;

    const [membersRes, projRes, tasksRes, activityRes, leadersRes, leadersScopeRes, meRes, workspaceRolesRes] = await Promise.all([
      axios.get(memberApiUrl, config).catch(() => ({ data: [] })),
      axios.get(projApiUrl, config).catch(() => ({ data: [] })),
      axios.get(tasksApiUrl, config).catch(() => ({ data: [] })),
      axios.get(`/api/projects/recent-activity?limit=20&_t=${ts}`, config).catch(() => ({ data: { items: [] } })),
      axios.get(`/api/members/meta/leaders?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(wsLeadersUrl, config).catch(() => ({ data: { leaders: null } })),
      axios.get(`/api/users/me?_t=${ts}`, config).catch(() => ({ data: null })),
      // Chính/Phụ Workspace membership per member — keyed by member_id, used
      // to badge the Team card pills below when a member holds >1 Workspace.
      axios.get(`/api/members/workspace-roles?_t=${ts}`, config).catch(() => ({ data: {} })),
    ]);

    return {
      rawMembers: membersRes.data || [],
      rawProjects: projRes.data || [],
      rawTasks: tasksRes.data || [],
      recentActivity: activityRes.data?.items || [],
      rawLeaders: leadersRes.data || [],
      // Backend-authoritative Leader identities the current user may see.
      allowedLeaders: Array.isArray(leadersScopeRes.data?.leaders) ? leadersScopeRes.data.leaders : null,
      currentUser: meRes.data || null,
      workspaceRoles: workspaceRolesRes.data || {},
    };
  }, [selectedMonth, selectedYear, selectedWorkspaceCode]);

  // React Query: shows the last-cached bundle instantly on revisit (no
  // loading flash), then silently refetches in the background — replaces
  // the old module-level `cachedOverviewData` variable, which only lived
  // until a full page reload and never refreshed itself automatically.
  const { data: overviewData, isFetching: loading, refetch } = useQuery({
    queryKey: ['dashboard-overview', selectedMonth, selectedYear, selectedWorkspaceCode],
    queryFn: fetchOverview,
    staleTime: 2 * 60_000,
  });

  const rawMembersAll: any[] = overviewData?.rawMembers || [];
  const rawProjectsAll: any[] = overviewData?.rawProjects || [];
  const rawTasksAll: any[] = overviewData?.rawTasks || [];
  // Chính/Phụ Workspace membership, keyed by member_id — { code, name,
  // is_primary }[]. Every Leader/Member has at least one entry (their home
  // Workspace) — a Phụ one only adds a second entry on top of that.
  const workspaceRolesByMember: Record<number, { code: string; name: string; is_primary: boolean }[]> =
    overviewData?.workspaceRoles || {};

  // Always shows the person's Workspace (mandatory — every Leader/Member card
  // must carry a "which Workspace" sign, not just multi-Workspace ones; a
  // single-Workspace person still needs to visibly show that one Workspace,
  // otherwise a card like "LeaderInfra" would show no tag at all). Relative
  // to whichever Workspace is currently being viewed (effectiveWsCode below);
  // when no specific Workspace is selected (viewing "Tất cả"), falls back to
  // showing the person's own home Workspace instead.
  function workspaceBadgeFor(memberId: any, wsCode: string | null): { label: string; sub: string | null; primary: boolean } | null {
    const entries = workspaceRolesByMember[Number(memberId)];
    if (!entries || entries.length < 1) return null;
    if (wsCode) {
      const match = entries.find((e) => e.code === wsCode);
      if (!match) return null;
      // A Leader viewing their own team always has wsCode forced to their own
      // Chính code (no switcher) — still show "+N phụ" on a Member who holds
      // extra Workspaces beyond this matched one, same as the aggregate
      // branch below does for Admin's "Toàn bộ Leader" view. Returned as a
      // separate `sub` line (rendered below the Chính badge) rather than
      // appended inline — keeps the Chính badge short and puts "+N phụ" on
      // its own row instead of cramming both onto one line.
      const otherCount = entries.length - 1;
      return match.is_primary
        ? { label: `🏠 ${match.name}`, sub: otherCount > 0 ? `+${otherCount} phụ` : null, primary: true }
        : { label: `${match.name} · Phụ`, sub: null, primary: false };
    }
    const home = entries.find((e) => e.is_primary);
    if (!home) return null;
    const secondaryCount = entries.length - 1;
    return { label: `🏠 ${home.name}`, sub: secondaryCount > 0 ? `+${secondaryCount} phụ` : null, primary: true };
  }

  // Company selection is shared app-wide via WorkspaceFilterProvider (see
  // Navbar's Workspace switcher). Filtering here — right where the raw
  // arrays enter the page — means every downstream computation (the large
  // stats memo below, charts, cards...) narrows to the selected Workspace
  // automatically, since they keep consuming `rawMembers`/`rawProjects`/
  // `rawTasks` by these same names without any further changes.
  const { workspaceCode } = useWorkspaceFilter();
  const { data: workspacesData } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => getWorkspaces(),
    staleTime: 5 * 60_000,
  });
  // For Leader accounts the Navbar displays a fixed workspace label but never
  // calls setWorkspaceCode, leaving the shared context null.  Fall back to
  // the authoritative data_scope from the user profile so the downstream
  // member / project / task client-side filters apply the correct scope.
  const earlyUserRole = overviewData?.currentUser?.role || getRole() || '';
  const earlyUserScope = overviewData?.currentUser?.data_scope;
  const effectiveWsCode = workspaceCode
    || (earlyUserRole === 'leader' && earlyUserScope && earlyUserScope !== 'all'
      ? earlyUserScope
      : null);
  const selectedWorkspace = effectiveWsCode
    ? (workspacesData || []).find((w: any) => w.code === effectiveWsCode) || null
    : null;

  // A project/member with an "all"-scope account belongs to every Workspace —
  // same fallback already applied to the Members/Customers/Projects backend
  // filters, so it can't silently disappear when narrowing to one Workspace.
  const rawProjects: any[] = selectedWorkspace
    ? rawProjectsAll.filter((p: any) =>
        p.data_scope === selectedWorkspace.code ||
        p.business === selectedWorkspace.name ||
        p.data_scope === 'all' ||
        p.business === 'All'
      )
    : rawProjectsAll;
  const scopedProjectIds = selectedWorkspace ? new Set(rawProjects.map((p: any) => p.id)) : null;
  const rawTasks: any[] = scopedProjectIds
    ? rawTasksAll.filter((t: any) => scopedProjectIds.has(t.project_id))
    : rawTasksAll;
  const rawMembers: any[] = selectedWorkspace
    ? rawMembersAll.filter((m: any) => m.workspace === selectedWorkspace.name || m.workspace === 'All')
    : rawMembersAll;
  const rawLeaders: any[] = overviewData?.rawLeaders || [];
  const allowedLeaders: string[] | null = overviewData?.allowedLeaders ?? null;
  const recentActivity: any[] = overviewData?.recentActivity || [];
  const currentUser: any = overviewData?.currentUser || null;
  const currentUserRole = currentUser?.role || getRole() || '';
  const showsMemberCards = String(currentUserRole).toLowerCase() === 'leader';
  const showsLeaderCards = !showsMemberCards;

  const applyQuickFilter = (type: string) => {
    setActiveQuickFilter(type);
    const now = new Date();
    if (type === 'Tuần trước') {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setSelectedYear(d.getFullYear()); setSelectedMonth(d.getMonth() + 1); setSelectedWeek(getWeekOfMonth(d));
    } else if (type === 'Tuần này') {
      setSelectedYear(now.getFullYear()); setSelectedMonth(now.getMonth() + 1); setSelectedWeek(getWeekOfMonth(now));
    } else if (type === 'Tuần tới') {
      const d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      setSelectedYear(d.getFullYear()); setSelectedMonth(d.getMonth() + 1); setSelectedWeek(getWeekOfMonth(d));
    } else if (type === 'Tháng trước') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      setSelectedYear(d.getFullYear()); setSelectedMonth(d.getMonth() + 1); setSelectedWeek('all');
    } else if (type === 'Tháng này') {
      setSelectedYear(now.getFullYear()); setSelectedMonth(now.getMonth() + 1); setSelectedWeek('all');
    } else if (type === 'Tháng tới') {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      setSelectedYear(d.getFullYear()); setSelectedMonth(d.getMonth() + 1); setSelectedWeek('all');
    }
  };


  const fetchInbox = useCallback(() => {
    const role = getRole();
    if (role === 'super_admin' || role === 'leader') {
      getInboxNotifications().then(data => {
        setInboxItems(data.items || []);
        setInboxUnread(data.unread_count || 0);
      }).catch(() => { });
    }
  }, []);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  // Close inbox popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inboxRef.current && !inboxRef.current.contains(e.target as Node)) {
        setInboxOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const {
    leaders,
    totalAllTasks,
    totalAllDoneTasks,
    activeTeamMembers,
    filteredTasks,
    pmStats,
    crossWsManday,
    crossWsMemberCount,
    priorityStats,
    overdueTasksList,
    memberRanking,
    memberCards,
    teamCardStats,
    activeProjects,
    topPerformer,
    lowestPerformer,
    summaryMatrix,
    averageMatrix,
    bonusMatrix,
    drilledMemberId
  } = useMemo(() => {
    const isSameId = (a: any, b: any) => a != null && b != null && String(a) === String(b);
    const isIdInList = (idList: any[], targetId: any) => targetId != null && idList.some(id => String(id) === String(targetId));
    const memberTaskFilter = (memberIds: any[]) => (t: any) =>
      isIdInList(memberIds, t.assigned_id) || isIdInList(memberIds, t.support_id);

    // 1. Get Leaders — canonical for Super Admin (Uses User.member_id → Member.id + Member.leader_member_id)
    // Legacy grouping kept as fallback when canonical list is unavailable.
    let lList: any[] = [];
    let visibleLeaders: any[] = [];
    if (showsLeaderCards) {
      const hasCanonical = Array.isArray(rawLeaders) && rawLeaders.length > 0 && rawLeaders[0] && typeof rawLeaders[0] === 'object' && 'member_id' in rawLeaders[0];
      if (hasCanonical) {
        const memberById = new Map(rawMembers.map((m: any) => [String(m.id), m]));
        const canonicalMap = new Map<string, any>();
        rawLeaders.forEach((lg: any) => {
          const name = (lg.name || '').trim();
          if (!name) return;
          const mid = lg.member_id != null ? String(lg.member_id) : null;
          const mRec = mid ? memberById.get(mid) : null;
          const team = (mRec?.team || mRec?.department || lg.team || 'Khác');
          const teamMemberIds: any[] = [];
          rawMembers.forEach((m: any) => {
            const lmId = m.leader_member_id != null ? String(m.leader_member_id) : null;
            if (mid && lmId && lmId === mid) {
              teamMemberIds.push(m.id);
            } else if (mid && String(m.id) === mid) {
              teamMemberIds.push(m.id);
            } else if (!mid || lmId == null) {
              const lNameLower = (m.leader_name || '').trim().toLowerCase();
              const lEmailLower = (m.leader_email || '').trim().toLowerCase();
              const lgNameLower = name.toLowerCase();
              const lgEmailLower = (lg.email || '').trim().toLowerCase();
              if (lNameLower && lNameLower === lgNameLower) teamMemberIds.push(m.id);
              else if (lEmailLower && lgEmailLower && lEmailLower === lgEmailLower) teamMemberIds.push(m.id);
            }
          });
          if (mid && !teamMemberIds.some((id: any) => String(id) === mid) && memberById.has(mid)) {
            teamMemberIds.push(Number(mid));
          }
          const uniqIds = Array.from(new Set(teamMemberIds.map((id: any) => String(id)))).map((s: string) => (isNaN(Number(s)) ? s : Number(s)));
          canonicalMap.set(name, { name, member_id: mid ? Number(mid) : null, user_id: lg.user_id, email: lg.email || '', team, memberIds: uniqIds, count: uniqIds.length });
        });
        const unassigned = rawMembers.filter((m: any) => {
          const hasLeaderId = m.leader_member_id != null;
          const hasLeaderName = (m.leader_name || '').trim();
          if (hasLeaderId) return false;
          const low = hasLeaderName.toLowerCase();
          const matched = rawLeaders.some((lg: any) => (lg.name || '').trim().toLowerCase() === low || (lg.email || '').trim().toLowerCase() === (m.leader_email || '').trim().toLowerCase());
          return !matched;
        });
        if (unassigned.length > 0) {
          canonicalMap.set('Không có Leader', { name: 'Không có Leader', member_id: null, team: 'Khác', memberIds: unassigned.map((m: any) => m.id), count: unassigned.length });
        }
        lList = Array.from(canonicalMap.values()).map(ld => {
          const lTasks = rawTasks.filter(t => isIdInList(ld.memberIds, t.assigned_id) || isIdInList(ld.memberIds, t.support_id));
          const done = lTasks.filter(t => t.status === 'Done' || t.status === 'done').length;
          return { ...ld, totalTasks: lTasks.length, doneTasks: done };
        }).sort((a, b) => b.count - a.count);
      } else {
        const leaderMap = new Map();
        rawMembers.forEach(m => {
          const lName = (m.leader_name || '').trim() || 'Không có Leader';
          if (!leaderMap.has(lName)) {
            leaderMap.set(lName, { name: lName, count: 0, team: m.team || m.department || 'Khác', memberIds: [] });
          }
          const ld = leaderMap.get(lName);
          ld.count++;
          ld.memberIds.push(m.id);
        });
        lList = Array.from(leaderMap.values()).map(ld => {
          const lTasks = rawTasks.filter(t => isIdInList(ld.memberIds, t.assigned_id) || isIdInList(ld.memberIds, t.support_id));
          const done = lTasks.filter(t => t.status === 'Done' || t.status === 'done').length;
          return { ...ld, totalTasks: lTasks.length, doneTasks: done };
        }).sort((a, b) => b.count - a.count);
      }
      visibleLeaders = lList;
      if (Array.isArray(allowedLeaders) && allowedLeaders.length > 0) {
        const allowed = new Set(allowedLeaders.map((n: string) => String(n).trim().toLowerCase()));
        visibleLeaders = lList.filter(ld =>
          ld.name && ld.name !== 'Không có Leader' && allowed.has(String(ld.name).trim().toLowerCase())
        );
      } else {
        visibleLeaders = lList.filter(ld => ld.name && ld.name !== 'Không có Leader');
      }
      if (selectedWorkspaceCode || workspaceCode) {
        visibleLeaders = visibleLeaders.filter(ld => ld.count > 0);
      }
    } else {
      lList = [];
      visibleLeaders = [];
    }

    const totTasks = rawTasks.length;
    const totDone = rawTasks.filter(t => t.status === 'Done' || t.status === 'done').length;

    // Leader Card: show only members whose leader_name matches the
    // logged-in Leader's display_name (from Member Management).  Workspace
    // filtering is already enforced by the backend (member_query_for_user).
    const leaderDisplayName = showsMemberCards
      ? (currentUser?.member?.display_name || currentUser?.full_name || '')
      : '';
    const memberCardSource = showsMemberCards
      ? rawMembers.filter((m: any) =>
          leaderDisplayName && m.leader_name
            ? String(m.leader_name).trim().toLowerCase() === leaderDisplayName.trim().toLowerCase()
            : false
        )
      : [];
    const memberCardsList = memberCardSource.map(m => {
      const mTasks = rawTasks.filter(memberTaskFilter([m.id]));
      const done = mTasks.filter(t => t.status === 'Done' || t.status === 'done').length;
      return {
        id: m.id,
        name: m.display_name || m.full_name || 'Member',
        team: m.team || m.department || 'General',
        totalTasks: mTasks.length,
        doneTasks: done,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const memberCardIds = memberCardSource.map(m => m.id);
    const teamCardTasks = rawTasks.filter(memberTaskFilter(memberCardIds));
    const teamStats = {
      memberCount: memberCardSource.length,
      totalTasks: teamCardTasks.length,
      doneTasks: teamCardTasks.filter(t => t.status === 'Done' || t.status === 'done').length,
    };

    // 2. Filter Members by selected Leader, except Leader accounts use member cards.
    // Canonical: prefer leader_member_id, fallback to leader_name/email for legacy records.
    // Tracks whichever single person is currently drilled into (Leader or
    // Member card), so the render can offer the Chính/Phụ toggle only when
    // that specific person actually holds more than one Workspace.
    let drilledMemberId: any = null;
    let activeTeamList = rawMembers;
    if (showsLeaderCards && selectedLeader && selectedLeader !== 'all') {
      const selTrim = selectedLeader.trim().toLowerCase();
      const selLeader = visibleLeaders.find((ld: any) => String(ld.name).trim().toLowerCase() === selTrim);
      const selMid = selLeader?.member_id != null ? String(selLeader.member_id) : null;
      drilledMemberId = selMid;
      if (selMid) {
        activeTeamList = rawMembers.filter(m => {
          const lmId = m.leader_member_id != null ? String(m.leader_member_id) : null;
          if (lmId) return lmId === selMid;
          const leaderName = ((m.leader_name || '').trim() || 'Không có Leader').toLowerCase();
          const lEmail = (m.leader_email || '').trim().toLowerCase();
          const selEmail = (selLeader?.email || '').trim().toLowerCase();
          if (leaderName === selTrim) return true;
          if (selEmail && lEmail === selEmail) return true;
          if (String(m.id) === selMid) return true;
          return false;
        });
        const leaderSelf = rawMembers.find((m: any) => String(m.id) === selMid);
        if (leaderSelf && !activeTeamList.some((m: any) => String(m.id) === selMid)) activeTeamList = [...activeTeamList, leaderSelf];
      } else {
        activeTeamList = rawMembers.filter(m => {
          const leaderName = ((m.leader_name || '').trim() || 'Không có Leader').toLowerCase();
          const mName = (m.display_name || m.full_name || m.name || '').trim().toLowerCase();
          return leaderName === selTrim || mName === selTrim;
        });
      }
    } else if (showsMemberCards) {
      activeTeamList = memberCardSource;
      if (selectedMemberId !== 'all') {
        activeTeamList = activeTeamList.filter(m => isSameId(m.id, selectedMemberId));
        drilledMemberId = selectedMemberId;
      }
    }
    const teamMemberIds = activeTeamList.map(m => m.id);

    // 3. Filter Tasks by Team & Date
    // `rawTasks` is narrowed to a single Workspace by the page-wide scope
    // (effectiveWsCode). For Super Admin that's an explicit, deliberate
    // choice via the Navbar switcher — keep respecting it. But a Leader has
    // no switcher at all: effectiveWsCode is silently forced to their own
    // Chính Workspace, which would make "Toàn bộ Team" quietly drop a
    // teammate's Phụ-Workspace tasks with no way to know it happened. A
    // Leader always sees their team's full picture across every Workspace —
    // no toggle needed; per-item Chính/Phụ Workspace badges (elsewhere on
    // this page) are how each item's Workspace is communicated instead.
    const taskSourceForDrill = currentUserRole === 'leader' ? rawTasksAll : rawTasks;
    let fTasks = taskSourceForDrill.filter(t => teamMemberIds.length === 0 || isIdInList(teamMemberIds, t.assigned_id) || isIdInList(teamMemberIds, t.support_id));
    fTasks = fTasks.filter(t => checkTaskInPeriod(t, selectedYear, selectedMonth, selectedWeek, activeQuickFilter));

    // 4. Calculate Stats (PM)
    let pmDone = 0, pmInProg = 0, pmOverdue = 0, pmTotal = fTasks.length, pmManday = 0, pmKpi = 0;
    let pmMandayPlanned = 0, pmKpiPlanned = 0;
    const pStats = { critical: 0, high: 0, normal: 0, interrupt: 0 };
    const overdueList: any[] = [];

    fTasks.forEach(t => {
      pmManday += (t.manday_actual || t.manday_est || 0);
      pmMandayPlanned += (t.manday_est || 0);
      pmKpiPlanned += (t.kpi_base || 0); // "Giao" side of the KPI ratio — counted regardless of completion
      const isDone = t.status === 'Done' || t.status === 'done';
      if (isDone) pmKpi += (t.kpi_base || 0); // Only count KPI for completed tasks
      const isCancel = t.status === 'Cancel' || t.status === 'cancel';
      const daysLateNum = calculateDaysLate(t);
      const isOverdue = daysLateNum > 0;

      if (isDone) pmDone++;
      else {
        pmInProg++;
        if (isOverdue) {
          pmOverdue++;
          overdueList.push({
            id: t.id,
            name: t.name,
            assignee: t.assigned_name || 'Unassigned',
            daysLate: daysLateNum,
            deadline: t.end_date_est || 'N/A',
            customerName: t.customerName || t.customer_name || 'Không có',
            projectName: t.projectName || t.project_name || 'Không có',
            projectDataScope: t.projectDataScope || null,
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
    const initialRanking = activeTeamList.map(m => {
      const myTasks = fTasks.filter(t => isSameId(t.assigned_id, m.id) || isSameId(t.support_id, m.id));
      let d = 0, i = 0, o = 0, md = 0, k = 0, mdPlanned = 0, kpiPlanned = 0;
      // Per-Workspace Manday allocation — powers the split-allocation bar in
      // the ranking table (e.g. "Dev 6.0 · Infra 2.0"), so a Chính/Phụ
      // Manday breakdown is visible per member without a separate toggle.
      const mandayByWs: Record<string, number> = {};
      myTasks.forEach(t => {
        const taskManday = (t.manday_actual || t.manday_est || 0);
        md += taskManday;
        mdPlanned += (t.manday_est || 0);
        kpiPlanned += getTaskKpiPotentialForMember(t, m.id);
        const wsCode = (t.projectDataScope || '').toLowerCase();
        if (wsCode) mandayByWs[wsCode] = (mandayByWs[wsCode] || 0) + taskManday;
        const done = (t.status === 'Done' || t.status === 'done') && Boolean(t.end_date_actual);
        if (done) { d++; k += getTaskKpiForMember(t, m.id); }
        else {
          i++;
          if (calculateDaysLate(t) > 0) o++;
        }
      });
      const kpiVal = typeof m.kpi_total === 'number' && m.kpi_total > 0 ? m.kpi_total : k;
      const mandayVal = typeof m.manday_total === 'number' && m.manday_total > 0 ? m.manday_total : md;
      return {
        id: m.id,
        name: m.display_name || m.full_name,
        team: m.team || m.department || 'General',
        position: m.position || 'Member',
        assigned: myTasks.length,
        done: d,
        inProgress: i,
        overdue: o,
        manday: Math.round(mandayVal * 10) / 10,
        mandayPlanned: Math.round(mdPlanned * 10) / 10,
        kpi: Math.round(kpiVal * 10) / 10,
        kpiPlanned: Math.round(kpiPlanned * 10) / 10,
        mandayByWs,
        rawMember: m
      };
    });
    const finalRanking = initialRanking.sort((a, b) => b.kpi - a.kpi).map((m, idx) => ({ ...m, rank: idx + 1 }));
    const topPerf = finalRanking.length > 0 && finalRanking[0].kpi > 0 ? finalRanking[0] : null;
    const lowestPerf = finalRanking.length > 1 ? finalRanking[finalRanking.length - 1] : null;

    // Cross-workspace Manday — how much of the team's total Manday was
    // logged on projects OUTSIDE the current "home" Workspace (Leader's
    // Chính, or the Workspace the switcher/drill is currently on), powering
    // the "Cross-workspace" summary card above the ranking table AND the
    // Phụ trách/Tham gia ngoài project-tab split below.
    //
    // For Admin drilled into a specific Leader, "home" must be THAT Leader's
    // own Chính Workspace — not the Admin's own switcher selection — so the
    // owned/external split reflects the drilled Leader's team, not whatever
    // Workspace the Admin happens to have the page-wide switcher on.
    const drilledLeaderHomeWs = (() => {
      if (currentUserRole === 'leader' || !showsLeaderCards || selectedLeader === 'all') return null;
      const ld = visibleLeaders.find((l: any) => l.name === selectedLeader);
      const mid = ld?.member_id;
      if (mid == null) return null;
      const entries = workspaceRolesByMember[Number(mid)] || [];
      const primary = entries.find((e: any) => e.is_primary);
      return (primary?.code || '').toLowerCase() || null;
    })();
    const homeWsCodeForSummary = (currentUserRole === 'leader'
      ? (currentUser?.data_scope || '')
      : (drilledLeaderHomeWs || effectiveWsCode || '')).toLowerCase();
    let crossWsManday = 0;
    let crossWsMemberCount = 0;
    finalRanking.forEach(m => {
      const wsEntries = Object.entries(m.mandayByWs || {}).filter(([code, v]) => (v as number) > 0 && code !== homeWsCodeForSummary);
      if (wsEntries.length > 0) {
        crossWsMemberCount++;
        crossWsManday += wsEntries.reduce((s, [, v]) => s + (v as number), 0);
      }
    });

    // 6. Active Projects (Filtered by BOTH Leader and Time Period)
    // Same reasoning as taskSourceForDrill above: a Leader has no Workspace
    // switcher, so `rawProjects` is silently narrowed to their Chính
    // Workspace by effectiveWsCode — which would make every Phụ-Workspace
    // project (their "Tham gia ngoài" contributions) invisible to the
    // Dashboard's own project section. Use the unscoped list for Leader.
    const projectSourceForDrill = currentUserRole === 'leader' ? rawProjectsAll : rawProjects;
    const allMappedProjects = projectSourceForDrill.map((p: any) => {
      const pAllTasks = taskSourceForDrill.filter(t => isSameId(t.project_id, p.id));
      const pLeaderTasks = pAllTasks.filter(t => teamMemberIds.length === 0 || isIdInList(teamMemberIds, t.assigned_id) || isIdInList(teamMemberIds, t.support_id));

      // Drilled in either as Admin picking one Leader, or as a Leader picking
      // one Member of their own team — either way, narrow the project list
      // the same way the KPI cards/ranking table already do.
      const isDrilledIn = selectedLeader !== 'all' || selectedMemberId !== 'all';

      const pmName = (p.pm_name || p.pm || p.leader_name || p.manager || p.project_manager || p.owner || '').toLowerCase();
      const isLeaderPM = !isDrilledIn || activeTeamList.some(m => {
        const mName = (m.display_name || m.full_name || m.name || '').trim().toLowerCase();
        return pmName.includes(mName);
      });

      const pTasksToUse = (isDrilledIn && teamMemberIds.length > 0) ? pLeaderTasks : pAllTasks;
      const done = pTasksToUse.filter(t => t.status === 'Done' || t.status === 'done').length;
      const open = pTasksToUse.length - done;
      const late = pTasksToUse.filter(t => calculateDaysLate(t) > 0).length;
      let pManday = 0, pMandayPlanned = 0, pKpi = 0, pKpiPlanned = 0;
      pTasksToUse.forEach(t => {
        pManday += (t.manday_actual || t.manday_est || 0);
        pMandayPlanned += (t.manday_est || 0);
        pKpiPlanned += (t.kpi_base || 0);
        if (t.status === 'Done' || t.status === 'done') {
          pKpi += getTaskKpiForMember(t, t.assigned_id);
          if (t.support_id != null && String(t.support_id) !== String(t.assigned_id)) {
            pKpi += getTaskKpiForMember(t, t.support_id);
          }
        }
      });

      // Check if any task in this project falls within the selected time period
      const hasTaskInPeriod = (selectedYear === 'all' && selectedMonth === 'all' && selectedWeek === 'all' && (activeQuickFilter === 'all' || !activeQuickFilter))
        ? true
        : pTasksToUse.some(t => checkTaskInPeriod(t, selectedYear, selectedMonth, selectedWeek, activeQuickFilter));

      // Leader/Member scope filter: project must belong to the drilled-in
      // Leader's team, or the drilled-in Member specifically, or be a project
      // they themselves PM.
      const belongsToLeaderScope = !isDrilledIn || pLeaderTasks.length > 0 || isLeaderPM;

      const dataScope = (p.data_scope || p.business || '').toLowerCase() || null;

      // Who on the current team actually shows up on this project — powers
      // the "Member ... liên quan" line in the Limited-access contribution
      // modal (a Phụ/external project only ever exposes THIS, never the
      // project's full internal member/backlog list).
      const contributingNames = Array.from(new Set(
        pLeaderTasks.flatMap((t: any) => [t.assigned_name, t.support_name]).filter(Boolean)
      ));

      return {
        id: p.id, name: p.name, status: p.status || 'Developing', current_phase: p.current_phase || '1. Tư vấn',
        progress: pTasksToUse.length ? Math.round((done / pTasksToUse.length) * 100) : 0,
        totalTasks: pTasksToUse.length, doneTasks: done, openTasks: open, lateTasks: late,
        manday: Math.round(pManday * 10) / 10, mandayPlanned: Math.round(pMandayPlanned * 10) / 10,
        kpi: Math.round(pKpi * 10) / 10, kpiPlanned: Math.round(pKpiPlanned * 10) / 10,
        hasPM: Boolean(pmName), hasTasks: pTasksToUse.length > 0,
        business: p.business || null,
        dataScope,
        contributingNames,
        // "Owned" = the project sits in the current home Workspace (Leader's
        // Chính, or whichever Workspace is currently selected/drilled) — same
        // Full-vs-Limited-Access distinction the backend already enforces via
        // project_query_for_user(); an empty homeWsCode (Admin viewing "Tất
        // cả") treats every project as owned since there's no single home ws.
        isOwned: !homeWsCodeForSummary || !dataScope || dataScope === homeWsCodeForSummary,
        isDisplayable: belongsToLeaderScope && hasTaskInPeriod
      };
    });

    const aProjects = allMappedProjects.filter(p => p.isDisplayable).sort((a, b) => b.progress - a.progress);

    // 7. KPI Matrices
    let sumM: any[] = [];
    let avgM: any[] = [];
    let bonM: any[] = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let i = 1; i <= 12; i++) {
      const rowSum: any = { month: `${monthNames[i - 1]} - ${matrixYear}` };
      const rowAvg: any = { month: `${monthNames[i - 1]} - ${matrixYear}` };
      const rowBon: any = { month: `${monthNames[i - 1]} - ${matrixYear}` };

      activeTeamList.forEach(m => {
        const mTasks = rawTasks.filter(t => (isSameId(t.assigned_id, m.id) || isSameId(t.support_id, m.id)) && (t.status === 'Done' || t.status === 'done') && Boolean(t.end_date_actual));
        let mkpi = 0;
        const cycle = CYCLE_TEMPLATE[i];
        mTasks.forEach(t => {
          const tdStr = t.end_date_actual;
          if (tdStr && cycle) {
            const td = new Date(tdStr);
            if (!isNaN(td.getTime())) {
              const startDt = new Date(`${matrixYear + cycle.startYo}-${cycle.startMd}T00:00:00`);
              const endDt = new Date(`${matrixYear + cycle.endYo}-${cycle.endMd}T23:59:59`);
              if (td >= startDt && td <= endDt) {
                mkpi += getTaskKpiForMember(t, m.id);
              }
            }
          }
        });
        const weeksInMonth = MONTH_WEEKS_COUNT[i] || 4;
        let avgKpi = mkpi > 0 ? (mkpi / weeksInMonth) : 0;
        rowSum[`m_${m.id}`] = Number(mkpi.toFixed(1));
        rowAvg[`m_${m.id}`] = Number(avgKpi.toFixed(1));
        rowBon[`m_${m.id}`] = Number(getKpiMultiplier(avgKpi).toFixed(1));
      });
      sumM.push(rowSum);
      avgM.push(rowAvg);
      bonM.push(rowBon);
    }

    return {
      leaders: visibleLeaders,
      totalAllTasks: totTasks,
      totalAllDoneTasks: totDone,
      activeTeamMembers: activeTeamList,
      filteredTasks: fTasks,
      pmStats: { total: pmTotal, done: pmDone, inProgress: pmInProg, overdue: pmOverdue, manday: Math.round(pmManday * 10) / 10, kpi: Math.round(pmKpi), mandayPlanned: Math.round(pmMandayPlanned * 10) / 10, kpiPlanned: Math.round(pmKpiPlanned * 10) / 10 },
      crossWsManday: Math.round(crossWsManday * 10) / 10,
      crossWsMemberCount,
      priorityStats: pStats,
      overdueTasksList: overdueList.sort((a, b) => b.daysLate - a.daysLate),
      memberRanking: finalRanking,
      memberCards: memberCardsList,
      teamCardStats: teamStats,
      activeProjects: aProjects,
      topPerformer: topPerf,
      lowestPerformer: lowestPerf,
      summaryMatrix: sumM,
      averageMatrix: avgM,
      bonusMatrix: bonM,
      drilledMemberId,
    };
  }, [rawMembers, rawTasks, rawProjects, rawTasksAll, rawProjectsAll, rawLeaders, allowedLeaders, selectedLeader, selectedMemberId, selectedYear, selectedMonth, selectedWeek, matrixYear, showsLeaderCards, showsMemberCards, workspaceCode]);

  // Projects touched by the selected Leader's team (any task assigned/supported
  // by their members, regardless of the date filter — Recent Activity always
  // shows the latest events, not just the ones in the currently selected period).
  const teamProjectIds = useMemo(() => {
    if (showsLeaderCards && selectedLeader === 'all') return null;
    const memberIds = new Set(activeTeamMembers.map((m: any) => String(m.id)));
    const ids = new Set<string>();
    rawTasks.forEach((t: any) => {
      if ((memberIds.has(String(t.assigned_id)) || memberIds.has(String(t.support_id))) && t.project_id != null) {
        ids.add(String(t.project_id));
      }
    });
    return ids;
  }, [showsLeaderCards, selectedLeader, activeTeamMembers, rawTasks]);

  const filteredActivity = recentActivity.filter(log => {
    if (auditModuleFilter !== 'all' && log.module?.toLowerCase() !== auditModuleFilter.toLowerCase()) return false;
    if (teamProjectIds && !teamProjectIds.has(String(log.project_id))) return false;
    // recentActivity comes from a separate, unscoped endpoint — narrow it to
    // the selected Workspace's projects too (teamProjectIds alone doesn't
    // cover the default "Toàn bộ Leader" view, where it's null).
    if (scopedProjectIds && !scopedProjectIds.has(log.project_id)) return false;
    return true;
  });

  const handleAiCheck = () => {
    setAiCheckStatus('Đang thực hiện AI Check dự án...');
    setTimeout(() => {
      setAiCheckStatus(`✅ AI Check hoàn tất: Tất cả ${activeProjects.length} dự án hoạt động ổn định, tiến độ trung bình ${activeProjects.length > 0 ? Math.round(activeProjects.reduce((acc, p) => acc + p.progress, 0) / activeProjects.length) : 0}%.`);
      setTimeout(() => setAiCheckStatus(null), 5000);
    }, 1000);
  };

  return (
    <div className="p-6 space-y-6">
      {/* 1. HEADER & DATE FILTER & SHORTCUT FILTERS */}
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-[#0b1c30]">Dashboard Tổng Quan</h2>
            <p className="text-xs text-slate-500 mt-1">Theo dõi tiến độ, hiệu suất và phân bổ KPI của Team</p>
            {(() => {
              const myWs: { code: string; name: string; is_primary: boolean }[] = overviewData?.currentUser?.workspaces || [];
              const role = overviewData?.currentUser?.role;
              if (role === 'super_admin' || myWs.length < 1) return null;
              const primary = myWs.find((w) => w.is_primary) || myWs[0];
              const secondaries = myWs.filter((w) => w !== primary);
              if (!primary) return null;
              return (
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-indigo-600 text-white">
                    🏠 Chính: {primary.name}
                  </span>
                  {secondaries.map((w) => (
                    <span key={w.code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-300">
                      {w.name} · Phụ
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* TIME FILTER & REFRESH */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500 hidden sm:block">Bộ lọc thời gian:</span>
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
                    {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
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
                    {[...Array(selectedMonth !== 'all' ? (MONTH_WEEKS_COUNT[selectedMonth] || 5) : 5)].map((_, i) => (
                      <option key={i + 1} value={i + 1}>{i + 1}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* SHORTCUT FILTER BUTTONS */}
            <div className="flex items-center gap-1 overflow-x-auto">
              {['Tuần trước', 'Tuần này', 'Tuần tới', 'Tháng trước', 'Tháng này', 'Tháng tới'].map(label => (
                <button
                  key={label}
                  onClick={() => applyQuickFilter(label)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap shadow-sm active:scale-95 ${activeQuickFilter === label
                      ? 'bg-[#0058be] text-white border border-[#0058be] shadow-md font-black'
                      : 'bg-white border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 text-slate-600'
                    }`}
                >
                  {label}
                </button>
              ))}
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

        {/* 2. LEADER / MEMBER SELECTOR BAR WITH PERCENTAGE CIRCLE */}
        {showsLeaderCards ? (
          <div className="flex flex-nowrap gap-2 overflow-x-auto pb-2 custom-scrollbar">
            <button
              onClick={() => setSelectedLeader('all')}
              className={`shrink-0 min-w-[170px] px-4 py-2 rounded-xl border transition-all flex items-center justify-between gap-3 ${selectedLeader === 'all' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <div>
                <div className="text-xs font-bold">Toàn bộ Leader</div>
                <div className="text-[10px] font-normal opacity-80">{leaders.length} team · {rawMembers.length} member</div>
              </div>
              <CircularProgress value={totalAllDoneTasks} total={totalAllTasks} />
            </button>
            {leaders.map(ld => {
              const badge = workspaceBadgeFor(ld.member_id, effectiveWsCode);
              return (
              <button
                key={ld.name}
                onClick={() => setSelectedLeader(ld.name)}
                className={`shrink-0 min-w-[170px] px-4 py-2 rounded-xl border transition-all flex items-center justify-between gap-3 ${selectedLeader === ld.name ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <div className="truncate">
                  <div className="text-xs font-bold truncate flex items-center gap-1">
                    {ld.name}
                    {badge && (
                      <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold normal-case ${badge.primary ? 'bg-indigo-600 text-white' : 'bg-amber-50 text-amber-700 border border-amber-300'}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                  {badge?.sub && (
                    <div className="mt-0.5">
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold normal-case bg-amber-50 text-amber-700 border border-amber-300">
                        {badge.sub}
                      </span>
                    </div>
                  )}
                  <div className="text-[10px] font-normal opacity-80 truncate">{ld.team} · {ld.count} member</div>
                </div>
                <CircularProgress value={ld.doneTasks} total={ld.totalTasks} />
              </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-nowrap gap-2 overflow-x-auto pb-2 custom-scrollbar">
            <button
              onClick={() => setSelectedMemberId('all')}
              className={`shrink-0 min-w-[170px] px-4 py-2 rounded-xl border transition-all flex items-center justify-between gap-3 ${selectedMemberId === 'all' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <div>
                <div className="text-xs font-bold">Toàn bộ Team</div>
                <div className="text-[10px] font-normal opacity-80">{teamCardStats.memberCount} member</div>
              </div>
              <CircularProgress value={teamCardStats.doneTasks} total={teamCardStats.totalTasks} />
            </button>
            {memberCards.map(m => {
              const badge = workspaceBadgeFor(m.id, effectiveWsCode);
              return (
              <button
                key={m.id}
                onClick={() => setSelectedMemberId(String(m.id))}
                className={`shrink-0 min-w-[170px] px-4 py-2 rounded-xl border transition-all flex items-center justify-between gap-3 ${selectedMemberId === String(m.id) ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <div className="truncate">
                  <div className="text-xs font-bold truncate flex items-center gap-1">
                    {m.name}
                    {badge && (
                      <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold normal-case ${badge.primary ? 'bg-indigo-600 text-white' : 'bg-amber-50 text-amber-700 border border-amber-300'}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                  {badge?.sub && (
                    <div className="mt-0.5">
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold normal-case bg-amber-50 text-amber-700 border border-amber-300">
                        {badge.sub}
                      </span>
                    </div>
                  )}
                  <div className="text-[10px] font-normal opacity-80 truncate">{m.team} · {m.totalTasks} task</div>
                </div>
                <CircularProgress value={m.doneTasks} total={m.totalTasks} />
              </button>
              );
            })}
          </div>
        )}
      </div>



      {/* INBOX (HỘP THƯ) — chỉ hiển thị với Super Admin và Team Leader */}
      {(() => {
        const role = getRole();
        if (!['super_admin', 'leader'].includes(role || '')) return null;
        return (
          <div ref={inboxRef} className="relative flex justify-end -mt-2 mb-2">
            <button
              onClick={() => { setInboxOpen(v => !v); if (!inboxOpen) fetchInbox(); }}
              className="relative flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl shadow-sm hover:bg-slate-50 text-slate-700 text-[12px] font-bold transition-all cursor-pointer"
              title="Hộp thư thông báo"
            >
              <span className="text-base">📨</span>
              <span>Hộp thư</span>
              {inboxUnread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                  {inboxUnread > 9 ? '9+' : inboxUnread}
                </span>
              )}
            </button>

            {inboxOpen && (
              <div className="absolute top-10 right-0 z-50 w-[380px] max-h-[440px] overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white z-10">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📨</span>
                    <h4 className="text-[13px] font-extrabold text-[#0b1c30]">Hộp thư thông báo</h4>
                    {inboxUnread > 0 && (
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded-full">{inboxUnread} chưa đọc</span>
                    )}
                  </div>
                  <button onClick={() => setInboxOpen(false)} className="text-slate-400 hover:text-slate-600 text-base cursor-pointer">✕</button>
                </div>

                {/* Items */}
                {inboxItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                    <span className="text-4xl mb-2">📭</span>
                    <p className="text-[12px]">Chưa có thông báo nào</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {inboxItems.map((n: any) => (
                      <div
                        key={n.id}
                        onClick={async () => {
                          if (!n.is_read) {
                            await markNotificationRead(n.id).catch(() => { });
                            setInboxItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
                            setInboxUnread(prev => Math.max(0, prev - 1));
                          }
                          setInboxOpen(false);
                          if (n.project_id) {
                            const url = `/project/detail/tasks?id=${n.project_id}${n.task_group_id ? `&groupId=${n.task_group_id}` : ''}`;
                            router.push(url);
                          }
                        }}
                        className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${n.is_read ? 'opacity-60' : 'bg-indigo-50/40'}`}
                      >
                        <span className="text-xl mt-0.5 shrink-0">{n.notification_type === 'group_approval_request' ? '🔔' : '⚠️'}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] leading-snug ${n.is_read ? 'text-slate-500' : 'text-[#0b1c30] font-semibold'}`}>
                            {n.message}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {n.project_name && (
                              <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold">{n.project_name}</span>
                            )}
                            {n.group_name && (
                              <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-bold">{n.group_name}</span>
                            )}
                            <span className="text-[10px] text-slate-400 ml-auto shrink-0">
                              {n.created_at ? new Date(n.created_at).toLocaleDateString('vi-VN') : ''}
                            </span>
                          </div>
                        </div>
                        {!n.is_read && <div className="w-2 h-2 bg-indigo-500 rounded-full mt-1.5 shrink-0" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* KPI CARDS */}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Tasks Phụ Trách" value={pmStats.total} icon="tasks" border="border-l-[#0058be]" text="text-[#0058be]" trend="Tổng" />
        <KpiCard label="Đã Hoàn Thành" value={pmStats.done} icon="check" border="border-l-emerald-500" text="text-emerald-600" trend={pmStats.total ? `${Math.round(pmStats.done / pmStats.total * 100)}%` : '0%'} />
        <KpiCard label="Đang Làm" value={Math.max(0, pmStats.inProgress - pmStats.overdue)} icon="lightning" border="border-l-amber-500" text="text-amber-600" trend="Trong tiến độ" />
        <KpiCard label="Trễ Hạn" value={pmStats.overdue} icon="alert" border="border-l-red-500" text="text-red-600" trend="Cần xử lý" />
        <KpiCard label="Manday Thực Tế" value={pmStats.manday} icon="clock" border="border-l-cyan-500" text="text-cyan-600" trend="Đã tiêu hao" />
        <KpiCard label="KPI Đạt Được" value={pmStats.kpi} icon="trophy" border="border-l-purple-500" text="text-purple-600" trend="Tổng điểm" />
      </div>

      {/* ALERT BLOCK — hiển thị khi có task cần chú ý */}
      {myAlerts && myAlerts.total > 0 && (
        <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-sm ${myAlerts.overdue_count > 0
            ? 'bg-red-50 border-red-200'
            : 'bg-amber-50 border-amber-200'
          }`}>
          <div className="flex items-start gap-2.5">
            <span className="text-lg mt-0.5">⚠️</span>
            <div>
              <p className={`text-[12.5px] font-bold ${myAlerts.overdue_count > 0 ? 'text-red-700' : 'text-amber-700'
                }`}>
                {myAlerts.overdue_count > 0 && (
                  <>Bạn đang có <strong>{myAlerts.overdue_count}</strong> task trễ hạn cần xử lý{myAlerts.pending_approval_count > 0 ? ' và' : '.'}</>
                )}
                {myAlerts.pending_approval_count > 0 && (
                  <> <strong>{myAlerts.pending_approval_count}</strong> task đã hoàn thành chờ xác nhận từ Leader.</>
                )}
              </p>
              {bulkRemindMsg && (
                <p className="text-[11px] text-emerald-600 font-semibold mt-0.5">{bulkRemindMsg}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/project-hub"
              className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${myAlerts.overdue_count > 0
                  ? 'text-red-600 border-red-300 hover:bg-red-100'
                  : 'text-amber-600 border-amber-300 hover:bg-amber-100'
                }`}
            >
              Xem chi tiết
            </Link>
            <button
              onClick={async () => {
                setSendingBulkRemind(true);
                setBulkRemindMsg(null);
                try {
                  const res = await remindLeaderBulk();
                  setBulkRemindMsg(res.message || 'Đã gửi nhắc nhở!');
                  setTimeout(() => setBulkRemindMsg(null), 4000);
                } catch {
                  setBulkRemindMsg('Lỗi gửi nhắc nhở, vui lòng thử lại.');
                } finally {
                  setSendingBulkRemind(false);
                }
              }}
              disabled={sendingBulkRemind}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${myAlerts.overdue_count > 0
                  ? 'bg-red-500 hover:bg-red-600 text-white border-red-500'
                  : 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                } disabled:opacity-60 cursor-pointer`}
            >
              {sendingBulkRemind ? '⏳ Đang gửi...' : '🔔 Gửi nhắc nhở hàng loạt'}
            </button>
          </div>
        </div>
      )}

      {/* 3 Ô HIỂN THỊ (STATUS BAR CHART + PRIORITY BREAKDOWN + OVERDUE LIST) */}
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
        <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Mức Độ Ưu Tiên (Priority)</h3>
            <span className="text-[10px] font-semibold text-slate-400">💡 Bấm vào để xem chi tiết</span>
          </div>
          <div className="p-4 space-y-3 overflow-y-auto max-h-[300px] custom-scrollbar">
            {[
              { label: 'Critical', key: 'critical' as const, val: priorityStats.critical, cls: 'bg-red-50 text-red-600 border-red-200 hover:border-red-400' },
              { label: 'High', key: 'high' as const, val: priorityStats.high, cls: 'bg-orange-50 text-orange-600 border-orange-200 hover:border-orange-400' },
              { label: 'Normal', key: 'normal' as const, val: priorityStats.normal, cls: 'bg-blue-50 text-blue-600 border-blue-200 hover:border-blue-400' },
              { label: 'Interrupt', key: 'interrupt' as const, val: priorityStats.interrupt, cls: 'bg-purple-50 text-purple-600 border-purple-200 hover:border-purple-400' }
            ].map(item => (
              <div
                key={item.label}
                onClick={() => setSelectedPriorityModal(item.key)}
                className={`flex items-center justify-between p-3 rounded-xl border ${item.cls} cursor-pointer transition-all hover:shadow-xs active:scale-[0.99]`}
              >
                <span className="text-xs font-bold">{item.label}</span>
                <span className="text-sm font-extrabold">{item.val} tasks</span>
              </div>
            ))}
          </div>
        </div>

        {/* OVERDUE LIST WITH CUSTOMER & PROJECT NAME */}
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden flex flex-col">
          <div
            onClick={() => setSelectedPriorityModal('overdue')}
            className="px-5 py-4 border-b border-red-100 bg-red-50/50 flex justify-between items-center cursor-pointer hover:bg-red-100/50 transition-colors"
          >
            <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider">Task Trễ Hạn ({overdueTasksList.length})</h3>
            <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full hover:bg-red-200">Xem tất cả →</span>
          </div>
          <div className="p-4 overflow-y-auto max-h-[300px] space-y-2.5 custom-scrollbar">
            {overdueTasksList.length === 0 ? (
              <p className="text-xs text-slate-400 font-semibold text-center py-6">Không có task trễ hạn.</p>
            ) : (
              overdueTasksList.map((t, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedPriorityModal('overdue')}
                  className="p-3 bg-white rounded-xl border border-red-100 hover:border-red-300 transition-all cursor-pointer hover:shadow-xs"
                >
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    <span className="text-[9px] font-extrabold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 truncate max-w-[140px]" title={t.projectName}>Dự án: {t.projectName}</span>
                    <span className="text-[9px] font-extrabold text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-100 truncate max-w-[140px]" title={t.customerName}>KH: {t.customerName}</span>
                    {t.projectDataScope && (
                      <span className="text-[9px] font-extrabold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 uppercase">
                        {(workspacesData || []).find((w: any) => w.code === t.projectDataScope)?.name || t.projectDataScope}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-bold text-[#0b1c30] leading-snug">{t.name}</p>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-[10px] font-semibold text-slate-500">Phụ trách: <span className="text-slate-700 font-bold">{t.assignee}</span></span>
                    <span className="text-[10px] font-extrabold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200">Trễ {t.daysLate} ngày</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 1. MEMBER KPI RANKING TABLE & TOP/LOWEST PERFORMERS */}
      <div className="space-y-5">
        <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <SvgIcon name="crown" className="w-4 h-4 text-indigo-600" />
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Bảng Xếp Hạng KPI Thành Viên</h3>
            </div>
            <span className="text-[10px] font-semibold text-slate-400">Click tên thành viên hoặc click trực tiếp vào chỉ số để xem chi tiết</span>
          </div>

          {/* Summary strip — matches the reference prototype's 4-card .summary-grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 border-b border-slate-100 bg-slate-50/60">
            <div className="px-4 py-3 border-r border-slate-100 last:border-r-0">
              <span className="block text-[9px] uppercase tracking-wide font-black text-slate-400">KPI Team</span>
              <strong className="block text-base font-black text-[#0b1c30] mt-1 tabular-nums">{pmStats.kpi.toFixed(1)} / {pmStats.kpiPlanned.toFixed(1)}</strong>
              <small className="block mt-0.5 text-[10px] text-slate-400 font-semibold leading-snug">Chỉ tính KPI phát sinh tại team, không double-count KPI ngoài team</small>
            </div>
            <div className="px-4 py-3 border-r border-slate-100 last:border-r-0">
              <span className="block text-[9px] uppercase tracking-wide font-black text-slate-400">Manday Team</span>
              <strong className="block text-base font-black text-[#0b1c30] mt-1 tabular-nums">{pmStats.manday.toFixed(1)} / {pmStats.mandayPlanned.toFixed(1)} MD</strong>
              <small className="block mt-0.5 text-[10px] text-slate-400 font-semibold leading-snug">Actual / Planned trong kỳ đang chọn</small>
            </div>
            <div className="px-4 py-3 border-r border-slate-100 last:border-r-0">
              <span className="block text-[9px] uppercase tracking-wide font-black text-slate-400">Cross-workspace</span>
              <strong className="block text-base font-black text-[#0b1c30] mt-1 tabular-nums">{crossWsManday.toFixed(1)} MD</strong>
              <small className="block mt-0.5 text-[10px] text-slate-400 font-semibold leading-snug"><span className="text-indigo-600 font-black">{crossWsMemberCount} member</span> đang tham gia workspace khác</small>
            </div>
            <div className="px-4 py-3">
              <span className="block text-[9px] uppercase tracking-wide font-black text-slate-400">Task Team</span>
              <strong className="block text-base font-black text-[#0b1c30] mt-1 tabular-nums">{pmStats.done} / {pmStats.total}</strong>
              <small className="block mt-0.5 text-[10px] text-slate-400 font-semibold leading-snug"><b className="text-slate-600">{pmStats.inProgress}</b> task đang làm · <b className="text-red-500">{pmStats.overdue}</b> task trễ</small>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto overflow-x-auto custom-scrollbar">
            <table className="w-full text-xs relative border-collapse">
              <thead className="sticky top-0 z-20 bg-slate-100 shadow-sm">
                <tr className="bg-slate-100 text-slate-500 border-b border-slate-200 uppercase text-[10px] tracking-wider font-extrabold">
                  <th className="px-4 py-3 text-center font-bold w-14 bg-slate-100">Hạng</th>
                  <th className="px-4 py-3 text-left font-bold bg-slate-100">Thành Viên</th>
                  <th className="px-4 py-3 text-center font-bold bg-slate-100">Xong / Giao</th>
                  <th className="px-4 py-3 text-center font-bold bg-slate-100">Trễ / Đang Làm</th>
                  <th className="px-4 py-3 text-center font-bold bg-slate-100">Manday HT / Giao</th>
                  <th className="px-4 py-3 text-center font-bold bg-slate-100 text-[#0058be]">KPI HT / Giao</th>
                  <th className="px-4 py-3 text-left font-bold bg-slate-100 min-w-[170px]">Phân Bổ Workspace</th>
                  <th className="px-4 py-3 font-bold bg-slate-100 min-w-[140px]">Tiến Độ</th>
                </tr>
              </thead>
              <tbody>
                {memberRanking.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-6 text-slate-400 font-semibold">Chưa có thành viên nào.</td></tr>
                ) : (
                  memberRanking.map((m, i) => {
                    const rate = m.assigned > 0 ? Math.round((m.done / m.assigned) * 100) : 0;
                    const isLeader = leaders.some(ld => ld.name && ld.name !== 'Không có Leader' && (
                      ld.name.trim().toLowerCase() === m.name.trim().toLowerCase() ||
                      ld.name.trim().toLowerCase() === (m.rawMember?.full_name || '').trim().toLowerCase() ||
                      ld.name.trim().toLowerCase() === (m.rawMember?.display_name || '').trim().toLowerCase()
                    ));

                    return (
                      <tr
                        key={m.id}
                        onClick={() => setSelectedMemberModal(m)}
                        className={`border-b border-slate-100 hover:bg-indigo-50/70 transition-colors cursor-pointer ${isLeader
                            ? 'bg-indigo-50/40 font-bold border-l-4 border-l-indigo-600'
                            : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
                          }`}
                      >
                        <td className="px-4 py-3.5 text-center">
                          <span className={`text-xs font-bold ${m.rank <= 3 ? 'text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200' : 'text-slate-400'}`}>#{m.rank}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-[#0058be] hover:underline flex items-center gap-1">
                              {m.name}
                              <span className="text-[10px] text-slate-400">🔍</span>
                            </span>
                            {isLeader && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-indigo-100 text-indigo-700 border border-indigo-200 shadow-xs flex items-center gap-1">
                                👑 LEADER
                              </span>
                            )}
                            {(() => {
                              const badge = workspaceBadgeFor(m.id, effectiveWsCode);
                              if (!badge) return null;
                              return (
                                <>
                                  <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${badge.primary ? 'bg-indigo-600 text-white' : 'bg-amber-50 text-amber-700 border border-amber-300'}`}>
                                    {badge.label}
                                  </span>
                                  {badge.sub && (
                                    <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-300">
                                      {badge.sub}
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <div className="inline-flex flex-col items-center justify-center min-w-[68px] rounded-[10px] border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(18,37,63,.04)] hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
                            <span className="text-sm font-black leading-none text-slate-700 tabular-nums">{m.done}/{m.assigned}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <div className="inline-flex flex-col items-center justify-center min-w-[68px] rounded-[10px] border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(18,37,63,.04)] hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
                            <span className={`text-sm font-black leading-none tabular-nums ${m.overdue > 0 ? 'text-red-600' : 'text-slate-700'}`}>{m.overdue}/{m.inProgress}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <div className="inline-flex flex-col items-center justify-center min-w-[68px] rounded-[10px] border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(18,37,63,.04)] hover:border-amber-300 hover:bg-amber-50/30 transition-colors">
                            <span className="text-sm font-black leading-none text-amber-600 tabular-nums">{m.manday.toFixed(1)}/{m.mandayPlanned.toFixed(1)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <div className="inline-flex flex-col items-center justify-center min-w-[68px] rounded-[10px] border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(18,37,63,.04)] hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
                            <span className="text-sm font-black leading-none text-[#0058be] tabular-nums">{m.kpi.toFixed(1)}/{m.kpiPlanned.toFixed(1)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-left">
                          {(() => {
                            const entries = Object.entries(m.mandayByWs || {}).filter(([, v]) => (v as number) > 0);
                            if (!entries.length) return <span className="text-[10px] text-slate-300">—</span>;
                            const total = entries.reduce((s, [, v]) => s + (v as number), 0);
                            const palette: Record<string, string> = { dev: 'bg-[#1f6fe5]', infra: 'bg-[#6c57e8]', marketing: 'bg-amber-500' };
                            const wsName = (code: string) => (workspacesData || []).find((w: any) => w.code === code)?.name || code.toUpperCase();
                            return (
                              <div className="min-w-[170px]">
                                <div className="flex items-center gap-2">
                                  <div className="flex h-2 flex-1 rounded-full overflow-hidden bg-slate-100">
                                    {entries.map(([code, v]) => (
                                      <div key={code} className={palette[code] || 'bg-slate-400'} style={{ width: `${((v as number) / total) * 100}%` }} title={`${wsName(code)}: ${(v as number).toFixed(1)} MD`} />
                                    ))}
                                  </div>
                                  <span className="text-[10px] font-black text-slate-400 whitespace-nowrap tabular-nums">
                                    {entries.map(([, v]) => Math.round((v as number) / total * 100)).join('/')}
                                  </span>
                                </div>
                                <div className="text-[9px] font-bold text-slate-400 mt-1">
                                  {entries.map(([code, v], idx) => (
                                    <span key={code}>{idx > 0 && ' · '}{wsName(code)} {(v as number).toFixed(1)}</span>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
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

        {/* TOP PERFORMER & LOWEST PERFORMER CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* XUẤT SẮC NHẤT */}
          {topPerformer ? (
            <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-orange-400 to-orange-500 shadow-md p-5 flex flex-col justify-between">
              <div className="absolute -right-6 -bottom-6 opacity-20 transform rotate-12">
                <SvgIcon name="star" className="w-40 h-40 text-white" />
              </div>
              <div className="relative z-10">
                <h3 className="text-[10px] font-black text-white/90 uppercase tracking-widest mb-1 shadow-sm">Xuất Sắc Nhất</h3>
                <p className="text-2xl font-extrabold text-white mb-6 drop-shadow-md">{topPerformer.name}</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white/20 backdrop-blur-sm rounded-xl p-3 flex flex-col items-center justify-center text-white border border-white/30">
                    <span className="text-xl font-black">{topPerformer.kpi.toFixed(1)}</span>
                    <span className="text-[9px] font-bold uppercase mt-1 opacity-90">KPI</span>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-xl p-3 flex flex-col items-center justify-center text-white border border-white/30">
                    <span className="text-xl font-black">{topPerformer.done}</span>
                    <span className="text-[9px] font-bold uppercase mt-1 opacity-90">Hoàn Thành</span>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-xl p-3 flex flex-col items-center justify-center text-white border border-white/30">
                    <span className="text-xl font-black">{topPerformer.manday.toFixed(1)}</span>
                    <span className="text-[9px] font-bold uppercase mt-1 opacity-90">Manday</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center min-h-[160px] text-slate-400 font-bold text-xs">Chưa đủ dữ liệu top</div>
          )}

          {/* CẦN CẢI THIỆN */}
          {lowestPerformer ? (
            <div className="rounded-2xl bg-white border border-red-100 shadow-sm p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                  <span>⚠️</span> Cần Cải Thiện
                </h3>
                <p className="text-2xl font-extrabold text-[#0b1c30] mb-6">{lowestPerformer.name}</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-50 rounded-xl p-3 flex flex-col items-center justify-center border border-slate-100">
                    <span className="text-xl font-black text-red-600">{lowestPerformer.kpi.toFixed(1)}</span>
                    <span className="text-[9px] font-bold uppercase mt-1 text-slate-400">KPI</span>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 flex flex-col items-center justify-center border border-slate-100">
                    <span className="text-xl font-black text-[#0b1c30]">{lowestPerformer.done}</span>
                    <span className="text-[9px] font-bold uppercase mt-1 text-slate-400">XONG</span>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 flex flex-col items-center justify-center border border-slate-100">
                    <span className="text-xl font-black text-red-600">{lowestPerformer.overdue}</span>
                    <span className="text-[9px] font-bold uppercase mt-1 text-slate-400">TRỄ</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center min-h-[160px] text-slate-400 font-bold text-xs">Chưa đủ dữ liệu cải thiện</div>
          )}
        </div>
      </div>

      {/* 2. DỰ ÁN ĐANG TRIỂN KHAI (ONGOING PROJECTS) */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-wrap gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <SvgIcon name="folders" className="w-4 h-4 text-slate-700 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Dự án đang triển khai</h3>
              <p className="text-[10px] text-slate-400 mt-0.5 truncate">Phân biệt rõ dự án thuộc workspace chính và dự án ngoài workspace chỉ tham gia đóng góp</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-xl">
              {([
                ['all', 'Tất cả'],
                ['owned', 'Phụ trách'],
                ['external', 'Tham gia ngoài'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setProjectFilterMode(mode)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${projectFilterMode === mode ? 'bg-white text-[#0058be] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={handleAiCheck}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg shadow-sm text-[11px] font-bold transition-all cursor-pointer active:scale-95"
            >
              <span className="text-sm">✨</span> AI Check
            </button>
          </div>
        </div>
        {aiCheckStatus && (
          <div className="bg-blue-50 px-5 py-2 text-xs font-bold text-blue-700 border-b border-blue-100 flex items-center justify-between animate-fadeIn">
            <span>{aiCheckStatus}</span>
            <button onClick={() => setAiCheckStatus(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
          </div>
        )}

        {(() => {
          const ownedProjects = activeProjects.filter((p: any) => p.isOwned);
          const externalProjects = activeProjects.filter((p: any) => !p.isOwned);
          const wsName = (code: string | null) => (code && (workspacesData || []).find((w: any) => w.code === code)?.name) || (code ? code.toUpperCase() : null);

          const renderCard = (p: any, isOwnedCard: boolean) => (
            <div
              key={p.id}
              onClick={() => isOwnedCard ? router.push(`/project/detail/overview?id=${p.id}`) : setContributionModalProject(p)}
              className={`p-4 rounded-2xl border shadow-sm transition-all flex flex-col justify-between cursor-pointer active:scale-[0.99] ${isOwnedCard
                  ? 'border-slate-200 bg-white hover:border-[#0058be] hover:shadow-md'
                  : 'border-purple-200/70 bg-[#fdfcff] hover:border-purple-400 hover:shadow-md'
                }`}
            >
              <div>
                <div className="flex justify-between items-start mb-2 gap-2">
                  <h4 className="text-sm font-black text-[#0b1c30] truncate hover:text-[#0058be]" title={p.name}>{p.name}</h4>
                  <div className="flex flex-wrap gap-1 justify-end shrink-0">
                    {p.dataScope && (
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">
                        {wsName(p.dataScope)} Workspace
                      </span>
                    )}
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${isOwnedCard ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                      {isOwnedCard ? 'Full access' : 'Limited access'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-[10px] text-slate-400 font-semibold">{p.current_phase || '1. Tư vấn'}</span>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${projectStatusBadge[p.status] || 'bg-blue-100 text-blue-700'}`}>
                    {p.status || 'Developing'}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5 mt-3.5">
                  <div className="bg-slate-50 rounded-lg py-2 px-1 text-center">
                    <span className="block text-[7px] uppercase font-black text-slate-400">Tiến độ</span>
                    <strong className="block text-[11px] font-black text-[#0b1c30] mt-1">{p.progress}%</strong>
                  </div>
                  <div className="bg-slate-50 rounded-lg py-2 px-1 text-center">
                    <span className="block text-[7px] uppercase font-black text-slate-400">Task</span>
                    <strong className="block text-[11px] font-black text-[#0b1c30] mt-1">{p.doneTasks}/{p.totalTasks}</strong>
                  </div>
                  <div className="bg-slate-50 rounded-lg py-2 px-1 text-center">
                    <span className="block text-[7px] uppercase font-black text-slate-400">Mở/Trễ</span>
                    <strong className={`block text-[11px] font-black mt-1 ${p.lateTasks > 0 ? 'text-red-600' : 'text-[#0b1c30]'}`}>{p.openTasks}/{p.lateTasks}</strong>
                  </div>
                  <div className="bg-slate-50 rounded-lg py-2 px-1 text-center">
                    <span className="block text-[7px] uppercase font-black text-slate-400">Manday</span>
                    <strong className="block text-[11px] font-black text-amber-600 mt-1">{p.manday.toFixed(1)}/{p.mandayPlanned.toFixed(1)}</strong>
                  </div>
                  <div className="bg-slate-50 rounded-lg py-2 px-1 text-center">
                    <span className="block text-[7px] uppercase font-black text-slate-400">KPI</span>
                    <strong className="block text-[11px] font-black text-[#0058be] mt-1">{p.kpi.toFixed(1)}/{p.kpiPlanned.toFixed(1)}</strong>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 mt-3.5">
                <p className="text-[10px] text-slate-400 leading-snug">
                  {isOwnedCard
                    ? 'Dự án thuộc workspace chính — xem đầy đủ chi tiết task, KPI và timeline.'
                    : 'Dự án ngoài workspace — chỉ xem contribution, tiến độ & risk được chia sẻ.'}
                </p>
                <span className="text-[#0058be] text-[10px] font-black whitespace-nowrap hover:underline shrink-0">
                  {isOwnedCard ? 'Xem chi tiết →' : 'Xem contribution →'}
                </span>
              </div>
            </div>
          );

          if (activeProjects.length === 0) {
            return <p className="text-xs text-slate-400 font-semibold py-8 text-center">Chưa có dự án nào đang hoạt động.</p>;
          }

          return (
            <div className="p-5 max-h-[520px] overflow-y-auto custom-scrollbar space-y-5">
              {projectFilterMode !== 'external' && ownedProjects.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3 gap-3">
                    <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-500">Dự án Workspace Chính phụ trách</h4>
                    <p className="text-[10px] text-slate-400">Được xem đầy đủ chi tiết dự án và task.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {ownedProjects.map((p: any) => renderCard(p, true))}
                  </div>
                </div>
              )}

              {projectFilterMode !== 'owned' && externalProjects.length > 0 && (
                <div>
                  <div className="flex items-center justify-between gap-3 mb-3 p-3 bg-purple-50/60 border border-purple-100 rounded-xl text-[11px] font-semibold text-purple-800">
                    <span>↗ <strong>Dự án liên workspace:</strong> chỉ hiển thị contribution, deadline chung và tiến độ/risk được chia sẻ — không mở toàn bộ chi tiết dự án.</span>
                    <button
                      onClick={() => setExternalProjectsCollapsed(v => !v)}
                      className="shrink-0 px-2.5 py-1 rounded-lg border border-purple-200 bg-white text-purple-700 text-[10px] font-black hover:bg-purple-50"
                    >
                      {externalProjectsCollapsed ? 'Hiện' : 'Ẩn'}
                    </button>
                  </div>
                  {!externalProjectsCollapsed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {externalProjects.map((p: any) => renderCard(p, false))}
                    </div>
                  )}
                </div>
              )}

              {projectFilterMode === 'owned' && ownedProjects.length === 0 && (
                <p className="text-xs text-slate-400 font-semibold py-8 text-center">Không có dự án nào thuộc workspace chính trong kỳ này.</p>
              )}
              {projectFilterMode === 'external' && externalProjects.length === 0 && (
                <p className="text-xs text-slate-400 font-semibold py-8 text-center">Không tham gia dự án ngoài workspace nào trong kỳ này.</p>
              )}
            </div>
          );
        })()}
      </div>



      {/* 4. HOẠT ĐỘNG GẦN ĐÂY (RECENT ACTIVITY SECTION) */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 to-white">
          <div className="flex items-center gap-2">
            <span className="text-base">📜</span>
            <div>
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Hoạt Động Gần Đây</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">20 hoạt động mới nhất trên tất cả dự án bạn có quyền xem</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={auditModuleFilter}
              onChange={(e) => setAuditModuleFilter(e.target.value)}
              className="text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-[#0058be]"
            >
              <option value="all">Tất cả Module</option>
              <option value="Project">Project</option>
              <option value="Phase">Phase</option>
              <option value="Task Group">Task Group</option>
              <option value="Task">Task</option>
              <option value="Meeting">Meeting</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-slate-400 border-b border-slate-100 uppercase text-[10px] tracking-wider">
                <th className="px-4 py-3 text-left font-bold">Thời gian</th>
                <th className="px-4 py-3 text-left font-bold">Thành viên</th>
                <th className="px-4 py-3 text-left font-bold">Dự án</th>
                <th className="px-4 py-3 text-center font-bold">Hành động</th>
                <th className="px-4 py-3 text-center font-bold">Module</th>
                <th className="px-5 py-3 text-left font-bold">Chi tiết thay đổi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-6 text-slate-400 font-semibold">Đang tải hoạt động...</td></tr>
              ) : filteredActivity.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-slate-400 font-semibold">Chưa có hoạt động nào.</td></tr>
              ) : (
                filteredActivity.map((log, idx) => (
                  <tr key={log.id || idx} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                      {log.created_at ? new Date(log.created_at).toLocaleString('vi-VN') : 'Mới đây'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#0b1c30]">
                      {log.user_name || 'Hệ thống'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-medium">
                      {log.project_name ? <>📁 {log.project_name}</> : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${log.action === 'CREATE' ? 'bg-emerald-100 text-emerald-700' :
                          log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
                            log.action === 'DELETE' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                        }`}>{log.action}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold">{log.module}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600 leading-snug">
                      {log.changes?.length === 1 ? (
                        <span>{log.changes[0].field_name}: <span className="text-slate-400">{log.changes[0].old_value || '—'}</span> → <span className="font-semibold text-[#0b1c30]">{log.changes[0].new_value || '—'}</span></span>
                      ) : (
                        log.description || `${log.action} trên ${log.module}`
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PRIORITY DETAIL MODAL */}
      {selectedPriorityModal && (
        <PriorityDetailModal
          initialFilter={selectedPriorityModal}
          tasks={filteredTasks}
          onClose={() => setSelectedPriorityModal(null)}
          onNavigate={(projectId) => router.push(`/project/detail?id=${projectId}`)}
        />
      )}

      {/* LIMITED-ACCESS CONTRIBUTION MODAL — for "Tham gia ngoài" (Phụ Workspace)
          project cards. Clicking one of these never navigates into the real
          project/detail page (that would require Full access) — it only ever
          shows the shared/contribution-scoped summary a Phụ Workspace grants:
          overall progress, the team's own Manday/KPI/Task contribution, and
          which of the team's own members are on it. Everything else about the
          project (backlog, docs, other members, budget) stays hidden. */}
      {contributionModalProject && (() => {
        const p = contributionModalProject;
        const wsLabel = (workspacesData || []).find((w: any) => w.code === p.dataScope)?.name || (p.dataScope || '').toUpperCase();
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setContributionModalProject(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-100">
                <div className="min-w-0">
                  <h3 className="text-lg font-black text-[#0b1c30] truncate">{p.name}</h3>
                  <p className="text-xs text-slate-400 font-semibold mt-1">{wsLabel} Workspace · Team bạn chỉ tham gia đóng góp</p>
                </div>
                <button onClick={() => setContributionModalProject(null)} className="shrink-0 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 font-bold">✕</button>
              </div>

              <div className="mx-6 mt-5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] font-bold text-amber-800 flex items-center gap-2">
                <span>🔒</span>
                <span>Dự án thuộc {wsLabel} Workspace. Team bạn chỉ xem phần đóng góp của member team mình và các chỉ số tổng quan được chia sẻ.</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 mt-4">
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <span className="block text-[9px] uppercase font-black text-slate-400">Tiến độ phần giao</span>
                  <strong className="block text-base font-black text-[#0b1c30] mt-1">{p.progress}%</strong>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <span className="block text-[9px] uppercase font-black text-slate-400">Task</span>
                  <strong className="block text-base font-black text-[#0b1c30] mt-1">{p.doneTasks}/{p.totalTasks}</strong>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <span className="block text-[9px] uppercase font-black text-slate-400">MD đóng góp</span>
                  <strong className="block text-base font-black text-amber-600 mt-1">{p.manday.toFixed(1)}/{p.mandayPlanned.toFixed(1)}</strong>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <span className="block text-[9px] uppercase font-black text-slate-400">KPI đóng góp</span>
                  <strong className="block text-base font-black text-[#0058be] mt-1">{p.kpi.toFixed(1)}/{p.kpiPlanned.toFixed(1)}</strong>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-6 py-5 mt-1">
                <div className="border border-slate-200 rounded-xl p-4">
                  <h4 className="text-xs font-black text-slate-700 mb-3">Thông tin team bạn được phép xem</h4>
                  <dl className="space-y-2.5 text-xs">
                    <div className="flex justify-between gap-3"><dt className="text-slate-400 font-semibold">Workspace sở hữu</dt><dd className="font-black text-slate-700">{wsLabel}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-400 font-semibold">Giai đoạn chung</dt><dd className="font-black text-slate-700 text-right">{p.current_phase}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-400 font-semibold">Tiến độ được chia sẻ</dt><dd className="font-black text-slate-700">{p.progress}%</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-400 font-semibold">Trạng thái</dt><dd className="font-black text-slate-700">{p.status}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-400 font-semibold shrink-0">Member liên quan</dt><dd className="font-black text-slate-700 text-right">{p.contributingNames.length ? p.contributingNames.join(', ') : '—'}</dd></div>
                  </dl>
                </div>
                <div className="border border-dashed border-slate-300 rounded-xl p-4 bg-slate-50/60 flex flex-col items-center justify-center text-center">
                  <span className="text-2xl">🔒</span>
                  <h4 className="text-xs font-black text-slate-700 mt-2">Không có quyền xem chi tiết nội bộ {wsLabel}</h4>
                  <p className="text-[10px] text-slate-400 font-semibold mt-1.5 leading-snug">Không xem toàn bộ backlog, task của member {wsLabel}, tài liệu nội bộ, budget, comment hoặc milestone nội bộ.</p>
                </div>
              </div>

              <div className="px-6 pb-5 -mt-1">
                <p className="text-[10px] text-slate-400 font-semibold leading-snug">
                  Nguyên tắc: chỉ xem đủ dữ liệu để quản lý workload, KPI đóng góp, deadline và risk của member mình — không xem cấu trúc vận hành nội bộ của Workspace khác.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 px-6 pb-6 pt-2 border-t border-slate-100">
                <p className="text-[10px] text-slate-400 font-semibold leading-snug max-w-[60%]">
                  Bạn đang được gán trực tiếp vào dự án này (không phải chỉ xem qua số liệu tổng hợp) nên vẫn mở được task/phần việc của mình bên trong.
                </p>
                <button
                  onClick={() => { setContributionModalProject(null); router.push(`/project/detail/overview?id=${p.id}`); }}
                  className="shrink-0 px-4 py-2 rounded-lg bg-[#0058be] hover:bg-[#004a9e] text-white text-xs font-bold"
                >
                  Mở dự án →
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MEMBER DETAIL MODAL */}
      {selectedMemberModal && (
        <MemberDetailModal
          member={selectedMemberModal}
          tasks={rawTasks}
          projects={rawProjects}
          onClose={() => setSelectedMemberModal(null)}
          onNavigate={(projectId) => router.push(`/project/detail/overview?id=${projectId}`)}
        />
      )}
    </div>
  );
}
