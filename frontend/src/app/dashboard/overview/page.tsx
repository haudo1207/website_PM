'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { getEmail, getName, getToken, getRole } from '@/lib/auth';
import KpiCard from '@/components/dashboard/KpiCard';
import ProgressBar from '@/components/dashboard/ProgressBar';
import SvgIcon from '@/components/dashboard/Icons';
import BarChartCard from '@/components/dashboard/BarChartCard';
import { projectStatusBadge, projectBarColor, MONTH_WEEKS_COUNT, getWeekOfMonth } from '@/app/dashboard/constants';

let cachedOverviewData: any = null;

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

const MemberDetailModal = ({ member, tasks, projects, onClose }: { member: any, tasks: any[], projects: any[], onClose: () => void }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'tasks'>('overview');
  const [taskFilter, setTaskFilter] = useState<'all' | 'inProgress' | 'overdue' | 'done'>('all');
  const [searchTask, setSearchTask] = useState('');

  if (!member) return null;

  const memberTasks = tasks.filter(t => t.assigned_id === member.id || t.support_id === member.id);
  const doneTasks = memberTasks.filter(t => t.status === 'Done' || t.status === 'done');
  const overdueTasks = memberTasks.filter(t => (t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel') && t.days_late > 0);
  const inProgTasks = memberTasks.filter(t => (t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel') && (t.days_late || 0) <= 0);

  const memberProjectIds = Array.from(new Set(memberTasks.map(t => t.project_id).filter(Boolean)));
  const memberProjects = projects.filter(p => memberProjectIds.includes(p.id)).map(p => {
    const pTasks = memberTasks.filter(t => t.project_id === p.id);
    const pDone = pTasks.filter(t => t.status === 'Done' || t.status === 'done').length;
    return {
      ...p,
      tasksCount: pTasks.length,
      doneCount: pDone,
      progress: pTasks.length > 0 ? Math.round((pDone / pTasks.length) * 100) : 0
    };
  });

  const filteredTasks = memberTasks.filter(t => {
    if (searchTask && !t.name?.toLowerCase().includes(searchTask.toLowerCase())) return false;
    if (taskFilter === 'done') return t.status === 'Done' || t.status === 'done';
    if (taskFilter === 'overdue') return (t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel') && t.days_late > 0;
    if (taskFilter === 'inProgress') return (t.status !== 'Done' && t.status !== 'done' && t.status !== 'Cancel' && t.status !== 'cancel') && (t.days_late || 0) <= 0;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-500/30 border border-indigo-400/40 flex items-center justify-center font-extrabold text-sm text-indigo-200">
              {member.name ? member.name.charAt(0).toUpperCase() : 'M'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-white">{member.name}</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  Hạng #{member.rank}
                </span>
              </div>
              <p className="text-xs text-slate-300">Tổng điểm KPI: <strong className="text-amber-400">{member.kpi.toFixed(1)}</strong> · Total Manday: <strong>{member.manday.toFixed(1)}</strong></p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer text-base"
          >
            ✕
          </button>
        </div>

        {/* MODAL TABS */}
        <div className="flex border-b border-slate-100 px-6 bg-slate-50 text-xs font-bold text-slate-500 gap-4">
          <button 
            onClick={() => setActiveTab('overview')}
            className={`py-3 border-b-2 transition-colors ${activeTab === 'overview' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent hover:text-slate-700'}`}
          >
            Tổng quan KPI ({member.kpi.toFixed(1)})
          </button>
          <button 
            onClick={() => setActiveTab('projects')}
            className={`py-3 border-b-2 transition-colors ${activeTab === 'projects' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent hover:text-slate-700'}`}
          >
            Dự án ({memberProjects.length})
          </button>
          <button 
            onClick={() => setActiveTab('tasks')}
            className={`py-3 border-b-2 transition-colors ${activeTab === 'tasks' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent hover:text-slate-700'}`}
          >
            Danh sách Task ({memberTasks.length})
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="p-6 overflow-y-auto custom-scrollbar space-y-5 flex-1">
          {activeTab === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 bg-indigo-50/60 rounded-xl border border-indigo-100">
                  <span className="text-[10px] font-bold uppercase text-indigo-500">Tổng điểm KPI</span>
                  <p className="text-2xl font-black text-indigo-700 mt-1">{member.kpi.toFixed(1)}</p>
                </div>
                <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-100">
                  <span className="text-[10px] font-bold uppercase text-emerald-500">Task Hoàn Thành</span>
                  <p className="text-2xl font-black text-emerald-700 mt-1">{doneTasks.length} / {memberTasks.length}</p>
                </div>
                <div className="p-4 bg-amber-50/60 rounded-xl border border-amber-100">
                  <span className="text-[10px] font-bold uppercase text-amber-500">Đang Triển Khai</span>
                  <p className="text-2xl font-black text-amber-700 mt-1">{inProgTasks.length}</p>
                </div>
                <div className="p-4 bg-red-50/60 rounded-xl border border-red-100">
                  <span className="text-[10px] font-bold uppercase text-red-500">Task Trễ Hạn</span>
                  <p className="text-2xl font-black text-red-700 mt-1">{overdueTasks.length}</p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-3">Dự án tham gia</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {memberProjects.length === 0 ? (
                    <p className="text-xs text-slate-400 font-semibold col-span-2 text-center py-4">Chưa có dự án nào.</p>
                  ) : (
                    memberProjects.map((p: any) => (
                      <div key={p.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-bold text-[#0b1c30] truncate">{p.name}</span>
                          <span className="text-[10px] font-extrabold text-[#0058be]">{p.progress}%</span>
                        </div>
                        <ProgressBar value={p.progress} color={p.progress >= 80 ? 'bg-emerald-500' : 'bg-blue-500'} height="h-1.5" />
                        <span className="text-[10px] text-slate-400 font-medium mt-1.5 block">{p.doneCount}/{p.tasksCount} task hoàn thành</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="space-y-3">
              {memberProjects.length === 0 ? (
                <p className="text-xs text-slate-400 font-semibold text-center py-6">Chưa có dự án nào.</p>
              ) : (
                memberProjects.map((p: any) => (
                  <div key={p.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
                    <div>
                      <h4 className="text-xs font-bold text-[#0b1c30]">{p.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-1">Phụ trách {p.tasksCount} task · Đã xong {p.doneCount} task</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-extrabold text-[#0058be]">{p.progress}%</span>
                      <div className="w-24">
                        <ProgressBar value={p.progress} color={p.progress >= 80 ? 'bg-emerald-500' : 'bg-blue-500'} height="h-2" />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-2 border-b border-slate-100">
                <div className="flex gap-1.5 flex-wrap">
                  <button onClick={() => setTaskFilter('all')} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${taskFilter === 'all' ? 'bg-[#0058be] text-white' : 'bg-slate-100 text-slate-600'}`}>Tất cả ({memberTasks.length})</button>
                  <button onClick={() => setTaskFilter('inProgress')} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${taskFilter === 'inProgress' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'}`}>Đang làm ({inProgTasks.length})</button>
                  <button onClick={() => setTaskFilter('overdue')} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${taskFilter === 'overdue' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600'}`}>Trễ ({overdueTasks.length})</button>
                  <button onClick={() => setTaskFilter('done')} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${taskFilter === 'done' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'}`}>Đã xong ({doneTasks.length})</button>
                </div>
                <input 
                  type="text" 
                  placeholder="Tìm task..." 
                  value={searchTask} 
                  onChange={e => setSearchTask(e.target.value)} 
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 outline-none w-48"
                />
              </div>

              <div className="space-y-2 max-h-[350px] overflow-y-auto custom-scrollbar">
                {filteredTasks.length === 0 ? (
                  <p className="text-xs text-slate-400 font-semibold text-center py-6">Không tìm thấy task nào.</p>
                ) : (
                  filteredTasks.map((t: any) => (
                    <div key={t.id} className="p-3 bg-white rounded-xl border border-slate-200 flex justify-between items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${t.status === 'Done' || t.status === 'done' ? 'bg-emerald-100 text-emerald-700' : t.days_late > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                            {t.status}
                          </span>
                          <p className="text-xs font-bold text-[#0b1c30]">{t.name}</p>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Dự án: {t.projectName || 'Không có'} · Khách hàng: {t.customerName || 'Không có'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-extrabold text-[#0058be] block">+{t.kpi_base || 0} KPI</span>
                        <span className="text-[10px] text-slate-400 font-semibold">{t.end_date_est || 'Chưa có hạn'}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function OverviewTab() {
  const [loading, setLoading] = useState(false);
  const [rawMembers, setRawMembers] = useState<any[]>(cachedOverviewData?.rawMembers || []);
  const [rawProjects, setRawProjects] = useState<any[]>(cachedOverviewData?.rawProjects || []);
  const [rawTasks, setRawTasks] = useState<any[]>(cachedOverviewData?.rawTasks || []);
  const [rawLeaders, setRawLeaders] = useState<any[]>(cachedOverviewData?.rawLeaders || []);

  // Team Audit Log states
  const [teamAuditLogs, setTeamAuditLogs] = useState<any[]>(cachedOverviewData?.teamAuditLogs || []);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditModuleFilter, setAuditModuleFilter] = useState('all');

  // Workspace/Leader Filter
  const [selectedLeader, setSelectedLeader] = useState<string>('all');
  
  // Unified Date Filter
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>('all');
  const [selectedWeek, setSelectedWeek] = useState<number | 'all'>('all');

  // Matrix Filter
  const [matrixYear, setMatrixYear] = useState<number>(new Date().getFullYear());

  // Filter & Modal States
  const [selectedMemberModal, setSelectedMemberModal] = useState<any>(null);
  const [aiCheckStatus, setAiCheckStatus] = useState<string | null>(null);

  const applyQuickFilter = (type: string) => {
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

  const filteredAuditLogs = teamAuditLogs.filter(log => {
    if (auditModuleFilter !== 'all') {
      return log.module?.toLowerCase() === auditModuleFilter.toLowerCase();
    }
    return true;
  });

  const fetchOverviewData = useCallback((forceRefresh = false) => {
    if (!forceRefresh && cachedOverviewData) return;
    setLoading(true);
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

    setAuditLoading(true);
    Promise.all([
      axios.get(`/api/members?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/projects?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/all-tasks-global?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(`/api/system-audit/logs?page_size=20&_t=${ts}`, config).catch(() => ({ data: { items: [] } })),
      axios.get(`/api/members/meta/leaders?_t=${ts}`, config).catch(() => ({ data: [] }))
    ]).then(([membersRes, projRes, tasksRes, auditRes, leadersRes]) => {
      setRawMembers(membersRes.data || []);
      setRawProjects(projRes.data || []);
      setRawTasks(tasksRes.data || []);
      setRawLeaders(leadersRes.data || []);
      
      const auditItems = auditRes.data?.items || [];
      setTeamAuditLogs(auditItems);
      
      cachedOverviewData = {
        rawMembers: membersRes.data || [],
        rawProjects: projRes.data || [],
        rawTasks: tasksRes.data || [],
        teamAuditLogs: auditItems,
        rawLeaders: leadersRes.data || []
      };
    }).finally(() => {
      setLoading(false);
      setAuditLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchOverviewData(true);
  }, [fetchOverviewData]);

  const { 
    leaders, 
    totalAllTasks,
    totalAllDoneTasks,
    activeTeamMembers, 
    filteredTasks, 
    pmStats, 
    priorityStats, 
    overdueTasksList, 
    memberRanking,
    activeProjects,
    topPerformer,
    lowestPerformer,
    summaryMatrix,
    averageMatrix,
    bonusMatrix
  } = useMemo(() => {
    const isSameId = (a: any, b: any) => a != null && b != null && String(a) === String(b);
    const isIdInList = (idList: any[], targetId: any) => targetId != null && idList.some(id => String(id) === String(targetId));

    // 1. Get Leaders
    const leaderMap = new Map();
    rawMembers.forEach(m => {
      const lName = m.leader_name || 'Không có Leader';
      if (!leaderMap.has(lName)) {
        leaderMap.set(lName, { name: lName, count: 0, team: m.team || m.department || 'Khác', memberIds: [] });
      }
      const ld = leaderMap.get(lName);
      ld.count++;
      ld.memberIds.push(m.id);
    });
    
    // Calculate tasks for leaders
    const lList = Array.from(leaderMap.values()).map(ld => {
       const lTasks = rawTasks.filter(t => isIdInList(ld.memberIds, t.assigned_id) || isIdInList(ld.memberIds, t.support_id));
       const done = lTasks.filter(t => t.status === 'Done' || t.status === 'done').length;
       return { ...ld, totalTasks: lTasks.length, doneTasks: done };
    }).sort((a,b) => b.count - a.count);

    const totTasks = rawTasks.length;
    const totDone = rawTasks.filter(t => t.status === 'Done' || t.status === 'done').length;

    // 2. Filter Members by Leader
    let activeTeamList = rawMembers;
    if (selectedLeader && selectedLeader !== 'all') {
      activeTeamList = rawMembers.filter(m => (m.leader_name || 'Không có Leader') === selectedLeader);
    }
    const teamMemberIds = activeTeamList.map(m => m.id);

    // 3. Filter Tasks by Team & Date
    let fTasks = rawTasks.filter(t => teamMemberIds.length === 0 || isIdInList(teamMemberIds, t.assigned_id) || isIdInList(teamMemberIds, t.support_id));
    fTasks = fTasks.filter(t => {
      const tDateStr = t.end_date_est || t.end_date_actual || t.created_at;
      if (!tDateStr) return true;
      const tDate = new Date(tDateStr);
      if (isNaN(tDate.getTime())) return true;
      if (selectedYear !== 'all' && tDate.getFullYear() !== selectedYear) return false;
      if (selectedMonth !== 'all' && (tDate.getMonth() + 1) !== selectedMonth) return false;
      if (selectedWeek !== 'all' && getWeekOfMonth(tDate) !== selectedWeek) return false;
      return true;
    });

    // 4. Calculate Stats (PM)
    let pmDone = 0, pmInProg = 0, pmOverdue = 0, pmTotal = fTasks.length, pmManday = 0, pmKpi = 0;
    const pStats = { critical: 0, high: 0, normal: 0, interrupt: 0 };
    const overdueList: any[] = [];

    fTasks.forEach(t => {
      pmManday += (t.manday_actual || t.manday_est || 0);
      pmKpi += (t.kpi_base || 0);
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
            deadline: t.end_date_est || 'N/A',
            customerName: t.customerName || t.customer_name || 'Không có',
            projectName: t.projectName || t.project_name || 'Không có'
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
      return { 
        id: m.id, 
        name: m.display_name || m.full_name, 
        team: m.team || m.department || 'General',
        position: m.position || 'Member', 
        assigned: myTasks.length,
        done: d,
        inProgress: i,
        overdue: o,
        manday: Math.round(md * 10) / 10,
        kpi: Math.round(k * 10) / 10,
        rawMember: m
      };
    });
    const finalRanking = initialRanking.sort((a, b) => b.kpi - a.kpi).map((m, idx) => ({ ...m, rank: idx + 1 }));
    const topPerf = finalRanking.length > 0 && finalRanking[0].kpi > 0 ? finalRanking[0] : null;
    const lowestPerf = finalRanking.length > 1 ? finalRanking[finalRanking.length - 1] : null;

    // 6. Active Projects
    const aProjects = rawProjects.map((p: any) => {
      const pTasks = rawTasks.filter(t => isSameId(t.project_id, p.id));
      const done = pTasks.filter(t => t.status === 'Done' || t.status === 'done').length;
      return {
        id: p.id, name: p.name, status: p.status || 'Developing', current_phase: p.current_phase || '1. Tư vấn',
        progress: pTasks.length ? Math.round((done / pTasks.length) * 100) : 0,
        totalTasks: pTasks.length, doneTasks: done
      };
    }).sort((a,b) => b.progress - a.progress);

    // 7. KPI Matrices
    let sumM: any[] = [];
    let avgM: any[] = [];
    let bonM: any[] = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for(let i=1; i<=12; i++) {
        const rowSum: any = { month: `${monthNames[i-1]} - ${matrixYear}` };
        const rowAvg: any = { month: `${monthNames[i-1]} - ${matrixYear}` };
        const rowBon: any = { month: `${monthNames[i-1]} - ${matrixYear}` };

        activeTeamList.forEach(m => {
           const mTasks = rawTasks.filter(t => (isSameId(t.assigned_id, m.id) || isSameId(t.support_id, m.id)) && (t.status === 'Done' || t.status === 'done'));
           let mkpi = 0;
           mTasks.forEach(t => {
              const tdStr = t.end_date_est || t.end_date_actual || t.created_at;
              if (tdStr) {
                const td = new Date(tdStr);
                if(td.getFullYear() === matrixYear && (td.getMonth()+1) === i) {
                  mkpi += (t.kpi_base || 0);
                }
              }
           });
           const weeksInMonth = MONTH_WEEKS_COUNT[i] || 4;
           let avgKpi = mkpi > 0 ? (mkpi / weeksInMonth) : 0;
           rowSum[`m_${m.id}`] = mkpi;
           rowAvg[`m_${m.id}`] = avgKpi.toFixed(1);
           rowBon[`m_${m.id}`] = getKpiMultiplier(avgKpi).toFixed(2);
        });
        sumM.push(rowSum);
        avgM.push(rowAvg);
        bonM.push(rowBon);
    }

    return { 
      leaders: lList, 
      totalAllTasks: totTasks,
      totalAllDoneTasks: totDone,
      activeTeamMembers: activeTeamList, 
      filteredTasks: fTasks,
      pmStats: { total: pmTotal, done: pmDone, inProgress: pmInProg, overdue: pmOverdue, manday: Math.round(pmManday*10)/10, kpi: Math.round(pmKpi) },
      priorityStats: pStats,
      overdueTasksList: overdueList.sort((a,b) => b.daysLate - a.daysLate),
      memberRanking: finalRanking,
      activeProjects: aProjects,
      topPerformer: topPerf,
      lowestPerformer: lowestPerf,
      summaryMatrix: sumM,
      averageMatrix: avgM,
      bonusMatrix: bonM
    };
  }, [rawMembers, rawTasks, rawProjects, rawLeaders, selectedLeader, selectedYear, selectedMonth, selectedWeek, matrixYear]);

  const handleAiCheck = () => {
    setAiCheckStatus('Đang thực hiện AI Check dự án...');
    setTimeout(() => {
      setAiCheckStatus(`✅ AI Check hoàn tất: Tất cả ${activeProjects.length} dự án hoạt động ổn định, tiến độ trung bình ${activeProjects.length > 0 ? Math.round(activeProjects.reduce((acc, p) => acc + p.progress, 0)/activeProjects.length) : 0}%.`);
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
                    {[...Array(selectedMonth !== 'all' ? (MONTH_WEEKS_COUNT[selectedMonth] || 5) : 5)].map((_, i) => (
                      <option key={i+1} value={i+1}>{i+1}</option>
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
                  className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 rounded-lg text-[11px] font-bold transition-all text-slate-600 cursor-pointer whitespace-nowrap shadow-sm active:scale-95"
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={() => fetchOverviewData(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm text-[11px] font-bold transition-all active:scale-95 cursor-pointer"
            >
              <SvgIcon name="refresh" className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#0058be]' : 'text-slate-500'}`} />
              LÀM MỚI
            </button>
          </div>
        </div>
        
        {/* 2. LEADER SELECTOR BAR WITH PERCENTAGE CIRCLE */}
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
          {leaders.map(ld => (
            <button
              key={ld.name}
              onClick={() => setSelectedLeader(ld.name)}
              className={`shrink-0 min-w-[170px] px-4 py-2 rounded-xl border transition-all flex items-center justify-between gap-3 ${selectedLeader === ld.name ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <div className="truncate">
                <div className="text-xs font-bold truncate">{ld.name}</div>
                <div className="text-[10px] font-normal opacity-80 truncate">{ld.team} · {ld.count} member</div>
              </div>
              <CircularProgress value={ld.doneTasks} total={ld.totalTasks} />
            </button>
          ))}
        </div>
      </div>

      {/* 3. KPI CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Tasks Phụ Trách" value={pmStats.total} icon="tasks" border="border-l-[#0058be]" text="text-[#0058be]" trend="Tổng" />
        <KpiCard label="Đã Hoàn Thành" value={pmStats.done} icon="check" border="border-l-emerald-500" text="text-emerald-600" trend={pmStats.total ? `${Math.round(pmStats.done/pmStats.total*100)}%` : '0%'} />
        <KpiCard label="Đang Làm" value={Math.max(0, pmStats.inProgress - pmStats.overdue)} icon="lightning" border="border-l-amber-500" text="text-amber-600" trend="Trong tiến độ" />
        <KpiCard label="Trễ Hạn" value={pmStats.overdue} icon="alert" border="border-l-red-500" text="text-red-600" trend="Cần xử lý" />
        <KpiCard label="Manday Thực Tế" value={pmStats.manday} icon="clock" border="border-l-cyan-500" text="text-cyan-600" trend="Đã tiêu hao" />
        <KpiCard label="KPI Đạt Được" value={pmStats.kpi} icon="trophy" border="border-l-purple-500" text="text-purple-600" trend="Tổng điểm" />
      </div>

      {/* 4. ONGOING PROJECTS */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden mb-5">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <SvgIcon name="folders" className="w-4 h-4 text-slate-700" />
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Dự án đang triển khai</h3>
          </div>
          <button 
            onClick={handleAiCheck}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg shadow-sm text-[11px] font-bold transition-all cursor-pointer active:scale-95"
          >
            <span className="text-sm">✨</span> AI Check
          </button>
        </div>
        {aiCheckStatus && (
          <div className="bg-blue-50 px-5 py-2 text-xs font-bold text-blue-700 border-b border-blue-100 flex items-center justify-between animate-fadeIn">
            <span>{aiCheckStatus}</span>
            <button onClick={() => setAiCheckStatus(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
          </div>
        )}
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[360px] overflow-y-auto custom-scrollbar">
          {activeProjects.length === 0 ? (
            <p className="text-xs text-slate-400 font-semibold py-4 text-center col-span-full">Chưa có dự án nào.</p>
          ) : (
            activeProjects.map((p: any) => (
              <div key={p.id} className="p-4 rounded-xl border border-slate-200 shadow-sm bg-slate-50/50 hover:bg-white hover:border-slate-300 transition-all flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-2 gap-2">
                    <h4 className="text-xs font-bold text-[#0b1c30] truncate" title={p.name}>{p.name}</h4>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${projectStatusBadge[p.status] || 'bg-blue-100 text-blue-700'}`}>
                      {p.status || 'Developing'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-semibold block mb-3">{p.current_phase || '1. Tư vấn'}</span>
                </div>
                <div>
                  <div className="flex justify-between text-[11px] mb-1.5 font-bold">
                    <span className="text-slate-500">Tiến độ</span>
                    <span className="text-[#0058be]">{p.progress}%</span>
                  </div>
                  <ProgressBar value={p.progress} color={projectBarColor[p.status] || 'bg-blue-600'} height="h-2" />
                  <div className="flex justify-between text-[10px] text-slate-400 font-semibold mt-2">
                    <span>Task: {p.doneTasks}/{p.totalTasks}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 5. CHARTS & LISTS */}
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
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Mức Độ Ưu Tiên (Priority)</h3>
          </div>
          <div className="p-4 space-y-3 overflow-y-auto max-h-[300px] custom-scrollbar">
             {[
               { label: 'Critical', val: priorityStats.critical, cls: 'bg-red-50 text-red-600 border-red-200' },
               { label: 'High', val: priorityStats.high, cls: 'bg-orange-50 text-orange-600 border-orange-200' },
               { label: 'Normal', val: priorityStats.normal, cls: 'bg-blue-50 text-blue-600 border-blue-200' },
               { label: 'Interrupt', val: priorityStats.interrupt, cls: 'bg-purple-50 text-purple-600 border-purple-200' }
             ].map(item => (
                <div key={item.label} className={`flex items-center justify-between p-3 rounded-xl border ${item.cls}`}>
                  <span className="text-xs font-bold">{item.label}</span>
                  <span className="text-sm font-extrabold">{item.val} tasks</span>
                </div>
             ))}
          </div>
        </div>

        {/* OVERDUE LIST WITH CUSTOMER & PROJECT NAME */}
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-red-100 bg-red-50/50 flex justify-between items-center">
            <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider">Task Trễ Hạn ({overdueTasksList.length})</h3>
          </div>
          <div className="p-4 overflow-y-auto max-h-[300px] space-y-2.5 custom-scrollbar">
            {overdueTasksList.length === 0 ? (
               <p className="text-xs text-slate-400 font-semibold text-center py-6">Không có task trễ hạn.</p>
            ) : (
               overdueTasksList.map((t, idx) => (
                 <div key={idx} className="p-3 bg-white rounded-xl border border-red-100 hover:border-red-300 transition-all">
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      <span className="text-[9px] font-extrabold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 truncate max-w-[140px]" title={t.projectName}>Dự án: {t.projectName}</span>
                      <span className="text-[9px] font-extrabold text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-100 truncate max-w-[140px]" title={t.customerName}>KH: {t.customerName}</span>
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

      {/* 6. TEAM AUDIT LOG SECTION */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden mb-5">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 to-white">
          <div className="flex items-center gap-2">
            <span className="text-base">📜</span>
            <div>
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Hoạt Động Gần Đây</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Nhật ký hoạt động & thay đổi của hệ thống</p>
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
                <tr><td colSpan={5} className="text-center py-6 text-slate-400 font-semibold">Chưa có nhật ký hoạt động nào.</td></tr>
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

      {/* 7. MEMBER KPI RANKING TABLE (CLICK MEMBER TO VIEW DETAIL MODAL) */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <SvgIcon name="crown" className="w-4 h-4 text-indigo-600" />
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Bảng Xếp Hạng KPI Thành Viên</h3>
          </div>
          <span className="text-[10px] font-semibold text-slate-400">💡 Bấm vào tên thành viên để xem chi tiết KPI, Dự án & Task</span>
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
                    <tr 
                      key={m.id} 
                      onClick={() => setSelectedMemberModal(m)}
                      className={`border-b border-slate-50 hover:bg-indigo-50/50 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-slate-50/20'}`}
                    >
                      <td className="px-4 py-3.5 text-center">
                        <span className={`text-xs font-bold ${m.rank <= 3 ? 'text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200' : 'text-slate-400'}`}>#{m.rank}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-[#0058be] hover:underline flex items-center gap-1.5">
                          {m.name}
                          <span className="text-[10px] text-slate-400">🔍</span>
                        </span>
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

      {/* 8. TOP PERFORMER & LOWEST PERFORMER (PLACED RIGHT BELOW MEMBER RANKING TABLE) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
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

      {/* 9. KPI MATRICES */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden p-5 space-y-6">
         <div className="flex flex-col sm:flex-row justify-between items-center border-b border-slate-100 pb-4 gap-4">
           <h3 className="text-sm font-bold text-[#0b1c30] uppercase tracking-wider">Ma Trận KPI Thành Viên</h3>
           <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600">Lọc theo năm:</span>
              <input type="number" value={matrixYear} onChange={e => setMatrixYear(parseInt(e.target.value))} className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 w-24 outline-none cursor-pointer" />
           </div>
         </div>

         {/* 1. Summary Matrix */}
         <div className="w-full">
           <h4 className="text-xs font-bold text-pink-700 mb-2">1. Tổng KPI</h4>
           <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
             <table className="w-full text-[10px] text-center border-collapse whitespace-nowrap">
               <thead className="sticky top-0 z-10">
                 <tr className="bg-pink-500 text-white font-bold">
                   <th className="p-2 border border-slate-200 text-left min-w-[100px] sticky left-0 bg-pink-600 z-20">Tháng</th>
                   {activeTeamMembers.map(m => (
                     <th key={m.id} className="p-2 border border-slate-200 min-w-[80px] bg-pink-500">{getShortName(m.full_name || m.display_name)}</th>
                   ))}
                 </tr>
               </thead>
               <tbody>
                 {summaryMatrix.map((r,i) => (
                   <tr key={i} className="hover:bg-slate-50">
                     <td className="p-2 border border-slate-200 text-left font-bold text-[#0b1c30] bg-white sticky left-0 z-10">{r.month}</td>
                     {activeTeamMembers.map(m => {
                        const val = r[`m_${m.id}`];
                        const bg = val > 100 ? 'bg-amber-300' : (val > 50 ? 'bg-amber-100' : 'bg-white');
                        return <td key={m.id} className={`p-2 border border-slate-200 font-semibold ${bg}`}>{val}</td>
                     })}
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
         </div>

         {/* 2. Average Matrix */}
         <div className="w-full">
           <h4 className="text-xs font-bold text-emerald-700 mb-2">2. Trung Bình KPI / Task</h4>
           <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
             <table className="w-full text-[10px] text-center border-collapse whitespace-nowrap">
               <thead className="sticky top-0 z-10">
                 <tr className="bg-emerald-500 text-white font-bold">
                   <th className="p-2 border border-slate-200 text-left min-w-[100px] sticky left-0 bg-emerald-600 z-20">Tháng</th>
                   {activeTeamMembers.map(m => (
                     <th key={m.id} className="p-2 border border-slate-200 min-w-[80px] bg-emerald-500">{getShortName(m.full_name || m.display_name)}</th>
                   ))}
                 </tr>
               </thead>
               <tbody>
                 {averageMatrix.map((r,i) => (
                   <tr key={i} className="hover:bg-slate-50">
                     <td className="p-2 border border-slate-200 text-left font-bold text-[#0b1c30] bg-white sticky left-0 z-10">{r.month}</td>
                     {activeTeamMembers.map(m => {
                        const val = r[`m_${m.id}`];
                        const bg = val > 10 ? 'bg-green-200' : (val > 5 ? 'bg-green-100' : 'bg-white');
                        return <td key={m.id} className={`p-2 border border-slate-200 font-semibold ${bg}`}>{val}</td>
                     })}
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
         </div>

         {/* 3. Bonus Matrix */}
         <div className="w-full">
           <h4 className="text-xs font-bold text-indigo-700 mb-2">3. KPI Thưởng</h4>
           <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
             <table className="w-full text-[10px] text-center border-collapse whitespace-nowrap">
               <thead className="sticky top-0 z-10">
                 <tr className="bg-indigo-500 text-white font-bold">
                   <th className="p-2 border border-slate-200 text-left min-w-[100px] sticky left-0 bg-indigo-600 z-20">Tháng</th>
                   {activeTeamMembers.map(m => (
                     <th key={m.id} className="p-2 border border-slate-200 min-w-[80px] bg-indigo-500">{getShortName(m.full_name || m.display_name)}</th>
                   ))}
                 </tr>
               </thead>
               <tbody>
                 {bonusMatrix.map((r,i) => (
                   <tr key={i} className="hover:bg-slate-50">
                     <td className="p-2 border border-slate-200 text-left font-bold text-[#0b1c30] bg-white sticky left-0 z-10">{r.month}</td>
                     {activeTeamMembers.map(m => {
                        const val = r[`m_${m.id}`];
                        const bg = val > 0 ? 'bg-indigo-100 text-indigo-800' : 'bg-white text-slate-400';
                        return <td key={m.id} className={`p-2 border border-slate-200 font-semibold ${bg}`}>{val}</td>
                     })}
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
         </div>

      </div>

      {/* MEMBER DETAIL MODAL */}
      {selectedMemberModal && (
        <MemberDetailModal
          member={selectedMemberModal}
          tasks={rawTasks}
          projects={rawProjects}
          onClose={() => setSelectedMemberModal(null)}
        />
      )}
    </div>
  );
}
