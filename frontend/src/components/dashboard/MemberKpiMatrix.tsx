'use client';

// Member KPI Matrix — extracted verbatim from the former "Ma Trận KPI Thành
// Viên" block in Overview. Logic, formulas, colors, filters, and data scope
// behavior are intentionally identical to the original implementation:
//   * Super Admin sees the full Leader set (subject to the workspace switcher
//     in the Navbar).
//   * Leader sees only their own team (filtered by `leader_name` matching the
//     signed-in leader's display_name — the same scoping mechanism Overview
//     already uses).
//   * Member and Viewer are blocked from this component by the Dashboard
//     layout (the "KPI Matrix" tab itself is gated to Super Admin + Leader).
//
// The component is self-contained: it fetches the same data Overview used
// and runs the same computation pipeline, so it can be mounted on its own
// tab without dragging in the rest of Overview.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { getToken, getRole } from '@/lib/auth';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';
import { MONTH_WEEKS_COUNT, CYCLE_TEMPLATE } from '@/app/dashboard/constants';

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

const getTaskKpiForMember = (t: any, memberId: any) => {
  const isDone = t.status === 'Done' || t.status === 'done';
  if (!isDone) return 0;
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

const isSameId = (a: any, b: any) => a != null && b != null && String(a) === String(b);
const isIdInList = (idList: any[], targetId: any) => targetId != null && idList.some((id) => String(id) === String(targetId));

export default function MemberKpiMatrix() {
  const [matrixYear, setMatrixYear] = useState<number>(new Date().getFullYear());
  const [selectedLeader, setSelectedLeader] = useState<string>('all');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('all');
  const [selectedWorkspaceCode, setSelectedWorkspaceCode] = useState<string>('');

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

  const { workspaceCode } = useWorkspaceFilter();

  const fetchMatrixData = async () => {
    const ts = Date.now();
    const token = getToken();
    const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

    const memberApiUrl = `/api/members?_t=${ts}&scope=true`;
    const projApiUrl = `/api/projects?_t=${ts}`;
    const tasksApiUrl = `/api/all-tasks-global?_t=${ts}`;
    const wsLeadersUrl = `/api/members/workspace-leaders?_t=${ts}`;

    const [membersRes, projRes, tasksRes, leadersRes, leadersScopeRes, meRes, workspaceRolesRes] = await Promise.all([
      axios.get(memberApiUrl, config).catch(() => ({ data: [] })),
      axios.get(projApiUrl, config).catch(() => ({ data: [] })),
      axios.get(tasksApiUrl, config).catch(() => ({ data: [] })),
      axios.get(`/api/members/meta/leaders?_t=${ts}`, config).catch(() => ({ data: [] })),
      axios.get(wsLeadersUrl, config).catch(() => ({ data: { leaders: null } })),
      axios.get(`/api/users/me?_t=${ts}`, config).catch(() => ({ data: null })),
      axios.get(`/api/members/workspace-roles?_t=${ts}`, config).catch(() => ({ data: {} })),
    ]);

    return {
      rawMembersAll: membersRes.data || [],
      rawProjectsAll: projRes.data || [],
      rawTasksAll: tasksRes.data || [],
      rawLeaders: leadersRes.data || [],
      allowedLeaders: Array.isArray(leadersScopeRes.data?.leaders) ? leadersScopeRes.data.leaders : null,
      currentUser: meRes.data || null,
      workspaceRoles: workspaceRolesRes.data || {},
    };
  };

  const { data, isFetching: loading } = useQuery({
    queryKey: ['dashboard-overview', selectedWorkspaceCode],
    queryFn: fetchMatrixData,
    staleTime: 2 * 60_000,
  });

  const rawMembersAll: any[] = data?.rawMembersAll || [];
  const rawProjectsAll: any[] = data?.rawProjectsAll || [];
  const rawTasksAll: any[] = data?.rawTasksAll || [];
  const rawLeaders: any[] = data?.rawLeaders || [];
  const allowedLeaders: string[] | null = data?.allowedLeaders ?? null;
  const currentUser: any = data?.currentUser || null;
  const workspaceRolesByMember: Record<number, { code: string; name: string; is_primary: boolean }[]> = data?.workspaceRoles || {};

  const currentUserRole = currentUser?.role || getRole() || '';
  const earlyUserScope = currentUser?.data_scope;

  // Same workspace scoping rule Overview uses — Leader's "home" workspace is
  // silently forced to their `data_scope`, Super Admin keeps the switcher.
  const effectiveWsCode = workspaceCode
    || (currentUserRole === 'leader' && earlyUserScope && earlyUserScope !== 'all'
      ? earlyUserScope
      : null);

  // Project/Task/Member workspace narrowing — same logic as Overview.
  const rawProjects: any[] = effectiveWsCode
    ? rawProjectsAll.filter((p: any) =>
      p.data_scope === effectiveWsCode ||
      p.business === effectiveWsCode ||
      p.data_scope === 'all' ||
      p.business === 'All'
    )
    : rawProjectsAll;
  const scopedProjectIds = effectiveWsCode ? new Set(rawProjects.map((p: any) => p.id)) : null;
  const rawTasks: any[] = scopedProjectIds
    ? rawTasksAll.filter((t: any) => scopedProjectIds.has(t.project_id))
    : rawTasksAll;
  const rawMembers: any[] = effectiveWsCode
    ? rawMembersAll.filter((m: any) => (m.workspace_code || m.workspace || '').toLowerCase() === effectiveWsCode.toLowerCase() || m.workspace === 'All')
    : rawMembersAll;

  const showsMemberCards = String(currentUserRole).toLowerCase() === 'leader';
  const showsLeaderCards = !showsMemberCards;

  // ── Team derivation (mirrors the Overview memo exactly) ────────────────
  const teamData = useMemo(() => {
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
        lList = Array.from(canonicalMap.values()).map((ld) => {
          const lTasks = rawTasks.filter((t: any) => isIdInList(ld.memberIds, t.assigned_id) || isIdInList(ld.memberIds, t.support_id));
          const done = lTasks.filter((t: any) => t.status === 'Done' || t.status === 'done').length;
          return { ...ld, totalTasks: lTasks.length, doneTasks: done };
        }).sort((a, b) => b.count - a.count);
      } else {
        const leaderMap = new Map();
        rawMembers.forEach((m) => {
          const lName = (m.leader_name || '').trim() || 'Không có Leader';
          if (!leaderMap.has(lName)) {
            leaderMap.set(lName, { name: lName, count: 0, team: m.team || m.department || 'Khác', memberIds: [] });
          }
          const ld = leaderMap.get(lName);
          ld.count++;
          ld.memberIds.push(m.id);
        });
        lList = Array.from(leaderMap.values()).map((ld) => {
          const lTasks = rawTasks.filter((t: any) => isIdInList(ld.memberIds, t.assigned_id) || isIdInList(ld.memberIds, t.support_id));
          const done = lTasks.filter((t: any) => t.status === 'Done' || t.status === 'done').length;
          return { ...ld, totalTasks: lTasks.length, doneTasks: done };
        }).sort((a, b) => b.count - a.count);
      }
      visibleLeaders = lList;
      if (Array.isArray(allowedLeaders) && allowedLeaders.length > 0) {
        const allowed = new Set(allowedLeaders.map((n: string) => String(n).trim().toLowerCase()));
        visibleLeaders = lList.filter((ld) =>
          ld.name && ld.name !== 'Không có Leader' && allowed.has(String(ld.name).trim().toLowerCase())
        );
      } else {
        visibleLeaders = lList.filter((ld) => ld.name && ld.name !== 'Không có Leader');
      }
      if (selectedWorkspaceCode || workspaceCode) {
        visibleLeaders = visibleLeaders.filter((ld) => ld.count > 0);
      }
    } else {
      lList = [];
      visibleLeaders = [];
    }

    // Leader: team = members whose leader_name matches the signed-in leader.
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

    let activeTeamList = rawMembers;
    if (showsLeaderCards && selectedLeader && selectedLeader !== 'all') {
      const selTrim = selectedLeader.trim().toLowerCase();
      const selLeader = visibleLeaders.find((ld: any) => String(ld.name).trim().toLowerCase() === selTrim);
      const selMid = selLeader?.member_id != null ? String(selLeader.member_id) : null;
      if (selMid) {
        activeTeamList = rawMembers.filter((m: any) => {
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
        activeTeamList = rawMembers.filter((m: any) => {
          const leaderName = ((m.leader_name || '').trim() || 'Không có Leader').toLowerCase();
          const mName = (m.display_name || m.full_name || m.name || '').trim().toLowerCase();
          return leaderName === selTrim || mName === selTrim;
        });
      }
    } else if (showsMemberCards) {
      activeTeamList = memberCardSource;
      if (selectedMemberId !== 'all') {
        activeTeamList = activeTeamList.filter((m: any) => isSameId(m.id, selectedMemberId));
      }
    }

    return { visibleLeaders, activeTeamList };
  }, [
    rawMembers, rawTasks, rawLeaders, allowedLeaders, showsLeaderCards, showsMemberCards,
    selectedLeader, selectedMemberId, currentUser, workspaceRolesByMember,
    selectedWorkspaceCode, workspaceCode,
  ]);

  const visibleLeaders = teamData.visibleLeaders;
  const activeTeamList = teamData.activeTeamList;

  // ── Matrix computation ─────────────────────────────────────────────────
  const { summaryMatrix, averageMatrix, bonusMatrix } = useMemo(() => {
    let sumM: any[] = [];
    let avgM: any[] = [];
    let bonM: any[] = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let i = 1; i <= 12; i++) {
      const rowSum: any = { month: `${monthNames[i - 1]} - ${matrixYear}` };
      const rowAvg: any = { month: `${monthNames[i - 1]} - ${matrixYear}` };
      const rowBon: any = { month: `${monthNames[i - 1]} - ${matrixYear}` };

      activeTeamList.forEach((m: any) => {
        const mTasks = rawTasks.filter((t: any) =>
          (isSameId(t.assigned_id, m.id) || isSameId(t.support_id, m.id)) &&
          (t.status === 'Done' || t.status === 'done') &&
          Boolean(t.end_date_actual)
        );
        let mkpi = 0;
        const cycle = CYCLE_TEMPLATE[i];
        mTasks.forEach((t: any) => {
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
        const avgKpi = mkpi > 0 ? (mkpi / weeksInMonth) : 0;
        rowSum[`m_${m.id}`] = Number(mkpi.toFixed(1));
        rowAvg[`m_${m.id}`] = Number(avgKpi.toFixed(1));
        rowBon[`m_${m.id}`] = Number(getKpiMultiplier(avgKpi).toFixed(1));
      });
      sumM.push(rowSum);
      avgM.push(rowAvg);
      bonM.push(rowBon);
    }

    return { summaryMatrix: sumM, averageMatrix: avgM, bonusMatrix: bonM };
  }, [activeTeamList, rawTasks, matrixYear]);

  const totalAllTasks = rawTasks.length;
  const totalAllDoneTasks = rawTasks.filter((t: any) => t.status === 'Done' || t.status === 'done').length;

  const CircularProgress = ({ value, total }: { value: number; total: number }) => {
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

  function workspaceBadgeFor(memberId: any, wsCode: string | null): { label: string; primary: boolean } | null {
    const entries = workspaceRolesByMember[Number(memberId)];
    if (!entries || entries.length < 1) return null;
    if (wsCode) {
      const match = entries.find((e: any) => e.code === wsCode);
      if (!match) return null;
      const otherCount = entries.length - 1;
      return match.is_primary
        ? { label: `🏠 ${match.name}${otherCount > 0 ? ` +${otherCount} phụ` : ''}`, primary: true }
        : { label: `${match.name} · Phụ`, primary: false };
    }
    const home = entries.find((e: any) => e.is_primary);
    if (!home) return null;
    const secondaryCount = entries.length - 1;
    return { label: `🏠 ${home.name}${secondaryCount > 0 ? ` +${secondaryCount} phụ` : ''}`, primary: true };
  }

  return (
    <div className="p-6 space-y-6">
      {/* 1. HEADER + ROLE-AWARE LEADER/MEMBER SELECTOR */}
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-[#0b1c30]">Ma Trận KPI Thành Viên</h2>
            <p className="text-xs text-slate-500 mt-1">Theo dõi tổng KPI, KPI trung bình / task và KPI thưởng theo tháng của từng thành viên.</p>
          </div>

          {/* YEAR FILTER */}
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm">
            <span className="text-xs font-bold text-slate-600">Lọc theo năm:</span>
            <input
              type="number"
              value={matrixYear}
              onChange={(e) => setMatrixYear(parseInt(e.target.value))}
              className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 w-24 outline-none cursor-pointer"
            />
          </div>
        </div>

        {/* 2. LEADER / MEMBER SELECTOR */}
        {showsLeaderCards ? (
          <div className="flex flex-nowrap gap-2 overflow-x-auto pb-2 custom-scrollbar">
            <button
              onClick={() => setSelectedLeader('all')}
              className={`shrink-0 min-w-[170px] px-4 py-2 rounded-xl border transition-all flex items-center justify-between gap-3 ${selectedLeader === 'all' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <div>
                <div className="text-xs font-bold">Toàn bộ Leader</div>
                <div className="text-[10px] font-normal opacity-80">{visibleLeaders.length} team · {rawMembers.length} member</div>
              </div>
              <CircularProgress value={totalAllDoneTasks} total={totalAllTasks} />
            </button>
            {visibleLeaders.map((ld: any) => {
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
                <div className="text-[10px] font-normal opacity-80">{activeTeamList.length} member</div>
              </div>
            </button>
            {activeTeamList.map((m: any) => {
              const badge = workspaceBadgeFor(m.id, effectiveWsCode);
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedMemberId(String(m.id))}
                  className={`shrink-0 min-w-[170px] px-4 py-2 rounded-xl border transition-all flex items-center justify-between gap-3 ${selectedMemberId === String(m.id) ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  <div className="truncate">
                    <div className="text-xs font-bold truncate flex items-center gap-1">
                      {m.display_name || m.full_name}
                      {badge && (
                        <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold normal-case ${badge.primary ? 'bg-indigo-600 text-white' : 'bg-amber-50 text-amber-700 border border-amber-300'}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. MA TRẬN KPI THÀNH VIÊN (KPI MATRICES) */}
      <div className="bg-white rounded-2xl border border-[#c2c6d6]/60 shadow-sm overflow-hidden p-5 space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-center border-b border-slate-100 pb-4 gap-4">
          <h3 className="text-sm font-bold text-[#0b1c30] uppercase tracking-wider">Ma Trận KPI Thành Viên</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600">Năm đang xem:</span>
            <span className="text-xs font-extrabold text-[#0058be] bg-blue-50 border border-blue-100 rounded-lg px-3 py-1">{matrixYear}</span>
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
                  {activeTeamList.map((m: any) => (
                    <th key={m.id} className="p-2 border border-slate-200 min-w-[80px] bg-pink-500">{getShortName(m.full_name || m.display_name)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaryMatrix.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="p-2 border border-slate-200 text-left font-bold text-[#0b1c30] bg-white sticky left-0 z-10">{r.month}</td>
                    {activeTeamList.map((m: any) => {
                      const val = r[`m_${m.id}`];
                      const numVal = typeof val === 'number' ? val : (val ? Number(val) : 0);
                      const displayVal = numVal.toFixed(1);
                      const bg = numVal > 100 ? 'bg-amber-300' : (numVal > 50 ? 'bg-amber-100' : 'bg-white');
                      return <td key={m.id} className={`p-2 border border-slate-200 font-semibold ${bg}`}>{displayVal}</td>;
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
                  {activeTeamList.map((m: any) => (
                    <th key={m.id} className="p-2 border border-slate-200 min-w-[80px] bg-emerald-500">{getShortName(m.full_name || m.display_name)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {averageMatrix.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="p-2 border border-slate-200 text-left font-bold text-[#0b1c30] bg-white sticky left-0 z-10">{r.month}</td>
                    {activeTeamList.map((m: any) => {
                      const val = r[`m_${m.id}`];
                      const numVal = typeof val === 'number' ? val : (val ? Number(val) : 0);
                      const displayVal = numVal.toFixed(1);
                      const bg = numVal > 10 ? 'bg-green-200' : (numVal > 5 ? 'bg-green-100' : 'bg-white');
                      return <td key={m.id} className={`p-2 border border-slate-200 font-semibold ${bg}`}>{displayVal}</td>;
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
                  {activeTeamList.map((m: any) => (
                    <th key={m.id} className="p-2 border border-slate-200 min-w-[80px] bg-indigo-500">{getShortName(m.full_name || m.display_name)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bonusMatrix.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="p-2 border border-slate-200 text-left font-bold text-[#0b1c30] bg-white sticky left-0 z-10">{r.month}</td>
                    {activeTeamList.map((m: any) => {
                      const val = r[`m_${m.id}`];
                      const numVal = typeof val === 'number' ? val : (val ? Number(val) : 0);
                      const displayVal = numVal.toFixed(1);
                      const bg = numVal > 0 ? 'bg-indigo-100 text-indigo-800' : 'bg-white text-slate-400';
                      return <td key={m.id} className={`p-2 border border-slate-200 font-semibold ${bg}`}>{displayVal}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {loading && activeTeamList.length === 0 && (
        <div className="text-center py-4 text-xs text-slate-400 font-semibold">Đang tải dữ liệu Ma Trận KPI…</div>
      )}
    </div>
  );
}
