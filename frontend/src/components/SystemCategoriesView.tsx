import React, { useState } from 'react';
import {
  createPosition,
  updatePosition,
  deletePosition,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createPriority,
  updatePriority,
  deletePriority,
  createStatus,
  updateStatus,
  deleteStatus,
  createTeam,
  updateTeam,
  deleteTeam,
  createCustomer,
  updateCustomer,
  deleteCustomer
} from '@/lib/api';

interface SystemCategoriesViewProps {
  positions: any[];
  departments: any[];
  priorities: any[];
  statuses: any[];
  teams: any[];
  customers: any[];
  onReload: () => void;
  onFlash: (msg: string) => void;
}

export default function SystemCategoriesView({
  positions,
  departments,
  priorities,
  statuses,
  teams,
  customers = [],
  onReload,
  onFlash
}: SystemCategoriesViewProps) {
  // Add item form states
  const [showAddPos, setShowAddPos] = useState(false);
  const [newPosName, setNewPosName] = useState('');
  const [newPosDesc, setNewPosDesc] = useState('');

  const [showAddDept, setShowAddDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptDesc, setNewDeptDesc] = useState('');

  const [showAddPrio, setShowAddPrio] = useState(false);
  const [newPrioName, setNewPrioName] = useState('');
  const [newPrioKpi, setNewPrioKpi] = useState(6);
  const [newPrioColor, setNewPrioColor] = useState('🟢 Xanh');

  const [showAddStatus, setShowAddStatus] = useState(false);
  const [newStatusName, setNewStatusName] = useState('');

  const [showAddTeam, setShowAddTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [editingTeamDesc, setEditingTeamDesc] = useState('');

  const [showAddCust, setShowAddCust] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustDesc, setNewCustDesc] = useState('');
  const [editingCustId, setEditingCustId] = useState<number | null>(null);
  const [editingCustName, setEditingCustName] = useState('');
  const [editingCustDesc, setEditingCustDesc] = useState('');

  // Editing states (ID mapping)
  const [editingPosId, setEditingPosId] = useState<number | null>(null);
  const [editingPosName, setEditingPosName] = useState('');
  const [editingPosDesc, setEditingPosDesc] = useState('');

  const [editingDeptId, setEditingDeptId] = useState<number | null>(null);
  const [editingDeptName, setEditingDeptName] = useState('');
  const [editingDeptDesc, setEditingDeptDesc] = useState('');

  const [editingPrioId, setEditingPrioId] = useState<number | null>(null);
  const [editingPrioName, setEditingPrioName] = useState('');
  const [editingPrioKpi, setEditingPrioKpi] = useState(6);
  const [editingPrioColor, setEditingPrioColor] = useState('');

  const [editingStatusId, setEditingStatusId] = useState<number | null>(null);
  const [editingStatusName, setEditingStatusName] = useState('');

  // --- Handlers ---
  const handleAddPos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPosName.trim()) return;
    try {
      await createPosition({ name: newPosName, description: newPosDesc });
      setNewPosName('');
      setNewPosDesc('');
      setShowAddPos(false);
      onReload();
      onFlash('Đã thêm chức vụ mới thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm chức vụ');
    }
  };

  const handleUpdatePos = async (id: number) => {
    if (!editingPosName.trim()) return;
    try {
      await updatePosition(id, { name: editingPosName, description: editingPosDesc });
      setEditingPosId(null);
      onReload();
      onFlash('Đã cập nhật chức vụ thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật chức vụ');
    }
  };

  const handleDeletePos = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa chức vụ "${name}"?`)) return;
    try {
      await deletePosition(id);
      onReload();
      onFlash('Đã xóa chức vụ thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa chức vụ');
    }
  };

  const handleAddDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeptName.trim()) return;
    try {
      await createDepartment({ name: newDeptName, description: newDeptDesc });
      setNewDeptName('');
      setNewDeptDesc('');
      setShowAddDept(false);
      onReload();
      onFlash('Đã thêm phòng ban mới thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm phòng ban');
    }
  };

  const handleUpdateDept = async (id: number) => {
    if (!editingDeptName.trim()) return;
    try {
      await updateDepartment(id, { name: editingDeptName, description: editingDeptDesc });
      setEditingDeptId(null);
      onReload();
      onFlash('Đã cập nhật phòng ban thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật phòng ban');
    }
  };

  const handleDeleteDept = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa phòng ban "${name}"?`)) return;
    try {
      await deleteDepartment(id);
      onReload();
      onFlash('Đã xóa phòng ban thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa phòng ban');
    }
  };

  const handleAddPrio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrioName.trim()) return;
    if (newPrioKpi <= 0) {
      onFlash('KPI Base phải lớn hơn 0');
      return;
    }
    try {
      await createPriority({ name: newPrioName, kpi_base: newPrioKpi, color: newPrioColor });
      setNewPrioName('');
      setNewPrioKpi(6);
      setShowAddPrio(false);
      onReload();
      onFlash('Đã thêm mức độ ưu tiên mới thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm mức độ ưu tiên');
    }
  };

  const handleUpdatePrio = async (id: number) => {
    if (!editingPrioName.trim()) return;
    if (editingPrioKpi <= 0) {
      onFlash('KPI Base phải lớn hơn 0');
      return;
    }
    try {
      await updatePriority(id, { name: editingPrioName, kpi_base: editingPrioKpi, color: editingPrioColor });
      setEditingPrioId(null);
      onReload();
      onFlash('Đã cập nhật mức độ ưu tiên thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật mức độ ưu tiên');
    }
  };

  const handleDeletePrio = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa mức độ ưu tiên "${name}"?`)) return;
    try {
      await deletePriority(id);
      onReload();
      onFlash('Đã xóa mức độ ưu tiên thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa mức độ ưu tiên');
    }
  };

  const handleAddStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatusName.trim()) return;
    try {
      await createStatus({ name: newStatusName });
      setNewStatusName('');
      setShowAddStatus(false);
      onReload();
      onFlash('Đã thêm trạng thái mới thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm trạng thái');
    }
  };

  const handleUpdateStatus = async (id: number) => {
    if (!editingStatusName.trim()) return;
    try {
      await updateStatus(id, { name: editingStatusName });
      setEditingStatusId(null);
      onReload();
      onFlash('Đã cập nhật trạng thái thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật trạng thái');
    }
  };

  const handleDeleteStatus = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa trạng thái "${name}"?`)) return;
    try {
      await deleteStatus(id);
      onReload();
      onFlash('Đã xóa trạng thái thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa trạng thái');
    }
  };

  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    try {
      await createTeam({ name: newTeamName, description: newTeamDesc });
      setNewTeamName(''); setNewTeamDesc(''); setShowAddTeam(false);
      onReload(); onFlash('Đã thêm team mới thành công');
    } catch (err: any) { onFlash(err.response?.data?.detail || 'Lỗi thêm team'); }
  };

  const handleUpdateTeam = async (id: number) => {
    if (!editingTeamName.trim()) return;
    try {
      await updateTeam(id, { name: editingTeamName, description: editingTeamDesc });
      setEditingTeamId(null); onReload(); onFlash('Đã cập nhật team thành công');
    } catch (err: any) { onFlash(err.response?.data?.detail || 'Lỗi cập nhật team'); }
  };

  const handleDeleteTeam = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa team "${name}"?`)) return;
    try {
      await deleteTeam(id); onReload(); onFlash('Đã xóa team thành công');
    } catch (err: any) { onFlash(err.response?.data?.detail || 'Lỗi khi xóa team'); }
  };

  const handleAddCust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;
    try {
      await createCustomer({ name: newCustName, description: newCustDesc });
      setNewCustName(''); setNewCustDesc(''); setShowAddCust(false);
      onReload(); onFlash('Đã thêm khách hàng mới thành công');
    } catch (err: any) { onFlash(err.response?.data?.detail || 'Lỗi thêm khách hàng'); }
  };

  const handleUpdateCust = async (id: number) => {
    if (!editingCustName.trim()) return;
    try {
      await updateCustomer(id, { name: editingCustName, description: editingCustDesc });
      setEditingCustId(null); onReload(); onFlash('Đã cập nhật khách hàng thành công');
    } catch (err: any) { onFlash(err.response?.data?.detail || 'Lỗi cập nhật khách hàng'); }
  };

  const handleDeleteCust = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa khách hàng "${name}"?`)) return;
    try {
      await deleteCustomer(id); onReload(); onFlash('Đã xóa khách hàng thành công');
    } catch (err: any) { onFlash(err.response?.data?.detail || 'Lỗi khi xóa khách hàng'); }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">Danh Mục Hệ Thống</h1>
        <p className="text-sm text-slate-500 mt-1">Cấu hình các giá trị dùng chung cho Chức vụ, Phòng ban, Trạng thái và Mức độ ưu tiên của Task</p>
      </div>

      {/* 1. CHỨC VỤ CARD */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
              💼 Chức vụ
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">Danh mục vai trò công việc</p>
          </div>
          <button
            onClick={() => setShowAddPos(!showAddPos)}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-bold transition-all shadow-sm"
          >
            {showAddPos ? 'Đóng' : '+ Thêm'}
          </button>
        </div>

        {showAddPos && (
          <form onSubmit={handleAddPos} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên chức vụ</label>
              <input
                required
                type="text"
                placeholder="Ví dụ: PM, Leader, Developer..."
                value={newPosName}
                onChange={e => setNewPosName(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:border-blue-500 transition-all"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả (tùy chọn)</label>
              <input
                type="text"
                placeholder="Mô tả ngắn gọn về chức vụ..."
                value={newPosDesc}
                onChange={e => setNewPosDesc(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:border-blue-500 transition-all"
              />
            </div>
            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm shrink-0 h-[36px]"
            >
              Lưu lại
            </button>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {positions.length === 0 ? (
            <p className="text-xs text-slate-400 italic p-6 text-center">Chưa có chức vụ nào.</p>
          ) : (
            positions.map(p => {
              const isEditing = editingPosId === p.id;
              return (
                <div key={p.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/40 transition-colors">
                  {isEditing ? (
                    <div className="flex-1 flex gap-3 mr-4">
                      <input
                        required
                        type="text"
                        value={editingPosName}
                        onChange={e => setEditingPosName(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none w-1/3"
                      />
                      <input
                        type="text"
                        value={editingPosDesc}
                        onChange={e => setEditingPosDesc(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none flex-1"
                      />
                    </div>
                  ) : (
                    <div>
                      <span className="font-semibold text-xs text-[#0f172a]">{p.name}</span>
                      {p.description && (
                        <span className="text-[11px] text-slate-400 ml-3 italic">({p.description})</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleUpdatePos(p.id)}
                          className="text-[11px] bg-blue-600 text-white px-2.5 py-1 rounded font-bold hover:bg-blue-700"
                        >
                          Lưu
                        </button>
                        <button
                          onClick={() => setEditingPosId(null)}
                          className="text-[11px] bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-bold hover:bg-slate-300"
                        >
                          Hủy
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingPosId(p.id);
                            setEditingPosName(p.name);
                            setEditingPosDesc(p.description || '');
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDeletePos(p.id, p.name)}
                          className="text-xs text-red-600 hover:text-red-700 font-semibold"
                        >
                          Xóa
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 2. PHÒNG BAN CARD */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
              🏢 Phòng ban
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">Danh mục các phòng ban trong công ty</p>
          </div>
          <button
            onClick={() => setShowAddDept(!showAddDept)}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-bold transition-all shadow-sm"
          >
            {showAddDept ? 'Đóng' : '+ Thêm'}
          </button>
        </div>

        {showAddDept && (
          <form onSubmit={handleAddDept} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên phòng ban</label>
              <input
                required
                type="text"
                placeholder="Ví dụ: AI, ERP, QA, Infrastructure..."
                value={newDeptName}
                onChange={e => setNewDeptName(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:border-blue-500 transition-all"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả (tùy chọn)</label>
              <input
                type="text"
                placeholder="Mô tả phòng ban..."
                value={newDeptDesc}
                onChange={e => setNewDeptDesc(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:border-blue-500 transition-all"
              />
            </div>
            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm shrink-0 h-[36px]"
            >
              Lưu lại
            </button>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {departments.length === 0 ? (
            <p className="text-xs text-slate-400 italic p-6 text-center">Chưa có phòng ban nào.</p>
          ) : (
            departments.map(d => {
              const isEditing = editingDeptId === d.id;
              return (
                <div key={d.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/40 transition-colors">
                  {isEditing ? (
                    <div className="flex-1 flex gap-3 mr-4">
                      <input
                        required
                        type="text"
                        value={editingDeptName}
                        onChange={e => setEditingDeptName(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none w-1/3"
                      />
                      <input
                        type="text"
                        value={editingDeptDesc}
                        onChange={e => setEditingDeptDesc(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none flex-1"
                      />
                    </div>
                  ) : (
                    <div>
                      <span className="font-semibold text-xs text-[#0f172a]">{d.name}</span>
                      {d.description && (
                        <span className="text-[11px] text-slate-400 ml-3 italic">({d.description})</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleUpdateDept(d.id)}
                          className="text-[11px] bg-blue-600 text-white px-2.5 py-1 rounded font-bold hover:bg-blue-700"
                        >
                          Lưu
                        </button>
                        <button
                          onClick={() => setEditingDeptId(null)}
                          className="text-[11px] bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-bold hover:bg-slate-300"
                        >
                          Hủy
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingDeptId(d.id);
                            setEditingDeptName(d.name);
                            setEditingDeptDesc(d.description || '');
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDeleteDept(d.id, d.name)}
                          className="text-xs text-red-600 hover:text-red-700 font-semibold"
                        >
                          Xóa
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 3. MỨC ĐỘ ƯU TIÊN CARD */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
              ⚡ Mức độ ưu tiên
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">Cấu hình Priority, KPI Base và màu sắc hiển thị</p>
          </div>
          <button
            onClick={() => setShowAddPrio(!showAddPrio)}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-bold transition-all shadow-sm"
          >
            {showAddPrio ? 'Đóng' : '+ Thêm'}
          </button>
        </div>

        {showAddPrio && (
          <form onSubmit={handleAddPrio} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên mức độ</label>
              <input
                required
                type="text"
                placeholder="Ví dụ: Normal, High, Critical..."
                value={newPrioName}
                onChange={e => setNewPrioName(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:border-blue-500 transition-all"
              />
            </div>
            <div className="w-[120px] flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">KPI Base</label>
              <input
                required
                type="number"
                min="1"
                value={newPrioKpi}
                onChange={e => setNewPrioKpi(Number(e.target.value))}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 transition-all"
              />
            </div>
            <div className="w-[160px] flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Màu / Icon</label>
              <select
                value={newPrioColor}
                onChange={e => setNewPrioColor(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 transition-all"
              >
                <option value="🟢 Xanh">🟢 Xanh</option>
                <option value="🟠 Cam">🟠 Cam</option>
                <option value="🔴 Đỏ">🔴 Đỏ</option>
                <option value="🟣 Tím">🟣 Tím</option>
                <option value="🔵 Lam">🔵 Lam</option>
                <option value="🟡 Vàng">🟡 Vàng</option>
                <option value="⚫ Đen">⚫ Đen</option>
              </select>
            </div>
            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm shrink-0 h-[36px]"
            >
              Lưu lại
            </button>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {priorities.length === 0 ? (
            <p className="text-xs text-slate-400 italic p-6 text-center">Chưa có mức độ ưu tiên nào.</p>
          ) : (
            priorities.map(p => {
              const isEditing = editingPrioId === p.id;
              return (
                <div key={p.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/40 transition-colors">
                  {isEditing ? (
                    <div className="flex-1 flex gap-3 mr-4">
                      <input
                        required
                        type="text"
                        value={editingPrioName}
                        onChange={e => setEditingPrioName(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none w-1/3"
                      />
                      <input
                        required
                        type="number"
                        min="1"
                        value={editingPrioKpi}
                        onChange={e => setEditingPrioKpi(Number(e.target.value))}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none w-[100px]"
                      />
                      <select
                        value={editingPrioColor}
                        onChange={e => setEditingPrioColor(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none w-[120px]"
                      >
                        <option value="🟢 Xanh">🟢 Xanh</option>
                        <option value="🟠 Cam">🟠 Cam</option>
                        <option value="🔴 Đỏ">🔴 Đỏ</option>
                        <option value="🟣 Tím">🟣 Tím</option>
                        <option value="🔵 Lam">🔵 Lam</option>
                        <option value="🟡 Vàng">🟡 Vàng</option>
                        <option value="⚫ Đen">⚫ Đen</option>
                      </select>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 text-xs font-semibold text-[#0f172a]">
                      <span className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 flex items-center gap-1.5">
                        <span className="text-sm leading-none">{p.color?.split(' ')[0] || '🟢'}</span>
                        <span>{p.name}</span>
                      </span>
                      <span className="text-slate-400 font-medium">
                        KPI Base: <strong className="text-slate-700">{p.kpi_base}</strong>
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleUpdatePrio(p.id)}
                          className="text-[11px] bg-blue-600 text-white px-2.5 py-1 rounded font-bold hover:bg-blue-700"
                        >
                          Lưu
                        </button>
                        <button
                          onClick={() => setEditingPrioId(null)}
                          className="text-[11px] bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-bold hover:bg-slate-300"
                        >
                          Hủy
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingPrioId(p.id);
                            setEditingPrioName(p.name);
                            setEditingPrioKpi(p.kpi_base);
                            setEditingPrioColor(p.color || '🟢 Xanh');
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDeletePrio(p.id, p.name)}
                          className="text-xs text-red-600 hover:text-red-700 font-semibold"
                        >
                          Xóa
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 4. TRẠNG THÁI CARD */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
              🔄 Trạng thái công việc
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">Danh mục các trạng thái của Task</p>
          </div>
          <button
            onClick={() => setShowAddStatus(!showAddStatus)}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-bold transition-all shadow-sm"
          >
            {showAddStatus ? 'Đóng' : '+ Thêm'}
          </button>
        </div>

        {showAddStatus && (
          <form onSubmit={handleAddStatus} className="p-6 bg-slate-50/30 border-b border-slate-200 flex gap-4 items-end">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên trạng thái</label>
              <input
                required
                type="text"
                placeholder="Ví dụ: Waiting, Process, Done, Cancel, Rework..."
                value={newStatusName}
                onChange={e => setNewStatusName(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:border-blue-500 transition-all"
              />
            </div>
            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm shrink-0 h-[36px]"
            >
              Lưu lại
            </button>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {statuses.length === 0 ? (
            <p className="text-xs text-slate-400 italic p-6 text-center">Chưa có trạng thái nào.</p>
          ) : (
            statuses.map(st => {
              const isEditing = editingStatusId === st.id;
              return (
                <div key={st.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/40 transition-colors">
                  {isEditing ? (
                    <div className="flex-1 mr-4">
                      <input
                        required
                        type="text"
                        value={editingStatusName}
                        onChange={e => setEditingStatusName(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none w-1/2"
                      />
                    </div>
                  ) : (
                    <span className="font-semibold text-xs text-[#0f172a]">{st.name}</span>
                  )}

                  <div className="flex items-center gap-3">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleUpdateStatus(st.id)}
                          className="text-[11px] bg-blue-600 text-white px-2.5 py-1 rounded font-bold hover:bg-blue-700"
                        >
                          Lưu
                        </button>
                        <button
                          onClick={() => setEditingStatusId(null)}
                          className="text-[11px] bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-bold hover:bg-slate-300"
                        >
                          Hủy
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingStatusId(st.id);
                            setEditingStatusName(st.name);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDeleteStatus(st.id, st.name)}
                          className="text-xs text-red-600 hover:text-red-700 font-semibold"
                        >
                          Xóa
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      {/* 5. TEAM CARD */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
              👥 Team
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">Danh mục các nhóm làm việc</p>
          </div>
          <button onClick={() => setShowAddTeam(!showAddTeam)}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-bold transition-all shadow-sm">
            {showAddTeam ? 'Đóng' : '+ Thêm'}
          </button>
        </div>

        {showAddTeam && (
          <form onSubmit={handleAddTeam} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên team</label>
              <input required type="text" placeholder="Ví dụ: Technical, Sales, Marketing..."
                value={newTeamName} onChange={e => setNewTeamName(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:border-blue-500 transition-all" />
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả (tùy chọn)</label>
              <input type="text" placeholder="Mô tả ngắn về team..."
                value={newTeamDesc} onChange={e => setNewTeamDesc(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:border-blue-500 transition-all" />
            </div>
            <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm shrink-0 h-[36px]">Lưu lại</button>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {teams.length === 0 ? (
            <p className="text-xs text-slate-400 italic p-6 text-center">Chưa có team nào.</p>
          ) : (
            teams.map(t => {
              const isEditing = editingTeamId === t.id;
              return (
                <div key={t.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/40 transition-colors">
                  {isEditing ? (
                    <div className="flex-1 flex gap-3 mr-4">
                      <input required type="text" value={editingTeamName} onChange={e => setEditingTeamName(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none w-1/3" />
                      <input type="text" value={editingTeamDesc} onChange={e => setEditingTeamDesc(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none flex-1" />
                    </div>
                  ) : (
                    <div>
                      <span className="font-semibold text-xs text-[#0f172a]">{t.name}</span>
                      {t.description && <span className="text-[11px] text-slate-400 ml-3 italic">({t.description})</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    {isEditing ? (
                      <>
                        <button onClick={() => handleUpdateTeam(t.id)} className="text-[11px] bg-blue-600 text-white px-2.5 py-1 rounded font-bold hover:bg-blue-700">Lưu</button>
                        <button onClick={() => setEditingTeamId(null)} className="text-[11px] bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-bold hover:bg-slate-300">Hủy</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setEditingTeamId(t.id); setEditingTeamName(t.name); setEditingTeamDesc(t.description || ''); }}
                          className="text-xs text-blue-600 hover:text-blue-700 font-semibold">Sửa</button>
                        <button onClick={() => handleDeleteTeam(t.id, t.name)}
                          className="text-xs text-red-600 hover:text-red-700 font-semibold">Xóa</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 6. KHÁCH HÀNG CARD */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
              🤝 Khách hàng
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">Danh mục khách hàng/đối tác</p>
          </div>
          <button onClick={() => setShowAddCust(!showAddCust)}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-bold transition-all shadow-sm">
            {showAddCust ? 'Đóng' : '+ Thêm'}
          </button>
        </div>

        {showAddCust && (
          <form onSubmit={handleAddCust} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên khách hàng</label>
              <input required type="text" placeholder="Ví dụ: Samsung SDS, LG CNS, Viettel..."
                value={newCustName} onChange={e => setNewCustName(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:border-blue-500 transition-all" />
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả (tùy chọn)</label>
              <input type="text" placeholder="Mô tả khách hàng..."
                value={newCustDesc} onChange={e => setNewCustDesc(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] placeholder-slate-400 outline-none focus:border-blue-500 transition-all" />
            </div>
            <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm shrink-0 h-[36px]">Lưu lại</button>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {customers.length === 0 ? (
            <p className="text-xs text-slate-400 italic p-6 text-center">Chưa có khách hàng nào.</p>
          ) : (
            customers.map(c => {
              const isEditing = editingCustId === c.id;
              return (
                <div key={c.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/40 transition-colors">
                  {isEditing ? (
                    <div className="flex-1 flex gap-3 mr-4">
                      <input required type="text" value={editingCustName} onChange={e => setEditingCustName(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none w-1/3" />
                      <input type="text" value={editingCustDesc} onChange={e => setEditingCustDesc(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-[#0f172a] focus:border-blue-500 outline-none flex-1" />
                    </div>
                  ) : (
                    <div>
                      <span className="font-semibold text-xs text-[#0f172a]">{c.name}</span>
                      {c.description && <span className="text-[11px] text-slate-400 ml-3 italic">({c.description})</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    {isEditing ? (
                      <>
                        <button onClick={() => handleUpdateCust(c.id)} className="text-[11px] bg-blue-600 text-white px-2.5 py-1 rounded font-bold hover:bg-blue-700">Lưu</button>
                        <button onClick={() => setEditingCustId(null)} className="text-[11px] bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-bold hover:bg-slate-300">Hủy</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setEditingCustId(c.id); setEditingCustName(c.name); setEditingCustDesc(c.description || ''); }}
                          className="text-xs text-blue-600 hover:text-blue-700 font-semibold">Sửa</button>
                        <button onClick={() => handleDeleteCust(c.id, c.name)}
                          className="text-xs text-red-600 hover:text-red-700 font-semibold">Xóa</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
