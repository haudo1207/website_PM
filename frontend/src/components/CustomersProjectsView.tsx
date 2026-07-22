'use client';
import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  getMembers
} from '@/lib/api';

interface CustomersProjectsViewProps {
  onFlash: (msg: string, isError?: boolean) => void;
}

export default function CustomersProjectsView({ onFlash }: CustomersProjectsViewProps) {
  const router = useRouter();

  // Data states
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Selection states
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  // Filter/Search states
  const [customerSearch, setCustomerSearch] = useState('');

  // Customer Inline Form / Edit states
  const [newCustomerName, setNewCustomerName] = useState('');
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [editingCustomerName, setEditingCustomerName] = useState('');

  // Project Modal state
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [projectForm, setProjectForm] = useState({
    name: '',
    year: new Date().getFullYear(),
    customerId: '' as string | number,
    pmId: '' as string | number,
    leaderId: '' as string | number,
    status: 'Planning',
    description: ''
  });

  // Fetch initial data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [custs, projs, mems] = await Promise.all([
        getCustomers(),
        getProjects(),
        getMembers()
      ]);
      setCustomers(custs || []);
      setProjects(projs || []);
      setMembers(mems || []);

      // Auto-select first customer if available and none selected
      if (custs && custs.length > 0 && !selectedCustomerId) {
        setSelectedCustomerId(custs[0].id);
      }
    } catch (err) {
      console.error(err);
      onFlash('Lỗi tải dữ liệu cấu hình hệ thống', true);
    } finally {
      setLoading(false);
    }
  };

  // Safe reload for project updates without full loading state
  const reloadProjects = async () => {
    try {
      const projs = await getProjects();
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

  // Selected Customer details
  const selectedCustomer = useMemo(() => {
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  // All projects belonging to the selected customer
  const customerProjects = useMemo(() => {
    if (!selectedCustomerId || !selectedCustomer) return [];
    
    // Support matching by customer_id OR customer_name for robustness
    return projects.filter(p => 
      p.customer_id === selectedCustomerId || 
      (p.customer_name && p.customer_name.toLowerCase() === selectedCustomer.name.toLowerCase())
    );
  }, [projects, selectedCustomerId, selectedCustomer]);

  // Computed distinct years for selected customer
  const customerYears = useMemo(() => {
    const yearsSet = new Set<number>();
    customerProjects.forEach(p => {
      if (p.year) yearsSet.add(p.year);
    });
    
    const yearsList = Array.from(yearsSet).sort((a, b) => b - a); // Descending order
    
    // Auto-select the first year if available and the current selected year is not in the list
    if (yearsList.length > 0) {
      if (!selectedYear || !yearsList.includes(selectedYear)) {
        setSelectedYear(yearsList[0]);
      }
    } else {
      setSelectedYear(null);
    }

    return yearsList;
  }, [customerProjects, selectedYear]);

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
      const created = await createCustomer({ name: newCustomerName.trim() });
      setNewCustomerName('');
      onFlash('Đã thêm khách hàng thành công');
      
      // Update local state and select the new customer
      const updatedCusts = await getCustomers();
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

  const handleDeleteCustomerClick = async (id: number, name: string) => {
    // Check if customer has projects
    const hasProjects = projects.some(p => 
      p.customer_id === id || 
      (p.customer_name && p.customer_name.toLowerCase() === name.toLowerCase())
    );
    if (hasProjects) {
      alert(`Không thể xóa khách hàng "${name}" vì đang có dự án liên kết. Hãy xóa hoặc chuyển dự án trước.`);
      return;
    }

    if (!confirm(`Bạn có chắc chắn muốn xóa khách hàng "${name}"?`)) return;
    setActionLoading(true);
    try {
      await deleteCustomer(id);
      onFlash('Đã xóa khách hàng thành công');
      
      const updatedCusts = await getCustomers();
      setCustomers(updatedCusts || []);
      if (selectedCustomerId === id) {
        setSelectedCustomerId(updatedCusts.length > 0 ? updatedCusts[0].id : null);
      }
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi xóa khách hàng', true);
    } finally {
      setActionLoading(false);
    }
  };

  // --- PROJECT CRUD HANDLERS ---
  const handleOpenCreateProject = () => {
    setModalMode('create');
    setEditingProjectId(null);
    setProjectForm({
      name: '',
      year: selectedYear || new Date().getFullYear(),
      customerId: selectedCustomerId || '',
      pmId: '',
      leaderId: '',
      status: 'Planning',
      description: ''
    });
    setShowProjectModal(true);
  };

  const handleOpenEditProject = (proj: any) => {
    setModalMode('edit');
    setEditingProjectId(proj.id);
    setProjectForm({
      name: proj.name || '',
      year: proj.year || new Date().getFullYear(),
      customerId: proj.customer_id || selectedCustomerId || '',
      pmId: proj.pm_ids?.[0] || proj.pm_id || '',
      leaderId: proj.technical_leader_ids?.[0] || proj.technical_leader_id || '',
      status: proj.status || 'Planning',
      description: proj.description || ''
    });
    setShowProjectModal(true);
  };

  const handleSaveProjectForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectForm.name.trim()) {
      alert('Tên dự án không được để trống!');
      return;
    }
    if (!projectForm.customerId) {
      alert('Vui lòng chọn khách hàng!');
      return;
    }

    setActionLoading(true);
    try {
      const selectedCust = customers.find(c => c.id === Number(projectForm.customerId));
      const payload = {
        name: projectForm.name.trim(),
        code: `${projectForm.name.trim().replace(/\s+/g, '-')}-${projectForm.year}`,
        customer_id: Number(projectForm.customerId),
        customer_name: selectedCust ? selectedCust.name : '',
        year: Number(projectForm.year),
        status: projectForm.status,
        description: projectForm.description,
        pm_ids: projectForm.pmId ? [Number(projectForm.pmId)] : [],
        technical_leader_ids: projectForm.leaderId ? [Number(projectForm.leaderId)] : [],
        member_ids: []
      };

      if (modalMode === 'create') {
        const created = await createProject(payload);
        onFlash('Đã tạo dự án mới thành công');
        
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

  const handleDeleteProjectClick = async (proj: any) => {
    if (proj.phase_count > 0 || proj.task_count > 0) {
      alert(`Không thể xóa dự án "${proj.name}" vì vẫn còn các phase hoặc task bên trong. Hãy dọn dẹp dự án trước.`);
      return;
    }

    if (!confirm(`Bạn có chắc chắn muốn xóa dự án "${proj.name}"? Hành động này không thể hoàn tác.`)) {
      return;
    }

    setActionLoading(true);
    try {
      await deleteProject(proj.id);
      onFlash('Đã xóa dự án thành công');
      reloadProjects();
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
      <div>
        <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">Cấu hình Khách hàng & Dự án</h1>
        <p className="text-sm text-slate-500 mt-1">Quản lý danh mục Khách hàng → Năm → Dự án để làm dữ liệu danh mục master phục vụ báo cáo và dropdown</p>
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
              const pCount = projects.filter(p => 
                p.customer_id === cat.id || 
                (p.customer_name && p.customer_name.toLowerCase() === cat.name.toLowerCase())
              ).length;

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
                        <button
                          onClick={() => handleDeleteCustomerClick(cat.id, cat.name)}
                          className="text-[10px] text-red-600 hover:underline font-medium"
                        >
                          Xóa
                        </button>
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
                        <button
                          onClick={() => handleDeleteProjectClick(proj)}
                          className="text-[10px] text-red-600 hover:underline font-semibold"
                        >
                          Xóa
                        </button>
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 w-full max-w-lg rounded-xl shadow-xl overflow-hidden flex flex-col">
            
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider">
                {modalMode === 'create' ? '➕ Thêm dự án mới' : '📝 Cập nhật dự án'}
              </h3>
              <button
                onClick={() => setShowProjectModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-all"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSaveProjectForm} className="p-6 space-y-4">
              {/* Project Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên dự án</label>
                <input
                  required
                  type="text"
                  placeholder="Ví dụ: Portal PM..."
                  value={projectForm.name}
                  onChange={e => setProjectForm({ ...projectForm, name: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 focus:border-blue-500 outline-none"
                />
              </div>

              {/* Customer and Year Selectors Row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Khách hàng</label>
                  <select
                    required
                    value={projectForm.customerId}
                    onChange={e => setProjectForm({ ...projectForm, customerId: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="">-- Chọn khách hàng --</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Năm</label>
                  <input
                    required
                    type="number"
                    min={1990}
                    max={2100}
                    value={projectForm.year}
                    onChange={e => setProjectForm({ ...projectForm, year: Number(e.target.value) })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* PM & Technical Leader Selectors */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project Manager (PM)</label>
                  <select
                    value={projectForm.pmId}
                    onChange={e => setProjectForm({ ...projectForm, pmId: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="">-- Chọn PM --</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.display_name} ({m.full_name})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Technical Leader</label>
                  <select
                    value={projectForm.leaderId}
                    onChange={e => setProjectForm({ ...projectForm, leaderId: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="">-- Chọn Leader --</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.display_name} ({m.full_name})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Project Status */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Trạng thái</label>
                <select
                  value={projectForm.status}
                  onChange={e => setProjectForm({ ...projectForm, status: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="Planning">Planning (Chuẩn bị)</option>
                  <option value="Process">Process (Đang thực hiện)</option>
                  <option value="Developing">Developing (Đang phát triển)</option>
                  <option value="Completed">Completed (Hoàn thành)</option>
                  <option value="Archived">Archived (Lưu trữ)</option>
                </select>
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả dự án</label>
                <textarea
                  rows={3}
                  placeholder="Thông tin thêm về dự án..."
                  value={projectForm.description}
                  onChange={e => setProjectForm({ ...projectForm, description: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 focus:border-blue-500 outline-none"
                />
              </div>

              {/* Modal Buttons */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProjectModal(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs font-bold transition-all"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-50"
                >
                  {actionLoading ? 'Đang lưu...' : 'Lưu dự án'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
