'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getProjects, deleteProject } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

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

function ProjectListContent() {
  const router = useRouter();
  const canManage = isAdmin();
  const [projects, setProjects] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('All');
  const [customerFilter, setCustomerFilter] = useState('All');
  const [pmFilter, setPmFilter] = useState('All');
  const [yearFilter, setYearFilter] = useState('All');
  const [sortBy, setSortBy] = useState('newest');

  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 9;

  const reload = () => getProjects().then(setProjects).catch(() => {});
  useEffect(() => { reload(); }, []);

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
    setPhaseFilter('All');
    setCustomerFilter('All');
    setPmFilter('All');
    setYearFilter('All');
    setPage(1);
  };

  // Dynamic lists from loaded data
  const uniqueCustomers = Array.from(new Set(projects.map(p => p.customer_name).filter(Boolean)));
  const uniquePms = Array.from(new Set(projects.map(p => p.pm_name).filter(Boolean)));
  const uniqueYears = Array.from(new Set(projects.map(p => p.year).filter(v => v !== null && v !== undefined))).sort((a, b) => b - a);

  // Filter
  const filtered = projects.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = [p.name, p.code, p.customer_name, p.pm_name].some(v => (v || '').toLowerCase().includes(q));
    const matchPhase = phaseFilter === 'All' || p.current_phase === phaseFilter;
    const matchCustomer = customerFilter === 'All' || p.customer_name === customerFilter;
    const matchPm = pmFilter === 'All' || p.pm_name === pmFilter;
    const matchYear = yearFilter === 'All' || String(p.year) === yearFilter;
    return matchSearch && matchPhase && matchCustomer && matchPm && matchYear;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'newest') return b.id - a.id;
    if (sortBy === 'oldest') return a.id - b.id;
    if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
    if (sortBy === 'name_desc') return b.name.localeCompare(a.name);
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 border border-slate-200 rounded-lg shadow-sm">
                <span className="text-xs text-slate-500 font-semibold">Sắp xếp:</span>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer">
                  <option value="newest">Mới nhất</option>
                  <option value="oldest">Cũ nhất</option>
                  <option value="name_asc">Tên (A-Z)</option>
                  <option value="name_desc">Tên (Z-A)</option>
                </select>
              </div>

              {canManage && <button onClick={() => router.push('/projects/new')} className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-5 py-2 rounded-lg text-sm font-bold shadow-md shadow-indigo-600/10 hover:shadow-indigo-600/20 transition-all duration-200">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Thêm dự án
              </button>}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3.5 shadow-sm">
            <div className="relative flex-1 min-w-[240px]">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" placeholder="Tìm kiếm tên dự án, khách hàng..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none text-slate-700 focus:border-indigo-500 bg-slate-50/20" />
            </div>
            
            <div className="flex flex-col flex-shrink-0 w-[170px]">
              <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 ml-0.5 tracking-wider">Giai đoạn</label>
              <select value={phaseFilter} onChange={e => { setPhaseFilter(e.target.value); setPage(1); }} className="bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none text-slate-600 focus:border-indigo-500 cursor-pointer font-semibold">
                <option value="All">Tất cả giai đoạn</option>
                {PROJECT_PHASES.map(ph => (
                  <option key={ph} value={ph}>{ph}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col flex-shrink-0 w-[170px]">
              <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 ml-0.5 tracking-wider">Khách hàng</label>
              <select value={customerFilter} onChange={e => { setCustomerFilter(e.target.value); setPage(1); }} className="bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none text-slate-600 focus:border-indigo-500 cursor-pointer font-semibold">
                <option value="All">Tất cả khách hàng</option>
                {uniqueCustomers.map(cust => (
                  <option key={cust} value={cust}>{cust}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col flex-shrink-0 w-[170px]">
              <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 ml-0.5 tracking-wider">Quản lý (PM)</label>
              <select value={pmFilter} onChange={e => { setPmFilter(e.target.value); setPage(1); }} className="bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none text-slate-600 focus:border-indigo-500 cursor-pointer font-semibold">
                <option value="All">Tất cả PM</option>
                {uniquePms.map(pm => (
                  <option key={pm} value={pm}>{pm}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col flex-shrink-0 w-[120px]">
              <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 ml-0.5 tracking-wider">Năm</label>
              <select value={yearFilter} onChange={e => { setYearFilter(e.target.value); setPage(1); }} className="bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none text-slate-600 focus:border-indigo-500 cursor-pointer font-semibold">
                <option value="All">Tất cả năm</option>
                {uniqueYears.map(yr => (
                  <option key={yr} value={String(yr)}>{yr}</option>
                ))}
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

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {paged.map(p => {
              const phaseBadge = getPhaseBadgeStyle(p.current_phase);
              return (
                <div key={p.id} onClick={() => router.push(`/project/detail?id=${p.id}`)}
                  className="bg-white border border-slate-200/80 rounded-xl overflow-hidden flex flex-col cursor-pointer group shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-300 hover:-translate-y-0.5 relative">
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[11px] font-bold text-slate-500 bg-slate-100/80 border border-slate-200 px-2 py-0.5 rounded">Năm: {p.year || '—'}</span>
                      <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded uppercase tracking-wider ${phaseBadge}`}>{p.current_phase || '1. Tư vấn'}</span>
                    </div>
                    <h3 className="text-base font-bold text-slate-800 mb-0.5 group-hover:text-indigo-600 transition-colors line-clamp-1">{p.name}</h3>
                    <p className="text-[13px] text-slate-500 mb-5 line-clamp-1 italic">{p.customer_name || 'Chưa có khách hàng'}</p>
                    
                    <div className="grid grid-cols-2 gap-y-4 mb-6">
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Project Manager</p>
                        <p className="text-[13px] font-semibold text-slate-700 truncate">{p.pm_name || <span className="text-slate-400 italic">—</span>}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Technical Lead</p>
                        <p className="text-[13px] font-semibold text-slate-700 truncate">{p.technical_leader_name || <span className="text-slate-400 italic">—</span>}</p>
                      </div>
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

            {canManage && <div onClick={() => router.push('/projects/new')}
              className="border-2 border-dashed border-slate-200 rounded-xl bg-white/60 flex flex-col items-center justify-center p-8 cursor-pointer hover:bg-slate-50 hover:border-indigo-500 transition-all duration-300 group min-h-[220px] shadow-sm text-center">
              <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-indigo-50 group-hover:border-indigo-200 transition-all duration-300 shadow-sm">
                <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <h4 className="text-[14px] font-bold text-slate-800">Thêm dự án mới</h4>
              <p className="text-xs text-slate-500 mt-2 px-4 max-w-[280px]">Bắt đầu khởi tạo quy trình tuân thủ mới cho khách hàng.</p>
            </div>}
          </div>

          <div className="flex justify-between items-center border-t border-slate-200 pt-6">
            <p className="text-sm text-slate-500">Hiển thị <span className="font-bold text-slate-700">{paged.length}</span> / <span className="font-bold text-slate-700">{filtered.length}</span> dự án</p>
            <div className="flex items-center gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="w-9 h-9 border border-slate-200 rounded-lg flex items-center justify-center bg-white hover:bg-slate-50 disabled:opacity-40 transition-colors">
                <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)} className={`w-9 h-9 border rounded-lg flex items-center justify-center text-sm font-bold transition-all ${p === page ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-600/10' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{p}</button>
              ))}
              <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="w-9 h-9 border border-slate-200 rounded-lg flex items-center justify-center bg-white hover:bg-slate-50 disabled:opacity-40 transition-colors">
                <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {deleteId !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#c2c6d6] rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h2 className="text-base font-bold text-[#0b1c30] mb-2">⚠️ Xóa dự án</h2>
            <p className="text-sm text-[#565e74] mb-6">Bạn có chắc muốn xóa dự án này?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#0b1c30]">Hủy</button>
              <button onClick={async () => { try { await deleteProject(deleteId); reload(); flash('Đã xóa!'); } catch(e: any) { flash(e?.response?.data?.detail || 'Xóa thất bại', true); } setDeleteId(null); }}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#dc2626] hover:bg-red-700 text-white shadow-sm">Xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f0f2f5]" />}>
      <ProjectListContent />
    </Suspense>
  );
}
