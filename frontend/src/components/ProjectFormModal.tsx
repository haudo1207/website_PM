'use client';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import SearchableSelect from '@/components/common/SearchableSelect';
import {
  getCustomers,
  getCustomersByWorkspace,
  createProject,
  updateProject,
  getMembers,
  getMasterPhases,
  getProjectTemplates,
  applyProjectTemplate,
  getWorkspaces,
  Workspace
} from '@/lib/api';

const PROJECT_PHASES = [
  '1. Tư vấn', '2. Báo giá', '3. Làm specs', '4. Duyệt HSMT',
  '5. Chờ ra thầu', '6. Tham gia thầu POP', '6. Tham gia thầu nhà phụ',
  '7. Trúng Thầu', '7. Rớt thầu', '8. Ký hợp đồng', '9. Đặt hàng',
  '10. Giao hàng', '11. Triển khai', '12. Hoàn thành triển khai',
  '13. Nghiệm thu', '14. Thanh toán', '15. Kết thúc dự án', '0. Huỷ'
];

export interface ProjectFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  /** Required when mode === 'edit' — the project being edited. */
  editingProject?: any;
  /** Prefill values, used when mode === 'create'. */
  defaultCustomerId?: number | string;
  defaultBusiness?: string;
  defaultYear?: number;
  onClose: () => void;
  onSaved: (project: any) => void;
  onFlash: (msg: string, isError?: boolean) => void;
  /** When provided (edit mode only), shows a "Xóa dự án" button in the footer. */
  onRequestDelete?: () => void;
}

export default function ProjectFormModal({
  isOpen, mode, editingProject, defaultCustomerId, defaultBusiness, defaultYear,
  onClose, onSaved, onFlash, onRequestDelete,
}: ProjectFormModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [actionLoading, setActionLoading] = useState(false);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [projectForm, setProjectForm] = useState({
    name: '',
    year: defaultYear || new Date().getFullYear(),
    customerId: '' as string | number,
    business: '',
    pmIds: [] as number[],
    leaderIds: [] as number[],
    salesIds: [] as number[],
    memberIds: [] as number[],
    currentPhase: '1. Tư vấn',
    status: 'Planning',
    description: ''
  });
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');

  const [pmDropdownOpen, setPmDropdownOpen] = useState(false);
  const [leaderDropdownOpen, setLeaderDropdownOpen] = useState(false);
  const [salesDropdownOpen, setSalesDropdownOpen] = useState(false);
  const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);
  const [phaseDropdownOpen, setPhaseDropdownOpen] = useState(false);
  const [pmSearch, setPmSearch] = useState('');
  const [leaderSearch, setLeaderSearch] = useState('');
  const [salesSearch, setSalesSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');

  const pmRef = useRef<HTMLDivElement>(null);
  const leaderRef = useRef<HTMLDivElement>(null);
  const salesRef = useRef<HTMLDivElement>(null);
  const memberRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const workspacesQuery = useQuery({ queryKey: ['workspaces'], queryFn: () => getWorkspaces(), staleTime: 5 * 60_000 });
  const workspaces: Workspace[] = workspacesQuery.data || [];

  const dataQuery = useQuery({
    queryKey: ['project-form-modal-data'],
    queryFn: async () => {
      const [allCusts, mems, mPhases] = await Promise.all([
        getCustomers().catch(() => []),
        getMembers().catch(() => []),
        getMasterPhases().catch(() => []),
      ]);
      return { allCustomers: allCusts || [], members: mems || [], masterPhases: mPhases || [] };
    },
    enabled: isOpen,
    staleTime: 60_000,
  });
  const allCustomers: any[] = dataQuery.data?.allCustomers || [];
  const members: any[] = dataQuery.data?.members || [];
  const dbMasterPhases: any[] = dataQuery.data?.masterPhases || [];

  // Body/html scroll lock while open.
  useEffect(() => {
    if (isOpen) {
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
  }, [isOpen]);

  // Click-outside listener for the dropdowns.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (pmDropdownOpen && pmRef.current && !pmRef.current.contains(target)) { setPmDropdownOpen(false); setPmSearch(''); }
      if (leaderDropdownOpen && leaderRef.current && !leaderRef.current.contains(target)) { setLeaderDropdownOpen(false); setLeaderSearch(''); }
      if (salesDropdownOpen && salesRef.current && !salesRef.current.contains(target)) { setSalesDropdownOpen(false); setSalesSearch(''); }
      if (memberDropdownOpen && memberRef.current && !memberRef.current.contains(target)) { setMemberDropdownOpen(false); setMemberSearch(''); }
      if (phaseDropdownOpen && phaseRef.current && !phaseRef.current.contains(target)) { setPhaseDropdownOpen(false); }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [pmDropdownOpen, leaderDropdownOpen, salesDropdownOpen, memberDropdownOpen, phaseDropdownOpen]);

  // Reset/prefill the form whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setFormSubmitted(false);
    if (mode === 'edit' && editingProject) {
      const pmIds = editingProject.pm_ids || (editingProject.pm_id ? [editingProject.pm_id] : []);
      const leaderIds = editingProject.technical_leader_ids || (editingProject.technical_leader_id ? [editingProject.technical_leader_id] : []);
      const salesIds = editingProject.sales_ids || (editingProject.sales_id ? [editingProject.sales_id] : []);
      const memberIds = editingProject.member_ids || editingProject.members?.map((m: any) => m.id) || [];
      setProjectForm({
        name: editingProject.name || '',
        year: editingProject.year || new Date().getFullYear(),
        customerId: editingProject.customer_id || defaultCustomerId || '',
        business: editingProject.business || defaultBusiness || '',
        pmIds: pmIds.map(Number),
        leaderIds: leaderIds.map(Number),
        salesIds: salesIds.map(Number),
        memberIds: memberIds.map(Number),
        currentPhase: editingProject.current_phase || '1. Tư vấn',
        status: editingProject.status || 'Planning',
        description: editingProject.description || ''
      });
    } else {
      setProjectForm({
        name: '',
        year: defaultYear || new Date().getFullYear(),
        customerId: defaultCustomerId || '',
        business: defaultBusiness || '',
        pmIds: [], leaderIds: [], salesIds: [], memberIds: [],
        currentPhase: '1. Tư vấn',
        status: 'Planning',
        description: ''
      });
      setSelectedTemplateId('');
      getProjectTemplates().then(t => setTemplates(t || [])).catch(() => setTemplates([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, editingProject]);

  // Default the workspace once the list has loaded, if none was prefilled.
  useEffect(() => {
    if (isOpen && !projectForm.business && workspaces.length > 0) {
      setProjectForm(f => ({ ...f, business: workspaces[0].name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, workspaces]);

  const wsNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    workspaces.forEach(w => m.set(w.code, w.name));
    return m;
  }, [workspaces]);
  const wsCodeByName = useMemo(() => {
    const m = new Map<string, string>();
    workspaces.forEach(w => m.set(w.name, w.code));
    return m;
  }, [workspaces]);
  const targetWsCode = wsCodeByName.get(projectForm.business) || (projectForm.business || '').toLowerCase();

  // Customer.business_unit is legacy/unreliable (see access.customer_query_for_user
  // on the backend — confirmed by a production data audit that most Customer rows
  // carry a stale value). A Customer's real Workspace is derived from its linked
  // Projects instead, via the same by-workspace endpoint the Project Hub Customers
  // tab uses, so this dropdown/mismatch check can't be thrown off by bad data.
  const businessCustomersQuery = useQuery({
    queryKey: ['customers-by-workspace', targetWsCode],
    queryFn: () => getCustomersByWorkspace(targetWsCode).catch(() => []),
    enabled: isOpen && projectForm.business !== 'All' && !!targetWsCode,
    staleTime: 60_000,
  });

  const businessCustomers: any[] = projectForm.business === 'All'
    ? allCustomers
    : (businessCustomersQuery.data || []);

  const customerMismatch = !!projectForm.customerId && projectForm.business !== 'All' &&
    !businessCustomersQuery.isLoading &&
    !businessCustomers.some((c: any) => c.id === Number(projectForm.customerId));

  const selectedCustomerName = projectForm.customerId
    ? (allCustomers.find(c => c.id === Number(projectForm.customerId))?.name || 'Chưa chọn KH')
    : 'Chưa chọn KH';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitted(true);

    if (!projectForm.name.trim()) {
      nameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      nameInputRef.current?.focus();
      return;
    }
    if (!projectForm.customerId) {
      onFlash('Vui lòng chọn khách hàng!', true);
      return;
    }

    setActionLoading(true);
    try {
      const selectedCust = allCustomers.find(c => c.id === Number(projectForm.customerId));
      const cleanNameSlug = projectForm.name.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      const safeCode = (cleanNameSlug.slice(0, 40) + `-${projectForm.year}`).slice(0, 50);
      const bizName = projectForm.business;
      const bizCode = wsCodeByName.get(bizName) || bizName.toLowerCase();
      const payload = {
        name: projectForm.name.trim(),
        code: safeCode,
        customer_id: Number(projectForm.customerId),
        customer_name: selectedCust ? selectedCust.name : '',
        business: bizName,
        data_scope: bizCode,
        year: Number(projectForm.year),
        status: projectForm.status,
        description: projectForm.description,
        current_phase: projectForm.currentPhase,
        pm_ids: projectForm.pmIds,
        technical_leader_ids: projectForm.leaderIds,
        sales_ids: projectForm.salesIds,
        member_ids: projectForm.memberIds
      };

      let result: any;
      if (mode === 'create') {
        result = await createProject(payload);
        if (result && result.id && selectedTemplateId) {
          try {
            await applyProjectTemplate(Number(selectedTemplateId), result.id);
            onFlash('Đã tạo dự án và áp dụng template thành công');
          } catch (applyErr: any) {
            onFlash('Đã tạo dự án nhưng áp dụng template thất bại: ' + (applyErr?.response?.data?.detail || applyErr?.message || 'Lỗi'), true);
          }
        } else {
          onFlash('Đã tạo dự án mới thành công');
        }
      } else if (editingProject) {
        result = await updateProject(editingProject.id, payload);
        onFlash('Đã cập nhật thông tin dự án');
      }

      onClose();
      onSaved(result);
    } catch (err: any) {
      onFlash('Lỗi lưu thông tin dự án: ' + (err.response?.data?.detail || err.message), true);
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-start justify-center responsive-modal-overlay">
      <div className="bg-white border border-slate-200 shadow-2xl flex flex-col animate-in fade-in zoom-in duration-200 responsive-modal-container">

        {/* Header with Context Pill */}
        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center responsive-modal-header">
          <div>
            <h3 className="text-sm font-extrabold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
              <span>{mode === 'create' ? '➕ Tạo dự án' : '📝 Cập nhật dự án'}</span>
            </h3>
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 mt-0.5">
              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold">{projectForm.business}</span>
              <span>●</span>
              <span className="text-slate-700 font-bold">{selectedCustomerName}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-all p-1.5 hover:bg-slate-200/60 rounded-lg cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="responsive-modal-body">

            {/* SECTION 1: THÔNG TIN DỰ ÁN */}
            <div className="modal-section space-y-3.5 bg-slate-50/50 p-3.5 sm:p-4 rounded-xl border border-slate-100">
              <div className="modal-section-title flex items-center justify-between border-b border-slate-200/80 pb-2">
                <h4 className="text-[11px] font-extrabold text-blue-700 uppercase tracking-wider flex items-center gap-2">
                  <span>📌</span> THÔNG TIN DỰ ÁN
                </h4>
              </div>

              <div className="modal-field-gap grid grid-cols-1 md:grid-cols-4 gap-3.5 items-start">
                <div className="md:col-span-3 space-y-1.5">
                  <label className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider block">
                    Tên dự án <span className="text-amber-500 font-bold ml-0.5">*</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    placeholder="Ví dụ: Portal PM Hải Phòng..."
                    value={projectForm.name}
                    onChange={e => {
                      setProjectForm({ ...projectForm, name: e.target.value });
                      if (formSubmitted && e.target.value.trim()) setFormSubmitted(false);
                    }}
                    className={`modal-input w-full bg-white border ${formSubmitted && !projectForm.name.trim() ? 'border-red-500 bg-red-50/20' : 'border-slate-200'} rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 focus:border-blue-500 outline-none font-semibold transition-all`}
                  />
                  {formSubmitted && !projectForm.name.trim() && (
                    <p className="text-[10px] font-bold text-red-500 flex items-center gap-1 mt-0.5 animate-in fade-in">
                      ⚠️ Tên dự án là bắt buộc
                    </p>
                  )}
                </div>

                <div className="md:col-span-1 space-y-1.5">
                  <label className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider block">
                    Năm <span className="text-amber-500 font-bold ml-0.5">*</span>
                  </label>
                  <input
                    type="number"
                    min={1990}
                    max={2100}
                    value={projectForm.year}
                    onChange={e => setProjectForm({ ...projectForm, year: Number(e.target.value) })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider block">
                    Khách hàng <span className="text-amber-500 font-bold ml-0.5">*</span>
                  </label>
                  <SearchableSelect
                    label="khách hàng"
                    icon=""
                    options={businessCustomers.map(c => ({ id: c.id, name: c.name }))}
                    value={projectForm.customerId}
                    onChange={(val: any) => setProjectForm({ ...projectForm, customerId: val === 'all' ? '' : val })}
                    placeholder="Tìm khách hàng..."
                    className="w-full"
                  />
                  {customerMismatch && (
                    <p className="text-[11px] font-medium text-amber-600 flex items-start gap-1">
                      <span className="material-symbols-outlined text-[14px] mt-[1px]">warning</span>
                      Khách hàng hiện tại không thuộc Workspace đã chọn. Vui lòng chọn khách hàng khác.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider block">
                    Workspace <span className="text-amber-500 font-bold ml-0.5">*</span>
                  </label>
                  <select
                    value={projectForm.business}
                    onChange={e => setProjectForm({ ...projectForm, business: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 cursor-pointer font-bold text-blue-700"
                  >
                    {workspaces.map(ws => (
                      <option key={ws.code} value={ws.name}>{ws.name}</option>
                    ))}
                    <option value="All">ALL (phạm vi tất cả team)</option>
                  </select>
                </div>
              </div>

              <div ref={phaseRef} className="space-y-1.5 relative">
                <label className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider block">
                  Giai đoạn hiện tại <span className="text-amber-500 font-bold ml-0.5">*</span>
                </label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPhaseDropdownOpen(!phaseDropdownOpen);
                    setPmDropdownOpen(false);
                    setLeaderDropdownOpen(false);
                    setSalesDropdownOpen(false);
                    setMemberDropdownOpen(false);
                  }}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] flex items-center justify-between outline-none focus:border-blue-500 transition-all cursor-pointer text-left font-semibold"
                >
                  <span className="truncate">{projectForm.currentPhase}</span>
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {phaseDropdownOpen && (
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 max-h-[160px] overflow-y-auto">
                    {(dbMasterPhases.length > 0 ? dbMasterPhases.map((m: any) => m.name) : PROJECT_PHASES).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setProjectForm({ ...projectForm, currentPhase: p });
                          setPhaseDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors ${projectForm.currentPhase === p ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-[#0f172a]'
                          }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* SECTION 2: NHÂN SỰ DỰ ÁN */}
            <div className="modal-section space-y-3.5 bg-slate-50/50 p-3.5 sm:p-4 rounded-xl border border-slate-100">
              <div className="modal-section-title flex items-center justify-between border-b border-slate-200/80 pb-2">
                <h4 className="text-[11px] font-extrabold text-blue-700 uppercase tracking-wider flex items-center gap-2">
                  <span>👥</span> NHÂN SỰ DỰ ÁN
                </h4>
                <span className="text-[10px] text-slate-400">Hỗ trợ tìm kiếm nhanh thành viên</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <TagPicker
                    refEl={pmRef} label="PM (Project Manager)" placeholder="Chọn PM..."
                    ids={projectForm.pmIds} members={members}
                    open={pmDropdownOpen} search={pmSearch}
                    onToggle={() => { setPmDropdownOpen(!pmDropdownOpen); setLeaderDropdownOpen(false); setSalesDropdownOpen(false); setMemberDropdownOpen(false); setPhaseDropdownOpen(false); }}
                    onSearch={setPmSearch}
                    onRemove={(id) => setProjectForm({ ...projectForm, pmIds: projectForm.pmIds.filter(x => x !== id) })}
                    onToggleId={(id) => setProjectForm({ ...projectForm, pmIds: projectForm.pmIds.includes(id) ? projectForm.pmIds.filter(x => x !== id) : [...projectForm.pmIds, id] })}
                  />
                  <TagPicker
                    refEl={salesRef} label="Sales" placeholder="Chọn Sales..."
                    ids={projectForm.salesIds} members={members}
                    open={salesDropdownOpen} search={salesSearch}
                    onToggle={() => { setSalesDropdownOpen(!salesDropdownOpen); setPmDropdownOpen(false); setLeaderDropdownOpen(false); setMemberDropdownOpen(false); setPhaseDropdownOpen(false); }}
                    onSearch={setSalesSearch}
                    onRemove={(id) => setProjectForm({ ...projectForm, salesIds: projectForm.salesIds.filter(x => x !== id) })}
                    onToggleId={(id) => setProjectForm({ ...projectForm, salesIds: projectForm.salesIds.includes(id) ? projectForm.salesIds.filter(x => x !== id) : [...projectForm.salesIds, id] })}
                  />
                </div>

                <div className="space-y-3">
                  <TagPicker
                    refEl={leaderRef} label="Team Leader (TL)" placeholder="Chọn TL..."
                    ids={projectForm.leaderIds} members={members}
                    open={leaderDropdownOpen} search={leaderSearch}
                    onToggle={() => { setLeaderDropdownOpen(!leaderDropdownOpen); setPmDropdownOpen(false); setSalesDropdownOpen(false); setMemberDropdownOpen(false); setPhaseDropdownOpen(false); }}
                    onSearch={setLeaderSearch}
                    onRemove={(id) => setProjectForm({ ...projectForm, leaderIds: projectForm.leaderIds.filter(x => x !== id) })}
                    onToggleId={(id) => setProjectForm({ ...projectForm, leaderIds: projectForm.leaderIds.includes(id) ? projectForm.leaderIds.filter(x => x !== id) : [...projectForm.leaderIds, id] })}
                  />
                  <TagPicker
                    refEl={memberRef} label="Thành viên (Members)" placeholder="Chọn Members..."
                    ids={projectForm.memberIds} members={members}
                    open={memberDropdownOpen} search={memberSearch}
                    onToggle={() => { setMemberDropdownOpen(!memberDropdownOpen); setPmDropdownOpen(false); setLeaderDropdownOpen(false); setSalesDropdownOpen(false); setPhaseDropdownOpen(false); }}
                    onSearch={setMemberSearch}
                    onRemove={(id) => setProjectForm({ ...projectForm, memberIds: projectForm.memberIds.filter(x => x !== id) })}
                    onToggleId={(id) => setProjectForm({ ...projectForm, memberIds: projectForm.memberIds.includes(id) ? projectForm.memberIds.filter(x => x !== id) : [...projectForm.memberIds, id] })}
                  />
                </div>
              </div>
            </div>

            {/* SECTION 3: KHỞI TẠO & MÔ TẢ */}
            <div className="modal-section space-y-3.5 bg-slate-50/50 p-3.5 sm:p-4 rounded-xl border border-slate-100">
              <div className="modal-section-title flex items-center justify-between border-b border-slate-200/80 pb-2">
                <h4 className="text-[11px] font-extrabold text-blue-700 uppercase tracking-wider flex items-center gap-2">
                  <span>⚙️</span> KHỞI TẠO & MÔ TẢ
                </h4>
              </div>

              {mode === 'create' && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Template Khởi tạo</label>
                  <select
                    value={selectedTemplateId}
                    onChange={e => setSelectedTemplateId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 cursor-pointer font-semibold"
                  >
                    <option value="">None (Không áp dụng template)</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.phases?.length || 18} phases)</option>
                    ))}
                  </select>

                  {selectedTemplateId && (
                    <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-3 text-[11px] font-bold text-emerald-800 animate-in fade-in">
                      <span className="flex items-center gap-1">✓ 18 Phase</span>
                      <span>•</span>
                      <span className="flex items-center gap-1">✓ 35 Task Group</span>
                      <span>•</span>
                      <span className="flex items-center gap-1">✓ 220 Tasks</span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Mô tả dự án</label>
                <textarea
                  rows={2}
                  placeholder="Thông tin ghi chú thêm về dự án..."
                  value={projectForm.description}
                  onChange={e => setProjectForm({ ...projectForm, description: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 focus:border-blue-500 outline-none"
                />
              </div>
            </div>

            {/* LIVE PROJECT SUMMARY CARD */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between font-bold text-slate-700 border-b border-slate-200/80 pb-1">
                <span className="flex items-center gap-1 text-[11px]"><span>📊</span> Project Summary Preview</span>
                <span className="text-[9px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-extrabold uppercase">{projectForm.business}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-400 block">Khách hàng:</span>
                  <span className="font-bold text-slate-800 truncate block">{selectedCustomerName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Năm:</span>
                  <span className="font-bold text-slate-800">{projectForm.year}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Current Phase:</span>
                  <span className="font-bold text-slate-800 truncate block">{projectForm.currentPhase}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Template:</span>
                  <span className="font-bold text-slate-800 truncate block">{selectedTemplateId ? 'Standard Template' : 'None'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-3.5 bg-white border-t border-slate-200/90 shadow-[0_-4px_16px_rgba(0,0,0,0.05)] flex items-center justify-between z-10 responsive-modal-footer">
            <div className="flex items-center gap-2">
              {mode === 'edit' && onRequestDelete && (
                <button
                  type="button"
                  onClick={onRequestDelete}
                  className="bg-rose-50 hover:bg-rose-100 text-rose-600 px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-rose-200 transition-colors cursor-pointer mr-2"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                  Xóa dự án
                </button>
              )}
              {!projectForm.name.trim() || !projectForm.customerId ? (
                <span className="text-amber-700 bg-amber-50 border border-amber-200/80 px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 animate-in fade-in">
                  <span className="text-amber-600 font-extrabold">⚠</span> Thiếu {!projectForm.name.trim() ? 'Tên dự án' : 'Khách hàng'} (*)
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-slate-400">
                  (*) Các trường có dấu <span className="text-amber-500 font-bold">*</span> là bắt buộc
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button type="button" onClick={onClose} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer">
                Hủy
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="bg-blue-600 hover:bg-blue-700 active:scale-98 text-white px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {actionLoading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Đang tạo...</span>
                  </>
                ) : (
                  <>
                    <span>🚀</span>
                    <span>{mode === 'create' ? 'Tạo dự án' : 'Cập nhật dự án'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function TagPicker({ refEl, label, placeholder, ids, members, open, search, onToggle, onSearch, onRemove, onToggleId }: {
  refEl: React.RefObject<HTMLDivElement>;
  label: string;
  placeholder: string;
  ids: number[];
  members: any[];
  open: boolean;
  search: string;
  onToggle: () => void;
  onSearch: (v: string) => void;
  onRemove: (id: number) => void;
  onToggleId: (id: number) => void;
}) {
  return (
    <div ref={refEl} className="space-y-1 relative">
      <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">{label}</label>
      <div
        onClick={onToggle}
        className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-xs text-[#0f172a] flex flex-wrap gap-1 items-center justify-between min-h-[36px] cursor-pointer focus-within:border-blue-500 transition-all"
      >
        <div className="flex flex-wrap gap-1 flex-1">
          {ids.length === 0 ? (
            <span className="text-slate-400 px-1 py-0.5">{placeholder}</span>
          ) : (
            ids.map(id => {
              const m = members.find(x => x.id === id);
              return (
                <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-semibold text-[10px] flex items-center gap-1">
                  {m?.display_name || id}
                  <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(id); }} className="text-blue-500 hover:text-blue-700 font-bold ml-0.5 text-xs">×</button>
                </span>
              );
            })
          )}
        </div>
        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-2 space-y-1.5 max-h-[200px] flex flex-col">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search member..."
            className="w-full bg-slate-50 border border-slate-200 text-[#0f172a] px-2.5 py-1.5 rounded-md text-xs focus:outline-none focus:border-blue-500"
          />
          <div className="overflow-y-auto space-y-0.5 flex-1 max-h-[130px]">
            {members
              .filter(u => u.display_name?.toLowerCase().includes(search.toLowerCase()) || u.full_name?.toLowerCase().includes(search.toLowerCase()))
              .map((u) => {
                const isSelected = ids.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onToggleId(u.id)}
                    className={`w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 rounded transition-colors flex items-center justify-between ${isSelected ? 'bg-blue-50 text-blue-600 font-bold' : 'text-[#0f172a]'}`}
                  >
                    <span>{u.display_name} <span className="text-[9px] text-slate-400 font-normal">({u.team || 'No Team'})</span></span>
                    {isSelected && <span className="text-emerald-600 font-bold text-[12px]">✓</span>}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
