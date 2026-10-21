'use client';
import { useEffect, useRef, useState, useMemo, ReactNode } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getProjects, deleteProject, bulkDeleteProjects, getCustomers, getWorkspaces, Workspace, getPinnedProjectIds, toggleProjectPin, setProjectCritical } from '@/lib/api';
import { isAdmin, isSuperAdmin } from '@/lib/auth';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';
import { useSidebarCollapse, SIDEBAR_PAD_EXPANDED, SIDEBAR_PAD_COLLAPSED } from '@/lib/sidebarCollapse';
import SearchableSelect from './common/SearchableSelect';
import ProjectFormModal from './ProjectFormModal';

const PROJECT_PHASES = [
  '1. Tư vấn', '2. Báo giá', '3. Làm specs', '4. Duyệt HSMT',
  '5. Chờ ra thầu', '6. Tham gia thầu POP', '6. Tham gia thầu nhà phụ',
  '7. Trúng Thầu', '7. Rớt thầu', '8. Ký hợp đồng', '9. Đặt hàng',
  '10. Giao hàng', '11. Triển khai', '12. Hoàn thành triển khai',
  '13. Nghiệm thu', '14. Thanh toán', '15. Kết thúc dự án', '0. Huỷ'
];

type ProjectColumn = 'pm' | 'sales' | 'activeManday' | 'completedManday' | 'activeKpi' | 'completedKpi' | 'activeTasks' | 'completedTasks' | 'overdueTasks';

const DEFAULT_PROJECT_COLUMNS: Record<ProjectColumn, boolean> = {
  pm: true,
  sales: true,
  activeManday: true,
  completedManday: true,
  activeKpi: true,
  completedKpi: true,
  activeTasks: true,
  completedTasks: true,
  overdueTasks: true,
};

const getPhaseBadgeStyle = (phase: string) => {
  if (!phase) return 'bg-slate-100 text-slate-600 border border-slate-200/50';
  const clean = phase.toLowerCase();
  if (clean.includes('tư vấn') || clean.includes('báo giá')) {
    return 'bg-blue-50 text-blue-700 border border-blue-200/30';
  }
  if (clean.includes('triển khai') || clean.includes('hoàn thành')) {
    return 'bg-indigo-50 text-indigo-700 border border-indigo-200/30';
  }
  if (clean.includes('duyệt') || clean.includes('hợp đồng') || clean.includes('ký')) {
    return 'bg-purple-50 text-purple-700 border border-purple-200/30';
  }
  if (clean.includes('init') || clean.includes('khởi tạo')) {
    return 'bg-pink-50 text-pink-700 border border-pink-200/30';
  }
  if (clean.includes('nghiệm thu') || clean.includes('trúng')) {
    return 'bg-emerald-50 text-emerald-700 border border-emerald-200/30';
  }
  if (clean.includes('huỷ') || clean.includes('rớt')) {
    return 'bg-red-50 text-red-700 border border-red-200/30';
  }
  return 'bg-sky-50 text-sky-700 border border-sky-200/30';
};

const getPaginationRange = (current: number, total: number) => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const range: (number | string)[] = [];
  const siblingCount = 1;

  for (let i = 1; i <= total; i++) {
    if (
      i === 1 ||
      i === total ||
      (i >= current - siblingCount && i <= current + siblingCount)
    ) {
      range.push(i);
    } else if (
      (i === 2 && current - siblingCount > 2) ||
      (i === total - 1 && current + siblingCount < total - 1)
    ) {
      range.push("...");
    }
  }

  const result: (number | string)[] = [];
  let prev: number | string | null = null;
  for (const val of range) {
    if (val === "..." && prev === "...") continue;
    result.push(val);
    prev = val;
  }
  return result;
};

interface ProjectListContentProps {
  /** Workspace code to lock the list to (Project Hub). Hides the Workspace
   * filter and prevents switching away from it. Undefined/omitted keeps the
   * original standalone /projects behavior unchanged. */
  lockedWorkspace?: string;
  /** Project Hub — renders a tab bar (Projects/Customers) right below the
   * page header. Undefined/omitted keeps the original standalone page look. */
  renderTabs?: () => ReactNode;
}

export default function ProjectListContent({ lockedWorkspace, renderTabs }: ProjectListContentProps = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { collapsed: sidebarCollapsed } = useSidebarCollapse();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramCustId = searchParams.get('customer_id');
  const paramCustName = searchParams.get('customer');
  const paramYear = searchParams.get('year');

  const canManage = isAdmin();
  const canManageCritical = isSuperAdmin();
  const { workspaceCode: ctxWorkspaceCode } = useWorkspaceFilter();
  const [search, setSearch] = useState('');
  // 'all' (same value as the dropdown's "Tất cả Workspace" option) = every
  // Workspace; otherwise a Workspace name/code. Defaults to the Navbar's one.
  const [businessFilter, setBusinessFilter] = useState(ctxWorkspaceCode || 'all');
  const [phaseFilter, setPhaseFilter] = useState('All');
  const [customerFilter, setCustomerFilter] = useState('All');
  const [pmFilter, setPmFilter] = useState('All');
  const [salesFilter, setSalesFilter] = useState('All');
  const [memberFilter, setMemberFilter] = useState('All');
  const [yearFilter, setYearFilter] = useState('All');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Record<ProjectColumn, boolean>>(DEFAULT_PROJECT_COLUMNS);
  const [sortBy, setSortBy] = useState('newest');

  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showProjectFormModal, setShowProjectFormModal] = useState(false);
  const [projectFormMode, setProjectFormMode] = useState<'create' | 'edit'>('create');
  const [editingProject, setEditingProject] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  // Nhớ lựa chọn Lưới/Danh sách theo trình duyệt (không cần đồng bộ server).
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pm_project_list_view');
      if (saved === 'grid' || saved === 'list') setViewMode(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('pm_project_list_view', viewMode); } catch {}
  }, [viewMode]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pm_project_list_columns');
      if (saved) setVisibleColumns({ ...DEFAULT_PROJECT_COLUMNS, ...JSON.parse(saved) });
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('pm_project_list_columns', JSON.stringify(visibleColumns)); } catch {}
  }, [visibleColumns]);

  // Close the per-card "..." menu on any click outside it — the button/dropdown
  // themselves stop propagation, so only genuine outside clicks reach here.
  useEffect(() => {
    if (menuOpenId === null) return;
    const handler = () => setMenuOpenId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuOpenId]);

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => getCustomers(),
    staleTime: 5 * 60_000,
  });
  const customers: any[] = customersData || [];
  const { data: workspacesData } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => getWorkspaces(),
    staleTime: 5 * 60_000,
  });
  const workspaces: Workspace[] = workspacesData || [];

  // Only an explicit customer_id from the URL narrows the API call. A pick
  // from the customer-name dropdown is filtered client-side by name below —
  // resolving it to an id here picked the wrong one of two same-named
  // customers.
  const resolvedCustomerId: number | null = useMemo(() => {
    if (paramCustId) {
      const n = Number(paramCustId);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }, [paramCustId]);

  // Workspace is the first dataset constraint. Use its code for the API so
  // all later filter options and the table originate from the same scope.
  // 'all'/'All' means every Workspace (backend treats a missing value as
  // unscoped); the Navbar default is applied by setting businessFilter itself.
  const selectedWorkspace = useMemo(() => {
    if (lockedWorkspace) return lockedWorkspace;
    if (businessFilter.toLowerCase() === 'all') return undefined;
    return workspaces.find(w => w.name === businessFilter || w.code === businessFilter)?.code || businessFilter;
  }, [lockedWorkspace, businessFilter, workspaces]);

  const { data: listData, refetch: reload, isFetching: listFetching } = useQuery({
    queryKey: ['project-list', selectedWorkspace, resolvedCustomerId],
    queryFn: async () => {
      const projs = await getProjects({
        business_unit: selectedWorkspace,
        customer_id: resolvedCustomerId || undefined,
      });
      return {
        projects: projs || [],
      };
    },
    // Keep showing the previous list while a new key loads, so the filter
    // options (and the stale-filter cleanup below) don't see an empty list.
    placeholderData: keepPreviousData,
  });
  const { data: pinnedIdsData } = useQuery({
    queryKey: ['project-pins'],
    queryFn: () => getPinnedProjectIds(),
  });
  const pinnedIds = useMemo(() => new Set<number>(pinnedIdsData || []), [pinnedIdsData]);
  const handleTogglePin = async (e: React.MouseEvent, projectId: number) => {
    e.stopPropagation();
    // Optimistic update so the pin/reorder feels instant, then reconcile with the server.
    const prevIds = pinnedIdsData || [];
    const nextIds = prevIds.includes(projectId) ? prevIds.filter((id: number) => id !== projectId) : [...prevIds, projectId];
    queryClient.setQueryData(['project-pins'], nextIds);
    try {
      await toggleProjectPin(projectId);
    } catch {
      queryClient.setQueryData(['project-pins'], prevIds);
      setMsg({ t: 'Không thể ghim dự án, vui lòng thử lại.', e: true });
    }
  };
  const projects: any[] = listData?.projects || [];

  // Project Hub: lock the Workspace filter to the current tab's Workspace.
  useEffect(() => {
    if (!lockedWorkspace) return;
    const ws = workspaces.find(w => w.code === lockedWorkspace);
    setBusinessFilter(ws?.name || lockedWorkspace);
  }, [lockedWorkspace, workspaces]);

  // When not locked to a specific Project Hub tab, default to whatever
  // Workspace is selected app-wide (Navbar switcher) — keeps this list
  // consistent with Dashboard/KPI. The dropdown below still lets the user
  // override it locally without touching the shared selection.
  //
  // manualWorkspacePickRef guards against this effect re-firing and
  // silently reverting a manual pick (incl. "Tất cả Workspace" -> 'all')
  // back to the Navbar's Workspace — it used to fire on every reference
  // change of `workspaces` (e.g. any background refetch of that query),
  // which for a Leader/Member with a fixed Workspace snapped the list back
  // to their Chính Workspace only, hiding the Phụ Workspace's projects
  // again even though "Tất cả Workspace" was still selected on screen.
  // A real change of ctxWorkspaceCode (Navbar switcher used elsewhere)
  // still re-syncs, since that's a deliberate cross-page action.
  const manualWorkspacePickRef = useRef(false);
  const lastCtxWorkspaceCodeRef = useRef(ctxWorkspaceCode);
  useEffect(() => {
    if (lockedWorkspace || !ctxWorkspaceCode) return;
    if (manualWorkspacePickRef.current && ctxWorkspaceCode === lastCtxWorkspaceCodeRef.current) return;
    lastCtxWorkspaceCodeRef.current = ctxWorkspaceCode;
    manualWorkspacePickRef.current = false;
    const ws = workspaces.find(w => w.code === ctxWorkspaceCode);
    setBusinessFilter(ws?.name || ctxWorkspaceCode);
  }, [lockedWorkspace, ctxWorkspaceCode, workspaces]);

  // Sync URL query params to filter states — only when the params themselves
  // change (or once customers load to resolve a customer_id). Re-running on
  // every customers refetch (background sync) reset the user's own picks.
  const appliedUrlParamsRef = useRef<string | null>(null);
  // Set when we strip customer params from the URL ourselves (dropdown pick),
  // so that URL change doesn't reset the filter the user just chose.
  const skipUrlSyncRef = useRef(false);
  useEffect(() => {
    const sig = `${paramCustId}|${paramCustName}|${paramYear}`;
    if (appliedUrlParamsRef.current === sig) return;
    if (paramCustId && customers.length === 0) return;
    appliedUrlParamsRef.current = sig;
    if (skipUrlSyncRef.current) {
      skipUrlSyncRef.current = false;
      return;
    }
    if (paramCustId) {
      if (customers.length > 0) {
        const found = customers.find(c => String(c.id) === String(paramCustId));
        if (found) {
          setCustomerFilter(found.name);
        }
      }
    } else if (paramCustName) {
      setCustomerFilter(paramCustName);
    } else {
      setCustomerFilter('All');
    }

    if (paramYear) {
      setYearFilter(paramYear);
    } else {
      setYearFilter('All');
    }
  }, [paramCustId, paramCustName, paramYear, customers]);

  const flash = (t: string, e = false) => { setMsg({ t, e }); setTimeout(() => setMsg(null), 4000); };

  // "Xóa lọc" returns the Workspace filter to the page's default — the
  // Navbar's Workspace, or every Workspace when the Navbar has none — so the
  // dropdown label always matches the list actually shown.
  const handleResetFilters = () => {
    setSearch('');
    if (!lockedWorkspace) {
      manualWorkspacePickRef.current = false;
      setBusinessFilter(ctxWorkspaceCode
        ? (workspaces.find(w => w.code === ctxWorkspaceCode)?.name || ctxWorkspaceCode)
        : 'all');
    }
    setPhaseFilter('All');
    setCustomerFilter('All');
    setPmFilter('All');
    setSalesFilter('All');
    setMemberFilter('All');
    setYearFilter('All');
    setOverdueOnly(false);
    setCriticalOnly(false);
    setPage(1);
    if (!lockedWorkspace) router.replace(pathname);
  };

  // Dynamic lists from loaded data memoized
  const uniqueCustomers = useMemo(() => {
    return Array.from(new Set(projects.map(p => p.customer_name).filter(Boolean))).sort();
  }, [projects]);

  const uniquePms = useMemo(() => {
    const names: string[] = [];
    projects.forEach(p => {
      (p.pm_name || '').split(',').map((s: string) => s.trim()).filter((s: string) => s).forEach((n: string) => names.push(n));
    });
    return Array.from(new Set(names)).sort();
  }, [projects]);

  const uniqueSales = useMemo(() => {
    const names: string[] = [];
    projects.forEach(p => {
      (p.sales_name || '').split(',').map((s: string) => s.trim()).filter((s: string) => s).forEach((n: string) => names.push(n));
    });
    return Array.from(new Set(names)).sort();
  }, [projects]);

  const uniqueMembers = useMemo(() => {
    const names: string[] = [];
    projects.forEach(p => {
      if (p.member_names) {
        p.member_names.split(',').map((s: string) => s.trim()).filter(Boolean).forEach((n: string) => names.push(n));
      }
      if (Array.isArray(p.members)) {
        p.members.forEach((m: any) => { if (m?.name) names.push(m.name); });
      }
      if (p.pm_name) {
        p.pm_name.split(',').map((s: string) => s.trim()).filter(Boolean).forEach((n: string) => names.push(n));
      }
      if (p.technical_leader_name) {
        p.technical_leader_name.split(',').map((s: string) => s.trim()).filter(Boolean).forEach((n: string) => names.push(n));
      }
      if (p.sales_name) {
        p.sales_name.split(',').map((s: string) => s.trim()).filter(Boolean).forEach((n: string) => names.push(n));
      }
    });
    return Array.from(new Set(names)).sort();
  }, [projects]);

  const uniqueYears = useMemo(() => {
    return Array.from(new Set(projects.map(p => p.year).filter(v => v !== null && v !== undefined))).sort((a, b) => (b as number) - (a as number));
  }, [projects]);

  // A Workspace switch replaces the source dataset. Clear any downstream
  // selection that is not available in that Workspace instead of leaving a
  // stale filter that belongs to the previous one.
  // Skipped while the list is (re)loading: the options then still describe
  // the previous dataset (or none yet) and would wrongly reset a fresh pick.
  useEffect(() => {
    if (listFetching || !listData) return;
    if (customerFilter !== 'All' && !uniqueCustomers.includes(customerFilter)) setCustomerFilter('All');
    if (pmFilter !== 'All' && !uniquePms.includes(pmFilter)) setPmFilter('All');
    if (salesFilter !== 'All' && !uniqueSales.includes(salesFilter)) setSalesFilter('All');
    if (memberFilter !== 'All' && !uniqueMembers.includes(memberFilter)) setMemberFilter('All');
    if (yearFilter !== 'All' && !uniqueYears.map(String).includes(yearFilter)) setYearFilter('All');
  }, [listFetching, listData, customerFilter, pmFilter, salesFilter, memberFilter, yearFilter, uniqueCustomers, uniquePms, uniqueSales, uniqueMembers, uniqueYears]);

  // Filter memoized. No Workspace check here — the API call above is already
  // scoped to selectedWorkspace by the backend (_apply_workspace_scope), which
  // owns the Workspace-tab rule incl. the assigned-project override. A second
  // client-side Workspace filter only drifts from it and hides projects the
  // backend correctly returned (e.g. a Leader's team-assigned project).
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return projects.filter(p => {
      const matchSearch = [p.name, p.code, p.customer_name, p.pm_name].some(v => (v || '').toLowerCase().includes(q));
      const matchPhase = phaseFilter === 'All' || p.current_phase === phaseFilter;
      const matchCustomer = customerFilter === 'All' ||
        (p.customer_name && p.customer_name.toLowerCase() === customerFilter.toLowerCase()) ||
        (paramCustId && String(p.customer_id) === String(paramCustId));
      const matchPm = pmFilter === 'All' ||
        (p.pm_name || '').split(',').map((s: string) => s.trim()).includes(pmFilter);
      const matchSales = salesFilter === 'All' ||
        (p.sales_name || '').split(',').map((s: string) => s.trim()).includes(salesFilter);
      const matchMember = memberFilter === 'All' || (() => {
        const mLower = memberFilter.toLowerCase();
        const projMemberNames: string[] = [];
        if (p.member_names) projMemberNames.push(...p.member_names.split(',').map((s: string) => s.trim()));
        if (Array.isArray(p.members)) p.members.forEach((m: any) => { if (m?.name) projMemberNames.push(m.name); });
        if (p.pm_name) projMemberNames.push(...p.pm_name.split(',').map((s: string) => s.trim()));
        if (p.technical_leader_name) projMemberNames.push(...p.technical_leader_name.split(',').map((s: string) => s.trim()));
        if (p.sales_name) projMemberNames.push(...p.sales_name.split(',').map((s: string) => s.trim()));
        return projMemberNames.some(name => name.toLowerCase() === mLower);
      })();
      const matchYear = yearFilter === 'All' || String(p.year) === yearFilter;
      const matchOverdue = !overdueOnly || (p.warning_task_count || 0) > 0;
      const matchCritical = !criticalOnly || p.is_critical === true;
      return matchSearch && matchPhase && matchCustomer && matchPm && matchSales && matchMember && matchYear && matchOverdue && matchCritical;
    });
  }, [projects, search, phaseFilter, customerFilter, paramCustId, pmFilter, salesFilter, memberFilter, yearFilter, overdueOnly, criticalOnly]);

  // Sort memoized — pinned projects always float to the top; the chosen
  // sortBy comparator only breaks ties within each (pinned / unpinned) group.
  const sorted = useMemo(() => {
    const compare = (a: any, b: any) => {
      if (sortBy === 'newest') {
        const timeA = new Date(a.last_activity_at || a.updated_at || a.created_at || 0).getTime();
        const timeB = new Date(b.last_activity_at || b.updated_at || b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return b.id - a.id;
      }
      if (sortBy === 'oldest') {
        const timeA = new Date(a.last_activity_at || a.updated_at || a.created_at || 0).getTime();
        const timeB = new Date(b.last_activity_at || b.updated_at || b.created_at || 0).getTime();
        if (timeA !== timeB) return timeA - timeB;
        return a.id - b.id;
      }
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name, 'vi');
      if (sortBy === 'name_desc') return b.name.localeCompare(a.name, 'vi');
      if (sortBy === 'overdue_desc') return (b.warning_task_count || 0) - (a.warning_task_count || 0);
      if (sortBy === 'manday_active_desc') return (b.active_manday || 0) - (a.active_manday || 0);
      if (sortBy === 'kpi_active_desc') return (b.active_kpi || 0) - (a.active_kpi || 0);
      return 0;
    };
    return [...filtered].sort((a, b) => {
      const aPinned = pinnedIds.has(a.id) ? 0 : 1;
      const bPinned = pinnedIds.has(b.id) ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      return compare(a, b);
    });
  }, [filtered, sortBy, pinnedIds]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  // Clamp the page when the list shrinks (delete, refetch, filter change
  // that didn't reset the page) so we never sit on an empty page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Bulk selection only ever covers projects in the current filtered list —
  // otherwise "Xóa đã chọn" would also delete projects hidden by a filter,
  // search or Workspace switch.
  const filteredIds = useMemo(() => new Set<number>(filtered.map(p => p.id)), [filtered]);
  useEffect(() => {
    setSelectedIds(prev => {
      const next = prev.filter(id => filteredIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredIds]);
  const visibleSelectedIds = selectedIds.filter(id => filteredIds.has(id));
  const mandayColumnCount = Number(visibleColumns.activeManday) + Number(visibleColumns.completedManday);
  const kpiColumnCount = Number(visibleColumns.activeKpi) + Number(visibleColumns.completedKpi);
  const taskColumnCount = Number(visibleColumns.activeTasks) + Number(visibleColumns.completedTasks) + Number(visibleColumns.overdueTasks);
  const hasMetricColumns = mandayColumnCount + kpiColumnCount + taskColumnCount > 0;

  const handleSetCritical = async (project: any) => {
    try {
      await setProjectCritical(project.id, !project.is_critical);
      setMenuOpenId(null);
      await reload();
      flash(project.is_critical ? 'Đã bỏ đánh dấu Critical.' : 'Đã đánh dấu dự án Critical.');
    } catch (e: any) {
      flash(e?.response?.data?.detail || 'Không thể cập nhật Critical.', true);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#f8fafc]" style={{ fontFamily: "'Inter', sans-serif" }}>
      <Navbar />
      <div className={`flex-1 min-w-0 pl-0 ${sidebarCollapsed ? SIDEBAR_PAD_COLLAPSED : SIDEBAR_PAD_EXPANDED} pt-14 md:pt-0 flex flex-col min-h-screen transition-[padding] duration-200`}>
        <div className="p-4 md:p-8 space-y-6 max-w-[1400px] w-full mx-auto">
          {msg && (
            <div className={`fixed top-6 right-6 z-50 rounded-xl px-5 py-3 text-sm font-semibold shadow-xl border backdrop-blur-sm transition-all duration-300 transform translate-y-0 ${msg.e ? 'bg-red-50/90 text-red-700 border-red-200' : 'bg-emerald-50/90 text-emerald-700 border-emerald-200'}`}>
              {msg.t}
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Danh sách dự án</h1>
              <p className="text-sm text-slate-500 mt-1">Quản lý và theo dõi tiến độ các dự án tuân thủ bảo mật.</p>
            </div>

            <div className="flex items-center gap-3">
              {renderTabs && renderTabs()}
              {canManage && (
                <button
                  onClick={() => { setProjectFormMode('create'); setEditingProject(null); setShowProjectFormModal(true); }}
                  className="flex items-center gap-1.5 bg-[#0058be] hover:bg-[#00479c] text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm transition-colors shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Tạo dự án
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3.5 shadow-sm relative z-30">
            <div className="relative flex-1 min-w-[240px]">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" placeholder="Tìm kiếm tên dự án, khách hàng..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none text-slate-700 focus:border-indigo-500 bg-slate-50/20" />
            </div>

            {!lockedWorkspace && (
              <SearchableSelect
                label="Workspace"
                icon="🗂️"
                options={workspaces.map(ws => ({ id: ws.name, name: ws.name }))}
                value={businessFilter}
                onChange={val => { manualWorkspacePickRef.current = true; setBusinessFilter(String(val)); setPage(1); }}
                placeholder="Tìm Workspace..."
              />
            )}

            <SearchableSelect
              label="PM"
              icon="👔"
              options={uniquePms.map(pm => ({ id: pm, name: pm }))}
              value={pmFilter}
              onChange={val => { setPmFilter(String(val)); setPage(1); }}
              placeholder="Tìm PM..."
            />

            <SearchableSelect
              label="Sales"
              icon="💼"
              options={uniqueSales.map(s => ({ id: s, name: s }))}
              value={salesFilter}
              onChange={val => { setSalesFilter(String(val)); setPage(1); }}
              placeholder="Tìm Sales..."
            />

            <SearchableSelect
              label="khách hàng"
              icon="🏢"
              options={uniqueCustomers.map(cust => ({ id: cust, name: cust }))}
              value={customerFilter}
              onChange={val => {
                // A customer from the URL (customer_id / customer) would keep
                // winning over the dropdown — drop it so the pick takes effect.
                if (paramCustId || paramCustName) {
                  const next = new URLSearchParams(searchParams.toString());
                  next.delete('customer_id');
                  next.delete('customer');
                  skipUrlSyncRef.current = true;
                  router.replace(next.toString() ? `${pathname}?${next}` : pathname);
                }
                setCustomerFilter(String(val));
                setPage(1);
              }}
              placeholder="Tìm khách hàng..."
            />

            <SearchableSelect
              label="năm"
              icon="📅"
              options={uniqueYears.map(yr => ({ id: String(yr), name: String(yr) }))}
              value={yearFilter}
              onChange={val => { setYearFilter(String(val)); setPage(1); }}
              placeholder="Tìm năm..."
            />

            <button
              type="button"
              onClick={() => { setCriticalOnly(v => !v); setPage(1); }}
              className={`h-[34px] px-3 rounded-lg border text-xs font-semibold transition-colors ${criticalOnly ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              🚩 Critical
            </button>

            <button
              type="button"
              onClick={() => { setOverdueOnly(v => !v); setPage(1); }}
              className={`h-[34px] px-3 rounded-lg border text-xs font-semibold transition-colors ${overdueOnly ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Có task trễ
            </button>

            <details className="relative shrink-0">
              <summary className="list-none flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer h-[34px]">
                Bộ lọc khác <span className="text-slate-400">▾</span>
              </summary>
              <div className="absolute right-0 mt-2 p-3 bg-white border border-slate-200 rounded-lg shadow-lg z-40 flex flex-col gap-2 min-w-[220px]">
                <SearchableSelect
                  label="giai đoạn"
                  icon="🚩"
                  options={PROJECT_PHASES.map(ph => ({ id: ph, name: ph }))}
                  value={phaseFilter}
                  onChange={val => { setPhaseFilter(String(val)); setPage(1); }}
                  placeholder="Tìm giai đoạn..."
                />
                <SearchableSelect
                  label="thành viên"
                  icon="👥"
                  options={uniqueMembers.map(m => ({ id: m, name: m }))}
                  value={memberFilter}
                  onChange={val => { setMemberFilter(String(val)); setPage(1); }}
                  placeholder="Tìm thành viên..."
                />
              </div>
            </details>

            {viewMode === 'list' && <details className="relative shrink-0 ml-auto">
              <summary className="list-none flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer h-[34px]">
                ⚙ Cột hiển thị <span className="text-slate-400">▾</span>
              </summary>
              <div className="absolute right-0 mt-2 p-3 bg-white border border-slate-200 rounded-lg shadow-lg z-40 min-w-[220px] text-xs">
                <p className="font-bold text-slate-500 uppercase tracking-wider mb-2">Cột hiển thị</p>
                {([
                  ['pm', 'PM'], ['sales', 'Sale'],
                  ['activeManday', 'Manday · Đang làm'], ['completedManday', 'Manday · Hoàn thành'],
                  ['activeKpi', 'KPI · Đang làm'], ['completedKpi', 'KPI · Hoàn thành'],
                  ['activeTasks', 'Task · Đang làm'], ['completedTasks', 'Task · Hoàn thành'], ['overdueTasks', 'Task · Trễ'],
                ] as [ProjectColumn, string][]).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 py-1.5 text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleColumns[key]}
                      onChange={e => setVisibleColumns(prev => ({ ...prev, [key]: e.target.checked }))}
                      className="accent-[#0058be]"
                    />
                    {label}
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => setVisibleColumns({ ...DEFAULT_PROJECT_COLUMNS })}
                  className="w-full text-left mt-2 pt-2 border-t border-slate-200 text-[#0058be] font-semibold hover:text-[#00479c]"
                >
                  Khôi phục mặc định
                </button>
              </div>
            </details>}

            {canManage && (
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer shrink-0 bg-slate-50/20 px-3 py-1.5 border border-slate-200 rounded-lg h-[34px]">
                <input
                  type="checkbox"
                  checked={paged.length > 0 && paged.every(p => selectedIds.includes(p.id))}
                  onChange={(e) => {
                    setSelectedIds(prev => e.target.checked
                      ? Array.from(new Set([...prev, ...paged.map(p => p.id)]))
                      : prev.filter(id => !paged.some(p => p.id === id)));
                  }}
                  className="w-4 h-4 rounded border-slate-300 cursor-pointer accent-[#0058be]"
                />
                Chọn trang này
              </label>
            )}
            <div className={`flex items-center gap-0.5 bg-slate-50/20 border border-slate-200 rounded-lg h-[34px] p-0.5 shrink-0 ${viewMode === 'grid' ? 'ml-auto' : ''}`}>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title="Xem dạng lưới"
                className={`w-[30px] h-[26px] flex items-center justify-center rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-[#0058be]' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                title="Xem dạng danh sách"
                className={`w-[30px] h-[26px] flex items-center justify-center rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-[#0058be]' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2 bg-slate-50/20 px-3 py-1.5 border border-slate-200 rounded-lg h-[34px] shrink-0">
              <span className="text-xs text-slate-500 font-semibold">Sắp xếp:</span>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer">
                <option value="newest">Mới nhất</option>
                <option value="oldest">Cũ nhất</option>
                <option value="name_asc">Tên (A-Z)</option>
                <option value="name_desc">Tên (Z-A)</option>
                <option value="overdue_desc">Task trễ ↓</option>
                <option value="manday_active_desc">Manday đang làm ↓</option>
                <option value="kpi_active_desc">KPI đang làm ↓</option>
              </select>
            </div>

            <button onClick={handleResetFilters} className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors flex-shrink-0 h-[34px]">
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" stroke="red" strokeWidth={1.5} />
              </svg>
              Xóa lọc
            </button>
          </div>

          {viewMode === 'grid' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {paged.map(p => {
              const phaseBadge = getPhaseBadgeStyle(p.current_phase);
              return (
                <div key={p.id} onClick={() => router.push(`/project/detail/overview?id=${p.id}`)}
                  className="bg-white border border-slate-200/80 rounded-xl overflow-hidden flex flex-col cursor-pointer group shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-300 hover:-translate-y-0.5 relative">
                  {canManage && (
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        setSelectedIds(prev => e.target.checked ? [...prev, p.id] : prev.filter(x => x !== p.id));
                      }}
                      className="absolute top-3 left-3 z-10 w-4 h-4 rounded border-slate-300 cursor-pointer accent-[#0058be]"
                    />
                  )}
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => handleTogglePin(e, p.id)}
                          className={`w-6 h-6 flex items-center justify-center rounded-md transition-all shrink-0 cursor-pointer text-sm ${pinnedIds.has(p.id) ? 'bg-amber-50 hover:bg-amber-100' : 'opacity-25 grayscale hover:opacity-70 hover:grayscale-0'}`}
                          title={pinnedIds.has(p.id) ? 'Bỏ ghim dự án' : 'Ghim dự án lên đầu danh sách'}
                        >
                          📌
                        </button>
                        <span className="text-[11px] font-bold text-slate-500 bg-slate-100/80 border border-slate-200 px-2 py-0.5 rounded">Năm: {p.year || '—'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded uppercase tracking-wider ${phaseBadge}`}>{p.current_phase || '1. Tư vấn'}</span>
                        {canManage && (
                          <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setMenuOpenId(prev => prev === p.id ? null : p.id)}
                              className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors shrink-0 cursor-pointer"
                              title="Tuỳ chọn dự án"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                              </svg>
                            </button>
                            {menuOpenId === p.id && (
                              <div className="absolute right-0 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-20 py-1">
                                <button
                                  onClick={() => { setMenuOpenId(null); setProjectFormMode('edit'); setEditingProject(p); setShowProjectFormModal(true); }}
                                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                >
                                  ✏️ Chỉnh sửa
                                </button>
                                {canManageCritical && (
                                  <button
                                    onClick={() => handleSetCritical(p)}
                                    className="w-full text-left px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer border-t border-slate-100"
                                  >
                                    {p.is_critical ? '✓ Bỏ Critical' : '🚩 Đánh dấu Critical'}
                                  </button>
                                )}
                                <button
                                  onClick={() => { setMenuOpenId(null); setDeleteId(p.id); }}
                                  className="w-full text-left px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer border-t border-slate-100"
                                >
                                  🗑 Xóa dự án
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {p.is_critical && <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-red-50 text-red-600 border border-red-200">🚩 Critical</span>}
                      {p.is_external && <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200" title="Dự án thuộc Workspace khác — hiện ở đây vì bạn hoặc team được gán vào">Tham gia ngoài</span>}
                      <h3 className="text-base font-bold text-slate-800 group-hover:text-indigo-600 transition-colors line-clamp-1">{p.name}</h3>
                      {p.business && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-extrabold uppercase tracking-wide bg-indigo-50 text-indigo-600 border border-indigo-200" title={`Dự án thuộc Workspace ${p.business}`}>
                          {p.business}
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-slate-500 mb-5 line-clamp-1 italic flex items-center gap-1.5"><span className="not-italic text-sm">🏢</span> {p.customer_name || 'Chưa có khách hàng'}</p>
                    
                    <div className="mb-3">
                      <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">PM</p>
                      <p className="text-[13px] font-semibold text-slate-700 truncate" title={p.pm_name}>{p.pm_name || <span className="text-slate-400 italic">—</span>}</p>
                    </div>
                    <div className="mb-5">
                      <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Sale</p>
                      <p className="text-[13px] font-semibold text-slate-700 truncate">{p.sales_name || <span className="text-slate-400 italic">--</span>}</p>
                    </div>

                    <div className="border-t border-slate-100 pt-4 mt-auto grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1.5">Manday</p>
                        <p className="text-[12px] font-bold text-amber-700 tabular-nums">{p.active_manday ?? 0} <span className="font-medium text-slate-500">đang</span></p>
                        <p className="text-[12px] font-bold text-emerald-600 tabular-nums">{p.completed_manday ?? 0} <span className="font-medium text-slate-500">xong</span></p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1.5">KPI</p>
                        <p className="text-[12px] font-bold text-indigo-700 tabular-nums">{p.active_kpi ?? 0} <span className="font-medium text-slate-500">đang</span></p>
                        <p className="text-[12px] font-bold text-emerald-600 tabular-nums">{p.completed_kpi ?? 0} <span className="font-medium text-slate-500">xong</span></p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1.5">Task</p>
                        <p className="text-[12px] font-bold text-slate-800 tabular-nums">{p.active_task_count ?? 0} <span className="font-medium text-slate-500">đang</span></p>
                        <p className="text-[12px] font-bold text-emerald-600 tabular-nums">{p.completed_task_count ?? 0} <span className="font-medium text-slate-500">xong</span></p>
                        <p className="text-[12px] font-bold text-rose-600 tabular-nums">{p.warning_task_count ?? 0} <span className="font-medium">trễ</span></p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {viewMode === 'list' && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200">
                    {canManage && <th className="px-4 py-2.5 w-8" rowSpan={hasMetricColumns ? 2 : 1}></th>}
                    <th className="px-2 py-2.5 w-8" rowSpan={hasMetricColumns ? 2 : 1}></th>
                    <th className="px-3 py-2.5 min-w-[220px]" rowSpan={hasMetricColumns ? 2 : 1}>Dự án</th>
                    {visibleColumns.pm && <th className="px-3 py-2.5" rowSpan={hasMetricColumns ? 2 : 1}>PM</th>}
                    {visibleColumns.sales && <th className="px-3 py-2.5" rowSpan={hasMetricColumns ? 2 : 1}>Sale</th>}
                    {mandayColumnCount > 0 && <th className="px-3 py-2.5 text-center" colSpan={mandayColumnCount}>Manday</th>}
                    {kpiColumnCount > 0 && <th className="px-3 py-2.5 text-center" colSpan={kpiColumnCount}>KPI</th>}
                    {taskColumnCount > 0 && <th className="px-3 py-2.5 text-center" colSpan={taskColumnCount}>Task</th>}
                    <th className="px-3 py-2.5 w-10" rowSpan={hasMetricColumns ? 2 : 1}></th>
                  </tr>
                  {hasMetricColumns && <tr className="bg-slate-50 text-slate-400 uppercase text-[9px] font-bold tracking-wider border-b border-slate-200">
                    {visibleColumns.activeManday && <th className="px-3 py-2 text-center">Đang làm</th>}
                    {visibleColumns.completedManday && <th className="px-3 py-2 text-center">Hoàn thành</th>}
                    {visibleColumns.activeKpi && <th className="px-3 py-2 text-center">Đang làm</th>}
                    {visibleColumns.completedKpi && <th className="px-3 py-2 text-center">Hoàn thành</th>}
                    {visibleColumns.activeTasks && <th className="px-3 py-2 text-center">Đang làm</th>}
                    {visibleColumns.completedTasks && <th className="px-3 py-2 text-center">Hoàn thành</th>}
                    {visibleColumns.overdueTasks && <th className="px-3 py-2 text-center">Trễ</th>}
                  </tr>}
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paged.map(p => {
                    const phaseBadge = getPhaseBadgeStyle(p.current_phase);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => router.push(`/project/detail/overview?id=${p.id}`)}
                        className="cursor-pointer hover:bg-slate-50/70 transition-colors group"
                      >
                        {canManage && (
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(p.id)}
                              onChange={(e) => {
                                setSelectedIds(prev => e.target.checked ? [...prev, p.id] : prev.filter(x => x !== p.id));
                              }}
                              className="w-4 h-4 rounded border-slate-300 cursor-pointer accent-[#0058be]"
                            />
                          </td>
                        )}
                        <td className="px-2 py-3">
                          <button
                            onClick={(e) => handleTogglePin(e, p.id)}
                            className={`w-6 h-6 flex items-center justify-center rounded-md transition-all shrink-0 cursor-pointer text-sm ${pinnedIds.has(p.id) ? 'bg-amber-50 hover:bg-amber-100' : 'opacity-25 grayscale hover:opacity-70 hover:grayscale-0'}`}
                            title={pinnedIds.has(p.id) ? 'Bỏ ghim dự án' : 'Ghim dự án lên đầu danh sách'}
                          >
                            📌
                          </button>
                        </td>
                        <td className="px-3 py-3 max-w-[280px]">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate" title={p.name}>{p.name}</span>
                            {p.is_critical && <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-red-50 text-red-600 border border-red-200">🚩 Critical</span>}
                            {p.is_external && <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200" title="Dự án thuộc Workspace khác — hiện ở đây vì bạn hoặc team được gán vào">Tham gia ngoài</span>}
                            {p.business && (
                              <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-indigo-50 text-indigo-600 border border-indigo-200">{p.business}</span>
                            )}
                          </div>
                          <p className="text-[11.5px] text-slate-500 truncate italic">{p.customer_name || 'Chưa có khách hàng'} · Năm {p.year || '—'}</p>
                        </td>
                        {visibleColumns.pm && <td className="px-3 py-3 text-[12.5px] font-semibold text-slate-700 max-w-[160px] truncate" title={p.pm_name}>{p.pm_name || <span className="text-slate-400 italic font-normal">—</span>}</td>}
                        {visibleColumns.sales && <td className="px-3 py-3 text-[12.5px] font-semibold text-slate-700 max-w-[140px] truncate" title={p.sales_name}>{p.sales_name || <span className="text-slate-400 italic font-normal">--</span>}</td>}
                        {visibleColumns.activeManday && <td className="px-3 py-3 text-center text-[13px] font-bold text-amber-700 tabular-nums">{p.active_manday ?? 0}</td>}
                        {visibleColumns.completedManday && <td className="px-3 py-3 text-center text-[13px] font-bold text-emerald-600 tabular-nums">{p.completed_manday ?? 0}</td>}
                        {visibleColumns.activeKpi && <td className="px-3 py-3 text-center text-[13px] font-bold text-indigo-700 tabular-nums">{p.active_kpi ?? 0}</td>}
                        {visibleColumns.completedKpi && <td className="px-3 py-3 text-center text-[13px] font-bold text-emerald-600 tabular-nums">{p.completed_kpi ?? 0}</td>}
                        {visibleColumns.activeTasks && <td className="px-3 py-3 text-center text-[13px] font-bold text-slate-800">{p.active_task_count ?? 0}</td>}
                        {visibleColumns.completedTasks && <td className="px-3 py-3 text-center text-[13px] font-bold text-emerald-600">{p.completed_task_count ?? 0}</td>}
                        {visibleColumns.overdueTasks && <td className="px-3 py-3 text-center text-[13px] font-bold text-rose-600">{p.warning_task_count ?? 0}</td>}
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          {canManage && (
                            <div className="relative">
                              <button
                                onClick={() => setMenuOpenId(prev => prev === p.id ? null : p.id)}
                                className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors shrink-0 cursor-pointer"
                                title="Tuỳ chọn dự án"
                              >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                                </svg>
                              </button>
                              {menuOpenId === p.id && (
                                <div className="absolute right-0 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-20 py-1">
                                  <button
                                    onClick={() => { setMenuOpenId(null); setProjectFormMode('edit'); setEditingProject(p); setShowProjectFormModal(true); }}
                                    className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                  >
                                    ✏️ Chỉnh sửa
                                  </button>
                                  {canManageCritical && (
                                    <button
                                      onClick={() => handleSetCritical(p)}
                                      className="w-full text-left px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer border-t border-slate-100"
                                    >
                                      {p.is_critical ? '✓ Bỏ Critical' : '🚩 Đánh dấu Critical'}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => { setMenuOpenId(null); setDeleteId(p.id); }}
                                    className="w-full text-left px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer border-t border-slate-100"
                                  >
                                    🗑 Xóa dự án
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 border-t border-slate-200 pt-6">
            {/* Left: Project Count */}
            <div>
              <p className="text-sm text-slate-500 font-medium">
                <span className="font-bold text-slate-700">{filtered.length}</span> dự án
              </p>
            </div>

            {/* Center: Range Display */}
            <div>
              <p className="text-xs text-slate-400 font-medium select-none">
                Hiển thị <span className="font-semibold text-slate-600">{Math.min((page - 1) * pageSize + 1, filtered.length)}</span> - <span className="font-semibold text-slate-600">{Math.min(page * pageSize, filtered.length)}</span> / <span className="font-semibold text-slate-600">{filtered.length}</span>
              </p>
            </div>

            {/* Right: Page size selector and page pagination */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 border border-slate-200 rounded-lg shadow-2xs">
                <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Hiện:</span>
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer"
                >
                  <option value={9}>9 / trang</option>
                  <option value={20}>20 / trang</option>
                  <option value={50}>50 / trang</option>
                  <option value={100}>100 / trang</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="w-8 h-8 border border-slate-200 rounded-lg flex items-center justify-center bg-white hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
                >
                  <svg className="w-3.5 h-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                {getPaginationRange(page, totalPages).map((p, idx) => {
                  if (p === "...") {
                    return (
                      <span key={`ellipsis-${idx}`} className="w-8 h-8 flex items-center justify-center text-slate-400 text-xs select-none">
                        ...
                      </span>
                    );
                  }
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(Number(p))}
                      className={`w-8 h-8 border rounded-lg flex items-center justify-center text-xs font-bold transition-all ${
                        p === page
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-600/10'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="w-8 h-8 border border-slate-200 rounded-lg flex items-center justify-center bg-white hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
                >
                  <svg className="w-3.5 h-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {visibleSelectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-[#0b1c30] text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4">
          <span className="text-sm font-semibold">Đã chọn {visibleSelectedIds.length} dự án</span>
          <button onClick={() => setSelectedIds([])} className="text-xs font-semibold text-slate-300 hover:text-white">Bỏ chọn</button>
          <button
            onClick={() => setShowBulkDeleteConfirm(true)}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[#dc2626] hover:bg-red-700 text-white"
          >
            🗑 Xóa đã chọn
          </button>
        </div>
      )}

      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#c2c6d6] rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h2 className="text-base font-bold text-[#0b1c30] mb-2">⚠️ Xóa {visibleSelectedIds.length} dự án</h2>
            <p className="text-sm text-[#565e74] mb-6">Bạn có chắc muốn xóa {visibleSelectedIds.length} dự án đã chọn? Hành động này không thể hoàn tác.</p>
            <div className="flex justify-end gap-3">
              <button disabled={bulkDeleting} onClick={() => setShowBulkDeleteConfirm(false)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#0b1c30]">Hủy</button>
              <button
                disabled={bulkDeleting}
                onClick={async () => {
                  setBulkDeleting(true);
                  const idsToDelete = visibleSelectedIds;
                  try {
                    const res = await bulkDeleteProjects(idsToDelete);
                    reload();
                    const okCount = res.deleted_ids?.length || 0;
                    const failCount = res.failed?.length || 0;
                    if (failCount === 0) {
                      flash(`Đã xóa ${okCount} dự án!`);
                    } else {
                      flash(`Đã xóa ${okCount}/${idsToDelete.length} dự án. ${failCount} dự án không thể xóa (không có quyền hoặc không tồn tại).`, true);
                    }
                  } catch (e: any) {
                    flash(e?.response?.data?.detail || 'Xóa hàng loạt thất bại', true);
                  }
                  setSelectedIds([]);
                  setShowBulkDeleteConfirm(false);
                  setBulkDeleting(false);
                }}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#dc2626] hover:bg-red-700 text-white shadow-sm disabled:opacity-50"
              >
                {bulkDeleting ? 'Đang xóa...' : 'Xóa'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProjectFormModal
        isOpen={showProjectFormModal}
        mode={projectFormMode}
        editingProject={editingProject}
        defaultBusiness={lockedWorkspace ? (workspaces.find(w => w.code === lockedWorkspace)?.name || lockedWorkspace) : (businessFilter.toLowerCase() !== 'all' ? businessFilter : undefined)}
        onClose={() => setShowProjectFormModal(false)}
        onSaved={() => reload()}
        onFlash={flash}
      />

      {deleteId !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#c2c6d6] rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h2 className="text-base font-bold text-[#0b1c30] mb-2">⚠️ Xóa dự án</h2>
            <p className="text-sm text-[#565e74] mb-6">Bạn có chắc muốn xóa dự án này?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#0b1c30]">Hủy</button>
              <button onClick={async () => {
                // Backend enforces the real rule (super_admin, or a leader scoped
                // to this project) — no need to duplicate it here.
                try { await deleteProject(deleteId); setSelectedIds(prev => prev.filter(x => x !== deleteId)); reload(); flash('Đã xóa!'); } catch(e: any) { flash(e?.response?.data?.detail || 'Xóa thất bại', true); } setDeleteId(null);
              }}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#dc2626] hover:bg-red-700 text-white shadow-sm">Xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
