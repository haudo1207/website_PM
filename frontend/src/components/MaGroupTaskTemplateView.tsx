'use client';
import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMaGroupTaskTemplate, saveMaGroupTaskTemplate } from '@/lib/api';

interface Props {
  onFlash: (msg: string) => void;
}

// Admin-edited default Detail/Manday for a Group Task auto-created under the
// system "MA" phase (weekly feedback) — every new project gets an "MA"
// phase, and creating a Group Task in it pre-fills from this template
// instead of leaving the form blank (see create_task_group() in
// routers/task_groups.py). Start Date is intentionally NOT editable here —
// it's always computed (Monday of the current week) at creation time.
export default function MaGroupTaskTemplateView({ onFlash }: Props) {
  const queryClient = useQueryClient();
  const { data: template, isLoading } = useQuery({
    queryKey: ['ma-group-task-template'],
    queryFn: () => getMaGroupTaskTemplate(),
    staleTime: 60_000,
  });

  const [description, setDescription] = useState('');
  const [mandayEst, setMandayEst] = useState('7');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setDescription(template.description || '');
      setMandayEst(template.manday_est != null ? String(template.manday_est) : '7');
    }
  }, [template]);

  const handleSave = async () => {
    const manday = Number(mandayEst);
    if (!mandayEst || Number.isNaN(manday) || manday <= 0) {
      onFlash('Manday phải là số lớn hơn 0.');
      return;
    }
    setSaving(true);
    try {
      await saveMaGroupTaskTemplate({ description, manday_est: manday });
      queryClient.invalidateQueries({ queryKey: ['ma-group-task-template'] });
      onFlash('Đã lưu template Group Task cho phase MA.');
    } catch (err: any) {
      onFlash(err?.response?.data?.detail || 'Lưu template thất bại.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-slate-400">Đang tải...</div>;
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h3 className="text-sm font-bold text-[#0b1c30]">Template Group Task cho phase &quot;MA&quot;</h3>
        <p className="text-[12.5px] text-slate-500 mt-1">
          Mỗi dự án mới tự có sẵn 1 phase hệ thống tên &quot;MA&quot; (không thể xóa), dùng chứa các Group Task feedback hàng tuần.
          Khi tạo Group Task trong phase này, Mô tả và Manday bên dưới sẽ được điền sẵn vào form thay vì để trống —
          người tạo vẫn sửa tự do trước/sau khi tạo. Start Date luôn được hệ thống tự tính là thứ 2 của tuần hiện tại, không cấu hình ở đây.
        </p>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Mô tả (Detail Task)</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={4}
          placeholder="Nội dung mặc định cho Group Task feedback hàng tuần..."
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0058be] focus:ring-2 focus:ring-blue-500/10"
        />
      </div>

      <div className="w-40">
        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Manday</label>
        <input
          type="number"
          min={1}
          max={10}
          step="0.5"
          value={mandayEst}
          onChange={e => setMandayEst(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0058be] focus:ring-2 focus:ring-blue-500/10"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-[#0058be] text-white text-sm font-bold rounded-lg hover:bg-[#0047a0] disabled:opacity-50"
      >
        {saving ? 'Đang lưu...' : 'Lưu template'}
      </button>
    </div>
  );
}
