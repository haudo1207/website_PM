'use client';

// People & Skill Intelligence — tab Dashboard cạnh Team Load. Tìm đúng
// người theo Skill cho 1 dự án, xem hồ sơ 360 (KPI, skill, tải công việc),
// và mượn/trả người giữa các dự án (Project Skill).
//
// Cấu trúc: 2 tab nhỏ — "Hồ sơ nhân sự & Skill Directory" (gộp 1 tab, có
// switch nội bộ Hồ sơ nhân sự ⇄ Skill Directory giống đúng file HTML mẫu
// markee_kpi_people_skills_profile360_v3.html) và "Project Skill".
//
// Dữ liệu tái dùng 100% từ những chỗ đã có, không tự bịa công thức mới:
// - CAPACITY — y hệt Team Load Section 4: Giao% = GET /system-audit/
//   team-comparison?start_date&end_date → member.giao_pct, phân loại bằng
//   workload_settings cùng kỳ (classifyPct ở dưới), hiển thị progress bar
//   + % theo đúng màu sắc KpiAverageProgressBar của Section 4.
// - KPI KỲ — đúng giá trị "Total KPI" trên Member Card Team Load Section 4:
//   member.kpi từ cùng response /team-comparison theo kỳ đang chọn.
// - "Việc đang mở" (Open/Total trong kỳ, Done loại khỏi Open) + "Dự án hiện
//   tại" (project có ≥1 task được giao trong kỳ, kể cả Done) — tính từ GET
//   /system-audit/team-comparison-tasks, lọc kỳ bằng checkTaskInPeriod (cùng
//   semantics Overview).
// - "Skill nổi bật" — cùng logic "PHÂN BỔ THEO SKILL" của MemberDetailModal
//   (manday desc trên task trong kỳ), fallback sang skill đã gán của Member.
// - Bộ lọc thời gian — cùng semantics/UI Overview/Team Load, mặc định
//   "Tuần này". Nhân sự hiển thị = Member có employment_status ON (Accounts
//   → Quản lý thành viên).
// - Hồ sơ chi tiết khi bấm vào 1 người: tái dùng thẳng MemberDetailModal.
import { useEffect, useMemo, useState } from 'react';
import { Users, Search, Loader2, Sparkles, Briefcase, ChevronRight, Send, Check, X } from 'lucide-react';
import { isAdmin } from '@/lib/auth';
import {
  getMembers, getTeamComparison, getTeamComparisonTasks, getCategories, getProjects,
  getDepartments,
  getEligibleLoanMembers, createMemberLoanRequest, getMemberLoanRequests, respondMemberLoanRequest,
  cancelMemberLoanRequest, getConsiderations, addConsideration, removeConsideration,
  checkConsideration, getMemberBusy, checkDateOverlap,
  TeamComparisonMember, WorkloadSetting, MemberLoanRequest, ConsiderationItem, BusyInfo,
} from '@/lib/api';
import {
  CYCLE_TEMPLATE, getMondayToSundayRange, getPrevWeekRange, getNextWeekRange,
  getWeekOfMonth, checkTaskInPeriod,
} from '@/app/dashboard/constants';
import FormulaTooltip from '@/components/dashboard/FormulaTooltip';
import MemberDetailModal from '@/components/dashboard/MemberDetailModal';

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type MainTab = 'people-skill' | 'project-skill';
type PeopleView = 'people' | 'skills';

interface SkillNode { id: number; name: string; group_id: number; is_active?: boolean; is_used?: boolean; }
interface GroupNode { id: number; name: string; category_id: number; is_used?: boolean; skills: SkillNode[]; }
interface CategoryNode { id: number; name: string; is_active?: boolean; is_used?: boolean; groups: GroupNode[]; }

function initials(name: string) {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function classifyPct(pct: number, settings: WorkloadSetting[]): { key: string; label: string; tone: string } {
  if (settings.length === 4) {
    const sorted = [...settings].sort((a, b) => (a.min_kpi ?? 0) - (b.min_kpi ?? 0));
    for (const ws of sorted) {
      const lo = ws.min_kpi ?? -Infinity;
      const hi = ws.max_kpi ?? Infinity;
      if (pct >= lo && pct <= hi) return toneFor(ws.status_key, ws.status_label);
    }
  }
  if (pct > 120) return toneFor('overload', 'Quá tải');
  if (pct >= 90) return toneFor('normal', 'Bình thường');
  if (pct >= 50) return toneFor('capacity', 'Còn capacity');
  return toneFor('not_working', 'Không làm việc');
}
function toneFor(key: string, label: string) {
  const tones: Record<string, string> = {
    overload: 'bg-rose-50 text-rose-700 border-rose-200',
    normal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    capacity: 'bg-blue-50 text-blue-700 border-blue-200',
    not_working: 'bg-slate-100 text-slate-500 border-slate-200',
  };
  return { key, label, tone: tones[key] || tones.not_working };
}

const OPEN_STATUSES_EXCLUDE = new Set(['done', 'cancel']);
const LOAN_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Đang xử lý', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  accepted: { label: 'Thành công', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Bị từ chối', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
};
const LOAN_STATUS_LABEL_RECIPIENT: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Đang chờ', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  accepted: { label: 'Đã đồng ý', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Đã từ chối', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export default function PeopleSkillIntelligence() {
  const admin = isAdmin();
  const [mainTab, setMainTab] = useState<MainTab>(admin ? 'people-skill' : 'project-skill');
  const [peopleView, setPeopleView] = useState<PeopleView>('people');

  // ── Dữ liệu dùng chung (chỉ Leader/Super Admin) ──
  const [members, setMembers] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [giaoMap, setGiaoMap] = useState<Map<number, number>>(new Map());
  const [kpiMap, setKpiMap] = useState<Map<number, number>>(new Map());
  const [workloadSettings, setWorkloadSettings] = useState<WorkloadSetting[]>([]);
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [allProjects, setAllProjects] = useState<{ id: any; name: string }[]>([]);
  const [selectedMemberModal, setSelectedMemberModal] = useState<any | null>(null);

  // ── Bộ lọc thời gian — cùng semantics/UI với Overview/Team Load, mặc
  //     định "Tuần này". Kỳ này drive TOÀN BỘ cột động (Skill nổi bật, Dự
  //     án hiện tại, KPI Kỳ, Capacity, Việc đang mở) qua cùng một cửa sổ.
  const initialNow = new Date();
  const [selectedYear, setSelectedYear] = useState<number | 'all'>(initialNow.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>(initialNow.getMonth() + 1);
  const [selectedWeek, setSelectedWeek] = useState<number | 'all'>(getWeekOfMonth(initialNow));
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>('Tuần này');

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

  // Cửa sổ ngày — dẫn xuất y hệt timeWindow của Team Load (MultiTeamProject-
  // Comparison), dùng chung cho API /team-comparison và checkTaskInPeriod.
  const timeWindow = useMemo(() => {
    if (activeQuickFilter === 'Tuần này') {
      const r = getMondayToSundayRange(new Date());
      return { start_date: formatYMD(r.monday), end_date: formatYMD(r.sunday) };
    }
    if (activeQuickFilter === 'Tuần trước') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      const r = getMondayToSundayRange(d);
      return { start_date: formatYMD(r.monday), end_date: formatYMD(r.sunday) };
    }
    if (activeQuickFilter === 'Tuần tới') {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      const r = getMondayToSundayRange(d);
      return { start_date: formatYMD(r.monday), end_date: formatYMD(r.sunday) };
    }
    if (typeof selectedMonth === 'number') {
      const cycle = CYCLE_TEMPLATE[selectedMonth];
      const yr = typeof selectedYear === 'number' ? selectedYear : new Date().getFullYear();
      if (cycle) {
        const s = new Date(`${yr + cycle.startYo}-${cycle.startMd}T00:00:00`);
        const e = new Date(`${yr + cycle.endYo}-${cycle.endMd}T23:59:59`);
        return { start_date: formatYMD(s), end_date: formatYMD(e) };
      }
      const s = new Date(yr, selectedMonth - 1, 1);
      const e = new Date(yr, selectedMonth, 0);
      return { start_date: formatYMD(s), end_date: formatYMD(e) };
    }
    if (typeof selectedYear === 'number') {
      return {
        start_date: `${selectedYear}-01-01`,
        end_date: `${selectedYear}-12-31`,
      };
    }
    return {} as { start_date?: string; end_date?: string };
  }, [selectedYear, selectedMonth, activeQuickFilter]);

  // ── Consideration list (per-user, API-backed) ──
  const [considerations, setConsiderations] = useState<ConsiderationItem[]>([]);
  const [considerationsLoading, setConsiderationsLoading] = useState(false);
  const [busyCache, setBusyCache] = useState<Map<number, BusyInfo>>(new Map());

  const loadConsiderations = () => {
    setConsiderationsLoading(true);
    getConsiderations()
      .then(setConsiderations)
      .catch(() => setConsiderations([]))
      .finally(() => setConsiderationsLoading(false));
  };

  const isInConsideration = (memberId: number) => considerations.some(c => c.member_id === memberId);

  const toggleConsideration = async (memberId: number, memberName: string, team?: string | null) => {
    if (isInConsideration(memberId)) {
      await removeConsideration(memberId);
      setConsiderations(prev => prev.filter(c => c.member_id !== memberId));
    } else {
      const item = await addConsideration(memberId);
      setConsiderations(prev => [item, ...prev]);
    }
  };

  const getMemberBusyInfo = async (memberId: number): Promise<BusyInfo | null> => {
    if (busyCache.has(memberId)) return busyCache.get(memberId)!;
    try {
      const info = await getMemberBusy(memberId);
      setBusyCache(prev => new Map(prev).set(memberId, info));
      return info;
    } catch {
      return null;
    }
  };

  const isMemberCurrentlyBusy = (memberId: number): boolean => {
    const info = busyCache.get(memberId);
    return info?.currently_busy || false;
  };

  const getMemberBusyPeriod = (memberId: number): { start_date: string; end_date: string } | null => {
    const info = busyCache.get(memberId);
    if (info?.current_busy_info) {
      return { start_date: info.current_busy_info.start_date, end_date: info.current_busy_info.end_date };
    }
    return null;
  };

  useEffect(() => {
    if (!admin) return;
    loadConsiderations();
  }, [admin]);

  useEffect(() => {
    if (!admin) return;
    setMembersLoading(true);
    // Note: Team-comparison data is fetched SEPARATELY below by the period
    // effect (with the active start_date/end_date), NOT here as an
    // unfiltered parallel. Calling getTeamComparison({}) in this initial
    // batch caused a race: a slow unfiltered response could resolve AFTER
    // the user changed the time filter and overwrite the filtered state
    // with stale, period-agnostic values — making Skill nổi bật / KPI kỳ /
    // Capacity appear not to update. The period effect below is now the
    // single source of truth for team-comparison data.
    Promise.all([
      getMembers({ light: true }).catch(() => []),
      getTeamComparisonTasks().catch(() => []),
      getProjects().catch(() => []),
      getEligibleLoanMembers().catch(() => []),
      getDepartments().catch(() => []),
    ]).then(([mem, tasks, projects, eligible, departments]) => {
      setLoanProjects(Array.isArray(projects) ? projects : []);
      setEligibleMembers(Array.isArray(eligible) ? eligible : []);
      setDeptMaster(Array.isArray(departments) ? departments : []);
      setMembers(Array.isArray(mem) ? mem.filter((m: any) => (m.employment_status || 'ON') === 'ON') : []);
      const taskList = Array.isArray(tasks) ? tasks : [];
      setAllTasks(taskList);
      const projMap = new Map<string, { id: any; name: string }>();
      for (const t of taskList) {
        if (t.project_id == null) continue;
        const key = String(t.project_id);
        if (!projMap.has(key)) projMap.set(key, { id: t.project_id, name: t.projectName || `Project #${t.project_id}` });
      }
      setAllProjects(Array.from(projMap.values()));
    }).finally(() => setMembersLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  // KPI Kỳ + Capacity theo kỳ đã chọn — gọi lại ĐÚNG API của Team Load
  // Section 4 (/system-audit/team-comparison) với cùng start_date/end_date,
  // không tự tính KPI/capacity ở UI.
  //
  // The `cancelled` flag below is the period-sync guarantee: when the user
  // changes the time filter, this effect re-runs, the cleanup flips
  // `cancelled=true` on the previous closure, and any in-flight response
  // for the OLD period is silently dropped instead of clobbering the
  // freshly-loaded state for the NEW period. Without it, an old response
  // that resolves after a newer one (slow network / larger dataset) would
  // flash the previous period's KPI/Capacity on screen.
  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    getTeamComparison({ start_date: timeWindow.start_date, end_date: timeWindow.end_date })
      .then((cmp) => {
        if (cancelled) return;
        const map = new Map<number, number>();
        const kmap = new Map<number, number>();
        if (cmp?.teams) {
          for (const t of cmp.teams) {
            for (const m of t.members || []) {
              map.set(m.member_id, m.giao_pct ?? 0);
              kmap.set(m.member_id, m.kpi ?? 0);
            }
          }
        }
        setGiaoMap(map);
        setKpiMap(kmap);
        setWorkloadSettings(cmp?.workload_settings || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, timeWindow.start_date, timeWindow.end_date]);

  // Task thuộc kỳ đang chọn — lọc bằng checkTaskInPeriod (cùng semantics
  // Overview/MemberDetailModal), dùng chung cho mọi cột động để không cột
  // nào rơi vào cửa sổ ngày khác nhau.
  const tasksInPeriod = useMemo(
    () => allTasks.filter(t => checkTaskInPeriod(t, selectedYear, selectedMonth, selectedWeek, activeQuickFilter)),
    [allTasks, selectedYear, selectedMonth, selectedWeek, activeQuickFilter]
  );

  const openTaskCountByMember = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of allTasks) {
      const status = (t.status || '').toLowerCase();
      if (OPEN_STATUSES_EXCLUDE.has(status)) continue;
      for (const key of [t.assigned_id, t.support_id]) {
        if (key == null) continue;
        map.set(Number(key), (map.get(Number(key)) || 0) + 1);
      }
    }
    return map;
  }, [allTasks]);

  // "Việc đang mở" theo kỳ: Open = mọi trạng thái KHÁC Done; Total = mọi
  // task được giao (assigned + support) trong kỳ.
  const periodTaskStatsByMember = useMemo(() => {
    const map = new Map<number, { open: number; total: number }>();
    for (const t of tasksInPeriod) {
      for (const key of [t.assigned_id, t.support_id]) {
        if (key == null) continue;
        const mid = Number(key);
        const s = map.get(mid) || { open: 0, total: 0 };
        s.total += 1;
        if ((t.status || '').toLowerCase() !== 'done') s.open += 1;
        map.set(mid, s);
      }
    }
    return map;
  }, [tasksInPeriod]);

  // "Skill nổi bật" — cùng logic "PHÂN BỔ THEO SKILL" của MemberDetailModal
  // (manday desc trên task trong kỳ); rỗng thì fallback skill đã gán ở
  // Accounts → Quản lý thành viên.
  const topSkillsByMember = useMemo(() => {
    const perMember = new Map<number, Map<string, number>>();
    for (const t of tasksInPeriod) {
      const name = t.skill_vendor_name;
      if (!name) continue;
      for (const key of [t.assigned_id, t.support_id]) {
        if (key == null) continue;
        const mid = Number(key);
        if (!perMember.has(mid)) perMember.set(mid, new Map());
        const skills = perMember.get(mid)!;
        skills.set(name, (skills.get(name) || 0) + (t.manday_actual || t.manday_est || 0));
      }
    }
    const result = new Map<number, string[]>();
    perMember.forEach((skills, mid) => {
      result.set(mid, Array.from(skills.entries()).sort((a, b) => b[1] - a[1]).map(([n]) => n));
    });
    return result;
  }, [tasksInPeriod]);

  // "Dự án hiện tại" theo kỳ: mọi project có ≥1 task được giao trong kỳ
  // (kể cả Done), sắp xếp theo số task giảm dần.
  const periodProjectsByMember = useMemo(() => {
    const perMember = new Map<number, Map<string, { name: string; count: number }>>();
    for (const t of tasksInPeriod) {
      if (t.project_id == null) continue;
      for (const key of [t.assigned_id, t.support_id]) {
        if (key == null) continue;
        const mid = Number(key);
        if (!perMember.has(mid)) perMember.set(mid, new Map());
        const projMap = perMember.get(mid)!;
        const pkey = String(t.project_id);
        const existing = projMap.get(pkey) || { name: t.projectName || `Project #${t.project_id}`, count: 0 };
        existing.count += 1;
        projMap.set(pkey, existing);
      }
    }
    const result = new Map<number, { name: string; count: number }[]>();
    perMember.forEach((projMap, mid) => {
      result.set(mid, Array.from(projMap.values()).sort((a, b) => b.count - a.count));
    });
    return result;
  }, [tasksInPeriod]);


  const [search, setSearch] = useState('');
  const [capacityFilter, setCapacityFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  // Danh sách TEAM chuẩn từ nguồn của Accounts → Quản lý thành viên
  // (/system-categories/departments — cột "Team" của MembersView).
  const [deptMaster, setDeptMaster] = useState<{ name: string }[]>([]);
  // Options Capacity — đúng phân loại Workload Settings của Team Load
  // Section 4; fallback 4 nhãn mặc định khi chưa tải được settings.
  const capacityOptions = useMemo(() => {
    if (workloadSettings.length === 4) {
      return [...workloadSettings]
        .sort((a, b) => (a.min_kpi ?? 0) - (b.min_kpi ?? 0))
        .map((ws) => ({ key: ws.status_key, label: ws.status_label }));
    }
    return [
      { key: 'not_working', label: 'Không làm việc' },
      { key: 'capacity', label: 'Còn capacity' },
      { key: 'normal', label: 'Bình thường' },
      { key: 'overload', label: 'Quá tải' },
    ];
  }, [workloadSettings]);
  const deptOptions = useMemo(() => {
    const fromMaster = deptMaster.map((d) => d.name).filter(Boolean);
    const source = fromMaster.length > 0 ? fromMaster : members.map((m) => m.department).filter(Boolean);
    return Array.from(new Set<string>(source)).sort();
  }, [deptMaster, members]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter(m => {
      if (capacityFilter && classifyPct(giaoMap.get(m.id) ?? 0, workloadSettings).key !== capacityFilter) return false;
      if (deptFilter && m.department !== deptFilter) return false;
      if (!q) return true;
      const hay = [m.display_name, m.full_name, m.team, m.department, ...(m.skills || []).map((s: any) => s.name)].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [members, search, capacityFilter, deptFilter, giaoMap, workloadSettings]);

  function openMemberProfile(m: any) {
    setSelectedMemberModal({
      id: m.id,
      name: m.display_name,
      rawMember: {
        team: m.team || undefined,
        department: m.department || undefined,
        leader_name: m.leader_name || undefined,
        display_name: m.display_name,
        full_name: m.full_name,
      },
    });
  }

  // ── Skill Directory ──────────────────────────────────────────────────
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillNode | null>(null);

  useEffect(() => {
    if (peopleView !== 'skills' || !admin) return;
    if (categories.length > 0) return;
    setCategoriesLoading(true);
    getCategories().then((data: CategoryNode[]) => {
      setCategories(Array.isArray(data) ? data : []);
      const firstUsed = (data || []).find(c => c.groups.some(g => g.skills.length > 0));
      if (firstUsed) setExpandedCategoryId(firstUsed.id);
    }).catch(() => setCategories([])).finally(() => setCategoriesLoading(false));
  }, [peopleView, admin, categories.length]);

  // ── Skill Directory — aggregation dựa trên task evidence (DONE + ASSIGNED
  // + exact skill_id match). KHÔNG dùng member.skills; KHÔNG dùng support tasks;
  // KHÔNG áp dụng time filter (dùng allTasks - toàn bộ lịch sử).
  // Member eligibility: chỉ ON members (đã lọc ở line 212).

  // Evidence: Map<`${memberId}|${skillId}`, { count, projects: Set<projectId> }>
  // Chỉ đếm task DONE + ASSIGNED (không phải support) + exact skill_vendor_id match.
  const taskEvidenceByMemberSkill = useMemo(() => {
    const m = new Map<string, { count: number; projects: Set<number> }>();
    const memberIds = new Set(members.map(mem => mem.id));
    for (const t of allTasks) {
      // Only DONE status counts
      const status = (t.status || '').toLowerCase();
      if (status !== 'done') continue;
      // Only ASSIGNED tasks count (not support)
      const assignedId = t.assigned_id != null ? Number(t.assigned_id) : null;
      if (assignedId == null) continue;
      // Member must be ON (already filtered in members state, but double-check)
      if (!memberIds.has(assignedId)) continue;
      // Exact skill_id match (skill_vendor_id is the FK to skills.id)
      const skillId = t.skill_vendor_id != null ? Number(t.skill_vendor_id) : null;
      if (skillId == null) continue;
      const key = `${assignedId}|${skillId}`;
      const entry = m.get(key) || { count: 0, projects: new Set() };
      entry.count += 1;
      // Track unique projects for "Dự án đã tham gia"
      if (t.project_id != null) {
        entry.projects.add(Number(t.project_id));
      }
      m.set(key, entry);
    }
    return m;
  }, [allTasks, members]);

  // Map<skillId, Member[]> — ON members có ≥1 qualifying evidence task cho skill này.
  // Build từ task evidence, KHÔNG từ member.skills.
  const membersBySkillId = useMemo(() => {
    const m = new Map<number, any[]>();
    const memberById = new Map(members.map(mem => [mem.id, mem]));
    const seen = new Map<string, boolean>(); // `${memberId}|${skillId}` → already added
    taskEvidenceByMemberSkill.forEach((entry, key) => {
      const [midStr, sidStr] = key.split('|');
      const mid = Number(midStr);
      const sid = Number(sidStr);
      const dedupeKey = `${mid}|${sid}`;
      if (seen.has(dedupeKey)) return;
      seen.set(dedupeKey, true);
      const mem = memberById.get(mid);
      if (!mem) return;
      if (!m.has(sid)) m.set(sid, []);
      m.get(sid)!.push(mem);
    });
    return m;
  }, [taskEvidenceByMemberSkill, members]);

  const totalEvidenceBySkillId = useMemo(() => {
    const agg = new Map<number, number>();
    taskEvidenceByMemberSkill.forEach((entry, key) => {
      const sidStr = key.split('|')[1];
      const sid = Number(sidStr);
      agg.set(sid, (agg.get(sid) || 0) + entry.count);
    });
    return agg;
  }, [taskEvidenceByMemberSkill]);

  // Skill Area → Skill hierarchy, chỉ giữ những nhánh ACTIVE và có ON member evidence.
  // Active-only rule: Category.is_active, Skill.is_active phải true.
  // Skill Area member count = distinct members có ≥1 qualifying evidence task trong area.
  const skillDirectory = useMemo(() => {
    return categories
      .filter((c) => c.is_active !== false) // Active-only: hide inactive categories
      .map((c) => {
        const skillEntries = c.groups
          .flatMap((g) => g.skills)
          .filter((s) => s.is_active !== false) // Active-only: hide inactive skills
          .map((s) => {
            const list = membersBySkillId.get(s.id) || [];
            return {
              ...s,
              memberCount: list.length,
              evidenceTotal: totalEvidenceBySkillId.get(s.id) || 0,
            };
          })
          .filter((s) => s.memberCount > 0);
        const seen = new Set<number>();
        for (const s of skillEntries) for (const mem of membersBySkillId.get(s.id) || []) seen.add(mem.id);
        return { ...c, memberCount: seen.size, skillEntries };
      })
      .filter((c) => c.memberCount > 0);
  }, [categories, membersBySkillId, totalEvidenceBySkillId]);

  const skillMembers = useMemo(() => {
    if (!selectedSkill) return [] as any[];
    const list = membersBySkillId.get(selectedSkill.id) || [];
    return [...list].sort((a, b) => {
      const ea = taskEvidenceByMemberSkill.get(`${a.id}|${selectedSkill.id}`)?.count || 0;
      const eb = taskEvidenceByMemberSkill.get(`${b.id}|${selectedSkill.id}`)?.count || 0;
      if (ea !== eb) return eb - ea;
      return (a.display_name || '').localeCompare(b.display_name || '');
    });
  }, [selectedSkill, membersBySkillId, taskEvidenceByMemberSkill]);

  // ── Project Skill — mượn/trả người ──────────────────────────────────
  const [loanProjects, setLoanProjects] = useState<any[]>([]);
  const [eligibleMembers, setEligibleMembers] = useState<any[]>([]);
  const [loanProjectId, setLoanProjectId] = useState<number | ''>('');
  const [loanMemberId, setLoanMemberId] = useState<number | ''>('');
  const [loanStartDate, setLoanStartDate] = useState<string>('');
  const [loanEndDate, setLoanEndDate] = useState<string>('');
  const [loanMessage, setLoanMessage] = useState('');
  const [sendingLoan, setSendingLoan] = useState(false);
  const [loanError, setLoanError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<MemberLoanRequest[]>([]);
  const [outgoing, setOutgoing] = useState<MemberLoanRequest[]>([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<number, string>>({});
  const [projectSearch, setProjectSearch] = useState('');
  const [showRejectInput, setShowRejectInput] = useState<Record<number, boolean>>({});

  function loadLoans() {
    setLoansLoading(true);
    Promise.all([
      getMemberLoanRequests('incoming').catch(() => []),
      admin ? getMemberLoanRequests('outgoing').catch(() => []) : Promise.resolve([]),
    ]).then(([inc, out]) => {
      setIncoming(inc);
      setOutgoing(out);
    }).finally(() => setLoansLoading(false));
  }

  useEffect(() => {
    if (mainTab !== 'project-skill') return;
    loadLoans();
    loadConsiderations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  const filteredLoanProjects = loanProjects.filter((p: any) =>
    p.name.toLowerCase().includes(projectSearch.toLowerCase())
  );

  async function handleSendLoan() {
    if (!loanProjectId || !loanMemberId || !loanStartDate || !loanEndDate) {
      setLoanError('Vui lòng chọn đầy đủ dự án, người, ngày bắt đầu và ngày kết thúc');
      return;
    }
    setSendingLoan(true);
    setLoanError(null);
    try {
      const overlap = await checkDateOverlap(Number(loanMemberId), loanStartDate, loanEndDate);
      if (overlap.has_overlap) {
        setLoanError(`Member đang bận từ ${overlap.overlap_info?.start_date} đến ${overlap.overlap_info?.end_date} (dự án: ${overlap.overlap_info?.project_name || 'N/A'})`);
        setSendingLoan(false);
        return;
      }
      await createMemberLoanRequest(Number(loanProjectId), Number(loanMemberId), loanStartDate, loanEndDate, loanMessage.trim() || undefined);
      setLoanMessage('');
      setLoanMemberId('');
      setLoanStartDate('');
      setLoanEndDate('');
      loadLoans();
      loadConsiderations();
    } catch (e: any) {
      setLoanError(e?.response?.data?.detail || 'Gửi yêu cầu thất bại');
    } finally {
      setSendingLoan(false);
    }
  }

  async function handleRespond(loanId: number, decision: 'accepted' | 'rejected') {
    setRespondingId(loanId);
    try {
      await respondMemberLoanRequest(loanId, decision, reasonDraft[loanId]?.trim() || undefined);
      loadLoans();
      setShowRejectInput(prev => ({ ...prev, [loanId]: false }));
      setReasonDraft(prev => ({ ...prev, [loanId]: '' }));
    } catch (e: any) {
      setLoanError(e?.response?.data?.detail || 'Không thể xử lý yêu cầu');
    } finally {
      setRespondingId(null);
    }
  }

  async function handleCancel(loanId: number) {
    if (!confirm('Bạn có chắc muốn hủy yêu cầu này?')) return;
    try {
      await cancelMemberLoanRequest(loanId);
      loadLoans();
    } catch (e: any) {
      setLoanError(e?.response?.data?.detail || 'Không thể hủy yêu cầu');
    }
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-1 border-b border-slate-200">
        {admin && (
          <button
            onClick={() => setMainTab('people-skill')}
            className={`px-3.5 py-2 text-[13px] font-bold border-b-2 transition-colors ${mainTab === 'people-skill' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            Hồ sơ nhân sự &amp; Skill Directory
          </button>
        )}
        <button
          onClick={() => setMainTab('project-skill')}
          className={`px-3.5 py-2 text-[13px] font-bold border-b-2 transition-colors ${mainTab === 'project-skill' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
        >
          Project Skill
        </button>
      </div>

      {mainTab === 'people-skill' && admin && (
        <div className="space-y-4">
          <div className="inline-flex bg-slate-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => setPeopleView('people')}
              className={`px-3.5 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${peopleView === 'people' ? 'bg-white text-[#0058be] shadow-sm' : 'text-slate-500'}`}
            >
              Hồ sơ nhân sự
            </button>
            <button
              onClick={() => setPeopleView('skills')}
              className={`px-3.5 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${peopleView === 'skills' ? 'bg-white text-[#0058be] shadow-sm' : 'text-slate-500'}`}
            >
              Skill Directory
            </button>
          </div>

          {peopleView === 'people' && (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm tên, team, hoặc skill..."
                    className="w-full pl-8 pr-3 py-1.5 text-[12.5px] bg-white text-slate-800 placeholder:text-slate-400 border border-slate-300 rounded-full outline-none focus:ring-1 focus:ring-[#0058be]"
                  />
                </div>
                <select value={capacityFilter} onChange={(e) => setCapacityFilter(e.target.value)}
                  className="text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
                  <option value="">Tất cả capacity</option>
                  {capacityOptions.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
                  className="text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
                  <option value="">Tất cả phòng ban</option>
                  {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 hidden sm:block">Bộ lọc thời gian:</span>
                  <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm text-[11px] font-bold">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500">Năm:</span>
                      <select
                        value={selectedYear}
                        onChange={(e) => { setSelectedYear(e.target.value === 'all' ? 'all' : Number(e.target.value)); setActiveQuickFilter(null); }}
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
                        onChange={(e) => { setSelectedMonth(e.target.value === 'all' ? 'all' : Number(e.target.value)); setActiveQuickFilter(null); }}
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
                        onChange={(e) => { setSelectedWeek(e.target.value === 'all' ? 'all' : Number(e.target.value)); setActiveQuickFilter(null); }}
                        className="bg-transparent border-none text-[#0058be] font-bold focus:outline-none cursor-pointer"
                      >
                        <option value="all">Tất cả</option>
                        {[...Array(5)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                      </select>
                    </div>
                  </div>
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
                </div>
                <span className="text-[11.5px] text-slate-400 font-semibold ml-auto">{filteredMembers.length} người</span>
              </div>

              {membersLoading ? (
                <div className="flex items-center justify-center py-14 text-slate-400 gap-2 text-[12.5px]">
                  <Loader2 className="w-4 h-4 animate-spin" /> Đang tải...
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                        <th className="text-left px-4 py-2.5">Nhân sự</th>
                        <th className="text-left px-4 py-2.5">Team</th>
                        <th className="text-left px-4 py-2.5">Skill nổi bật</th>
                        <th className="text-left px-4 py-2.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">Dự án hiện tại
                            <FormulaTooltip align="left">
                              <p className="font-bold text-white/90 mb-1">Dự án hiện tại</p>
                              <p className="text-white/80 mb-1">Nguồn dữ liệu:</p>
                              <p className="text-white font-mono">Project có ≥1 Task được giao (assigned + support) cho người này trong kỳ đang chọn</p>
                              <p className="text-white/60 mt-1.5">Trong đó:</p>
                              <ul className="text-white/70 list-disc ml-3 mt-0.5 space-y-0.5">
                                <li><b>Kể cả task đã Done</b> — Done KHÔNG loại project ra khỏi danh sách; mọi task được giao trong kỳ đều tính là tham gia project đó.</li>
                                <li><b>Kỳ:</b> cùng bộ lọc thời gian đang chọn ở trên (mặc định Tuần này), dùng chung logic <code>checkTaskInPeriod</code> với Overview/Team Load.</li>
                                <li><b>Thứ tự:</b> project có nhiều task được giao nhất trong kỳ hiển thị trước.</li>
                              </ul>
                            </FormulaTooltip>
                          </span>
                        </th>
                        <th className="text-right px-4 py-2.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 justify-end">KPI Kỳ
                            <FormulaTooltip align="right">
                              <p className="font-bold text-white/90 mb-1">KPI Kỳ</p>
                              <p className="text-white/80 mb-1">Công thức (đã được Portal tính sẵn):</p>
                              <p className="text-white font-mono">KPI Kỳ = Σ kpi_assigned + Σ kpi_support (task Done trong kỳ)</p>
                              <p className="text-white/60 mt-1.5">Trong đó:</p>
                              <ul className="text-white/70 list-disc ml-3 mt-0.5 space-y-0.5">
                                <li><b>kpi_assigned / kpi_support:</b> Tính từ <code>utils/kpi_engine.py</code> cho từng task <b>Done</b> (Cancel = 0) có <code>end_date_actual</code> rơi vào kỳ đang chọn.</li>
                                <li><b>Phạm vi:</b> ĐÚNG giá trị "Total KPI" trên Member Card của Team Load Section 4 (nguồn <code>/system-audit/team-comparison</code>) — không có phép tính KPI thứ hai ở UI.</li>
                                <li><b>Đây là giá trị KPI, không phải KPI%</b> — theo dõi bộ lọc thời gian đang chọn.</li>
                              </ul>
                            </FormulaTooltip>
                          </span>
                        </th>
                        <th className="text-left px-4 py-2.5 w-[160px] whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">Capacity
                            <FormulaTooltip align="left">
                              <p className="font-bold text-white/90 mb-1">Capacity</p>
                              <p className="text-white/80 mb-1">Công thức (y hệt Team Load Section 4):</p>
                              <p className="text-white font-mono">Capacity = Giao ÷ Weeks Divisor × 100%</p>
                              <p className="text-white/60 mt-1.5">Trong đó:</p>
                              <ul className="text-white/70 list-disc ml-3 mt-0.5 space-y-0.5">
                                <li><b>Giao:</b> Σ (priority_kpi_base × manday_est) của MỌI task được giao trong kỳ, bất kể trạng thái (Done/Doing/chưa làm) — nguồn <code>/system-audit/team-comparison</code>.</li>
                                <li><b>Weeks Divisor:</b> số tuần của kỳ lọc — Tuần = 1, Tháng = 4–5 (lịch tài chính), Năm = 52.</li>
                                <li><b>Phân loại màu:</b> theo Workload Settings (Settings → Workload): {">"}120% Quá tải (đỏ) · 90–120% Bình thường (xanh lá) · 50–90% Còn capacity (xanh dương) · {"<"}50% Không làm việc (xám).</li>
                              </ul>
                              <p className="text-white/50 mt-1.5">Dùng Giao% (không phải KPI%) để đánh giá tải, vì Giao tính cả task chưa Done.</p>
                            </FormulaTooltip>
                          </span>
                        </th>
                        <th className="text-right px-4 py-2.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 justify-end">Việc đang mở
                            <FormulaTooltip align="right">
                              <p className="font-bold text-white/90 mb-1">Việc đang mở</p>
                              <p className="text-white/80 mb-1">Công thức:</p>
                              <p className="text-white font-mono">Open / Total trong kỳ đang chọn</p>
                              <p className="text-white/60 mt-1.5">Trong đó:</p>
                              <ul className="text-white/70 list-disc ml-3 mt-0.5 space-y-0.5">
                                <li><b>Tử số (Open):</b> số task được giao (assigned + support) trong kỳ có trạng thái KHÁC Done.</li>
                                <li><b>Mẫu số (Total):</b> tổng mọi task được giao trong kỳ, gồm cả task Done.</li>
                                <li><b>Done → loại khỏi Open;</b> mọi trạng thái còn lại (Waiting, In Process, Block, Overdue, Cancel...) đều tính là đang mở. Không định nghĩa lại trạng thái task.</li>
                                <li><b>Phạm vi:</b> cả tử số và mẫu số dùng cùng kỳ đang chọn (checkTaskInPeriod — cùng semantics Overview).</li>
                              </ul>
                            </FormulaTooltip>
                          </span>
                        </th>
                        <th className="text-right px-4 py-2.5">Shortlist</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMembers.map((m) => {
                        const giao = giaoMap.get(m.id) ?? 0;
                        const badge = classifyPct(giao, workloadSettings);
                        const kpiKy = kpiMap.get(m.id) ?? 0;
                        const stats = periodTaskStatsByMember.get(m.id) || { open: 0, total: 0 };
                        const projects = periodProjectsByMember.get(m.id) || [];
                        const taskSkills = topSkillsByMember.get(m.id) || [];
                        const skillNames = taskSkills.length > 0
                          ? taskSkills
                          : (m.skills || []).slice(0, 3).map((s: any) => s.name);
                        const barCls = badge.key === 'overload' ? 'bg-rose-500' : badge.key === 'normal' ? 'bg-emerald-500' : badge.key === 'capacity' ? 'bg-[#0058be]' : 'bg-slate-300';
                        return (
                          <tr key={m.id} onClick={() => openMemberProfile(m)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[11px] flex items-center justify-center shrink-0">{initials(m.display_name)}</div>
                                <div>
                                  <div className="font-bold text-slate-800">{m.display_name}</div>
                                  <div className="text-[11px] text-slate-400">{m.department || ''}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-slate-600 font-semibold whitespace-nowrap">{m.department || '—'}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {skillNames.slice(0, 3).map((name: string) => (
                                  <span key={name} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{name}</span>
                                ))}
                                {taskSkills.length > 3 && <span className="text-[10px] text-slate-400">+{taskSkills.length - 3}</span>}
                                {skillNames.length === 0 && <span className="text-[11px] text-slate-300">—</span>}
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              {projects.length === 0 ? (
                                <span className="text-[11px] text-slate-300">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1 max-w-[240px]">
                                  {projects.slice(0, 2).map((p) => (
                                    <span key={p.name} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-[#0058be] border border-blue-100 truncate max-w-[140px]" title={`${p.name} · ${p.count} task trong kỳ`}>{p.name}</span>
                                  ))}
                                  {projects.length > 2 && <span className="text-[10px] text-slate-400 whitespace-nowrap">+{projects.length - 2} dự án</span>}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-extrabold text-[#0058be] tabular-nums">{kpiKy.toFixed(1)}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-slate-100 rounded-full overflow-hidden h-2 min-w-[60px]">
                                  <div className={`${barCls} h-2 rounded-full transition-all duration-500`} style={{ width: `${Math.max(0, Math.min(100, giao))}%` }} />
                                </div>
                                <span className={`shrink-0 text-[10px] font-bold tabular-nums ${giao > 120 ? 'text-rose-600' : giao >= 90 ? 'text-emerald-600' : 'text-slate-500'}`}>{giao.toFixed(0)}%</span>
                              </div>
                              <span className={`inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${badge.tone}`}>{badge.label}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                              {stats.total === 0 ? (
                                <span className="text-[11px] text-slate-300">—</span>
                              ) : (
                                <span className="font-bold text-slate-700">{stats.open}/{stats.total}
                                  <span className="ml-1 font-semibold text-[10.5px] text-slate-400">{stats.open === 0 ? '— Done hết' : '— In process'}</span>
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {isMemberCurrentlyBusy(m.id) ? (
                                <div className="text-[10px]">
                                  <span className="font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">Đang bận</span>
                                  {getMemberBusyPeriod(m.id) && (
                                    <div className="text-[9px] text-rose-500 mt-0.5">
                                      {formatDate(getMemberBusyPeriod(m.id)!.start_date)} → {formatDate(getMemberBusyPeriod(m.id)!.end_date)}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <button
                                  onClick={async (e) => { e.stopPropagation(); await toggleConsideration(m.id, m.display_name, m.team); }}
                                  className={`text-[10.5px] font-bold px-2 py-1 rounded-lg border whitespace-nowrap transition-colors ${
                                    isInConsideration(m.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                                  }`}
                                >
                                  {isInConsideration(m.id) ? '✓ Đã chọn' : '+ Chọn'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredMembers.length === 0 && (
                        <tr><td colSpan={8} className="text-center py-12 text-slate-400">Không tìm thấy nhân sự phù hợp.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {peopleView === 'skills' && (
            <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-3">
              <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1 max-h-[70vh] overflow-y-auto">
                {categoriesLoading ? (
                  <div className="flex items-center justify-center py-8 text-slate-400 gap-2 text-[12px]"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải...</div>
                ) : skillDirectory.length === 0 ? (
                  <div className="text-center py-8 text-[11.5px] text-slate-400">Chưa có nhân sự nào được gắn skill để dựng thư mục.</div>
                ) : skillDirectory.map((c) => (
                  <div key={c.id}>
                    <button
                      onClick={() => setExpandedCategoryId(expandedCategoryId === c.id ? null : c.id)}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12.5px] font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <span className="flex items-center gap-1.5"><ChevronRight className={`w-3.5 h-3.5 transition-transform ${expandedCategoryId === c.id ? 'rotate-90' : ''}`} />{c.name}</span>
                      <span className="text-[11px] font-bold text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5">{c.memberCount}</span>
                    </button>
                    {expandedCategoryId === c.id && (
                      <div className="pl-6 space-y-0.5 pb-1">
                        {c.skillEntries.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => { setSelectedSkill({ id: s.id, name: s.name, group_id: 0, is_active: s.is_active, is_used: s.is_used }); setExpandedCategoryId(c.id); }}
                            className={`w-full text-left flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12px] ${selectedSkill?.id === s.id ? 'bg-[#0058be] text-white font-bold' : 'text-slate-500 hover:bg-slate-50'}`}
                          >
                            <span>{s.name}</span>
                            <span className={`text-[10.5px] font-bold rounded-full px-1.5 py-0.5 ${selectedSkill?.id === s.id ? 'bg-white/20 text-white' : 'text-slate-400 bg-slate-100'}`}>{s.memberCount}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                {!selectedSkill ? (
                  <div className="text-center py-16 text-[12.5px] text-slate-400">
                    <Sparkles className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                    Chọn 1 Skill bên trái để xem ai đang có skill đó.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-extrabold text-slate-800">{selectedSkill.name}</h3>
                        <p className="text-[11.5px] text-slate-400">{skillMembers.length} người có skill này · Evidence = DONE + ASSIGNED tasks (toàn bộ lịch sử)</p>
                      </div>
                    </div>
                    {skillMembers.length === 0 ? (
                      <div className="text-center py-10 text-slate-400 text-[12.5px]">Chưa có ai có task evidence cho skill này.</div>
                    ) : (
                      <div className="space-y-2">
                        {skillMembers.map((m) => {
                          const evidenceEntry = taskEvidenceByMemberSkill.get(`${m.id}|${selectedSkill.id}`);
                          const evidence = evidenceEntry?.count || 0;
                          const projectIds = Array.from(evidenceEntry?.projects || []);
                          const projects = projectIds.map(pid => allProjects.find(p => String(p.id) === String(pid))?.name || `Project #${pid}`);
                          const roleParts = [m.position, m.department].filter(Boolean);
                          return (
                            <div key={m.id} onClick={() => openMemberProfile(m)} className="border border-slate-200 rounded-lg px-3 py-2.5 hover:border-[#0058be] cursor-pointer transition-colors">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[11px] flex items-center justify-center shrink-0">{initials(m.display_name)}</div>
                                  <div className="min-w-0">
                                    <div className="font-bold text-slate-800 text-[12.5px] truncate">{m.display_name}</div>
                                    <div className="text-[11px] text-slate-400 truncate">
                                      {roleParts.length > 0 ? roleParts.join(' · ') : [m.team, m.department].filter(Boolean).join(' · ') || '—'}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">Task Evidence</div>
                                  <div className="text-[12.5px] font-extrabold text-[#0058be] tabular-nums">{evidence}</div>
                                </div>
                                {isMemberCurrentlyBusy(m.id) ? (
                                  <div className="shrink-0 text-[10px]">
                                    <span className="font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">Đang bận</span>
                                    {getMemberBusyPeriod(m.id) && (
                                      <div className="text-[9px] text-rose-500 mt-0.5">
                                        {formatDate(getMemberBusyPeriod(m.id)!.start_date)} → {formatDate(getMemberBusyPeriod(m.id)!.end_date)}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    onClick={async (e) => { e.stopPropagation(); await toggleConsideration(m.id, m.display_name); }}
                                    className={`shrink-0 text-[10.5px] font-bold px-2 py-1 rounded-lg border whitespace-nowrap transition-colors ${
                                      isInConsideration(m.id) ? 'bg-[#0058be] text-white border-[#0058be]' : 'border-slate-300 text-slate-500 hover:border-[#0058be] hover:text-[#0058be]'
                                    }`}
                                    title="Thêm vào danh sách xem xét"
                                  >
                                    {isInConsideration(m.id) ? '✓ Đã chọn' : '+ Chọn'}
                                  </button>
                                )}
                              </div>
                              {projects.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-slate-100">
                                  <div className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-1">Dự án đã tham gia</div>
                                  <div className="flex flex-wrap gap-1">
                                    {projects.map((pname, idx) => (
                                      <span key={idx} className="text-[11px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{pname}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {mainTab === 'project-skill' && (
        <div className="space-y-4">
          {/* Nhân sự đang được xem xét */}
          {admin && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-[13px] font-extrabold text-slate-800 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#0058be]" /> Nhân sự đang được xem xét ({considerations.length})
              </h3>
              {considerationsLoading ? (
                <div className="flex items-center justify-center py-4 text-slate-400 gap-2 text-[12px]"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải...</div>
              ) : considerations.length === 0 ? (
                <p className="text-[12px] text-slate-400 py-2 text-center">Chưa chọn ai. Hãy chọn từ Hồ sơ nhân sự hoặc Skill Directory.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {considerations.map((c) => {
                    const busyInfo = c.busy_info?.length > 0 ? c.busy_info[0] : null;
                    return (
                      <div key={c.id} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                        <button
                          onClick={() => removeConsideration(c.member_id).then(() => setConsiderations(prev => prev.filter(x => x.member_id !== c.member_id)))}
                          className="text-slate-400 hover:text-rose-500 transition-colors"
                          title="Xóa khỏi danh sách"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[12px] font-bold text-slate-700">{c.member_name}</span>
                        {c.member_team && <span className="text-[10px] text-slate-400">({c.member_team})</span>}
                        {busyInfo && (
                          <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                            Đang bận {formatDate(busyInfo.start_date)} → {formatDate(busyInfo.end_date)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Mượn người cho dự án */}
          {admin && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-[13px] font-extrabold text-slate-800 flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-[#0058be]" /> Mượn người cho dự án
              </h3>
              <p className="text-[11.5px] text-slate-400">Chỉ chọn được người trong danh sách xem xét và không đang bận.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Project dropdown with search */}
                <div className="relative">
                  <label className="text-[11px] font-bold text-slate-500 mb-1 block">Dự án</label>
                  <input
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    placeholder="Tìm dự án..."
                    className="w-full text-[12px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be] mb-1"
                  />
                  <select value={loanProjectId} onChange={(e) => setLoanProjectId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
                    <option value="">-- Chọn dự án --</option>
                    {filteredLoanProjects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {/* Member dropdown - only from consideration list */}
                <div>
                  <label className="text-[11px] font-bold text-slate-500 mb-1 block">Người muốn mượn</label>
                  <select value={loanMemberId} onChange={(e) => setLoanMemberId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
                    <option value="">-- Chọn người --</option>
                    {considerations.filter(c => !c.busy_info?.length).map((c) => (
                      <option key={c.member_id} value={c.member_id}>{c.member_name}{c.member_team ? ` (${c.member_team})` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] font-bold text-slate-500 mb-1 block">Ngày bắt đầu</label>
                  <input
                    type="date"
                    value={loanStartDate}
                    onChange={(e) => setLoanStartDate(e.target.value)}
                    className="w-full text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 mb-1 block">Ngày kết thúc</label>
                  <input
                    type="date"
                    value={loanEndDate}
                    onChange={(e) => setLoanEndDate(e.target.value)}
                    min={loanStartDate}
                    className="w-full text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]"
                  />
                </div>
              </div>
              <input
                value={loanMessage}
                onChange={(e) => setLoanMessage(e.target.value)}
                placeholder="Lý do / ghi chú (không bắt buộc)"
                className="w-full text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]"
              />
              {loanError && <p className="text-[11.5px] text-red-600">{loanError}</p>}
              <button
                onClick={handleSendLoan}
                disabled={!loanProjectId || !loanMemberId || !loanStartDate || !loanEndDate || sendingLoan}
                className="flex items-center gap-1.5 text-[12px] font-bold text-white bg-[#0058be] hover:bg-[#0047a0] disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
              >
                {sendingLoan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Gửi yêu cầu mượn
              </button>
            </div>
          )}

          {/* Yêu cầu liên quan đến bạn */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
            <h3 className="text-[13px] font-extrabold text-slate-800">Yêu cầu liên quan đến bạn</h3>
            {loansLoading ? (
              <div className="flex items-center justify-center py-8 text-slate-400 gap-2 text-[12.5px]"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải...</div>
            ) : incoming.length === 0 ? (
              <p className="text-[12px] text-slate-400 py-4 text-center">Chưa có yêu cầu nào.</p>
            ) : (
              incoming.map((loan) => {
                const st = LOAN_STATUS_LABEL_RECIPIENT[loan.status];
                return (
                  <div key={loan.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[12.5px] font-bold text-slate-800">
                          {loan.requested_by_name || 'Một Leader'} muốn mượn <span className="text-[#0058be]">{loan.member_name}</span> cho dự án <span className="text-[#0058be]">{loan.project_name}</span>
                        </div>
                        {loan.start_date && loan.end_date && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Giai đoạn: {formatDate(loan.start_date)} → {formatDate(loan.end_date)}
                          </div>
                        )}
                        {loan.message && <div className="text-[11px] text-slate-400 mt-0.5">"{loan.message}"</div>}
                      </div>
                      <span className={`shrink-0 text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${st.tone}`}>{st.label}</span>
                    </div>
                    {loan.status === 'pending' && (
                      <div className="space-y-2">
                        {!showRejectInput[loan.id] ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleRespond(loan.id, 'accepted')}
                              disabled={respondingId === loan.id}
                              className="flex items-center gap-1 text-[11.5px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg"
                            >
                              <Check className="w-3.5 h-3.5" /> Đồng ý
                            </button>
                            <button
                              onClick={() => setShowRejectInput(prev => ({ ...prev, [loan.id]: true }))}
                              disabled={respondingId === loan.id}
                              className="flex items-center gap-1 text-[11.5px] font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg"
                            >
                              <X className="w-3.5 h-3.5" /> Từ chối
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <input
                              value={reasonDraft[loan.id] || ''}
                              onChange={(e) => setReasonDraft((prev) => ({ ...prev, [loan.id]: e.target.value }))}
                              placeholder="Lý do từ chối (bắt buộc)"
                              className="w-full text-[11.5px] border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleRespond(loan.id, 'rejected')}
                                disabled={respondingId === loan.id || !reasonDraft[loan.id]?.trim()}
                                className="text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 px-2.5 py-1 rounded-lg"
                              >
                                Xác nhận từ chối
                              </button>
                              <button
                                onClick={() => { setShowRejectInput(prev => ({ ...prev, [loan.id]: false })); setReasonDraft(prev => ({ ...prev, [loan.id]: '' })); }}
                                className="text-[11px] font-bold text-slate-500 hover:text-slate-700 px-2 py-1"
                              >
                                Hủy
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {loan.reason && loan.status !== 'pending' && (
                      <div className="text-[11px] text-slate-400">Lý do: {loan.reason}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Yêu cầu đã gửi */}
          {admin && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
              <h3 className="text-[13px] font-extrabold text-slate-800">Yêu cầu đã gửi</h3>
              {outgoing.length === 0 ? (
                <p className="text-[12px] text-slate-400 py-4 text-center">Bạn chưa gửi yêu cầu mượn người nào.</p>
              ) : (
                outgoing.map((loan) => {
                  const st = LOAN_STATUS_LABEL[loan.status];
                  return (
                    <div key={loan.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-[12.5px] font-bold text-slate-800">
                            Mượn <span className="text-[#0058be]">{loan.member_name}</span> cho dự án {loan.project_name}
                          </div>
                          {loan.start_date && loan.end_date && (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Giai đoạn: {formatDate(loan.start_date)} → {formatDate(loan.end_date)}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`shrink-0 text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${st.tone}`}>{st.label}</span>
                          {loan.status === 'pending' && (
                            <button
                              onClick={() => handleCancel(loan.id)}
                              className="text-[10.5px] font-bold text-white bg-rose-500 hover:bg-rose-600 px-2 py-0.5 rounded"
                            >
                              Hủy request
                            </button>
                          )}
                        </div>
                      </div>
                      {loan.reason && loan.status === 'rejected' && (
                        <div className="text-[11px] text-rose-500 bg-rose-50 px-2 py-1 rounded">Lý do từ chối: {loan.reason}</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {selectedMemberModal && (
        <MemberDetailModal
          member={selectedMemberModal}
          tasks={allTasks}
          projects={allProjects}
          onClose={() => setSelectedMemberModal(null)}
          onNavigate={(projectId) => { setSelectedMemberModal(null); window.location.href = `/project/detail/overview?id=${projectId}`; }}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          selectedWeek={selectedWeek}
          activeQuickFilter={activeQuickFilter}
          onApplyQuickFilter={applyQuickFilter}
          onYearChange={(v) => { setSelectedYear(v); setActiveQuickFilter(null); }}
          onMonthChange={(v) => { setSelectedMonth(v); setActiveQuickFilter(null); }}
          onWeekChange={(v) => { setSelectedWeek(v); setActiveQuickFilter(null); }}
        />
      )}
    </div>
  );
}
