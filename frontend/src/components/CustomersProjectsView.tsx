'use client';
import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { isSuperAdmin, isAdmin } from '@/lib/auth';
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  getMembers,
  getMasterPhases,
  getProjectTemplates,
  applyProjectTemplate
} from '@/lib/api';

interface CustomersProjectsViewProps {
  onFlash: (msg: string, isError?: boolean) => void;
}

const PROJECT_PHASES = [
  '1. Tư vấn', '2. Báo giá', '3. Làm specs', '4. Duyệt HSMT',
  '5. Chờ ra thầu', '6. Tham gia thầu POP', '6. Tham gia thầu nhà phụ',
  '7. Trúng Thầu', '7. Rớt thầu', '8. Ký hợp đồng', '9. Đặt hàng',
  '10. Giao hàng', '11. Triển khai', '12. Hoàn thành triển khai',
  '13. Nghiệm thu', '14. Thanh toán', '15. Kết thúc dự án', '0. Huỷ'
];

export default function CustomersProjectsView({ onFlash }: CustomersProjectsViewProps) {
  const router = useRouter();

  // Data states
  const [customers, setCustomers] = useState<any[]>([]);
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Selection states
  const [activeBU, setActiveBU] = useState<'infrastructure' | 'markee'>('infrastructure');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  // Filter/Search states
  const [customerSearch, setCustomerSearch] = useState('');

  // Customer Inline Form / Edit states
  const [newCustomerName, setNewCustomerName] = useState('');
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [editingCustomerName, setEditingCustomerName] = useState('');
  const [showCustomerDeleteModal, setShowCustomerDeleteModal] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState<{ id: number; name: string; linkedProjects: any[] } | null>(null);

  // Project Modal state
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showProjectDeleteModal, setShowProjectDeleteModal] = useState(false);
  const [deletingProject, setDeletingProject] = useState<any | null>(null);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [projectForm, setProjectForm] = useState({
    name: '',
    year: new Date().getFullYear(),
    customerId: '' as string | number,
    business: 'Infrastructure',
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
  const [formSubmitted, setFormSubmitted] = useState(false);

  // Modal searchable dropdown states
  const [modalPmDropdownOpen, setModalPmDropdownOpen] = useState(false);
  const [modalLeaderDropdownOpen, setModalLeaderDropdownOpen] = useState(false);
  const [modalSalesDropdownOpen, setModalSalesDropdownOpen] = useState(false);
  const [modalMemberDropdownOpen, setModalMemberDropdownOpen] = useState(false);
  const [modalPhaseDropdownOpen, setModalPhaseDropdownOpen] = useState(false);

  const [modalPmSearch, setModalPmSearch] = useState('');
  const [modalLeaderSearch, setModalLeaderSearch] = useState('');
  const [modalSalesSearch, setModalSalesSearch] = useState('');
  const [modalMemberSearch, setModalMemberSearch] = useState('');

  // Refs for clicking outside in modal
  const modalPmRef = React.useRef<HTMLDivElement>(null);
  const modalLeaderRef = React.useRef<HTMLDivElement>(null);
  const modalSalesRef = React.useRef<HTMLDivElement>(null);
  const modalMemberRef = React.useRef<HTMLDivElement>(null);
  const modalPhaseRef = React.useRef<HTMLDivElement>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);

  // Click outside listener for modal dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (modalPmDropdownOpen && modalPmRef.current && !modalPmRef.current.contains(target)) {
        setModalPmDropdownOpen(false);
        setModalPmSearch('');
      }
      if (modalLeaderDropdownOpen && modalLeaderRef.current && !modalLeaderRef.current.contains(target)) {
        setModalLeaderDropdownOpen(false);
        setModalLeaderSearch('');
      }
      if (modalSalesDropdownOpen && modalSalesRef.current && !modalSalesRef.current.contains(target)) {
        setModalSalesDropdownOpen(false);
        setModalSalesSearch('');
      }
      if (modalMemberDropdownOpen && modalMemberRef.current && !modalMemberRef.current.contains(target)) {
        setModalMemberDropdownOpen(false);
        setModalMemberSearch('');
      }
      if (modalPhaseDropdownOpen && modalPhaseRef.current && !modalPhaseRef.current.contains(target)) {
        setModalPhaseDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modalPmDropdownOpen, modalLeaderDropdownOpen, modalSalesDropdownOpen, modalMemberDropdownOpen, modalPhaseDropdownOpen]);

  // Master phases state from settings
  const [dbMasterPhases, setDbMasterPhases] = useState<any[]>([]);

  // Fetch initial data
  useEffect(() => {
    loadData();
  }, [activeBU]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [custs, projs, mems, mPhases, allCusts] = await Promise.all([
        getCustomers(activeBU).catch(e => { console.error('getCustomers error:', e); return []; }),
        getProjects(activeBU).catch(e => { console.error('getProjects error:', e); return []; }),
        getMembers().catch(e => { console.error('getMembers error:', e); return []; }),
        getMasterPhases().catch(e => { console.error('getMasterPhases error:', e); return []; }),
        getCustomers().catch(e => { console.error('getCustomers all error:', e); return []; })
      ]);
      setCustomers(custs || []);
      setAllCustomers(allCusts || []);
      setProjects(projs || []);
      setMembers(mems || []);
      setDbMasterPhases(mPhases || []);

      // Auto-select first customer if available
      if (custs && custs.length > 0) {
        setSelectedCustomerId(custs[0].id);
      } else {
        setSelectedCustomerId(null);
      }
    } catch (err: any) {
      console.error('loadData error:', err);
      onFlash(err.response?.data?.detail || err.message || 'Lỗi tải dữ liệu cấu hình hệ thống', true);
    } finally {
      setLoading(false);
    }
  };

  // Safe reload for project updates without full loading state
  const reloadProjects = async () => {
    try {
      const projs = await getProjects(activeBU);
      setProjects(projs || []);
    } catch (err) {
      console.error(err);
    }
  };

  // Filtered Customers based on search
  const filteredCustomers = useMemo(() => {
    return customers.filter(c =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase())
    );
  }, [customers, customerSearch]);

  // Business-filtered customers for the Project modal (mirrors Project Detail -> Edit Project)
  const modalBusinessCustomers = useMemo(() => {
    return projectForm.business === 'All'
      ? allCustomers
      : allCustomers.filter((c) => (c.business_unit || '').toLowerCase() === projectForm.business.toLowerCase());
  }, [allCustomers, projectForm.business]);

  const modalSelectedCustomerBu = (allCustomers.find((c) => c.id === Number(projectForm.customerId))?.business_unit || '').toLowerCase();
  const modalCustomerMismatch = !!projectForm.customerId && (
    projectForm.business === 'All'
      ? !!modalSelectedCustomerBu && modalSelectedCustomerBu !== 'infrastructure' && modalSelectedCustomerBu !== 'markee'
      : modalSelectedCustomerBu !== projectForm.business.toLowerCase()
  );

  // Selected Customer details
  const selectedCustomer = useMemo(() => {
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  // All projects belonging to the selected customer
  const customerProjects = useMemo(() => {
    if (!selectedCustomerId || !selectedCustomer) return [];
    const custName = (selectedCustomer.name || '').trim().toLowerCase();
    return projects.filter(p => 
      p.customer_id === selectedCustomerId ||
      (p.customer_name && p.customer_name.trim().toLowerCase() === custName)
    );
  }, [projects, selectedCustomerId, selectedCustomer]);

  // Computed distinct years for selected customer
  const customerYears = useMemo(() => {
    const yearsSet = new Set<number>();
    customerProjects.forEach(p => {
      if (p.year) yearsSet.add(p.year);
    });
    return Array.from(yearsSet).sort((a, b) => b - a); // Descending order
  }, [customerProjects]);

  // Sync selected year when customerYears change
  useEffect(() => {
    if (customerYears.length > 0) {
      if (!selectedYear || !customerYears.includes(selectedYear)) {
        setSelectedYear(customerYears[0]);
      }
    } else {
      setSelectedYear(null);
    }
  }, [customerYears]);

  // Final filtered projects for the third column (selected customer + selected year)
  const filteredProjects = useMemo(() => {
    if (!selectedYear) return [];
    return customerProjects.filter(p => p.year === selectedYear);
  }, [customerProjects, selectedYear]);

  // Statistics for Customer Card
  const customerStats = useMemo(() => {
    const projCount = customerProjects.length;
    const yearsCount = customerYears.length;
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
      
      // Update local state and select the new customer
      const updatedCusts = await getCustomers(activeBU);
      setCustomers(updatedCusts || []);
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
      
      const updatedCusts = await getCustomers();
      setCustomers(updatedCusts || []);
      // Also reload projects to reflect updated customer names
      reloadProjects();
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật khách hàng', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteCustomerClick = (id: number, name: string) => {
    if (!isAdmin()) {
      alert('Bạn không có quyền thực hiện thao tác xóa khách hàng!');
      return;
    }
    const linkedProjects = projects.filter(p => 
      p.customer_id === id || 
      (p.customer_name && p.customer_name.trim().toLowerCase() === name.trim().toLowerCase())
    );
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
      await loadData();
    } catch (err: any) {
      onFlash(err.response?.data?.detail || err.message || 'Lỗi xóa khách hàng', true);
    } finally {
      setActionLoading(false);
    }
  };

  // --- PROJECT CRUD HANDLERS ---
  const handleOpenCreateProject = async () => {
    setModalMode('create');
    setEditingProjectId(null);
    setFormSubmitted(false);
    setProjectForm({
      name: '',
      year: selectedYear || new Date().getFullYear(),
      customerId: selectedCustomerId || '',
      business: activeBU === 'markee' ? 'Markee' : 'Infrastructure',
      pmIds: [],
      leaderIds: [],
      salesIds: [],
      memberIds: [],
      currentPhase: '1. Tư vấn',
      status: 'Planning',
      description: ''
    });
    setSelectedTemplateId('');
    // Load templates for the dropdown
    try {
      const tpls = await getProjectTemplates();
      setTemplates(tpls || []);
    } catch (err) {
      setTemplates([]);
    }
    setShowProjectModal(true);
  };

  const handleOpenEditProject = (proj: any) => {
    setModalMode('edit');
    setEditingProjectId(proj.id);
    setFormSubmitted(false);

    // Safely extract multiple stakeholder IDs
    const pmIds = proj.pm_ids || (proj.pm_id ? [proj.pm_id] : []);
    const leaderIds = proj.technical_leader_ids || (proj.technical_leader_id ? [proj.technical_leader_id] : []);
    const salesIds = proj.sales_ids || (proj.sales_id ? [proj.sales_id] : []);
    const memberIds = proj.member_ids || proj.members?.map((m: any) => m.id) || [];

    setProjectForm({
      name: proj.name || '',
      year: proj.year || new Date().getFullYear(),
      customerId: proj.customer_id || selectedCustomerId || '',
      business: proj.business || (activeBU === 'markee' ? 'Markee' : 'Infrastructure'),
      pmIds: pmIds.map(Number),
      leaderIds: leaderIds.map(Number),
      salesIds: salesIds.map(Number),
      memberIds: memberIds.map(Number),
      currentPhase: proj.current_phase || '1. Tư vấn',
      status: proj.status || 'Planning',
      description: proj.description || ''
    });
    setShowProjectModal(true);
  };

  const handleSaveProjectForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitted(true);

    if (!projectForm.name.trim()) {
      if (nameInputRef.current) {
        nameInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        nameInputRef.current.focus();
      }
      return;
    }
    if (!projectForm.customerId) {
      onFlash('Vui lòng chọn khách hàng!', true);
      return;
    }

    setActionLoading(true);
    try {
      const selectedCust = allCustomers.find(c => c.id === Number(projectForm.customerId));
      const payload = {
        name: projectForm.name.trim(),
        code: `${projectForm.name.trim().replace(/\s+/g, '-')}-${projectForm.year}`,
        customer_id: Number(projectForm.customerId),
        customer_name: selectedCust ? selectedCust.name : '',
        business: projectForm.business || (activeBU === 'markee' ? 'Markee' : 'Infrastructure'),
        data_scope: (projectForm.business || (activeBU === 'markee' ? 'Markee' : 'Infrastructure')).toLowerCase(),
        year: Number(projectForm.year),
        status: projectForm.status,
        description: projectForm.description,
        current_phase: projectForm.currentPhase,
        pm_ids: projectForm.pmIds,
        technical_leader_ids: projectForm.leaderIds,
        sales_ids: projectForm.salesIds,
        member_ids: projectForm.memberIds
      };

      if (modalMode === 'create') {
        const created = await createProject(payload);
        
        // Nếu có chọn template, tự động áp dụng template vào dự án vừa tạo
        if (created && created.id && selectedTemplateId) {
          try {
            await applyProjectTemplate(Number(selectedTemplateId), created.id);
            onFlash('Đã tạo dự án và áp dụng template thành công');
          } catch (applyErr: any) {
            onFlash('Đã tạo dự án nhưng áp dụng template thất bại: ' + (applyErr?.response?.data?.detail || applyErr?.message || 'Lỗi'), true);
          }
        } else {
          onFlash('Đã tạo dự án mới thành công');
        }
        
        // Auto-select the year of the newly created project
        if (created && created.year) {
          setSelectedYear(created.year);
        }
      } else if (editingProjectId) {
        await updateProject(editingProjectId, payload);
        onFlash('Đã cập nhật thông tin dự án');
      }

      setShowProjectModal(false);
      await loadData();
    } catch (err: any) {
      alert('Lỗi lưu thông tin dự án: ' + (err.response?.data?.detail || err.message));
    } finally {
      setActionLoading(false);
    }
  };

  const handleArchiveProject = async (proj: any) => {
    const isArchived = proj.status === 'Archived';
    const nextStatus = isArchived ? 'Planning' : 'Archived';
    try {
      await updateProject(proj.id, { 
        status: nextStatus,
        // Send existing properties to preserve them
        pm_ids: proj.pm_ids || [],
        technical_leader_ids: proj.technical_leader_ids || []
      });
      onFlash(isArchived ? 'Đã kích hoạt lại dự án' : 'Đã đưa dự án vào Lưu trữ (Archive)');
      reloadProjects();
    } catch (err: any) {
      onFlash('Không thể thay đổi trạng thái dự án: ' + (err.response?.data?.detail || err.message), true);
    }
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
      await loadData();
    } catch (err: any) {
      onFlash('Lỗi xóa dự án: ' + (err.response?.data?.detail || err.message), true);
    } finally {
      setActionLoading(false);
    }
  };

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
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">CUSTOMER MANAGEMENT</h1>
          <p className="text-sm text-slate-500 mt-1">Quản lý danh mục Khách hàng → Năm → Dự án theo Workspace</p>
        </div>

        {/* Business Unit Selector Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 self-start sm:self-auto">
          <button
            onClick={() => setActiveBU('infrastructure')}
            className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              activeBU === 'infrastructure'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <span>🛡️</span> Infrastructure
          </button>
          <button
            onClick={() => setActiveBU('markee')}
            className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              activeBU === 'markee'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <span>🚀</span> Markee
          </button>
        </div>
      </div>

      {/* 3-Column Portfolio UI Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* ============================================================== */}
        {/* COLUMN 1: CUSTOMERS */}
        {/* ============================================================== */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[650px] transition-all">
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
              
              // Count projects for this customer
              const pCount = projects.filter(p => p.customer_id === cat.id).length;

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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[650px] transition-all">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
            <span className="text-xs font-bold text-[#0f172a] uppercase tracking-wider">📅 Năm</span>
            <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">{customerYears.length}</span>
          </div>

          {/* Customer Statistics Card (Tích hợp thống kê ở Cột 2 khi chọn khách hàng) */}
          {selectedCustomer ? (
            <div className="p-4 bg-slate-50 border-b border-slate-100 shrink-0">
              <div className="bg-white border border-slate-150 rounded-lg p-3 shadow-xs space-y-2">
                <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  🏢 {selectedCustomer.name}
                  <span className="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800">
                    ACTIVE
                  </span>
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
                const yProjCount = customerProjects.filter(p => p.year === yr).length;

                return (
                  <div
                    key={yr}
                    onClick={() => setSelectedYear(yr)}
                    className={`p-3.5 flex justify-between items-center cursor-pointer transition-all ${
                      isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600' : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <span className="font-semibold text-xs text-[#0f172a]">
                      📆 Năm {yr}
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[650px] transition-all">
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
            {selectedYear ? (
              filteredProjects.map(proj => {
                // Get PM & Leader names
                const pmText = proj.pm_name || 'Chưa phân công';
                const leaderText = proj.technical_leader_name || 'Chưa phân công';
                
                const isArchived = proj.status === 'Archived';
                const statusColor = 
                  proj.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' :
                  proj.status === 'Developing' || proj.status === 'Process' ? 'bg-blue-100 text-blue-800' :
                  isArchived ? 'bg-slate-200 text-slate-700' :
                  'bg-amber-100 text-amber-800';

                return (
                  <div
                    key={proj.id}
                    className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col gap-2.5 relative ${
                      isArchived ? 'opacity-70 bg-slate-50' : ''
                    }`}
                  >
                    {/* Project Header */}
                    <div className="flex justify-between items-start gap-2">
                      <div className="font-bold text-sm text-[#0f172a]">
                        {proj.name}
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${statusColor}`}>
                        {proj.status}
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
                        <button
                          onClick={() => handleArchiveProject(proj)}
                          className={`text-[10px] font-semibold hover:underline ${
                            isArchived ? 'text-emerald-600' : 'text-slate-500'
                          }`}
                        >
                          {isArchived ? 'Mở lại' : 'Archive'}
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
                        onClick={() => router.push(`/project/detail?id=${proj.id}`)}
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

      {/* ============================================================== */}
      {/* PROJECT CREATE/EDIT MODAL */}
      {/* ============================================================== */}
      {showProjectModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center responsive-modal-overlay">
          <div className="bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col transition-all animate-in fade-in zoom-in duration-200 responsive-modal-container">
            
            {/* Header with Context Pill */}
            <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-sm font-extrabold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                  <span>{modalMode === 'create' ? '➕ Tạo dự án' : '📝 Cập nhật dự án'}</span>
                </h3>
                <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 mt-0.5">
                  <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold">{projectForm.business || 'Infrastructure'}</span>
                  <span>●</span>
                  <span className="text-slate-700 font-bold">
                    {projectForm.customerId 
                      ? (allCustomers.find(c => c.id === Number(projectForm.customerId))?.name || (selectedCustomer ? selectedCustomer.name : 'Chưa chọn KH'))
                      : (selectedCustomer ? selectedCustomer.name : 'Chưa chọn KH')}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowProjectModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-all p-1.5 hover:bg-slate-200/60 rounded-lg cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSaveProjectForm} className="flex flex-col flex-1 overflow-hidden min-h-0">
              
              {/* Scrollable Form Content Body */}
              <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">
                
                {/* SECTION 1: THÔNG TIN DỰ ÁN */}
                <div className="space-y-3.5 bg-slate-50/50 p-3.5 sm:p-4 rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <h4 className="text-[11px] font-extrabold text-blue-700 uppercase tracking-wider flex items-center gap-2">
                      <span>📌</span> THÔNG TIN DỰ ÁN
                    </h4>
                  </div>

                  {/* Row 1: Project Name (75%) & Year (25%) */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5 items-start">
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
                        className={`w-full bg-white border ${formSubmitted && !projectForm.name.trim() ? 'border-red-500 bg-red-50/20' : 'border-slate-200'} rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 focus:border-blue-500 outline-none font-semibold transition-all`}
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

                  {/* Row 2: Customer & Business */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider block">
                        Khách hàng <span className="text-amber-500 font-bold ml-0.5">*</span>
                      </label>
                      <select
                        value={projectForm.customerId}
                        onChange={e => setProjectForm({ ...projectForm, customerId: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 cursor-pointer font-semibold"
                      >
                        <option value="">-- Chọn khách hàng --</option>
                        {modalBusinessCustomers.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      {modalCustomerMismatch && (
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
                        <option value="Infrastructure">Infrastructure</option>
                        <option value="Markee">Markee</option>
                        <option value="All">All (Cả 2 team)</option>
                      </select>
                    </div>
                  </div>

                  {/* Row 3: Current Phase */}
                  <div ref={modalPhaseRef} className="space-y-1.5 relative">
                    <label className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider block">
                      Giai đoạn hiện tại <span className="text-amber-500 font-bold ml-0.5">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setModalPhaseDropdownOpen(!modalPhaseDropdownOpen);
                        setModalPmDropdownOpen(false);
                        setModalLeaderDropdownOpen(false);
                        setModalSalesDropdownOpen(false);
                        setModalMemberDropdownOpen(false);
                      }}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] flex items-center justify-between outline-none focus:border-blue-500 transition-all cursor-pointer text-left font-semibold"
                    >
                      <span className="truncate">{projectForm.currentPhase}</span>
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {modalPhaseDropdownOpen && (
                      <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 max-h-[160px] overflow-y-auto">
                        {(dbMasterPhases.length > 0 ? dbMasterPhases.map((m: any) => m.name) : PROJECT_PHASES).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => {
                              setProjectForm({ ...projectForm, currentPhase: p });
                              setModalPhaseDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors ${
                              projectForm.currentPhase === p ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-[#0f172a]'
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
                <div className="space-y-3.5 bg-slate-50/50 p-3.5 sm:p-4 rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <h4 className="text-[11px] font-extrabold text-blue-700 uppercase tracking-wider flex items-center gap-2">
                      <span>👥</span> NHÂN SỰ DỰ ÁN
                    </h4>
                    <span className="text-[10px] text-slate-400">Hỗ trợ tìm kiếm nhanh thành viên</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Left Column: PM & Sales */}
                    <div className="space-y-3">
                      {/* PM Field */}
                      <div ref={modalPmRef} className="space-y-1 relative">
                        <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">PM (Project Manager)</label>
                        <div
                          onClick={() => {
                            setModalPmDropdownOpen(!modalPmDropdownOpen);
                            setModalLeaderDropdownOpen(false);
                            setModalSalesDropdownOpen(false);
                            setModalMemberDropdownOpen(false);
                            setModalPhaseDropdownOpen(false);
                          }}
                          className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-xs text-[#0f172a] flex flex-wrap gap-1 items-center justify-between min-h-[36px] cursor-pointer focus-within:border-blue-500 transition-all"
                        >
                          <div className="flex flex-wrap gap-1 flex-1">
                            {projectForm.pmIds.length === 0 ? (
                              <span className="text-slate-400 px-1 py-0.5">Chọn PM...</span>
                            ) : (
                              projectForm.pmIds.map(id => {
                                const m = members.find(x => x.id === id);
                                return (
                                  <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-semibold text-[10px] flex items-center gap-1">
                                    {m?.display_name || id}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setProjectForm({
                                          ...projectForm,
                                          pmIds: projectForm.pmIds.filter(x => x !== id)
                                        });
                                      }}
                                      className="text-blue-500 hover:text-blue-700 font-bold ml-0.5 text-xs"
                                    >
                                      ×
                                    </button>
                                  </span>
                                );
                              })
                            )}
                          </div>
                          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>

                        {modalPmDropdownOpen && (
                          <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-2 space-y-1.5 max-h-[200px] flex flex-col">
                            <input
                              type="text"
                              value={modalPmSearch}
                              onChange={(e) => setModalPmSearch(e.target.value)}
                              placeholder="Search member..."
                              className="w-full bg-slate-50 border border-slate-200 text-[#0f172a] px-2.5 py-1.5 rounded-md text-xs focus:outline-none focus:border-blue-500"
                            />
                            <div className="overflow-y-auto space-y-0.5 flex-1 max-h-[130px]">
                              {members
                                .filter(u => u.display_name?.toLowerCase().includes(modalPmSearch.toLowerCase()) || u.full_name?.toLowerCase().includes(modalPmSearch.toLowerCase()))
                                .map((u) => {
                                  const isSelected = projectForm.pmIds.includes(u.id);
                                  return (
                                    <button
                                      key={u.id}
                                      type="button"
                                      onClick={() => {
                                        setProjectForm({
                                          ...projectForm,
                                          pmIds: isSelected
                                            ? projectForm.pmIds.filter(id => id !== u.id)
                                            : [...projectForm.pmIds, u.id]
                                        });
                                      }}
                                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 rounded transition-colors flex items-center justify-between ${
                                        isSelected ? 'bg-blue-50 text-blue-600 font-bold' : 'text-[#0f172a]'
                                      }`}
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

                      {/* Sales Field */}
                      <div ref={modalSalesRef} className="space-y-1 relative">
                        <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Sales</label>
                        <div
                          onClick={() => {
                            setModalSalesDropdownOpen(!modalSalesDropdownOpen);
                            setModalPmDropdownOpen(false);
                            setModalLeaderDropdownOpen(false);
                            setModalMemberDropdownOpen(false);
                            setModalPhaseDropdownOpen(false);
                          }}
                          className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-xs text-[#0f172a] flex flex-wrap gap-1 items-center justify-between min-h-[36px] cursor-pointer focus-within:border-blue-500 transition-all"
                        >
                          <div className="flex flex-wrap gap-1 flex-1">
                            {projectForm.salesIds.length === 0 ? (
                              <span className="text-slate-400 px-1 py-0.5">Chọn Sales...</span>
                            ) : (
                              projectForm.salesIds.map(id => {
                                const m = members.find(x => x.id === id);
                                return (
                                  <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-semibold text-[10px] flex items-center gap-1">
                                    {m?.display_name || id}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setProjectForm({
                                          ...projectForm,
                                          salesIds: projectForm.salesIds.filter(x => x !== id)
                                        });
                                      }}
                                      className="text-blue-500 hover:text-blue-700 font-bold ml-0.5 text-xs"
                                    >
                                      ×
                                    </button>
                                  </span>
                                );
                              })
                            )}
                          </div>
                          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>

                        {modalSalesDropdownOpen && (
                          <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-2 space-y-1.5 max-h-[200px] flex flex-col">
                            <input
                              type="text"
                              value={modalSalesSearch}
                              onChange={(e) => setModalSalesSearch(e.target.value)}
                              placeholder="Search member..."
                              className="w-full bg-slate-50 border border-slate-200 text-[#0f172a] px-2.5 py-1.5 rounded-md text-xs focus:outline-none focus:border-blue-500"
                            />
                            <div className="overflow-y-auto space-y-0.5 flex-1 max-h-[130px]">
                              {members
                                .filter(u => u.display_name?.toLowerCase().includes(modalSalesSearch.toLowerCase()) || u.full_name?.toLowerCase().includes(modalSalesSearch.toLowerCase()))
                                .map((u) => {
                                  const isSelected = projectForm.salesIds.includes(u.id);
                                  return (
                                    <button
                                      key={u.id}
                                      type="button"
                                      onClick={() => {
                                        setProjectForm({
                                          ...projectForm,
                                          salesIds: isSelected
                                            ? projectForm.salesIds.filter(id => id !== u.id)
                                            : [...projectForm.salesIds, u.id]
                                        });
                                      }}
                                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 rounded transition-colors flex items-center justify-between ${
                                        isSelected ? 'bg-blue-50 text-blue-600 font-bold' : 'text-[#0f172a]'
                                      }`}
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
                    </div>

                    {/* Right Column: TL & Members */}
                    <div className="space-y-3">
                      {/* TL Field */}
                      <div ref={modalLeaderRef} className="space-y-1 relative">
                        <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Team Leader (TL)</label>
                        <div
                          onClick={() => {
                            setModalLeaderDropdownOpen(!modalLeaderDropdownOpen);
                            setModalPmDropdownOpen(false);
                            setModalSalesDropdownOpen(false);
                            setModalMemberDropdownOpen(false);
                            setModalPhaseDropdownOpen(false);
                          }}
                          className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-xs text-[#0f172a] flex flex-wrap gap-1 items-center justify-between min-h-[36px] cursor-pointer focus-within:border-blue-500 transition-all"
                        >
                          <div className="flex flex-wrap gap-1 flex-1">
                            {projectForm.leaderIds.length === 0 ? (
                              <span className="text-slate-400 px-1 py-0.5">Chọn TL...</span>
                            ) : (
                              projectForm.leaderIds.map(id => {
                                const m = members.find(x => x.id === id);
                                return (
                                  <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-semibold text-[10px] flex items-center gap-1">
                                    {m?.display_name || id}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setProjectForm({
                                          ...projectForm,
                                          leaderIds: projectForm.leaderIds.filter(x => x !== id)
                                        });
                                      }}
                                      className="text-blue-500 hover:text-blue-700 font-bold ml-0.5 text-xs"
                                    >
                                      ×
                                    </button>
                                  </span>
                                );
                              })
                            )}
                          </div>
                          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>

                        {modalLeaderDropdownOpen && (
                          <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-2 space-y-1.5 max-h-[200px] flex flex-col">
                            <input
                              type="text"
                              value={modalLeaderSearch}
                              onChange={(e) => setModalLeaderSearch(e.target.value)}
                              placeholder="Search member..."
                              className="w-full bg-slate-50 border border-slate-200 text-[#0f172a] px-2.5 py-1.5 rounded-md text-xs focus:outline-none focus:border-blue-500"
                            />
                            <div className="overflow-y-auto space-y-0.5 flex-1 max-h-[130px]">
                              {members
                                .filter(u => u.display_name?.toLowerCase().includes(modalLeaderSearch.toLowerCase()) || u.full_name?.toLowerCase().includes(modalLeaderSearch.toLowerCase()))
                                .map((u) => {
                                  const isSelected = projectForm.leaderIds.includes(u.id);
                                  return (
                                    <button
                                      key={u.id}
                                      type="button"
                                      onClick={() => {
                                        setProjectForm({
                                          ...projectForm,
                                          leaderIds: isSelected
                                            ? projectForm.leaderIds.filter(id => id !== u.id)
                                            : [...projectForm.leaderIds, u.id]
                                        });
                                      }}
                                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 rounded transition-colors flex items-center justify-between ${
                                        isSelected ? 'bg-blue-50 text-blue-600 font-bold' : 'text-[#0f172a]'
                                      }`}
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

                      {/* Members Field */}
                      <div ref={modalMemberRef} className="space-y-1 relative">
                        <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Thành viên (Members)</label>
                        <div
                          onClick={() => {
                            setModalMemberDropdownOpen(!modalMemberDropdownOpen);
                            setModalPmDropdownOpen(false);
                            setModalLeaderDropdownOpen(false);
                            setModalSalesDropdownOpen(false);
                            setModalPhaseDropdownOpen(false);
                          }}
                          className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-xs text-[#0f172a] flex flex-wrap gap-1 items-center justify-between min-h-[36px] cursor-pointer focus-within:border-blue-500 transition-all"
                        >
                          <div className="flex flex-wrap gap-1 flex-1">
                            {projectForm.memberIds.length === 0 ? (
                              <span className="text-slate-400 px-1 py-0.5">Chọn Members...</span>
                            ) : (
                              projectForm.memberIds.map(id => {
                                const m = members.find(x => x.id === id);
                                return (
                                  <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-semibold text-[10px] flex items-center gap-1">
                                    {m?.display_name || id}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setProjectForm({
                                          ...projectForm,
                                          memberIds: projectForm.memberIds.filter(x => x !== id)
                                        });
                                      }}
                                      className="text-blue-500 hover:text-blue-700 font-bold ml-0.5 text-xs"
                                    >
                                      ×
                                    </button>
                                  </span>
                                );
                              })
                            )}
                          </div>
                          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>

                        {modalMemberDropdownOpen && (
                          <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-2 space-y-1.5 max-h-[200px] flex flex-col">
                            <input
                              type="text"
                              value={modalMemberSearch}
                              onChange={(e) => setModalMemberSearch(e.target.value)}
                              placeholder="Search member..."
                              className="w-full bg-slate-50 border border-slate-200 text-[#0f172a] px-2.5 py-1.5 rounded-md text-xs focus:outline-none focus:border-blue-500"
                            />
                            <div className="overflow-y-auto space-y-0.5 flex-1 max-h-[130px]">
                              {members
                                .filter(u => u.display_name?.toLowerCase().includes(modalMemberSearch.toLowerCase()) || u.full_name?.toLowerCase().includes(modalMemberSearch.toLowerCase()))
                                .map((u) => {
                                  const isSelected = projectForm.memberIds.includes(u.id);
                                  return (
                                    <button
                                      key={u.id}
                                      type="button"
                                      onClick={() => {
                                        setProjectForm({
                                          ...projectForm,
                                          memberIds: isSelected
                                            ? projectForm.memberIds.filter(id => id !== u.id)
                                            : [...projectForm.memberIds, u.id]
                                        });
                                      }}
                                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 rounded transition-colors flex items-center justify-between ${
                                        isSelected ? 'bg-blue-50 text-blue-600 font-bold' : 'text-[#0f172a]'
                                      }`}
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
                    </div>
                  </div>
                </div>

                {/* SECTION 3: KHỞI TẠO & MÔ TẢ */}
                <div className="space-y-3.5 bg-slate-50/50 p-3.5 sm:p-4 rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <h4 className="text-[11px] font-extrabold text-blue-700 uppercase tracking-wider flex items-center gap-2">
                      <span>⚙️</span> KHỞI TẠO & MÔ TẢ
                    </h4>
                  </div>

                  {/* Template Selection */}
                  {modalMode === 'create' && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                        Template Khởi tạo
                      </label>
                      <select
                        value={selectedTemplateId}
                        onChange={e => setSelectedTemplateId(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 cursor-pointer font-semibold"
                      >
                        <option value="">None (Không áp dụng template)</option>
                        {templates.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.phases?.length || 18} phases)
                          </option>
                        ))}
                      </select>

                      {/* Template Preview Badge */}
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

                  {/* Description */}
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
              {/* LIVE PROJECT SUMMARY CARD */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between font-bold text-slate-700 border-b border-slate-200/80 pb-1">
                  <span className="flex items-center gap-1 text-[11px]">
                    <span>📊</span> Project Summary Preview
                  </span>
                  <span className="text-[9px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-extrabold uppercase">
                    {projectForm.business || 'Infrastructure'}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div>
                    <span className="text-slate-400 block">Khách hàng:</span>
                    <span className="font-bold text-slate-800 truncate block">
                      {projectForm.customerId 
                        ? (allCustomers.find(c => c.id === Number(projectForm.customerId))?.name || (selectedCustomer ? selectedCustomer.name : 'Chưa chọn KH'))
                        : (selectedCustomer ? selectedCustomer.name : 'Chưa chọn KH')}
                    </span>
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
                    <span className="font-bold text-slate-800 truncate block">
                      {selectedTemplateId ? 'Standard Template' : 'None'}
                    </span>
                  </div>
                </div>
              </div>
              </div>
              {/* End Scrollable Form Content Body */}

              {/* FIXED STICKY FOOTER */}
              <div className="px-6 py-3.5 bg-white border-t border-slate-200/90 shadow-[0_-4px_16px_rgba(0,0,0,0.05)] flex items-center justify-between shrink-0 z-10">
                {/* Left Side: Field Status Indicator */}
                <div className="flex items-center gap-2">
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

                {/* Right Side: Fixed Action Buttons */}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowProjectModal(false)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
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
                        <span>{modalMode === 'create' ? 'Tạo dự án' : 'Cập nhật dự án'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* CUSTOMER DELETE CONFIRMATION MODAL */}
      {/* ============================================================== */}
      {showCustomerDeleteModal && deletingCustomer && (
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
                      <li key={p.id}>{p.name} ({p.year || '—'})</li>
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
        </div>
      )}

      {/* ============================================================== */}
      {/* PROJECT DELETE CONFIRMATION MODAL */}
      {/* ============================================================== */}
      {showProjectDeleteModal && deletingProject && (
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
        </div>
      )}

    </div>
  );
}
