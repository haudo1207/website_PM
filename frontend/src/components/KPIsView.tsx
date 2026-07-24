import React, { useEffect, useState } from 'react';
import {
  getPerformanceSettings,
  createPerformanceSetting,
  updatePerformanceSetting,
  deletePerformanceSetting,
  getPriorities,
  createPriority,
  updatePriority,
  deletePriority,
  getStatuses,
  createStatus,
  updateStatus,
  deleteStatus
} from '@/lib/api';

interface RemarkRule {
  id: number;
  performance: string;
  kpi: number;
  remark_type?: string;
  description?: string;
  sort_order: number;
  is_active: boolean;
}

interface KPIsViewProps {
  statuses?: any[];
  onReload?: () => void;
  onFlash: (msg: string) => void;
}

export default function KPIsView({ statuses = [], onReload, onFlash }: KPIsViewProps) {
  const [activeTab, setActiveTab] = useState<'priority' | 'status' | 'remark'>('priority');

  // 1. PRIORITIES STATES
  const [priorities, setPriorities] = useState<any[]>([]);
  const [showAddPrio, setShowAddPrio] = useState(false);
  const [newPrioName, setNewPrioName] = useState('');
  const [newPrioKpi, setNewPrioKpi] = useState(6);
  const [newPrioColor, setNewPrioColor] = useState('🟢 Xanh');

  const [editingPrioId, setEditingPrioId] = useState<number | null>(null);
  const [editingPrioName, setEditingPrioName] = useState('');
  const [editingPrioKpi, setEditingPrioKpi] = useState(6);
  const [editingPrioColor, setEditingPrioColor] = useState('');

  // 2. STATUSES STATES
  const [dbStatuses, setDbStatuses] = useState<any[]>(statuses);
  const [showAddStatus, setShowAddStatus] = useState(false);
  const [newStatusName, setNewStatusName] = useState('');
  const [editingStatusId, setEditingStatusId] = useState<number | null>(null);
  const [editingStatusName, setEditingStatusName] = useState('');

  // 3. REMARK STATES (formerly Performance Settings)
  const [remarks, setRemarks] = useState<RemarkRule[]>([]);
  const [showAddRemark, setShowAddRemark] = useState(false);
  const [newRemarkPerf, setNewRemarkPerf] = useState('');
  const [newRemarkKpi, setNewRemarkKpi] = useState(0);
  const [newRemarkType, setNewRemarkType] = useState('Bonus');
  const [newRemarkDesc, setNewRemarkDesc] = useState('');

  const [editingRemarkId, setEditingRemarkId] = useState<number | null>(null);
  const [editingRemarkPerf, setEditingRemarkPerf] = useState('');
  const [editingRemarkKpi, setEditingRemarkKpi] = useState(0);
  const [editingRemarkType, setEditingRemarkType] = useState('Bonus');
  const [editingRemarkDesc, setEditingRemarkDesc] = useState('');

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [prioData, statusData, remarkData] = await Promise.all([
        getPriorities(),
        getStatuses().catch(() => []),
        getPerformanceSettings()
      ]);
      setPriorities(prioData || []);
      setDbStatuses(statusData || []);
      setRemarks(remarkData || []);
    } catch (err) {
      console.error(err);
      onFlash('Lỗi tải danh sách Cấu hình KPI');
    } finally {
      setLoading(false);
    }
  };

  // --- HANDLERS: PRIORITY ---
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
      loadAll();
      onFlash('Đã thêm Priority mới thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm Priority');
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
      loadAll();
      onFlash('Đã cập nhật Priority thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật Priority');
    }
  };

  const handleDeletePrio = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa Priority "${name}"?`)) return;
    try {
      await deletePriority(id);
      loadAll();
      onFlash('Đã xóa Priority thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa Priority');
    }
  };

  // --- HANDLERS: STATUS ---
  const handleAddStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatusName.trim()) return;
    try {
      await createStatus({ name: newStatusName });
      setNewStatusName('');
      setShowAddStatus(false);
      loadAll();
      if (onReload) onReload();
      onFlash('Đã thêm Status mới thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm Status');
    }
  };

  const handleUpdateStatus = async (id: number) => {
    if (!editingStatusName.trim()) return;
    try {
      await updateStatus(id, { name: editingStatusName });
      setEditingStatusId(null);
      loadAll();
      if (onReload) onReload();
      onFlash('Đã cập nhật Status thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật Status');
    }
  };

  const handleDeleteStatus = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa Status "${name}"?`)) return;
    try {
      await deleteStatus(id);
      loadAll();
      if (onReload) onReload();
      onFlash('Đã xóa Status thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa Status');
    }
  };

  // --- HANDLERS: REMARK ---
  const handleAddRemark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRemarkPerf.trim()) return;
    try {
      await createPerformanceSetting({
        performance: newRemarkPerf.trim(),
        kpi: Number(newRemarkKpi),
        remark_type: newRemarkType,
        description: newRemarkDesc.trim() || undefined
      });
      setNewRemarkPerf('');
      setNewRemarkKpi(0);
      setNewRemarkType('Bonus');
      setNewRemarkDesc('');
      setShowAddRemark(false);
      loadAll();
      onFlash('Đã thêm Remark mới thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm Remark');
    }
  };

  const handleUpdateRemark = async (id: number) => {
    if (!editingRemarkPerf.trim()) return;
    try {
      await updatePerformanceSetting(id, {
        performance: editingRemarkPerf.trim(),
        kpi: Number(editingRemarkKpi),
        remark_type: editingRemarkType,
        description: editingRemarkDesc.trim() || undefined
      });
      setEditingRemarkId(null);
      loadAll();
      onFlash('Đã cập nhật Remark thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật Remark');
    }
  };

  const handleDeleteRemark = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa Remark "${name}"?`)) return;
    try {
      await deletePerformanceSetting(id);
      loadAll();
      onFlash('Đã xóa Remark thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa Remark');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">CẤU HÌNH KPI</h1>
        <p className="text-sm text-slate-500 mt-1">Cấu hình các dữ liệu liên quan đến Task và tính điểm KPI: Priority, Status và Remark</p>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 w-fit">
        <button
          onClick={() => setActiveTab('priority')}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
            activeTab === 'priority'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          ⚡ Priority (Mức độ ưu tiên)
        </button>
        <button
          onClick={() => setActiveTab('status')}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
            activeTab === 'status'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          📌 Status (Trạng thái công việc)
        </button>
        <button
          onClick={() => setActiveTab('remark')}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
            activeTab === 'remark'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          🏷️ Remark (Cấu hình Performance)
        </button>
      </div>

      {/* TAB 1: PRIORITY */}
      {activeTab === 'priority' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                ⚡ Priority (Mức độ ưu tiên)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">Cấu hình độ ưu tiên Task (Normal, High, Critical, Interrupt) và KPI Base</p>
            </div>
            <button
              onClick={() => setShowAddPrio(!showAddPrio)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg font-bold transition-all shadow-sm"
            >
              {showAddPrio ? 'Đóng' : '+ Thêm Priority'}
            </button>
          </div>

          {showAddPrio && (
            <form onSubmit={handleAddPrio} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col md:flex-row gap-4 items-end">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên Priority <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  placeholder="Ví dụ: Normal, High, Critical, Interrupt..."
                  value={newPrioName}
                  onChange={e => setNewPrioName(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <div className="w-32 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">KPI Base</label>
                <input
                  required
                  type="number"
                  min={1}
                  value={newPrioKpi}
                  onChange={e => setNewPrioKpi(Number(e.target.value))}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <div className="w-40 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Màu sắc</label>
                <select
                  value={newPrioColor}
                  onChange={e => setNewPrioColor(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="🟢 Xanh">🟢 Xanh</option>
                  <option value="🟡 Vàng">🟡 Vàng</option>
                  <option value="🔴 Đỏ">🔴 Đỏ</option>
                  <option value="🟣 Tím">🟣 Tím</option>
                </select>
              </div>
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shrink-0"
              >
                Lưu Priority
              </button>
            </form>
          )}

          <div className="divide-y divide-slate-100">
            {priorities.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Chưa có Priority nào.</div>
            ) : (
              priorities.map(prio => (
                <div key={prio.id} className="p-4 px-6 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
                  {editingPrioId === prio.id ? (
                    <div className="flex-1 flex flex-col md:flex-row gap-3 items-center">
                      <input
                        type="text"
                        value={editingPrioName}
                        onChange={e => setEditingPrioName(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a]"
                      />
                      <input
                        type="number"
                        min={1}
                        value={editingPrioKpi}
                        onChange={e => setEditingPrioKpi(Number(e.target.value))}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a] w-24"
                      />
                      <select
                        value={editingPrioColor}
                        onChange={e => setEditingPrioColor(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a]"
                      >
                        <option value="🟢 Xanh">🟢 Xanh</option>
                        <option value="🟡 Vàng">🟡 Vàng</option>
                        <option value="🔴 Đỏ">🔴 Đỏ</option>
                        <option value="🟣 Tím">🟣 Tím</option>
                      </select>
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdatePrio(prio.id)} className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded font-semibold">Lưu</button>
                        <button onClick={() => setEditingPrioId(null)} className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-semibold">Hủy</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="text-base">{prio.color?.split(' ')[0] || '🟢'}</span>
                        <div>
                          <div className="text-xs font-bold text-[#0f172a]">{prio.name}</div>
                          <div className="text-[11px] text-slate-500 font-medium">KPI Base: <span className="font-bold text-blue-600">{prio.kpi_base}</span></div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            setEditingPrioId(prio.id);
                            setEditingPrioName(prio.name);
                            setEditingPrioKpi(prio.kpi_base);
                            setEditingPrioColor(prio.color || '🟢 Xanh');
                          }}
                          className="text-xs text-blue-600 hover:underline font-semibold"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDeletePrio(prio.id, prio.name)}
                          className="text-xs text-red-600 hover:underline font-semibold"
                        >
                          Xóa
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: STATUS */}
      {activeTab === 'status' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                📌 Status (Trạng thái công việc)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">Cấu hình các trạng thái cho Task (Waiting, Processing, Done, Cancel, Rework)</p>
            </div>
            <button
              onClick={() => setShowAddStatus(!showAddStatus)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg font-bold transition-all shadow-sm"
            >
              {showAddStatus ? 'Đóng' : '+ Thêm Status'}
            </button>
          </div>

          {showAddStatus && (
            <form onSubmit={handleAddStatus} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col md:flex-row gap-4 items-end">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên Status <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  placeholder="Ví dụ: Waiting, Processing, Done, Cancel, Rework..."
                  value={newStatusName}
                  onChange={e => setNewStatusName(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shrink-0"
              >
                Lưu Status
              </button>
            </form>
          )}

          <div className="divide-y divide-slate-100">
            {dbStatuses.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Chưa có Status nào.</div>
            ) : (
              dbStatuses.map(st => (
                <div key={st.id} className="p-4 px-6 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
                  {editingStatusId === st.id ? (
                    <div className="flex-1 flex gap-3 items-center">
                      <input
                        type="text"
                        value={editingStatusName}
                        onChange={e => setEditingStatusName(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a] flex-1"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdateStatus(st.id)} className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded font-semibold">Lưu</button>
                        <button onClick={() => setEditingStatusId(null)} className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-semibold">Hủy</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-xs font-bold text-[#0f172a]">{st.name}</div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            setEditingStatusId(st.id);
                            setEditingStatusName(st.name);
                          }}
                          className="text-xs text-blue-600 hover:underline font-semibold"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDeleteStatus(st.id, st.name)}
                          className="text-xs text-red-600 hover:underline font-semibold"
                        >
                          Xóa
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: REMARK */}
      {activeTab === 'remark' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                🏷️ Remark (Cấu hình Performance KPI)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">Quản lý các Remark dùng trong Task, hệ số/điểm KPI (+/-) và loại Thưởng/Phạt</p>
            </div>
            <button
              onClick={() => setShowAddRemark(!showAddRemark)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg font-bold transition-all shadow-sm"
            >
              {showAddRemark ? 'Đóng' : '+ Thêm Remark'}
            </button>
          </div>

          {showAddRemark && (
            <form onSubmit={handleAddRemark} className="p-6 bg-slate-50/30 border-b border-slate-200 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên Remark <span className="text-red-500">*</span></label>
                  <input
                    required
                    type="text"
                    placeholder="Ví dụ: (T) Có tài liệu đào tạo, (P) Điền sai form..."
                    value={newRemarkPerf}
                    onChange={e => setNewRemarkPerf(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Loại (Thưởng/Phạt)</label>
                  <select
                    value={newRemarkType}
                    onChange={e => setNewRemarkType(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 cursor-pointer font-semibold"
                  >
                    <option value="Bonus">🎁 Thưởng (Bonus)</option>
                    <option value="Penalty">⚠️ Phạt (Penalty)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">KPI (+/- hệ số hoặc điểm)</label>
                  <input
                    required
                    type="number"
                    step="0.1"
                    placeholder="Ví dụ: 1.2, -0.5, 2..."
                    value={newRemarkKpi}
                    onChange={e => setNewRemarkKpi(Number(e.target.value))}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="md:col-span-2 flex gap-3 items-end">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả (tùy chọn)</label>
                    <input
                      type="text"
                      placeholder="Mô tả trường hợp áp dụng Remark..."
                      value={newRemarkDesc}
                      onChange={e => setNewRemarkDesc(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-xs font-bold transition-all shrink-0 h-[38px]"
                  >
                    Lưu Remark
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="divide-y divide-slate-100">
            {remarks.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Chưa có Remark nào được tạo.</div>
            ) : (
              remarks.map(rm => {
                const isBonus = rm.remark_type === 'Bonus' || rm.kpi >= 0;
                return (
                  <div key={rm.id} className="p-4 px-6 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
                    {editingRemarkId === rm.id ? (
                      <div className="flex-1 flex flex-col md:flex-row gap-3 items-center">
                        <input
                          type="text"
                          value={editingRemarkPerf}
                          onChange={e => setEditingRemarkPerf(e.target.value)}
                          className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a] flex-1"
                        />
                        <select
                          value={editingRemarkType}
                          onChange={e => setEditingRemarkType(e.target.value)}
                          className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a]"
                        >
                          <option value="Bonus">🎁 Thưởng</option>
                          <option value="Penalty">⚠️ Phạt</option>
                        </select>
                        <input
                          type="number"
                          step="0.1"
                          value={editingRemarkKpi}
                          onChange={e => setEditingRemarkKpi(Number(e.target.value))}
                          className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a] w-20"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => handleUpdateRemark(rm.id)} className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded font-semibold">Lưu</button>
                          <button onClick={() => setEditingRemarkId(null)} className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-semibold">Hủy</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            isBonus ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {isBonus ? '🎁 Thưởng' : '⚠️ Phạt'}
                          </span>
                          <div>
                            <div className="text-xs font-bold text-[#0f172a]">
                              {rm.performance}
                            </div>
                            {rm.description && <div className="text-[11px] text-slate-500 mt-0.5">{rm.description}</div>}
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <span className={`text-xs font-bold font-mono px-2 py-1 rounded ${
                            isBonus ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {rm.kpi > 0 ? `+${rm.kpi}` : rm.kpi} KPI
                          </span>

                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => {
                                setEditingRemarkId(rm.id);
                                setEditingRemarkPerf(rm.performance);
                                setEditingRemarkKpi(rm.kpi);
                                setEditingRemarkType(rm.remark_type || (rm.kpi >= 0 ? 'Bonus' : 'Penalty'));
                                setEditingRemarkDesc(rm.description || '');
                              }}
                              className="text-xs text-blue-600 hover:underline font-semibold"
                            >
                              Sửa
                            </button>
                            <button
                              onClick={() => handleDeleteRemark(rm.id, rm.performance)}
                              className="text-xs text-red-600 hover:underline font-semibold"
                            >
                              Xóa
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
