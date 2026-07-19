import React, { useEffect, useState } from 'react';
import {
  getPerformanceSettings,
  createPerformanceSetting,
  updatePerformanceSetting,
  deletePerformanceSetting,
  getPriorities,
  createPriority,
  updatePriority,
  deletePriority
} from '@/lib/api';

interface KPIRule {
  id: number;
  performance: string;
  kpi: number;
  sort_order: number;
  is_active: boolean;
}

interface KPIsViewProps {
  onFlash: (msg: string) => void;
}

export default function KPIsView({ onFlash }: KPIsViewProps) {
  const [rules, setRules] = useState<KPIRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  // Inline edit state
  const [editPerf, setEditPerf] = useState('');
  const [editKpi, setEditKpi] = useState(0);

  // New KPI Temp Rule State
  const [newRuleMode, setNewRuleMode] = useState(false);
  const [newPerf, setNewPerf] = useState('');
  const [newKpi, setNewKpi] = useState(0);

  // Priorities States
  const [priorities, setPriorities] = useState<any[]>([]);
  const [showAddPrio, setShowAddPrio] = useState(false);
  const [newPrioName, setNewPrioName] = useState('');
  const [newPrioKpi, setNewPrioKpi] = useState(6);
  const [newPrioColor, setNewPrioColor] = useState('🟢 Xanh');

  const [editingPrioId, setEditingPrioId] = useState<number | null>(null);
  const [editingPrioName, setEditingPrioName] = useState('');
  const [editingPrioKpi, setEditingPrioKpi] = useState(6);
  const [editingPrioColor, setEditingPrioColor] = useState('');

  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    setLoading(true);
    try {
      const data = await getPerformanceSettings();
      setRules(data);
      const prioData = await getPriorities();
      setPriorities(prioData);
    } catch (err) {
      console.error(err);
      onFlash('Lỗi tải danh sách cấu hình KPI');
    } finally {
      setLoading(false);
    }
  };

  // Priorities Handlers
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
      loadRules();
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
      loadRules();
      onFlash('Đã cập nhật mức độ ưu tiên thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật mức độ ưu tiên');
    }
  };

  const handleDeletePrio = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa mức độ ưu tiên "${name}"?`)) return;
    try {
      await deletePriority(id);
      loadRules();
      onFlash('Đã xóa mức độ ưu tiên thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa mức độ ưu tiên');
    }
  };

  const handleStartEdit = (rule: KPIRule) => {
    setEditingId(rule.id);
    setEditPerf(rule.performance);
    setEditKpi(rule.kpi);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = async (id: number) => {
    if (!editPerf.trim()) {
      onFlash('Nội dung Performance không được để trống');
      return;
    }
    try {
      await updatePerformanceSetting(id, {
        performance: editPerf,
        kpi: editKpi
      });
      setEditingId(null);
      loadRules();
      onFlash('Đã cập nhật cấu hình KPI thành công');
    } catch (err) {
      console.error(err);
      onFlash('Lỗi cập nhật cấu hình KPI');
    }
  };

  const handleAddKPI = async () => {
    if (!newPerf.trim()) {
      onFlash('Vui lòng điền nội dung Performance');
      return;
    }
    try {
      await createPerformanceSetting({
        performance: newPerf,
        kpi: newKpi
      });
      setNewRuleMode(false);
      setNewPerf('');
      setNewKpi(0);
      loadRules();
      onFlash('Đã tạo mới cấu hình KPI thành công');
    } catch (err) {
      console.error(err);
      onFlash('Lỗi tạo mới cấu hình KPI');
    }
  };

  const handleDeleteRule = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa cấu hình KPI này?')) return;
    try {
      await deletePerformanceSetting(id);
      loadRules();
      onFlash('Đã xóa cấu hình KPI thành công');
    } catch (err) {
      console.error(err);
      onFlash('Lỗi xóa cấu hình KPI');
    }
  };

  // Helper to determine group of a rule
  const getRuleGroup = (performance: string): string => {
    const p = performance.trim().toLowerCase();
    if (p.startsWith('(t)')) {
      return 'I. Tasks khen thưởng';
    }
    if (p.startsWith('(p)')) {
      return 'II. Tasks bị phạt';
    }
    if (
      p.includes('rework') ||
      p.includes('change request') ||
      p.includes('issue') ||
      p.includes('unplanned')
    ) {
      return 'IV. Tasks phát sinh';
    }
    if (
      p.includes('xử lý sự cố') ||
      p.includes('ngày lễ') ||
      p.includes('cuối tuần') ||
      p.includes('tối trong tuần') ||
      p.includes('ot') ||
      /^\d+\s*day/.test(p)
    ) {
      return 'III. Tasks làm ngoài giờ';
    }
    return 'IV. Tasks phát sinh';
  };

  const groupsOrder = [
    'I. Tasks khen thưởng',
    'II. Tasks bị phạt',
    'III. Tasks làm ngoài giờ',
    'IV. Tasks phát sinh'
  ];

  const groupedRules = groupsOrder.reduce((acc, groupName) => {
    acc[groupName] = rules.filter(r => getRuleGroup(r.performance) === groupName);
    return acc;
  }, {} as Record<string, KPIRule[]>);

  return (
    <div className="space-y-6">
      {/* MỨC ĐỘ ƯU TIÊN CARD */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
              ⚡ Mức độ ưu tiên & KPI Base
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">Cấu hình Priority, KPI Base và màu sắc hiển thị</p>
          </div>
          <button
            onClick={() => setShowAddPrio(!showAddPrio)}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-bold transition-all shadow-sm"
          >
            {showAddPrio ? 'Đóng' : '+ Thêm Priority'}
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

      {/* Upper header with + Thêm KPI button */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">Cấu hình Performance KPI</h1>
          <p className="text-xs text-slate-500 mt-1">
            Quản lý danh sách các quy tắc thưởng/phạt và làm ngoài giờ (OT) từ ô Remark.
          </p>
        </div>
        {!newRuleMode && (
          <button
            onClick={() => setNewRuleMode(true)}
            className="bg-[#0058be] hover:bg-[#0047a0] text-white px-3.5 py-2 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Thêm KPI
          </button>
        )}
      </div>

      {/* Form thêm mới nhanh */}
      {newRuleMode && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 animate-fade-in">
          <h3 className="text-xs font-bold uppercase text-[#0b1c30] tracking-wider">Thêm quy tắc KPI mới</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nội dung Performance</label>
              <input
                type="text"
                value={newPerf}
                onChange={e => setNewPerf(e.target.value)}
                placeholder="Ví dụ: (T) Có tài liệu đào tạo upload lên website"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0b1c30] placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Giá trị KPI (Cộng/Trừ/Hệ số)</label>
              <input
                type="number"
                step="0.01"
                value={newKpi}
                onChange={e => setNewKpi(Number(e.target.value))}
                placeholder="Ví dụ: 5, -5, 0.7"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0b1c30] placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddKPI}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-xs font-bold transition-all shadow-sm"
              >
                Lưu
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewRuleMode(false);
                  setNewPerf('');
                  setNewKpi(0);
                }}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold transition-all"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Table View */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-[65%]">Performance</th>
                <th className="px-6 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-[20%] text-center">KPI</th>
                <th className="px-6 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-[15%] text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-xs text-slate-400 italic">
                    Đang tải danh sách cấu hình...
                  </td>
                </tr>
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-xs text-slate-400 italic">
                    Chưa có cấu hình KPI nào được ghi nhận.
                  </td>
                </tr>
              ) : (
                groupsOrder.map(groupName => {
                  const groupRules = groupedRules[groupName] || [];
                  if (groupRules.length === 0) return null;

                  return (
                    <React.Fragment key={groupName}>
                      {/* Section Header Row */}
                      <tr className="bg-slate-100/70 border-y border-slate-200/80">
                        <td colSpan={3} className="px-6 py-2.5 text-[10px] font-extrabold text-[#0058be] uppercase tracking-wider">
                          {groupName}
                        </td>
                      </tr>
                      {groupRules.map(rule => {
                        const isEditing = editingId === rule.id;

                        return (
                          <tr key={rule.id} className="hover:bg-slate-50/40 transition-colors group">
                            {/* Performance Cell */}
                            <td className="px-6 py-4">
                              {isEditing ? (
                                <textarea
                                  value={editPerf}
                                  onChange={e => setEditPerf(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      handleSaveEdit(rule.id);
                                    } else if (e.key === 'Escape') {
                                      handleCancelEdit();
                                    }
                                  }}
                                  autoFocus
                                  rows={1}
                                  className="w-full bg-white border border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-2.5 py-1.5 text-xs text-[#0b1c30] font-medium outline-none resize-y"
                                />
                              ) : (
                                <div className="text-xs text-[#0b1c30] font-medium min-h-[28px] flex items-center px-1.5">
                                  {rule.performance}
                                </div>
                              )}
                            </td>

                            {/* KPI Value Cell */}
                            <td className="px-6 py-4 text-center">
                              {isEditing ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editKpi}
                                  onChange={e => setEditKpi(Number(e.target.value))}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      handleSaveEdit(rule.id);
                                    } else if (e.key === 'Escape') {
                                      handleCancelEdit();
                                    }
                                  }}
                                  className="w-24 text-center bg-white border border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-2.5 py-1 text-xs text-[#0b1c30] font-semibold outline-none"
                                />
                              ) : (
                                <div
                                  className={`inline-block font-semibold text-xs px-2.5 py-0.5 rounded-full transition-colors ${
                                    rule.kpi > 1
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : rule.kpi < 0
                                      ? 'bg-red-50 text-red-600'
                                      : 'bg-amber-50 text-amber-700'
                                  }`}
                                >
                                  {rule.kpi}
                                </div>
                              )}
                            </td>

                            {/* Actions Cell */}
                            <td className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center gap-3">
                                {isEditing ? (
                                  <>
                                    <button
                                      onClick={() => handleSaveEdit(rule.id)}
                                      className="text-xs font-bold text-emerald-600 hover:text-emerald-800 transition-colors"
                                    >
                                      Lưu
                                    </button>
                                    <button
                                      onClick={handleCancelEdit}
                                      className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                                    >
                                      Hủy
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleStartEdit(rule)}
                                      className="text-slate-400 hover:text-[#0058be] transition-colors p-1 rounded hover:bg-slate-100"
                                      title="Sửa"
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      onClick={() => handleDeleteRule(rule.id)}
                                      className="text-slate-400 hover:text-red-600 transition-colors p-1 rounded hover:bg-slate-100"
                                      title="Xóa"
                                    >
                                      🗑️
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
