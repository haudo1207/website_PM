'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { getEmail, getName, getToken } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import KpiCard from '@/components/dashboard/KpiCard';
import PieChartCard from '@/components/dashboard/PieChartCard';
import BarChartCard from '@/components/dashboard/BarChartCard';
import SvgIcon from '@/components/dashboard/Icons';
import { getKpiGiaoForMember } from '@/lib/kpiPotential';
import {
  priorityDot,
  statusStyle,
  activityColor,
  MONTH_WEEKS_COUNT,
  getWeekOfMonth,
  checkTaskInPeriod,
  isTaskDoneInPeriod,
  calculateDaysLate
} from '@/app/dashboard/constants';

// Real completed-KPI formula — reads the backend-computed kpi_assigned /
// kpi_support / kpi_final / kpi_base fields that `kpi_engine.py` only
// populates once a task reaches Done (verbatim copy of
// MemberDetailModal.tsx's `getTaskKpiForMember`, the source of truth Team
// Load / Overview's member drill-down uses). Report previously computed its
// "Điểm KPI" card by gating the STATUS-AGNOSTIC `getKpiGiaoForMember`
// potential formula (priority_kpi_base × manday_est) on isDone instead —
// that helper's own file header explicitly says it must NOT be used for HT
// ("this helper is ONLY for Giao... HT must continue to come from
// getTaskKpiForMember") — so Report's completed-KPI number could silently
// diverge from what a Leader sees for the same person in Team Load/Overview.
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

const formatVNDate = (dStr: string) => {
  if (!dStr) return '—';
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return dStr;
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
};

function getTaskMandayDisplay(t: any): number {
  const isDone = t.status === 'Done' || t.status === 'done';
  const v = isDone ? (t.manday_actual ?? t.manday_est ?? 0) : (t.manday_est ?? 0);
  return Math.round(Number(v || 0) * 10) / 10;
}

function getTaskStartDay(t: any): string {
  return t.start_date || t.created_at;
}

export default function ReportTab() {
  // ── Time-range filter (Requirement: default to "This Week" for ALL roles)
  // Seed the same shape as `applyQuickFilter('Tuần này')` so the page opens
  // already filtered to the current week (Mon→Sun). The "Tuần này" quick-filter
  // chip starts highlighted because `activeQuickFilter='Tuần này'`. `checkTaskInPeriod`
  // already understands both `selectedWeek` and the `Tuần này` shortcut, so every
  // Report consumer (chartStats, myRealTasks, filteredTasks, chartWeeklyProgress,
  // monthlyProgress, chartMonthlyProgress) computes against the same window
  // without a second filter mechanism.
  const initialNow = new Date();
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>('Tuần này');
  const router = useRouter();
  const [selectedYear, setSelectedYear] = useState<number | 'all'>(initialNow.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>(initialNow.getMonth() + 1);
  const [selectedWeek, setSelectedWeek] = useState<number | 'all'>(getWeekOfMonth(initialNow));

  const [searchTaskName, setSearchTaskName] = useState<string>('');
  const [filterCustomer, setFilterCustomer] = useState<string>('all');
  const [filterProject, setFilterProject] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const [sortDeadline, setSortDeadline] = useState<'default'|'asc'|'desc'>('default');
  const [sortKPI, setSortKPI] = useState<'default'|'desc'|'asc'>('default');
  const [openFilterDropdown, setOpenFilterDropdown] = useState<string | null>(null);

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

  const fetchReportData = useCallback(async () => {
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

    let memberApiUrl = `/api/members?_t=${ts}`;
    if (selectedMonth !== 'all' && typeof selectedMonth === 'number') {
      memberApiUrl += `&month=${selectedMonth}`;
    }
    if (selectedYear !== 'all' && typeof selectedYear === 'number') {
      memberApiUrl += `&year=${selectedYear}`;
    }

    const [userRes, membersRes, tasksRes] = await Promise.all([
      axios.get(`/api/users/me?_t=${ts}`, config).catch(() => ({ data: {} })),
      axios.get(memberApiUrl, config).catch(() => ({ data: [] })),
      axios.get(`/api/all-tasks-global?_t=${ts}`, config).catch(() => ({ data: [] })),
    ]);

    const currentUser = userRes.data || {};
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

    return {
      currentUserProfile: currentUser,
      realMemberData: matched,
      rawMyTasks: myTasks,
    };
  }, [selectedMonth, selectedYear]);

  const { data: reportData, isFetching: loadingReal, refetch: refetchReport } = useQuery({
    queryKey: ['dashboard-report', selectedMonth, selectedYear],
    queryFn: fetchReportData,
    staleTime: 2 * 60_000,
  });

  const currentUserProfile = reportData?.currentUserProfile ?? null;
  const realMemberData = reportData?.realMemberData ?? null;
  const rawMyTasksAll: any[] = reportData?.rawMyTasks || [];

  // Chính/Phụ Workspace tabs — labeled by the actual Workspace name (never
  // the literal words "Chính"/"Phụ"), Workspace chính first then each Phụ
  // one after. super_admin has no home Workspace, so no tabs for them.
  const myWorkspaces: { code: string; name: string; is_primary: boolean }[] = currentUserProfile?.workspaces || [];
  const [reportWsCode, setReportWsCode] = useState<string | null>(null);
  const primaryWs = myWorkspaces.find((w) => w.is_primary) || myWorkspaces[0] || null;
  const activeReportWsCode = currentUserProfile?.role === 'super_admin'
    ? null
    : (reportWsCode || primaryWs?.code || null);
  // A task whose project belongs to none of my granted Workspaces (Chính or
  // any Phụ) has no tab of its own here — it only reached `rawMyTasksAll`
  // because I'm explicitly assigned to it (project_members), same
  // membership-overrides-Workspace escape hatch already applied on the
  // Project page (ProjectListContent.tsx's `isAssignedToMe`, projects.py's
  // `assigned_project_ids`). Without this, such a task would silently
  // disappear from every Report tab even though it still shows up as one of
  // "my projects" on the Project page.
  const myWorkspaceCodes = useMemo(
    () => new Set(myWorkspaces.map((w) => w.code.toLowerCase())),
    [myWorkspaces]
  );
  const rawMyTasks: any[] = activeReportWsCode
    ? rawMyTasksAll.filter((t: any) => {
        const scope = (t.projectDataScope || '').toLowerCase();
        return scope === activeReportWsCode || !myWorkspaceCodes.has(scope);
      })
    : rawMyTasksAll;

  const getMyTaskManday = useCallback((t: any) => {
    const isDone = t.status === 'Done' || t.status === 'done';
    if (!isDone) return 0;
    return (t.manday_actual || t.manday_est || 0);
  }, []);

  // Returns the status-agnostic KPI Giao share for the current user on `t`.
  // Replaces the previous Done-only implementation so in-progress / overdue /
  // waiting tasks are included on the "KPI được giao" side of the report.
  //
  // Display-name fallback is preserved for legacy rows that arrive without
  // `assigned_id` / `support_id` set (the task serializer falls back to
  // matching by name in those cases). The HT side is unaffected — see
  // `getMyTaskKpi` below which still gates on Done.
  const getTaskKpiWeighted = useCallback((t: any) => {
    const memberId = realMemberData?.id;
    if (memberId == null) return 0;

    const matchesById =
      (t.assigned_id != null && String(t.assigned_id) === String(memberId)) ||
      (t.support_id != null && String(t.support_id) === String(memberId));
    if (matchesById) return getKpiGiaoForMember(t, memberId);

    // Display-name fallback for legacy rows where `assigned_id`/`support_id`
    // are not populated on the task payload but the assignee name is.
    const memberDisplayName = (realMemberData?.display_name || '').toLowerCase().trim();
    const memberFullName = (realMemberData?.full_name || '').toLowerCase().trim();
    const assignNameLow = (t.assigned_name || '').toLowerCase().trim();
    const suppNameLow = (t.support_name || '').toLowerCase().trim();
    const nameIsAssigned =
      (memberDisplayName && assignNameLow === memberDisplayName) ||
      (memberFullName && assignNameLow === memberFullName);
    const nameIsSupport =
      (memberDisplayName && suppNameLow === memberDisplayName) ||
      (memberFullName && suppNameLow === memberFullName);
    if (!nameIsAssigned && !nameIsSupport) return 0;

    // Synthesize a memberId-style view that the helper can consume: copy the
    // task and override the id fields with the real member's id so the
    // helper's Assignee/Support split applies correctly.
    const fake = { ...t, assigned_id: nameIsAssigned ? memberId : t.assigned_id, support_id: nameIsSupport ? memberId : t.support_id };
    return getKpiGiaoForMember(fake, memberId);
  }, [realMemberData]);

  // Completed KPI ("HT") — MUST use the real getTaskKpiForMember formula
  // (backend kpi_assigned/kpi_support/kpi_final), never getTaskKpiWeighted
  // (that one is the status-agnostic Giao/potential estimate — see the
  // getKpiGiaoForMember file header). Using the estimate here was the bug:
  // it made Report's own "Điểm KPI" diverge from what Team Load/Overview's
  // member drill-down (MemberDetailModal) shows for the exact same person.
  const getMyTaskKpi = useCallback((t: any) => {
    return getTaskKpiForMember(t, realMemberData?.id);
  }, [realMemberData]);

  const { chartStats, chartWeeklyProgress, chartMonthlyProgress } = useMemo(() => {
    let dCount = 0, iCount = 0, oCount = 0;

    // Was a second, hand-rolled period filter independent from
    // `checkTaskInPeriod` below (different window logic — no OR-fallback,
    // no overdue-relative-to-period-end rule) — the pie/bar charts here
    // could disagree with the KPI cards and tables further down the SAME
    // page for the SAME filter selection. Now shares the one filter used
    // everywhere else on this page.
    const cTasks = rawMyTasks.filter((t: any) =>
      checkTaskInPeriod(t, selectedYear, selectedMonth, selectedWeek, activeQuickFilter)
    );

    cTasks.forEach((t: any) => {
      const isDone = t.status === 'Done' || t.status === 'done';
      const isCancel = t.status === 'Cancel' || t.status === 'cancel';
      const daysLateNum = calculateDaysLate(t);
      const isOverdue = daysLateNum > 0;
      if (isDone) { dCount++; }
      else if (!isCancel) { iCount++; if (isOverdue) oCount++; }
    });

    // HT/KPI is summed over the STRICT isTaskDoneInPeriod set (end_date_actual
    // falls inside the period), not over `cTasks` (lenient planned-window
    // overlap) — same "count once, into the period it actually finished"
    // rule MemberDetailModal's localKpi uses, so this can't drift from what
    // a Leader sees for this same person in Team Load/Overview.
    const doneInPeriod = rawMyTasks.filter((t: any) =>
      isTaskDoneInPeriod(t, selectedYear, selectedMonth, selectedWeek, activeQuickFilter)
    );
    const cKpi = doneInPeriod.reduce((acc: number, t: any) => acc + getMyTaskKpi(t), 0);

    const targetMonth = selectedMonth !== 'all' ? selectedMonth : (new Date().getMonth() + 1);
    const numWeeks = typeof targetMonth === 'number' && MONTH_WEEKS_COUNT[targetMonth] ? MONTH_WEEKS_COUNT[targetMonth] : 5;

    const wProgress = Array.from({ length: numWeeks }, (_, idx) => {
      const wNum = idx + 1;
      const wTasks = cTasks.filter((t: any) => {
        if (!t.end_date_est) return false;
        const d = new Date(t.end_date_est);
        return !isNaN(d.getTime()) && getWeekOfMonth(d) === wNum;
      });
      const wDoneInPeriod = doneInPeriod.filter((t: any) => {
        if (!t.end_date_actual) return false;
        const d = new Date(t.end_date_actual);
        return !isNaN(d.getTime()) && getWeekOfMonth(d) === wNum;
      });
      const wKpi = wDoneInPeriod.reduce((acc: number, t: any) => acc + getMyTaskKpi(t), 0);
      return {
        name: `Tuần ${wNum}`,
        kpi: Math.round(wKpi),
        tasks: wTasks.length
      };
    });

    return {
      chartStats: { done: dCount, inProgress: iCount, overdue: oCount },
      chartWeeklyProgress: wProgress,
      chartMonthlyProgress: [{ name: selectedMonth !== 'all' ? `Tháng ${selectedMonth}` : 'Tất cả', kpi: Math.round(cKpi), tasks: cTasks.length }]
    };
  }, [rawMyTasks, selectedYear, selectedMonth, selectedWeek, activeQuickFilter, getMyTaskKpi]);

  // Derived state based on filters
  const {
    myRealTasks,
    realUpcomingDeadlines,
    realOverdueTasks,
    realTaskStats,
    filteredActivities,
    weeklyProgress,
    monthlyProgress,
    topRealProjects
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

    const filteredTasks = rawMyTasks.filter(t => checkTaskInPeriod(t, selectedYear, selectedMonth, selectedWeek, activeQuickFilter));
    // Strict "count once, into the period it actually finished" set for
    // HT/KPI sums — see the chartStats useMemo above for the full rationale.
    const doneInPeriodTasks = rawMyTasks.filter(t => isTaskDoneInPeriod(t, selectedYear, selectedMonth, selectedWeek, activeQuickFilter));
    doneInPeriodTasks.forEach((t: any) => { dynamicKpi += getMyTaskKpi(t); });

    filteredTasks.forEach((t: any) => {
      mandayTotal += getMyTaskManday(t);

      const isDone = t.status === 'Done' || t.status === 'done';
      const isCancel = t.status === 'Cancel' || t.status === 'cancel';
      const daysLateNum = calculateDaysLate(t);

      const isOverdue = daysLateNum > 0;

      if (isDone) {
        doneCount++;
        acts.push({ action: `Hoàn thành: ${t.name}`, time: 'Đã hoàn thành', type: 'done' });
      } else if (isCancel) {
        acts.push({ action: `Đã hủy: ${t.name}`, time: 'Hủy tác vụ', type: 'cancel' });
      } else {
        inProgressCount++;
        if (isOverdue) {
          overdueCount++;
          overdueList.push({
            id: t.id,
            project: t.projectName || t.project_name || 'Chưa rõ',
            customer: t.customerName || t.customer_name || 'Chưa rõ',
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
              id: t.id, project: t.projectName || 'Chưa rõ', name: t.name, deadline: t.end_date_est, daysLeft: diffDays
            });
          }
        }
      }
    });

    const myProjectsMap = new Map();
    filteredTasks.forEach(t => {
      const pName = t.projectName || 'Không có';
      const cName = t.customerName || t.customer_name || 'Không có';
      if (!myProjectsMap.has(pName)) {
        myProjectsMap.set(pName, { id: t.project_id, name: pName, customerName: cName, tasks: 0, done: 0, kpi: 0, kpiTarget: 0, mandayActual: 0, mandayPlanned: 0 });
      }
      const p = myProjectsMap.get(pName);
      p.tasks++;
      p.mandayPlanned += Number(t.manday_est || 0);
      p.kpiTarget += getTaskKpiWeighted(t);
      if (t.status === 'Done' || t.status === 'done') {
        p.done++;
        p.mandayActual += getMyTaskManday(t);
      }
    });
    // HT/KPI per project — summed over the strict `doneInPeriodTasks` set
    // above, not the lenient Done rows in `filteredTasks`, for the same
    // reason as `dynamicKpi`. Creates the project entry too, in case none
    // of that project's other tasks fell into this period's lenient window.
    doneInPeriodTasks.forEach((t: any) => {
      const pName = t.projectName || 'Không có';
      const cName = t.customerName || t.customer_name || 'Không có';
      if (!myProjectsMap.has(pName)) {
        myProjectsMap.set(pName, { id: t.project_id, name: pName, customerName: cName, tasks: 0, done: 0, kpi: 0, kpiTarget: 0, mandayActual: 0, mandayPlanned: 0 });
      }
      myProjectsMap.get(pName).kpi += getMyTaskKpi(t);
    });
    const topProjects = Array.from(myProjectsMap.values())
      .sort((a, b) => b.kpi - a.kpi)
      .map(p => ({
        ...p,
        kpi: Math.round(p.kpi * 10) / 10,
        kpiTarget: Math.round(p.kpiTarget * 10) / 10,
        mandayActual: Math.round(p.mandayActual * 10) / 10,
        mandayPlanned: Math.round(p.mandayPlanned * 10) / 10,
        // Issue 3 — Project Progress from Settings → Master Phases (single
        // source of truth). Task-completion percentage is preserved as
        // `taskCompletionPct` for surfaces that intentionally show it.
        progress: typeof p.progress_pct === 'number' ? Math.round(p.progress_pct) : (p.tasks > 0 ? Math.round((p.done / p.tasks) * 100) : 0),
        taskCompletionPct: p.tasks > 0 ? Math.round((p.done / p.tasks) * 100) : 0,
      }));

    const mandayPlannedTotal = Math.round(topProjects.reduce((s, p) => s + p.mandayPlanned, 0) * 10) / 10;
    const kpiTargetTotal = Math.round(topProjects.reduce((s, p) => s + p.kpiTarget, 0) * 10) / 10;
    const avgProgress = topProjects.length ? Math.round(topProjects.reduce((s, p) => s + p.progress, 0) / topProjects.length) : 0;

    // Was: fall back to `realMemberData.kpi_total`/`manday_total` from
    // `/api/members` whenever present. Dropped entirely — verified live
    // against the dev DB that this is unsafe: backend's SQL there is a
    // bare `SUM(Task.kpi_assigned)` / `SUM(Task.kpi_support)` with NO
    // fallback to `kpi_base` (unlike `getTaskKpiForMember` above, and
    // unlike MemberDetailModal, which NEVER uses this fallback — it always
    // recomputes locally). Confirmed member 306's real Done tasks all have
    // kpi_assigned/kpi_support/kpi_final = NULL (kpi_base populated
    // instead), so that endpoint's kpi_total resolves to 0 for them while
    // the correct, kpi_base-aware total is nonzero — i.e. the fallback
    // could silently show "0" on the headline card even with real
    // completed work. Always using the local recompute matches
    // MemberDetailModal exactly and removes this whole failure mode.
    const finalManday = Math.round(mandayTotal * 10) / 10;
    const finalKpi = Math.round(dynamicKpi * 10) / 10;

    const stats = {
      total: filteredTasks.length,
      done: doneCount,
      inProgress: inProgressCount,
      mandayPlanned: mandayPlannedTotal,
      kpiTarget: kpiTargetTotal,
      avgProgress,
      overdue: overdueCount,
      manday: finalManday,
      kpi: finalKpi
    };

    const kpiPoints = dynamicKpi;

    const wProg = [
      { name: 'Tuần 1', kpi: Math.round(kpiPoints * 0.25), tasks: Math.ceil(doneCount * 0.25) },
      { name: 'Tuần 2', kpi: Math.round(kpiPoints * 0.5), tasks: Math.ceil(doneCount * 0.5) },
      { name: 'Tuần 3', kpi: Math.round(kpiPoints * 0.75), tasks: Math.ceil(doneCount * 0.75) },
      { name: 'Tuần 4', kpi: Math.round(kpiPoints), tasks: filteredTasks.length },
    ];
    
    const mProg = [{ name: selectedMonth !== 'all' ? `Tháng ${selectedMonth}` : 'Tất cả', kpi: Math.round(kpiPoints), tasks: filteredTasks.length }];

    return {
      myRealTasks: filteredTasks,
      realUpcomingDeadlines: upcoming,
      realOverdueTasks: overdueList,
      realTaskStats: stats,
      filteredActivities: acts.slice(0, 5),
      weeklyProgress: wProg,
      monthlyProgress: mProg,
      topRealProjects: topProjects
    };
  }, [rawMyTasks, selectedYear, selectedMonth, selectedWeek, activeQuickFilter, realMemberData, getMyTaskManday, getMyTaskKpi, getTaskKpiWeighted]);

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
      {/* HEADER & TIME FILTER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Báo cáo hiệu suất cá nhân</h3>
          {loadingReal && <span className="text-[10px] text-blue-600 font-semibold animate-pulse">Đang cập nhật...</span>}
          {myWorkspaces.length > 1 && currentUserProfile?.role !== 'super_admin' && (
            // Workspace chính first, then each Phụ one — labeled by the
            // actual Workspace name only (never the words "Chính"/"Phụ").
            // Switches which Workspace's tasks the whole report below shows.
            <div className="flex items-center gap-1">
              {myWorkspaces.map((w) => (
                <button
                  key={w.code}
                  onClick={() => setReportWsCode(w.code)}
                  className={`px-2.5 py-1 rounded-full text-[10.5px] font-bold transition-colors ${
                    activeReportWsCode === w.code ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:border-indigo-300'
                  }`}
                >
                  {w.is_primary && '🏠 '}{w.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
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

          {/* SHORTCUT FILTER BUTTONS FOR REPORT */}
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
            onClick={() => refetchReport()}
            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm text-[11px] font-bold transition-all active:scale-95 cursor-pointer"
          >
            <SvgIcon name="refresh" className={`w-3.5 h-3.5 ${loadingReal ? 'animate-spin text-[#0058be]' : 'text-slate-500'}`} />
            LÀM MỚI
          </button>
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {reportKpiCards.map(c => <KpiCard key={c.label} {...c} />)}
      </div>

      {/* CHARTS CONTAINER */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PieChartCard title="Trạng thái Task" data={[
          { name: 'Hoàn Thành', value: chartStats.done, fill: '#10b981' },
          { name: 'Đang Làm', value: chartStats.inProgress, fill: '#f59e0b' },
          { name: 'Trễ Hạn', value: chartStats.overdue, fill: '#ef4444' }
        ]} />
        
        <div className="relative">
          <BarChartCard
            title={selectedMonth !== 'all' ? `Tiến độ KPI tháng ${selectedMonth}` : "Tiến độ KPI theo tuần"}
            data={chartWeeklyProgress}
            bars={[
              { key: 'kpi',   name: 'Điểm KPI',  fill: '#6366f1' },
              { key: 'tasks', name: 'Số Task', fill: '#10b981' },
            ]}
            xKey="name"
          />
        </div>
      </div>

      {/* DỰ ÁN CỦA TÔI (MY PROJECTS TABLE) */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <SvgIcon name="folders" className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Dự Án Của Tôi</h3>
          </div>
          <span className="text-[10px] font-bold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-100">{topRealProjects.length} dự án</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-slate-100 bg-slate-50/50">
          <div className="p-4 border-r border-slate-100 last:border-r-0">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Tổng Task</span>
            <strong className="block text-base font-extrabold text-[#0b1c30] mt-1.5">{realTaskStats.done} / {realTaskStats.total}</strong>
            <span className="block text-[10px] text-slate-400 mt-1">Hoàn thành / Tổng task được giao</span>
          </div>
          <div className="p-4 border-r border-slate-100 last:border-r-0">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Tổng Manday</span>
            <strong className="block text-base font-extrabold text-[#0b1c30] mt-1.5">{realTaskStats.manday} / {realTaskStats.mandayPlanned} MD</strong>
            <span className="block text-[10px] text-slate-400 mt-1">Actual / Planned</span>
          </div>
          <div className="p-4 border-r border-slate-100 last:border-r-0">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Tổng KPI</span>
            <strong className="block text-base font-extrabold text-[#0b1c30] mt-1.5">{realTaskStats.kpi} / {realTaskStats.kpiTarget}</strong>
            <span className="block text-[10px] text-slate-400 mt-1">KPI hoàn thành / KPI được giao</span>
          </div>
          <div className="p-4 border-r border-slate-100 last:border-r-0">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Tiến Độ Cá Nhân</span>
            <strong className="block text-base font-extrabold text-[#0b1c30] mt-1.5">{realTaskStats.avgProgress}%</strong>
            <span className="block text-[10px] text-slate-400 mt-1">Trung bình tiến độ theo project assignment</span>
          </div>
        </div>
        <div className="overflow-x-auto overflow-y-auto max-h-[400px] custom-scrollbar">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50/80 text-slate-400 border-b border-slate-100 uppercase text-[10px] tracking-wider">
                <th className="px-4 py-3 font-bold w-12 text-center">STT</th>
                <th className="px-4 py-3 font-bold">Tên Dự Án</th>
                <th className="px-4 py-3 font-bold">Khách Hàng</th>
                <th className="px-4 py-3 font-bold text-center">Task HT / Tổng</th>
                <th className="px-4 py-3 font-bold text-center">Manday HT / Giao</th>
                <th className="px-4 py-3 font-bold text-center text-[#0058be]">KPI HT / Giao</th>
                <th className="px-4 py-3 font-bold min-w-[120px]">Tiến Độ Của Tôi</th>
              </tr>
            </thead>
            <tbody>
              {topRealProjects.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-slate-400 font-semibold">Chưa tham gia dự án nào.</td></tr>
              ) : (
                topRealProjects.map((p, idx) => (
                  <tr
                    key={p.name}
                    onClick={() => { if (p.id) router.push(`/project/detail?id=${p.id}`); }}
                    className="border-b border-slate-50 hover:bg-slate-50/80 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center min-w-[30px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-black">#{idx + 1}</span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#0b1c30]">{p.name}</td>
                    <td className="px-4 py-3 text-slate-500 font-semibold">{p.customerName || 'Không có'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center min-w-[64px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-extrabold text-[#18304d]">{p.done}/{p.tasks}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center min-w-[80px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-extrabold text-amber-600 whitespace-nowrap">{p.mandayActual}/{p.mandayPlanned}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center min-w-[80px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-extrabold text-[#0058be] whitespace-nowrap">{p.kpi}/{p.kpiTarget}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden flex items-center">
                        <div className={`h-full rounded-full ${p.progress >= 80 ? 'bg-emerald-500' : p.progress >= 50 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${p.progress}%` }} />
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 mt-1 block">{p.progress}%</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TASK CỦA TÔI TABLE */}
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
            <thead className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur shadow-sm">
              <tr className="text-slate-500 border-b border-slate-200 text-[10px] tracking-wider">
                <th className="px-4 py-2.5 min-w-[180px] w-[250px] max-w-[280px] align-top bg-slate-100 sticky left-0 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                  <input 
                    type="text" 
                    placeholder="TÊN TASK (TÌM...)" 
                    value={searchTaskName} 
                    onChange={e => setSearchTaskName(e.target.value)} 
                    className="w-full text-xs font-bold uppercase bg-transparent border-none outline-none text-[#0058be] placeholder:text-slate-500 focus:placeholder:text-slate-300" 
                  />
                </th>
                <th 
                  className="px-4 py-2.5 align-top bg-slate-100 relative group cursor-pointer hover:bg-slate-200/50 transition-colors w-[15%] min-w-[120px]"
                  onMouseLeave={() => setOpenFilterDropdown(null)}
                >
                  <div 
                    className="flex flex-col gap-0.5 h-full w-full"
                    onClick={() => setOpenFilterDropdown(openFilterDropdown === 'customer' ? null : 'customer')}
                  >
                    <div className="flex items-center justify-start gap-1.5">
                      <span className={`font-bold uppercase tracking-wider ${filterCustomer !== 'all' ? 'text-[#0058be]' : 'text-[#2e3b52]'}`}>Khách Hàng</span>
                      <SvgIcon name="filter" className={`w-3.5 h-3.5 shrink-0 transition-colors ${filterCustomer !== 'all' ? 'text-[#0058be]' : 'text-slate-500 group-hover:text-slate-700'}`} />
                    </div>
                    {filterCustomer !== 'all' && <span className="text-[10px] font-bold text-[#0058be] truncate max-w-[120px] text-left">{filterCustomer}</span>}
                  </div>
                  
                  {openFilterDropdown === 'customer' && (
                    <div className="absolute top-full left-0 mt-0 min-w-[140px] bg-white border border-slate-200 shadow-lg rounded-b-md z-50 py-1 text-left">
                      <div 
                        className={`px-4 py-2 text-[13px] font-bold cursor-pointer hover:bg-slate-50 ${filterCustomer === 'all' ? 'text-[#0058be] bg-[#f8fafc]' : 'text-[#475569]'}`}
                        onClick={(e) => { e.stopPropagation(); setFilterCustomer('all'); setOpenFilterDropdown(null); }}
                      >
                        All
                      </div>
                      {uniqueCustomers.map((c: any) => (
                        <div 
                          key={c} 
                          className={`px-4 py-2 text-[13px] font-bold cursor-pointer hover:bg-slate-50 ${filterCustomer === c ? 'text-[#0058be] bg-[#f8fafc]' : 'text-[#475569]'}`}
                          onClick={(e) => { e.stopPropagation(); setFilterCustomer(c); setOpenFilterDropdown(null); }}
                        >
                          {c}
                        </div>
                      ))}
                    </div>
                  )}
                </th>
                <th 
                  className="px-4 py-2.5 align-top bg-slate-100 relative group cursor-pointer hover:bg-slate-200/50 transition-colors w-[15%] min-w-[120px]"
                  onMouseLeave={() => setOpenFilterDropdown(null)}
                >
                  <div 
                    className="flex flex-col gap-0.5 h-full w-full"
                    onClick={() => setOpenFilterDropdown(openFilterDropdown === 'project' ? null : 'project')}
                  >
                    <div className="flex items-center justify-start gap-1.5">
                      <span className={`font-bold uppercase tracking-wider ${filterProject !== 'all' ? 'text-[#0058be]' : 'text-[#2e3b52]'}`}>Dự Án</span>
                      <SvgIcon name="filter" className={`w-3.5 h-3.5 shrink-0 transition-colors ${filterProject !== 'all' ? 'text-[#0058be]' : 'text-slate-500 group-hover:text-slate-700'}`} />
                    </div>
                    {filterProject !== 'all' && <span className="text-[10px] font-bold text-[#0058be] truncate max-w-[120px] text-left">{filterProject}</span>}
                  </div>

                  {openFilterDropdown === 'project' && (
                    <div className="absolute top-full left-0 mt-0 min-w-[160px] bg-white border border-slate-200 shadow-lg rounded-b-md z-50 py-1 text-left">
                      <div 
                        className={`px-4 py-2 text-[13px] font-bold cursor-pointer hover:bg-slate-50 ${filterProject === 'all' ? 'text-[#0058be] bg-[#f8fafc]' : 'text-[#475569]'}`}
                        onClick={(e) => { e.stopPropagation(); setFilterProject('all'); setOpenFilterDropdown(null); }}
                      >
                        All
                      </div>
                      {uniqueProjects.map((p: any) => (
                        <div 
                          key={p} 
                          className={`px-4 py-2 text-[13px] font-bold cursor-pointer hover:bg-slate-50 ${filterProject === p ? 'text-[#0058be] bg-[#f8fafc]' : 'text-[#475569]'}`}
                          onClick={(e) => { e.stopPropagation(); setFilterProject(p); setOpenFilterDropdown(null); }}
                        >
                          {p}
                        </div>
                      ))}
                    </div>
                  )}
                </th>
                <th 
                  className="px-4 py-2.5 align-top w-[140px] bg-slate-100 relative group cursor-pointer hover:bg-slate-200/50 transition-colors"
                  onMouseLeave={() => setOpenFilterDropdown(null)}
                >
                  <div 
                    className="flex flex-col gap-0.5 h-full w-full"
                    onClick={() => setOpenFilterDropdown(openFilterDropdown === 'priority' ? null : 'priority')}
                  >
                    <div className="flex items-center justify-center gap-1.5 text-center">
                      <span className={`font-bold uppercase tracking-wider whitespace-nowrap ${filterPriority !== 'all' ? 'text-[#0058be]' : 'text-[#2e3b52]'}`}>Priority</span>
                      <SvgIcon name="filter" className={`w-3.5 h-3.5 shrink-0 transition-colors ${filterPriority !== 'all' ? 'text-[#0058be]' : 'text-slate-500 group-hover:text-slate-700'}`} />
                    </div>
                    {filterPriority !== 'all' && <span className="text-[10px] font-bold text-[#0058be] truncate max-w-[100px] text-center mx-auto">{filterPriority}</span>}
                  </div>

                  {openFilterDropdown === 'priority' && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-0 w-[140px] bg-white border border-slate-200 shadow-lg rounded-b-md z-50 py-1 text-left">
                      <div 
                        className={`px-4 py-2 text-[13px] font-bold cursor-pointer hover:bg-slate-50 ${filterPriority === 'all' ? 'text-[#0058be] bg-[#f8fafc]' : 'text-[#475569]'}`}
                        onClick={(e) => { e.stopPropagation(); setFilterPriority('all'); setOpenFilterDropdown(null); }}
                      >
                        All
                      </div>
                      {uniquePriorities.map((p: any) => (
                        <div 
                          key={p} 
                          className={`px-4 py-2 text-[13px] font-bold cursor-pointer hover:bg-slate-50 ${filterPriority === p ? 'text-[#0058be] bg-[#f8fafc]' : 'text-[#475569]'}`}
                          onClick={(e) => { e.stopPropagation(); setFilterPriority(p); setOpenFilterDropdown(null); }}
                        >
                          {p}
                        </div>
                      ))}
                    </div>
                  )}
                </th>
                <th 
                  className="px-4 py-2.5 align-top w-[140px] bg-slate-100 relative group cursor-pointer hover:bg-slate-200/50 transition-colors"
                  onMouseLeave={() => setOpenFilterDropdown(null)}
                >
                  <div 
                    className="flex flex-col gap-0.5 h-full w-full"
                    onClick={() => setOpenFilterDropdown(openFilterDropdown === 'status' ? null : 'status')}
                  >
                    <div className="flex items-center justify-center gap-1.5 text-center">
                      <span className={`font-bold uppercase tracking-wider whitespace-nowrap ${filterStatus !== 'all' ? 'text-[#0058be]' : 'text-[#2e3b52]'}`}>Trạng Thái</span>
                      <SvgIcon name="filter" className={`w-3.5 h-3.5 shrink-0 transition-colors ${filterStatus !== 'all' ? 'text-[#0058be]' : 'text-slate-500 group-hover:text-slate-700'}`} />
                    </div>
                    {filterStatus !== 'all' && <span className="text-[10px] font-bold text-[#0058be] truncate max-w-[100px] text-center mx-auto">{filterStatus}</span>}
                  </div>

                  {openFilterDropdown === 'status' && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-0 w-[140px] bg-white border border-slate-200 shadow-lg rounded-b-md z-50 py-1 text-left">
                      <div 
                        className={`px-4 py-2 text-[13px] font-bold cursor-pointer hover:bg-slate-50 ${filterStatus === 'all' ? 'text-[#0058be] bg-[#f8fafc]' : 'text-[#475569]'}`}
                        onClick={(e) => { e.stopPropagation(); setFilterStatus('all'); setOpenFilterDropdown(null); }}
                      >
                        All
                      </div>
                      {uniqueStatuses.map((s: any) => (
                        <div 
                          key={s} 
                          className={`px-4 py-2 text-[13px] font-bold cursor-pointer hover:bg-slate-50 ${filterStatus === s ? 'text-[#0058be] bg-[#f8fafc]' : 'text-[#475569]'}`}
                          onClick={(e) => { e.stopPropagation(); setFilterStatus(s); setOpenFilterDropdown(null); }}
                        >
                          {s}
                        </div>
                      ))}
                    </div>
                  )}
                </th>
                <th className="px-4 py-2.5 align-top text-center w-[90px] bg-slate-100">
                  <span className="font-bold uppercase tracking-wider text-[#2e3b52] whitespace-nowrap">Manday</span>
                </th>
                <th className="px-4 py-2.5 align-top text-center w-[100px] bg-slate-100">
                  <span className="font-bold uppercase tracking-wider text-[#2e3b52] whitespace-nowrap">Start Day</span>
                </th>
                <th className="px-4 py-2.5 align-top text-center w-[140px] bg-slate-100 hover:bg-slate-200/50 transition-colors">
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
                <th className="px-4 py-2.5 align-top text-center w-[110px] bg-slate-100 hover:bg-slate-200/50 transition-colors">
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
                  <td colSpan={9} className="text-center py-6 text-slate-400 font-semibold">Chưa có task nào phù hợp bộ lọc.</td>
                </tr>
              ) : (
                tableTasks.map((t: any, i: number) => (
                  <tr 
                    key={t.id} 
                    onClick={() => { if (t.project_id) router.push(`/project/detail?id=${t.project_id}`); }}
                    className={`border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}
                  >
                    <td className={`px-4 py-3 font-semibold text-[#0b1c30] whitespace-normal break-words max-w-[250px] sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/95'}`}>
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
                    <td className="px-4 py-3 text-center text-cyan-600 font-bold tabular-nums">{getTaskMandayDisplay(t)}</td>
                    <td className="px-4 py-3 text-center text-slate-500 tabular-nums">{formatVNDate(getTaskStartDay(t))}</td>
                    <td className="px-4 py-3 text-center text-slate-500 tabular-nums">{formatVNDate(t.end_date_est)}</td>
                    <td className="px-4 py-3 text-center font-extrabold text-[#0058be]">
                      {(t.status === 'Done' || t.status === 'done') ? getMyTaskKpi(t) : <span className="text-slate-300 font-semibold">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DEADLINE GẦN & HOẠT ĐỘNG GẦN ĐÂY & TASK TRỄ HẠN */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-amber-50/40 to-white">
            <div className="flex items-center gap-2">
              <SvgIcon name="clock" className="w-4 h-4 text-amber-600" />
              <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Deadline Gần (≤ 3 ngày)</h3>
            </div>
            <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-100">{realUpcomingDeadlines.length}</span>
          </div>
          <div className="p-4 space-y-3 overflow-y-auto max-h-[300px] custom-scrollbar">
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
          <div className="p-4 space-y-2.5 overflow-y-auto max-h-[300px] custom-scrollbar">
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
          <div className="p-4 space-y-3 overflow-y-auto max-h-[300px] custom-scrollbar">
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
