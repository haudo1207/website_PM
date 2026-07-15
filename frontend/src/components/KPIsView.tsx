import React, { useEffect, useState, useRef } from 'react';
import {
  getPerformanceSettings,
  createPerformanceSetting,
  updatePerformanceSetting,
  deletePerformanceSetting
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

  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    setLoading(true);
    try {
      const data = await getPerformanceSettings();
      setRules(data);
    } catch (err) {
      console.error(err);
      onFlash('Lỗi tải danh sách cấu hình KPI');
    } finally {
      setLoading(false);
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

  return (
    <div className="space-y-6">
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
                rules.map(rule => {
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
                            onBlur={() => handleSaveEdit(rule.id)}
                            autoFocus
                            rows={1}
                            className="w-full bg-white border border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-2.5 py-1.5 text-xs text-[#0b1c30] font-medium outline-none resize-y"
                          />
                        ) : (
                          <div 
                            onClick={() => handleStartEdit(rule)}
                            className="text-xs text-[#0b1c30] font-medium cursor-pointer min-h-[28px] flex items-center hover:bg-slate-100/50 rounded px-1.5 transition-colors"
                          >
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
                            onBlur={() => handleSaveEdit(rule.id)}
                            className="w-24 text-center bg-white border border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-2.5 py-1 text-xs text-[#0b1c30] font-semibold outline-none"
                          />
                        ) : (
                          <div
                            onClick={() => handleStartEdit(rule)}
                            className={`inline-block font-semibold text-xs px-2.5 py-0.5 rounded-full cursor-pointer transition-colors ${
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
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
