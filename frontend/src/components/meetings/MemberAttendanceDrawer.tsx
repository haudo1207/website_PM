'use client';

// "Chi tiết tham gia" drawer (chốt 2026-09-15) — click-through from the
// Meetings page's "Nhân sự & Tham gia" card. Right-side slide-in drawer,
// matching the app's existing member-detail convention
// (components/dashboard/MemberDetailModal.tsx).

import { useState } from 'react';

interface MemberAttendanceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  member: { member_id: number; display_name: string; hours: number; meetings: number } | null;
  summary?: {
    on_time_count: number;
    late_count: number;
    late_minutes_total: number;
    no_show_count: number;
    total_recorded: number;
    history: { meeting_id: number; title: string; date: string | null; status: string; late_minutes: number | null }[];
  };
}

const STATUS_LABEL: Record<string, string> = {
  ON_TIME: '🟢 Đúng giờ',
  LATE: '🟠 Trễ',
  NO_SHOW: '🔴 Không tham gia',
};

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return d && m ? `${d}/${m}` : dateStr;
}

export default function MemberAttendanceDrawer({ isOpen, onClose, member, summary }: MemberAttendanceDrawerProps) {
  const [showAllHistory, setShowAllHistory] = useState(false);

  if (!isOpen || !member) return null;

  const history = summary?.history || [];
  const visibleHistory = showAllHistory ? history : history.slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div onClick={onClose} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white h-full shadow-2xl overflow-y-auto custom-scrollbar flex flex-col border-l border-slate-200">
        <div className="sticky top-0 z-20 bg-white px-6 py-4 border-b border-slate-100 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#6366f1] text-white flex items-center justify-center font-black text-lg shadow-sm shrink-0">
              {member.display_name ? member.display_name.charAt(0).toUpperCase() : 'M'}
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider">Chi tiết tham gia</p>
              <h2 className="text-lg font-extrabold text-[#0b1c30] tracking-tight">{member.display_name}</h2>
              <p className="text-xs font-semibold text-slate-400 mt-0.5">{member.meetings} cuộc họp · {member.hours}h</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors flex items-center justify-center font-bold text-sm shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1">
          {!summary ? (
            <p className="text-xs text-[#94a3b8] italic text-center py-8">Chưa có dữ liệu tham gia được ghi nhận.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                  <p className="text-xl font-black text-emerald-700 leading-none">{summary.on_time_count}</p>
                  <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide mt-1.5">Đúng giờ</p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">
                  <p className="text-xl font-black text-amber-700 leading-none">{summary.late_count}</p>
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mt-1.5">Trễ</p>
                </div>
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-center">
                  <p className="text-xl font-black text-red-700 leading-none">{summary.no_show_count}</p>
                  <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide mt-1.5">Vắng</p>
                </div>
              </div>
              <p className="text-xs text-[#64748b]">
                Tổng thời gian trễ: <b className="text-[#0b1c30]">{summary.late_minutes_total} phút</b>
              </p>

              <div>
                <h3 className="text-[11px] font-black text-[#0b1c30] uppercase tracking-wider mb-3">Lịch sử tham gia</h3>
                <div className="space-y-1.5">
                  {visibleHistory.map(h => (
                    <div key={h.meeting_id} className="flex items-center justify-between text-xs py-1.5 border-b border-[#f1f5f9] last:border-0">
                      <span className="text-[#94a3b8] font-semibold w-10 shrink-0">{formatShortDate(h.date)}</span>
                      <span className="text-[#0b1c30] font-bold flex-1 truncate px-2">{h.title}</span>
                      <span className={`font-semibold shrink-0 ${h.status === 'ON_TIME' ? 'text-emerald-700' : h.status === 'LATE' ? 'text-amber-700' : 'text-red-700'}`}>
                        {STATUS_LABEL[h.status] || h.status}{h.status === 'LATE' && h.late_minutes != null ? ` ${h.late_minutes} phút` : ''}
                      </span>
                    </div>
                  ))}
                </div>
                {history.length > 10 && (
                  <button
                    type="button"
                    onClick={() => setShowAllHistory(v => !v)}
                    className="mt-3 text-[11px] font-bold text-[#6366f1] hover:underline"
                  >
                    {showAllHistory ? 'Thu gọn' : `Xem tất cả (${history.length}) →`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
