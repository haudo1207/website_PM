'use client';
import { useEffect, useState, useMemo, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getProjects, deleteProject, updateProject, getCustomers, getWorkspaces, Workspace } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import SearchableSelect from './common/SearchableSelect';

const STATUS_STYLES: Record<string, { bg: string; bar: string }> = {
  'Planning':   { bg: 'bg-[#fef9c3] text-[#854d0e]', bar: 'bg-[#854d0e]' },
  'Developing': { bg: 'bg-[#dbeafe] text-[#1d4ed8]', bar: 'bg-[#0058be]' },
  'Completed':  { bg: 'bg-[#dcfce7] text-[#15803d]', bar: 'bg-[#15803d]' },
  'Archived':   { bg: 'bg-[#f1f5f9] text-[#64748b]', bar: 'bg-[#94a3b8]' },
};

const PROJECT_PHASES = [
  '1. Tư vấn', '2. Báo giá', '3. Làm specs', '4. Duyệt HSMT',
  '5. Chờ ra thầu', '6. Tham gia thầu POP', '6. Tham gia thầu nhà phụ',
  '7. Trúng Thầu', '7. Rớt thầu', '8. Ký hợp đồng', '9. Đặt hàng',
  '10. Giao hàng', '11. Triển khai', '12. Hoàn thành triển khai',
  '13. Nghiệm thu', '14. Thanh toán', '15. Kết thúc dự án', '0. Huỷ'
];

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
  const searchParams = useSearchParams();
  const paramCustId = searchParams.get('customer_id');
  const paramCustName = searchParams.get('customer');
  const paramYear = searchParams.get('year');

  const canManage = isAdmin();
  const [search, setSearch] = useState('');
  const [businessFilter, setBusinessFilter] = useState('All');
  const [phaseFilter, setPhaseFilter] = useState('All');
  const [customerFilter, setCustomerFilter] = useState('All');
  const [pmFilter, setPmFilter] = useState('All');
  const [salesFilter, setSalesFilter] = useState('All');
  const [memberFilter, setMemberFilter] = useState('All');
  const [yearFilter, setYearFilter] = useState('All');
  const [sortBy, setSortBy] = useState('newest');

  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [renamingProject, setRenamingProject] = useState<{ id: number; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);

  // Close the per-card "..." menu on any click outside it — the button/dropdown
  // themselves stop propagation, so only genuine outside clicks reach here.
  useEffect(() => {
    if (menuOpenId === null) return;
    const handler = () => setMenuOpenId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuOpenId]);

  const { data: listData, refetch: reload } = useQuery({
    queryKey: ['project-list'],
    queryFn: async () => {
      const [projs, custs] = await Promise.all([
        getProjects(),
        getCustomers(),
      ]);
      return {
        projects: projs || [],
        customers: custs || [],
      };
    },
  });
  // Shared cache key with Navbar/Project Hub/CustomersProjectsView — this
  // near-static list is fetched once and reused across the whole app.
  const { data: workspacesData } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => getWorkspaces(),
    staleTime: 5 * 60_000,
  });
  const projects: any[] = listData?.projects || [];
  const customers: any[] = listData?.customers || [];
  const workspaces: Workspace[] = workspacesData || [];

  // Project Hub: lock the Workspace filter to the current tab's Workspace.
  useEffect(() => {
    if (!lockedWorkspace) return;
    const ws = workspaces.find(w => w.code === lockedWorkspace);
    setBusinessFilter(ws?.name || lockedWorkspace);
  }, [lockedWorkspace, workspaces]);

  // Sync URL query params to filter states
  useEffect(() => {
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

  const getInitials = (name: string) => {
    if (!name) return '—';
    return name
      .trim()
      .split(/\s+/)
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  };

  const handleResetFilters = () => {
    setSearch('');
    if (!lockedWorkspace) setBusinessFilter('All');
    setPhaseFilter('All');
    setCustomerFilter('All');
    setPmFilter('All');
    setSalesFilter('All');
    setMemberFilter('All');
    setYearFilter('All');
    setPage(1);
    if (!lockedWorkspace) router.push('/projects');
  };

  // Dynamic lists from loaded data memoized
  const uniqueCustomers = useMemo(() => {
    const dbCustomerNames = customers.map(c => c.name);
    const projCustomerNames = projects.map(p => p.customer_name).filter(Boolean);
    return Array.from(new Set([...dbCustomerNames, ...projCustomerNames])).sort();
  }, [customers, projects]);

  const uniquePms = useMemo(() => {
    return Array.from(new Set(projects.map(p => p.pm_name).filter(Boolean)));
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
      if (p.pm_name) names.push(p.pm_name);
      if (p.technical_leader_name) names.push(p.technical_leader_name);
      if (p.sales_name) {
        p.sales_name.split(',').map((s: string) => s.trim()).filter(Boolean).forEach((n: string) => names.push(n));
      }
    });
    return Array.from(new Set(names)).sort();
  }, [projects]);

  const uniqueYears = useMemo(() => {
    return Array.from(new Set(projects.map(p => p.year).filter(v => v !== null && v !== undefined))).sort((a, b) => (b as number) - (a as number));
  }, [projects]);

  // Workspace code → display name map from the Workspace Master
  const wsNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    (workspaces || []).forEach(w => m.set(w.code, w.name));
    return m;
  }, [workspaces]);

  // Filter memoized
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return projects.filter(p => {
      const matchSearch = [p.name, p.code, p.customer_name, p.pm_name].some(v => (v || '').toLowerCase().includes(q));
      const pBiz = (p.business || wsNameByCode.get(p.business_unit) || '').toLowerCase();
      const matchBusiness = businessFilter === 'All' || pBiz === businessFilter.toLowerCase() || (p.business && p.business.toLowerCase() === 'all');
      const matchPhase = phaseFilter === 'All' || p.current_phase === phaseFilter;
      const matchCustomer = customerFilter === 'All' ||
        (p.customer_name && p.customer_name.toLowerCase() === customerFilter.toLowerCase()) ||
        (paramCustId && String(p.customer_id) === String(paramCustId));
      const matchPm = pmFilter === 'All' || p.pm_name === pmFilter;
      const matchSales = salesFilter === 'All' ||
        (p.sales_name || '').split(',').map((s: string) => s.trim()).includes(salesFilter);
      const matchMember = memberFilter === 'All' || (() => {
        const mLower = memberFilter.toLowerCase();
        const projMemberNames: string[] = [];
        if (p.member_names) projMemberNames.push(...p.member_names.split(',').map((s: string) => s.trim()));
        if (Array.isArray(p.members)) p.members.forEach((m: any) => { if (m?.name) projMemberNames.push(m.name); });
        if (p.pm_name) projMemberNames.push(p.pm_name);
        if (p.technical_leader_name) projMemberNames.push(p.technical_leader_name);
        if (p.sales_name) projMemberNames.push(...p.sales_name.split(',').map((s: string) => s.trim()));
        return projMemberNames.some(name => name.toLowerCase() === mLower);
      })();
      const matchYear = yearFilter === 'All' || String(p.year) === yearFilter;
      return matchSearch && matchBusiness && matchPhase && matchCustomer && matchPm && matchSales && matchMember && matchYear;
    });
  }, [projects, search, businessFilter, phaseFilter, customerFilter, paramCustId, pmFilter, salesFilter, memberFilter, yearFilter, wsNameByCode]);

  // Sort memoized
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
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
      return 0;
    });
  }, [filtered, sortBy]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="min-h-screen flex bg-[#f8fafc]" style={{ fontFamily: "'Inter', sans-serif" }}>
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
        <div className="p-8 space-y-6 max-w-[1400px] w-full mx-auto">
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

            {renderTabs && renderTabs()}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3.5 shadow-sm relative z-30">
            <div className="flex items-center gap-2 bg-slate-50/20 px-3 py-1.5 border border-slate-200 rounded-lg h-[34px] shrink-0">
              <span className="text-xs text-slate-500 font-semibold">Sắp xếp:</span>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer">
                <option value="newest">Mới nhất</option>
                <option value="oldest">Cũ nhất</option>
                <option value="name_asc">Tên (A-Z)</option>
                <option value="name_desc">Tên (Z-A)</option>
              </select>
            </div>

            <div className="relative flex-1 min-w-[240px]">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" placeholder="Tìm kiếm tên dự án, khách hàng..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none text-slate-700 focus:border-indigo-500 bg-slate-50/20" />
            </div>
            
            <SearchableSelect
              label="giai đoạn"
              icon="🚩"
              options={PROJECT_PHASES.map(ph => ({ id: ph, name: ph }))}
              value={phaseFilter}
              onChange={val => { setPhaseFilter(String(val)); setPage(1); }}
              placeholder="Tìm giai đoạn..."
            />

            <SearchableSelect
              label="khách hàng"
              icon="🏢"
              options={uniqueCustomers.map(cust => ({ id: cust, name: cust }))}
              value={customerFilter}
              onChange={val => { setCustomerFilter(String(val)); setPage(1); }}
              placeholder="Tìm khách hàng..."
            />

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
              label="thành viên"
              icon="👥"
              options={uniqueMembers.map(m => ({ id: m, name: m }))}
              value={memberFilter}
              onChange={val => { setMemberFilter(String(val)); setPage(1); }}
              placeholder="Tìm thành viên..."
            />

            {!lockedWorkspace && (
              <SearchableSelect
                label="Workspace"
                icon="🗂️"
                options={workspaces.map(ws => ({ id: ws.name, name: ws.name }))}
                value={businessFilter}
                onChange={val => { setBusinessFilter(String(val)); setPage(1); }}
                placeholder="Tìm Workspace..."
              />
            )}

            <SearchableSelect
              label="năm"
              icon="📅"
              options={uniqueYears.map(yr => ({ id: String(yr), name: String(yr) }))}
              value={yearFilter}
              onChange={val => { setYearFilter(String(val)); setPage(1); }}
              placeholder="Tìm năm..."
            />

            <button onClick={handleResetFilters} className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors flex-shrink-0 h-[34px]">
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" stroke="red" strokeWidth={1.5} />
              </svg>
              Xóa lọc
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {paged.map(p => {
              const phaseBadge = getPhaseBadgeStyle(p.current_phase);
              return (
                <div key={p.id} onClick={() => router.push(`/project/detail?id=${p.id}`)}
                  className="bg-white border border-slate-200/80 rounded-xl overflow-hidden flex flex-col cursor-pointer group shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-300 hover:-translate-y-0.5 relative">
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[11px] font-bold text-slate-500 bg-slate-100/80 border border-slate-200 px-2 py-0.5 rounded">Năm: {p.year || '—'}</span>
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
                              <div className="absolute right-0 mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-20 py-1">
                                <button
                                  onClick={() => { setMenuOpenId(null); router.push(`/project/detail?id=${p.id}`); }}
                                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                >
                                  ✏️ Chỉnh sửa
                                </button>
                                <button
                                  onClick={() => { setMenuOpenId(null); setRenamingProject({ id: p.id, name: p.name }); setRenameValue(p.name || ''); }}
                                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                >
                                  ✎ Đổi tên
                                </button>
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
                    <h3 className="text-base font-bold text-slate-800 mb-0.5 group-hover:text-indigo-600 transition-colors line-clamp-1">{p.name}</h3>
                    <p className="text-[13px] text-slate-500 mb-5 line-clamp-1 italic flex items-center gap-1.5"><span className="not-italic text-sm">🏢</span> {p.customer_name || 'Chưa có khách hàng'}</p>
                    
                    <div className="grid grid-cols-2 gap-y-4 mb-3">
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Project Manager</p>
                        <p className="text-[13px] font-semibold text-slate-700 truncate">{p.pm_name || <span className="text-slate-400 italic">—</span>}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Technical Lead</p>
                        <p className="text-[13px] font-semibold text-slate-700 truncate">{p.technical_leader_name || <span className="text-slate-400 italic">—</span>}</p>
                      </div>
                    </div>
                    <div className="mb-6">
                      <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Sales</p>
                      <p className="text-[13px] font-semibold text-slate-700 truncate">{p.sales_name || <span className="text-slate-400 italic">--</span>}</p>
                    </div>

                    <div className="border-t border-slate-100 pt-4 mt-auto flex justify-between items-center">
                      <div className="flex gap-6">
                        <div className="text-left">
                          <p className="text-[11px] text-slate-500 font-medium">Tổng</p>
                          <p className="text-[14px] font-bold text-slate-800 mt-0.5">{p.task_count ?? 0}</p>
                        </div>
                        <div className="text-left">
                          <p className="text-[11px] text-emerald-600 font-medium">Hoàn thành</p>
                          <p className="text-[14px] font-bold text-emerald-600 mt-0.5">{p.completed_task_count ?? 0}</p>
                        </div>
                        <div className="text-left">
                          <p className="text-[11px] text-rose-600 font-medium">Cảnh báo</p>
                          <p className="text-[14px] font-bold text-rose-600 mt-0.5">{p.warning_task_count ?? 0}</p>
                        </div>
                      </div>

                      <div className="flex -space-x-1.5 overflow-hidden">
                        {p.members?.slice(0, 3).map((m: any, idx: number) => {
                          const COLORS = ['bg-blue-600', 'bg-purple-600', 'bg-indigo-600', 'bg-pink-600', 'bg-emerald-600'];
                          const bg = COLORS[idx % COLORS.length];
                          return (
                            <div key={idx} className={`inline-block h-6 w-6 rounded-full ring-2 ring-white ${bg} flex items-center justify-center text-[9px] font-bold text-white uppercase`} title={m.name}>
                              {getInitials(m.name)}
                            </div>
                          );
                        })}
                        {p.members?.length > 3 && (
                          <div className="inline-block h-6 w-6 rounded-full ring-2 ring-white bg-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-600 uppercase" title="Xem thêm thành viên">
                            +{p.members.length - 3}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

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
                  disabled={page === totalPages}
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

      {renamingProject && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setRenamingProject(null)}>
          <div className="bg-white border border-[#c2c6d6] rounded-xl shadow-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-[#0b1c30] mb-4">Đổi tên dự án</h2>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setRenamingProject(null); }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-6 outline-none focus:ring-2 focus:ring-[#0058be]/30 focus:border-[#0058be]"
              placeholder="Tên dự án"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setRenamingProject(null)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#0b1c30]">Hủy</button>
              <button onClick={async () => {
                const trimmed = renameValue.trim();
                if (!trimmed) { flash('Tên dự án không được để trống', true); return; }
                try {
                  await updateProject(renamingProject.id, { name: trimmed });
                  reload();
                  flash('Đã đổi tên!');
                } catch (e: any) {
                  flash(e?.response?.data?.detail || 'Đổi tên thất bại', true);
                }
                setRenamingProject(null);
              }} className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#0058be] hover:bg-[#00479c] text-white shadow-sm">Lưu</button>
            </div>
          </div>
        </div>
      )}

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
                try { await deleteProject(deleteId); reload(); flash('Đã xóa!'); } catch(e: any) { flash(e?.response?.data?.detail || 'Xóa thất bại', true); } setDeleteId(null);
              }}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#dc2626] hover:bg-red-700 text-white shadow-sm">Xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
