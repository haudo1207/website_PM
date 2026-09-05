'use client';
import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkloadSettings, updateWorkloadSettings, WorkloadSetting } from '@/lib/api';

interface Props {
  onFlash: (msg: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  not_working: 'Không làm việc',
  capacity: 'Còn capacity',
  normal: 'Bình thường',
  overload: 'Quá tải',
};

const STATUS_COLORS: Record<string, string> = {
  not_working: 'bg-slate-100 text-slate-600 border-slate-200',
  capacity: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  normal: 'bg-blue-50 text-blue-700 border-blue-200',
  overload: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function WorkloadSettingsView({ onFlash }: Props) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['workload-settings'],
    queryFn: () => getWorkloadSettings(),
    staleTime: 60_000,
  });

  const [form, setForm] = useState<Record<string, { min_kpi: string; max_kpi: string }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings && settings.length > 0) {
      const f: Record<string, { min_kpi: string; max_kpi: string }> = {};
      for (const s of settings) {
        f[s.status_key] = {
          min_kpi: s.min_kpi !== null ? String(s.min_kpi) : '',
          max_kpi: s.max_kpi !== null ? String(s.max_kpi) : '',
        };
      }
      setForm(f);
    }
  }, [settings]);

  const handleChange = (key: string, field: 'min_kpi' | 'max_kpi', value: string) => {
    setForm(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = Object.entries(form).map(([key, vals]) => ({
        status_key: key,
        min_kpi: vals.min_kpi === '' ? null : Number(vals.min_kpi),
        max_kpi: vals.max_kpi === '' ? null : Number(vals.max_kpi),
      }));
      await updateWorkloadSettings(payload);
      queryClient.invalidateQueries({ queryKey: ['workload-settings'] });
      onFlash('Đã cập nhật ngưỡng workload thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật ngưỡng workload');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <p className="text-xs text-slate-400 italic py-6">Đang tải cấu hình...</p>;
  }

  const sorted = (settings || []).sort((a, b) => (a.min_kpi ?? 0) - (b.min_kpi ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">Cấu hình ngưỡng Workload</h1>
        <p className="text-sm text-slate-500 mt-1">
          Quản lý ngưỡng phân loại tải KPI cho Dashboard → Team Load → Section 4.
          Baseline: <strong>100 KPI điểm / tuần tài chính = 100%</strong>.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase text-[10px] tracking-wider">
              <th className="px-4 py-3 text-left font-bold">Trạng thái</th>
              <th className="px-4 py-3 text-center font-bold">KPI% tối thiểu</th>
              <th className="px-4 py-3 text-center font-bold">KPI% tối đa</th>
              <th className="px-4 py-3 text-left font-bold">Ví dụ</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => {
              const f = form[s.status_key] || { min_kpi: '', max_kpi: '' };
              return (
                <tr key={s.status_key} className="border-b border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-extrabold px-2.5 py-1 rounded-full border ${STATUS_COLORS[s.status_key] || 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABELS[s.status_key] || s.status_label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      step="0.01"
                      value={f.min_kpi}
                      onChange={e => handleChange(s.status_key, 'min_kpi', e.target.value)}
                      placeholder={s.min_kpi === null ? '-∞' : ''}
                      className="w-24 text-center border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      step="0.01"
                      value={f.max_kpi}
                      onChange={e => handleChange(s.status_key, 'max_kpi', e.target.value)}
                      placeholder={s.max_kpi === null ? '+∞' : ''}
                      className="w-24 text-center border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {s.status_key === 'not_working' && 'KPI% < 50%'}
                    {s.status_key === 'capacity' && '50% ≤ KPI% < 90%'}
                    {s.status_key === 'normal' && '90% ≤ KPI% ≤ 120%'}
                    {s.status_key === 'overload' && 'KPI% > 120%'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-[#0058be] text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
        </button>
        <p className="text-[10px] text-slate-400">
          KPI% = KPI điểm hoàn thành / số tuần tài chính trong kỳ chọn.
          Chỉ Super Admin được phép thay đổi.
        </p>
      </div>
    </div>
  );
}
