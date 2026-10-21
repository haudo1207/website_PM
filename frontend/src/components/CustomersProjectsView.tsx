'use client';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { isSuperAdmin, isAdmin } from '@/lib/auth';
import SearchableSelect from '@/components/common/SearchableSelect';
import ProjectFormModal from './ProjectFormModal';
import {
  getCustomers,
  getCustomersByWorkspace,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerLinkedProjects,
  getProjects,
  deleteProject,
  getMembers,
  getWorkspaces,
  Workspace
} from '@/lib/api';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';

interface CustomersProjectsViewProps {
  onFlash: (msg: string, isError?: boolean) => void;
  /** Project Hub — locks the view to a single Workspace: hides the Workspace
   * tabs/header and fetches Customers via the Project-derived endpoint
   * (Customer.business_unit is unreliable, see backend access.customer_query_for_user)
   * instead of the legacy `Customer.business_unit`-based one. */
  lockedWorkspace?: string;
  /** Optional tab switcher (e.g. Projects/Customers) rendered on the same
   * header row as the title — mirrors ProjectListContent's `renderTabs`. */
  renderTabs?: () => React.ReactNode;
}

interface ComboboxOption {
  id: number;
  name: string;
}

// Projects with a null/empty year go into a "Không rõ năm" bucket,
// represented internally by the sentinel year 0.
const UNKNOWN_YEAR = 0;
const yearOf = (p: any): number => (p.year ? Number(p.year) : UNKNOWN_YEAR);



export default function CustomersProjectsView({ onFlash, lockedWorkspace, renderTabs }: CustomersProjectsViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Loading states
  const [actionLoading, setActionLoading] = useState(false);

  // Selection states
  const [activeBU, setActiveBU] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  // Mounted state for SSR-safe portal rendering
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Filter/Search states
  const [customerSearch, setCustomerSearch] = useState('');

  // V2 Filter & Sort States
  const [selectedPmIds, setSelectedPmIds] = useState<number[]>([]);
  const [selectedSalesIds, setSelectedSalesIds] = useState<number[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [sortMode, setSortMode] = useState<string>('activity_desc');

  // Customer Inline Form / Edit states
  const [newCustomerName, setNewCustomerName] = useState('');
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [editingCustomerName, setEditingCustomerName] = useState('');
  const [showCustomerDeleteModal, setShowCustomerDeleteModal] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState<{ id: number; name: string; linkedProjects: any[] } | null>(null);

  // Project Modal state — form fields/dropdowns/template picker now live
  // inside the shared <ProjectFormModal>; this component only tracks
  // open/mode/which project is being edited.
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showProjectDeleteModal, setShowProjectDeleteModal] = useState(false);
  const [deletingProject, setDeletingProject] = useState<any | null>(null);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingProject, setEditingProject] = useState<any | null>(null);

  // Body and HTML scroll lock effect when modal is active
  useEffect(() => {
    if (showProjectModal || showCustomerDeleteModal || showProjectDeleteModal) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [showProjectModal, showCustomerDeleteModal, showProjectDeleteModal]);

  // Workspace list for the (non-locked) tab switcher — shared cache key with
  // Navbar/Project Hub so switching pages doesn't refetch this near-static data.
  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => getWorkspaces(),
    enabled: !lockedWorkspace,
    staleTime: 5 * 60_000,
  });
  const workspaces: Workspace[] = workspacesQuery.data || [];

  // Company selection is shared app-wide via WorkspaceFilterProvider (see
  // Navbar's Workspace switcher) — follow it here too so switching Workspace
  // there also switches this tab, instead of staying on whatever was first.
  const { workspaceCode: ctxWorkspaceCode, setWorkspaceCode: setCtxWorkspaceCode } = useWorkspaceFilter();

  useEffect(() => {
    if (lockedWorkspace) {
      setActiveBU(lockedWorkspace);
    } else if (ctxWorkspaceCode && workspaces.some(w => w.code === ctxWorkspaceCode)) {
      setActiveBU(ctxWorkspaceCode);
    } else if (workspaces.length > 0) {
      setActiveBU(prev => prev || workspaces[0].code);
    }
  }, [lockedWorkspace, workspaces, ctxWorkspaceCode]);

  // Base data (Customers/Members) — cached per Workspace, does not refetch
  // on PM/Sales/Member/sort filter changes.
  const baseDataKey = ['workspace-base-data', activeBU, lockedWorkspace ? 'by-project' : 'by-business-unit'];
  const baseQuery = useQuery({
    queryKey: baseDataKey,
    // Errors are re-thrown (not swallowed into []) so a failed load surfaces
    // as an error state instead of looking like "no customers".
    queryFn: async () => {
      const [custs, mems] = await Promise.all([
        (lockedWorkspace ? getCustomersByWorkspace(activeBU) : getCustomers(activeBU)).catch((e: any) => { console.error('getCustomers error:', e); throw e; }),
        getMembers().catch((e: any) => { console.error('getMembers error:', e); throw e; }),
      ]);
      return { customers: custs || [], members: mems || [] };
    },
    enabled: !!activeBU,
  });
  const customers: any[] = baseQuery.data?.customers || [];
  const members: any[] = baseQuery.data?.members || [];

  // Projects — cached per Workspace + filter/sort combo (its own key so a
  // filter change doesn't force-refetch Customers/Members/MasterPhases).
  const projectsKey = ['workspace-projects', activeBU, selectedPmIds, selectedSalesIds, selectedMemberIds, sortMode];
  const projectsQuery = useQuery({
    queryKey: projectsKey,
    queryFn: () => getProjects({
      business_unit: activeBU,
      pm_ids: selectedPmIds.length > 0 ? selectedPmIds.join(',') : undefined,
      sales_ids: selectedSalesIds.length > 0 ? selectedSalesIds.join(',') : undefined,
      member_ids: selectedMemberIds.length > 0 ? selectedMemberIds.join(',') : undefined,
      sort: sortMode
    }).catch((e: any) => { console.error('getProjects error:', e); throw e; }),
    enabled: !!activeBU,
  });
  const projects: any[] = projectsQuery.data || [];
  const loading = baseQuery.isLoading || projectsQuery.isLoading;
  const loadError = baseQuery.isError || projectsQuery.isError;

  // Auto-select the first Customer once per Workspace switch (matches the
  // legacy behavior) — but never on a silent background revalidation, so an
  // in-progress selection isn't yanked away by cache/focus refetches.
  // Only marked done once the list is non-empty, so a later successful load
  // (e.g. after an empty/failed one) still auto-selects.
  const autoSelectedForBU = useRef<string | null>(null);
  useEffect(() => {
    if (!baseQuery.data || autoSelectedForBU.current === activeBU) return;
    const custs = baseQuery.data.customers;
    if (custs.length > 0) {
      autoSelectedForBU.current = activeBU;
      setSelectedCustomerId(custs[0].id);
    } else {
      setSelectedCustomerId(null);
    }
  }, [activeBU, baseQuery.data]);

  // Dangling selection: the selected Customer disappeared after a refetch
  // (deleted here or by someone else) → fall back to the first one (or none).
  useEffect(() => {
    if (!baseQuery.data || selectedCustomerId == null) return;
    const custs = baseQuery.data.customers;
    if (!custs.some((c: any) => c.id === selectedCustomerId)) {
      setSelectedCustomerId(custs.length > 0 ? custs[0].id : null);
    }
  }, [baseQuery.data, selectedCustomerId]);

  // Clear the Customer search when switching Workspace.
  useEffect(() => {
    setCustomerSearch('');
  }, [activeBU]);

  // Refetch Customers + Projects without touching the current selection
  // (the dangling-selection effect above handles removed Customers).
  const reloadAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workspace-base-data', activeBU] }),
      queryClient.invalidateQueries({ queryKey: ['workspace-projects', activeBU] }),
    ]);
  };

  const reloadProjects = async () => {
    await queryClient.invalidateQueries({ queryKey: ['workspace-projects', activeBU] });
  };

  // Filtered Customers based on search
  const filteredCustomers = useMemo(() => {
    return customers.filter(c =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase())
    );
  }, [customers, customerSearch]);

  // Keep the selection visible: if the search hides the selected Customer,
  // move the selection to the first match.
  useEffect(() => {
    if (!customerSearch.trim() || filteredCustomers.length === 0) return;
    if (!filteredCustomers.some(c => c.id === selectedCustomerId)) {
      setSelectedCustomerId(filteredCustomers[0].id);
    }
  }, [customerSearch, filteredCustomers, selectedCustomerId]);

  // Workspace code → display name, used to prefill <ProjectFormModal>'s
  // default workspace from the currently active Workspace tab.
  const wsNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    (workspaces || []).forEach(w => m.set(w.code, w.name));
    return m;
  }, [workspaces]);

  // Selected Customer details
  const selectedCustomer = useMemo(() => {
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  // Customer id → Projects index, built once per data change (instead of
  // filtering all projects per Customer on every render).
  // Customer identity = `customer_id` (authoritative), or — for legacy rows
  // where `customer_id` is NULL — a matching `customer_name`. Same rule as
  // the backend cascade/unlink on Customer delete. Used by the count badge,
  // the project list (customerProjects) and the delete dialog so they stay
  // consistent. Preserves the backend's project order (sortMode).
  const projectsByCustomer = useMemo(() => {
    const idsByName = new Map<string, number[]>();
    customers.forEach(c => {
      const n = (c.name || '').trim().toLowerCase();
      if (!n) return;
      const arr = idsByName.get(n);
      if (arr) arr.push(c.id); else idsByName.set(n, [c.id]);
    });
    const index = new Map<number, any[]>();
    const add = (cid: number, p: any) => {
      const arr = index.get(cid);
      if (arr) arr.push(p); else index.set(cid, [p]);
    };
    projects.forEach(p => {
      if (p.customer_id != null) {
        add(Number(p.customer_id), p);
      } else {
        const n = (p.customer_name || '').trim().toLowerCase();
        if (n) (idsByName.get(n) || []).forEach(cid => add(cid, p));
      }
    });
    return index;
  }, [projects, customers]);

  // All projects belonging to the selected customer
  const customerProjects = useMemo(() => {
    if (!selectedCustomerId || !selectedCustomer) return [];
    return projectsByCustomer.get(Number(selectedCustomer.id)) || [];
  }, [projectsByCustomer, selectedCustomerId, selectedCustomer]);

  // Computed distinct years for selected customer (unknown bucket last)
  const customerYears = useMemo(() => {
    const yearsSet = new Set<number>();
    customerProjects.forEach(p => {
      yearsSet.add(yearOf(p));
    });
    return Array.from(yearsSet).sort((a, b) => b - a); // Descending order (0 last)
  }, [customerProjects]);

  // Year to select once the refetched projects include it (set after
  // creating a project) — keeps the sync effect below from clobbering it.
  const pendingYearRef = useRef<number | null>(null);

  // Sync selected year when customerYears change
  useEffect(() => {
    const pending = pendingYearRef.current;
    if (pending != null) {
      if (customerYears.includes(pending)) {
        pendingYearRef.current = null;
        setSelectedYear(pending);
        return;
      }
      // Wait for the in-flight refetch before giving up on the pending year.
      if (projectsQuery.isFetching) return;
      pendingYearRef.current = null;
    }
    if (customerYears.length > 0) {
      if (selectedYear === null || !customerYears.includes(selectedYear)) {
        setSelectedYear(customerYears[0]);
      }
    } else {
      setSelectedYear(null);
    }
  }, [customerYears, projectsQuery.isFetching]);

  // Final filtered projects for the third column (selected customer + selected year)
  const filteredProjects = useMemo(() => {
    if (selectedYear === null) return [];
    return customerProjects.filter(p => yearOf(p) === selectedYear);
  }, [customerProjects, selectedYear]);

  // Statistics for Customer Card
  const customerStats = useMemo(() => {
    const projCount = customerProjects.length;
    const yearsCount = customerYears.filter(y => y !== UNKNOWN_YEAR).length;
    let totalTasks = 0;
    
    customerProjects.forEach(p => {
      totalTasks += p.task_count || 0;
    });

    return {
      projects: projCount,
      years: yearsCount,
      tasks: totalTasks
    };
  }, [customerProjects, customerYears]);

  // --- CUSTOMER CRUD HANDLERS ---
  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) return;
    setActionLoading(true);
    try {
      const created = await createCustomer({ name: newCustomerName.trim(), business_unit: activeBU });
      setNewCustomerName('');
      onFlash(`Đã thêm khách hàng thành công`);

      // Refresh the list and select the newly created customer
      await queryClient.invalidateQueries({ queryKey: ['workspace-base-data', activeBU] });
      if (created && created.id) {
        setSelectedCustomerId(created.id);
      }
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm khách hàng', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartEditCustomer = (c: any) => {
    setEditingCustomerId(c.id);
    setEditingCustomerName(c.name);
  };

  const handleSaveCustomerName = async (id: number) => {
    if (!editingCustomerName.trim()) return;
    setActionLoading(true);
    try {
      await updateCustomer(id, { name: editingCustomerName.trim() });
      setEditingCustomerId(null);
      onFlash('Đã cập nhật tên khách hàng');

      await queryClient.invalidateQueries({ queryKey: ['workspace-base-data', activeBU] });
      // Also reload projects to reflect updated customer names
      reloadProjects();
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật khách hàng', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteCustomerClick = async (id: number, name: string) => {
    if (!isAdmin()) {
      alert('Bạn không có quyền thực hiện thao tác xóa khách hàng!');
      return;
    }
    // The cascade/unlink spans every Workspace, so ask the backend for the real
    // list; fall back to this Workspace's projects (same rule) if that fails.
    let linkedProjects: any[] = projectsByCustomer.get(Number(id)) || [];
    try {
      linkedProjects = await getCustomerLinkedProjects(id);
    } catch (e) {
      console.error('getCustomerLinkedProjects error:', e);
    }
    setDeletingCustomer({ id, name, linkedProjects });
    setShowCustomerDeleteModal(true);
  };

  const confirmDeleteCustomer = async (cascade: boolean) => {
    if (!deletingCustomer) return;
    const { id, name } = deletingCustomer;
    setActionLoading(true);
    try {
      await deleteCustomer(id, cascade);
      onFlash(cascade ? `Đã xóa khách hàng "${name}" cùng toàn bộ dự án liên quan` : `Đã xóa khách hàng "${name}" thành công`);
      setShowCustomerDeleteModal(false);
      setDeletingCustomer(null);
      // Selection is kept if it still exists; otherwise the dangling-selection
      // effect picks the first remaining Customer.
      await reloadAll();
    } catch (err: any) {
      onFlash(err.response?.data?.detail || err.message || 'Lỗi xóa khách hàng', true);
    } finally {
      setActionLoading(false);
    }
  };

  // --- PROJECT CRUD HANDLERS ---
  const handleOpenCreateProject = () => {
    setModalMode('create');
    setEditingProject(null);
    setShowProjectModal(true);
  };

  const handleOpenEditProject = (proj: any) => {
    setModalMode('edit');
    setEditingProject(proj);
    setShowProjectModal(true);
  };

  const handleProjectFormSaved = async (created: any) => {
    // Keep the selected Customer; after create, jump to the new project's year.
    if (modalMode === 'create' && created?.year) {
      pendingYearRef.current = Number(created.year);
      setSelectedYear(Number(created.year));
    }
    await reloadAll();
  };

  const handleDeleteProjectClick = (proj: any) => {
    if (!isAdmin()) {
      alert('Bạn không có quyền thực hiện thao tác xóa dự án!');
      return;
    }
    setDeletingProject(proj);
    setShowProjectDeleteModal(true);
  };

  const confirmDeleteProject = async () => {
    if (!deletingProject) return;
    setActionLoading(true);
    try {
      await deleteProject(deletingProject.id);
      onFlash(`Đã xóa dự án "${deletingProject.name}" thành công`);
      setShowProjectDeleteModal(false);
      setDeletingProject(null);
      await reloadAll();
    } catch (err: any) {
      onFlash('Lỗi xóa dự án: ' + (err.response?.data?.detail || err.message), true);
    } finally {
      setActionLoading(false);
    }
  };

  // Memoized options for SearchableSelect
  const memberOptions = useMemo<ComboboxOption[]>(() => {
    return (members || [])
      .map((m: any) => ({
        id: m.id,
        name: m.display_name || m.full_name || m.email || `Member #${m.id}`
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [members]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Đang tải dữ liệu...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ contentVisibility: 'auto' }}>
      
      {/* Page Header — hidden when Project Hub locks this view to a single
          Workspace (Project Hub already shows the Workspace name there). */}
      {!lockedWorkspace && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">Quản lý khách hàng &amp; dự án</h1>
            <p className="text-sm text-slate-500 mt-1">Quản lý danh mục Khách hàng → Năm → Dự án theo Workspace</p>
          </div>

          {/* Workspace filter (dropdown) — mirrors the Workspace filter on the
              Projects tab instead of a dedicated pill row. */}
          <div className="flex items-center gap-3 self-start sm:self-auto">
            {workspaces.length === 0 ? (
              <span className="text-xs font-semibold text-slate-400">No Workspaces</span>
            ) : (
              <SearchableSelect
                label="Workspace"
                icon="🏢"
                options={workspaces.map(ws => ({ id: ws.code, name: ws.name }))}
                value={activeBU}
                onChange={val => {
                  // This view always shows one Workspace — ignore the picker's "all" row.
                  const code = String(val);
                  if (!code || code.toLowerCase() === 'all') return;
                  setActiveBU(code);
                  // Write it to the shared filter too, so the Navbar agrees and the
                  // effect above doesn't snap back to the old Navbar Workspace.
                  setCtxWorkspaceCode(code);
                }}
                placeholder="Tìm Workspace..."
                align="right"
                className="w-[200px]"
              />
            )}
            {renderTabs && renderTabs()}
          </div>
        </div>
      )}



      {/* Load error — queries throw instead of returning [] so a failure
          isn't mistaken for an empty Workspace. */}
      {loadError && (
        <div className="flex items-center justify-between gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
          <span className="font-semibold">⚠️ Không tải được dữ liệu</span>
          <button
            type="button"
            onClick={() => { baseQuery.refetch(); projectsQuery.refetch(); }}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-xs font-bold transition-all shadow-sm"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* 3-Column Portfolio UI Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* ============================================================== */}
        {/* COLUMN 1: CUSTOMERS */}
        {/* ============================================================== */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[calc(100vh-206px)] min-h-[480px] max-h-[750px] transition-all">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
            <span className="text-xs font-bold text-[#0f172a] uppercase tracking-wider">🏢 Khách hàng</span>
            <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">{customers.length}</span>
          </div>

          {/* Search bar inside column */}
          <div className="p-3 bg-white border-b border-slate-100 shrink-0">
            <div className="relative">
              <input
                type="text"
                placeholder="Tìm khách hàng..."
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:bg-white focus:border-blue-500 transition-all"
              />
              <svg className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Customer list */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredCustomers.map(cat => {
              const isSelected = selectedCustomerId === cat.id;
              const isEditing = editingCustomerId === cat.id;
              
              // Count projects for this customer — same index as the project
              // list so the badge matches it (id OR legacy name).
              const pCount = (projectsByCustomer.get(Number(cat.id)) || []).length;

              return (
                <div
                  key={cat.id}
                  onClick={() => {
                    if (!isEditing) {
                      setSelectedCustomerId(cat.id);
                    }
                  }}
                  className={`p-3.5 flex flex-col gap-2 cursor-pointer transition-all ${
                    isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600' : 'hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {isEditing ? (
                      <div className="flex-1 flex gap-1.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editingCustomerName}
                          onChange={e => setEditingCustomerName(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none"
                        />
                        <button
                          onClick={() => handleSaveCustomerName(cat.id)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded text-[10px] font-bold"
                        >
                          Lưu
                        </button>
                        <button
                          onClick={() => setEditingCustomerId(null)}
                          className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded text-[10px] font-bold"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <span className="font-semibold text-xs leading-relaxed text-[#0f172a]">
                        🏢 {cat.name}
                      </span>
                    )}

                    {!isEditing && (
                      <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleStartEditCustomer(cat)}
                          className="text-[10px] text-blue-600 hover:underline font-medium"
                        >
                          Sửa
                        </button>
                        {isSuperAdmin() && (
                          <button
                            onClick={() => handleDeleteCustomerClick(cat.id, cat.name)}
                            className="text-[10px] text-red-600 hover:underline font-medium"
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-medium">
                      {pCount} dự án
                    </span>
                  </div>
                </div>
              );
            })}
            
            {filteredCustomers.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-10 italic">Không tìm thấy khách hàng nào.</p>
            )}
          </div>

          {/* Add customer inline footer */}
          <form onSubmit={handleAddCustomer} className="p-3 bg-slate-50 border-t border-slate-200 flex gap-2 shrink-0">
            <input
              required
              type="text"
              placeholder="Khách hàng mới..."
              value={newCustomerName}
              onChange={e => setNewCustomerName(e.target.value)}
              className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-[#0f172a] placeholder-slate-400 focus:border-blue-500 outline-none"
            />
            <button
              type="submit"
              disabled={actionLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-bold transition-all shadow-sm disabled:opacity-50"
            >
              Thêm
            </button>
          </form>
        </div>

        {/* ============================================================== */}
        {/* COLUMN 2: YEARS */}
        {/* ============================================================== */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[calc(100vh-206px)] min-h-[480px] max-h-[750px] transition-all">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
            <span className="text-xs font-bold text-[#0f172a] uppercase tracking-wider">📅 Năm</span>
            <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">{customerStats.years}</span>
          </div>

          {/* Customer Statistics Card (Tích hợp thống kê ở Cột 2 khi chọn khách hàng) */}
          {selectedCustomer ? (
            <div className="p-4 bg-slate-50 border-b border-slate-100 shrink-0">
              <div className="bg-white border border-slate-150 rounded-lg p-3 shadow-xs space-y-2">
                <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  🏢 {selectedCustomer.name}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-slate-100">
                  <div>
                    <div className="text-xs font-bold text-blue-600">{customerStats.projects}</div>
                    <div className="text-[9px] text-slate-400 font-semibold uppercase">Dự án</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-violet-600">{customerStats.years}</div>
                    <div className="text-[9px] text-slate-400 font-semibold uppercase">Năm</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-emerald-600">{customerStats.tasks}</div>
                    <div className="text-[9px] text-slate-400 font-semibold uppercase">Tasks</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Years list */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {selectedCustomerId ? (
              customerYears.map(yr => {
                const isSelected = selectedYear === yr;
                
                // Count projects under this year
                const yProjCount = customerProjects.filter(p => yearOf(p) === yr).length;

                return (
                  <div
                    key={yr}
                    onClick={() => setSelectedYear(yr)}
                    className={`p-3.5 flex justify-between items-center cursor-pointer transition-all ${
                      isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600' : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <span className="font-semibold text-xs text-[#0f172a]">
                      📆 {yr === UNKNOWN_YEAR ? 'Không rõ năm' : `Năm ${yr}`}
                    </span>
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold">
                      {yProjCount} dự án
                    </span>
                  </div>
                )
              })
            ) : (
              <p className="text-xs text-slate-400 text-center py-10 italic">Vui lòng chọn Khách hàng ở cột bên trái.</p>
            )}

            {selectedCustomerId && customerYears.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-10 italic">Chưa có dự án nào để tính năm.</p>
            )}
          </div>

          <div className="p-3 bg-slate-50 border-t border-slate-200 text-center text-[10px] text-slate-400 select-none shrink-0 font-medium uppercase tracking-wider">
            Năm tự động tính từ Projects
          </div>
        </div>

        {/* ============================================================== */}
        {/* COLUMN 3: PROJECTS */}
        {/* ============================================================== */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[calc(100vh-206px)] min-h-[480px] max-h-[750px] transition-all">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
            <span className="text-xs font-bold text-[#0f172a] uppercase tracking-wider">📁 Dự án</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                {filteredProjects.length}
              </span>
              {selectedCustomerId && (
                <button
                  onClick={handleOpenCreateProject}
                  className="bg-blue-600 hover:bg-blue-700 text-white w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs shadow-sm transition-all"
                  title="Thêm dự án"
                >
                  +
                </button>
              )}
            </div>
          </div>

          {/* Projects list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
            {selectedYear !== null ? (
              filteredProjects.map(proj => {
                // Get PM & Leader names
                const pmText = proj.pm_name || 'Chưa phân công';
                const leaderText = proj.technical_leader_name || 'Chưa phân công';
                
                return (
                  <div
                    key={proj.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col gap-2.5 relative"
                  >
                    {/* Project Header: name + current phase (project status is not shown) */}
                    <div className="flex justify-between items-start gap-2">
                      <div className="font-bold text-sm text-[#0f172a]">
                        {proj.name}
                      </div>
                      <span
                        className="px-2 py-0.5 rounded text-[9px] font-semibold bg-slate-100 text-slate-600 whitespace-nowrap shrink-0 max-w-[50%] truncate"
                        title={proj.current_phase || undefined}
                      >
                        {proj.current_phase || '—'}
                      </span>
                    </div>

                    {/* Meta info */}
                    <div className="text-xs text-slate-500 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[10px] text-slate-400 uppercase w-12 shrink-0">PM:</span>
                        <span className="text-[#0f172a] font-medium truncate">{pmText}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[10px] text-slate-400 uppercase w-12 shrink-0">Leader:</span>
                        <span className="text-[#0f172a] font-medium truncate">{leaderText}</span>
                      </div>
                    </div>

                    {/* Stats pills */}
                    <div className="flex gap-2 pt-1 border-t border-slate-100">
                      <span className="text-[10px] font-semibold text-slate-500 flex items-center gap-1">
                        👥 {proj.members?.length || 0} members
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 flex items-center gap-1">
                        📋 {proj.task_count || 0} tasks
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-slate-100">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleOpenEditProject(proj)}
                          className="text-[10px] text-blue-600 hover:underline font-semibold"
                        >
                          Sửa
                        </button>
                        {isAdmin() && (
                          <button
                            onClick={() => handleDeleteProjectClick(proj)}
                            className="text-[10px] text-red-600 hover:underline font-semibold"
                          >
                            Xóa
                          </button>
                        )}
                      </div>

                      <button
                        onClick={() => router.push(`/project/detail/overview?id=${proj.id}`)}
                        className="bg-blue-50 hover:bg-blue-100 text-blue-600 px-2.5 py-1 rounded text-[10px] font-bold tracking-wide uppercase transition-all shadow-2xs"
                      >
                        [Open Project]
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-20 text-slate-400">
                <svg className="w-12 h-12 mx-auto text-slate-300 stroke-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="text-xs italic mt-2">Chọn Năm ở cột bên trái để hiển thị danh sách dự án.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <ProjectFormModal
        isOpen={showProjectModal}
        mode={modalMode}
        editingProject={editingProject}
        defaultCustomerId={selectedCustomerId || undefined}
        defaultBusiness={wsNameByCode.get(activeBU) || activeBU}
        defaultYear={selectedYear || undefined}
        onClose={() => setShowProjectModal(false)}
        onSaved={handleProjectFormSaved}
        onFlash={onFlash}
      />

      {/* ============================================================== */}
      {/* CUSTOMER DELETE CONFIRMATION MODAL */}
      {/* ============================================================== */}
      {showCustomerDeleteModal && deletingCustomer && mounted && createPortal(
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center font-bold text-lg">🗑️</div>
              <div>
                <h3 className="text-base font-bold text-[#0f172a]">Xác nhận xóa Khách hàng</h3>
                <p className="text-xs text-slate-500 font-semibold">{deletingCustomer.name}</p>
              </div>
            </div>

            {deletingCustomer.linkedProjects.length > 0 ? (
              <div className="space-y-3 my-4">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                  <p className="font-bold flex items-center gap-1.5">
                    <span>⚠️</span> Đang có {deletingCustomer.linkedProjects.length} dự án liên kết với khách hàng này:
                  </p>
                  <ul className="mt-1.5 ml-4 list-disc space-y-0.5 max-h-28 overflow-y-auto font-medium">
                    {deletingCustomer.linkedProjects.map(p => (
                      <li key={p.id}>{p.name} ({p.year || '—'}{p.business ? ` · ${p.business}` : ''})</li>
                    ))}
                  </ul>
                </div>
                <p className="text-xs text-slate-600 font-medium">Vui lòng chọn hình thức xử lý khi xóa:</p>

                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => confirmDeleteCustomer(false)}
                    className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50/50 transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#0f172a] group-hover:text-blue-700">1. Gỡ liên kết & Giữ lại dự án</span>
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-semibold">An toàn (Khuyên dùng)</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">Xóa khách hàng, giữ lại các dự án và đặt thông tin khách hàng của dự án về trống.</p>
                  </button>

                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => confirmDeleteCustomer(true)}
                    className="w-full text-left p-3 rounded-xl border border-red-200 hover:border-red-500 hover:bg-red-50/50 transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-red-700">2. Xóa sạch khách hàng & Tất cả dự án</span>
                      <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-semibold">Xóa triệt để</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">Xóa vĩnh viễn khách hàng cùng toàn bộ {deletingCustomer.linkedProjects.length} dự án và task con bên trong.</p>
                  </button>
                </div>
              </div>
            ) : (
              <div className="my-4 text-xs text-slate-600 leading-relaxed">
                Bạn có chắc chắn muốn xóa khách hàng <span className="font-bold text-[#0f172a]">"{deletingCustomer.name}"</span>? Hành động này không thể hoàn tác.
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowCustomerDeleteModal(false);
                  setDeletingCustomer(null);
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition-all"
              >
                Hủy
              </button>
              {deletingCustomer.linkedProjects.length === 0 && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => confirmDeleteCustomer(false)}
                  className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50"
                >
                  Xóa khách hàng
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ============================================================== */}
      {/* PROJECT DELETE CONFIRMATION MODAL */}
      {/* ============================================================== */}
      {showProjectDeleteModal && deletingProject && mounted && createPortal(
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center font-bold text-lg">🗑️</div>
              <div>
                <h3 className="text-base font-bold text-[#0f172a]">Xác nhận xóa Dự án</h3>
                <p className="text-xs text-slate-500 font-semibold">{deletingProject.name}</p>
              </div>
            </div>

            <div className="space-y-3 my-4">
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 leading-relaxed">
                <p className="font-bold flex items-center gap-1.5 mb-1 text-red-700">
                  <span>⚠️</span> Cảnh báo hành động không thể hoàn tác!
                </p>
                Xóa dự án này sẽ tự động xóa triệt để toàn bộ các Phase, Nhóm nhiệm vụ, Task con, Thành viên liên kết và Lịch họp bên trong dự án.
              </div>

              <div className="grid grid-cols-3 gap-2 py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                <div>
                  <span className="block text-[10px] uppercase font-bold text-slate-400">Phase</span>
                  <span className="text-xs font-bold text-slate-700">{deletingProject.phase_count || 0}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-bold text-slate-400">Tasks</span>
                  <span className="text-xs font-bold text-slate-700">{deletingProject.task_count || 0}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-bold text-slate-400">Thành viên</span>
                  <span className="text-xs font-bold text-slate-700">{deletingProject.members?.length || 0}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowProjectDeleteModal(false);
                  setDeletingProject(null);
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition-all"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={confirmDeleteProject}
                className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50"
              >
                Xóa vĩnh viễn dự án
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
