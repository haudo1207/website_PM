'use client';

import React from 'react';
import { Sparkles, Check } from 'lucide-react';
import type { ZaloConversationSummary } from '@/lib/api';

// Mirrors MeetingDetailModal's "Bản Tóm Tắt AI Chi Tiết" tab section-by-section
// (info grid, purple TỔNG QUAN box, emerald decisions, amber issues, indigo
// next steps, priority-dot task cards) so the Zalo group digest reads as the
// same "AI Summary" pattern used for meetings — shared between the project
// detail "Tóm tắt nhóm" tab and the /zalo-account summary modal. Uses a
// neutral slate card border (not an indigo one) so it doesn't double up with
// the slate-bordered conversation card it's usually nested inside.
function priorityDotColor(priority: string) {
  if (priority === 'High' || priority === 'Critical') return 'bg-red-500';
  if (priority === 'Medium') return 'bg-blue-500';
  return 'bg-emerald-500';
}

export default function ZaloSummaryCard({ s }: { s: ZaloConversationSummary }) {
  // Defensive fallbacks — `issues`/`next_steps` are absent on any API
  // response served by a backend that hasn't been redeployed with those
  // columns yet, and older summary rows never had `decisions`/`recommended_tasks`
  // backfilled either. Without this, a missing array crashes the whole card.
  const decisions = s.decisions || [];
  const issues = s.issues || [];
  const nextSteps = s.next_steps || [];
  const tasks = s.recommended_tasks || [];

  return (
    <div className="border border-slate-200 rounded-2xl bg-white p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2 text-[#6366f1]">
          <Sparkles size={18} />
          <h4 className="text-sm font-extrabold text-[#0b1c30]">Bản Tóm Tắt AI</h4>
        </div>
        <span className="text-[11px] font-semibold text-[#94a3b8]">{s.message_count} tin nhắn</span>
      </div>

      {/* Info grid — mirrors the meeting detail tab's header info table */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs">
        <div>
          <p className="text-[#94a3b8] font-semibold">Từ</p>
          <p className="text-[#0b1c30] font-bold mt-0.5">{new Date(s.period_start).toLocaleString('vi-VN')}</p>
        </div>
        <div>
          <p className="text-[#94a3b8] font-semibold">Đến</p>
          <p className="text-[#0b1c30] font-bold mt-0.5">{new Date(s.period_end).toLocaleString('vi-VN')}</p>
        </div>
        <div>
          <p className="text-[#94a3b8] font-semibold">Số tin nhắn</p>
          <p className="text-[#0b1c30] font-bold mt-0.5">{s.message_count}</p>
        </div>
      </div>

      {/* Tổng quan */}
      <div className="space-y-2">
        <h5 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">Tổng quan</h5>
        <div className="p-4 bg-[#f8f6ff] border border-[#eee9fe] rounded-2xl text-sm text-[#334155] leading-relaxed whitespace-pre-wrap">
          {s.content}
        </div>
      </div>

      {/* Các quyết định chính */}
      <div className="space-y-2">
        <h5 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">Các quyết định chính ({decisions.length})</h5>
        {decisions.length > 0 ? (
          <div className="space-y-2">
            {decisions.map((dec, i) => (
              <div key={i} className="p-3.5 bg-emerald-50/60 border border-emerald-200/80 rounded-xl flex items-start gap-3 text-xs text-[#065f46]">
                <Check size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                <span className="font-medium">{dec}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#94a3b8] italic">Chưa ghi nhận quyết định nào từ AI.</p>
        )}
      </div>

      {/* Vấn đề & rủi ro */}
      {issues.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">Vấn đề & rủi ro ({issues.length})</h5>
          <div className="space-y-2">
            {issues.map((it, i) => (
              <div key={i} className="p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-xl flex items-start gap-3 text-xs text-amber-900">
                <span className="shrink-0 mt-0.5 font-bold">{i + 1}.</span>
                <span className="font-medium">{it}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bước tiếp theo */}
      {nextSteps.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">Bước tiếp theo ({nextSteps.length})</h5>
          <div className="space-y-2">
            {nextSteps.map((it, i) => (
              <div key={i} className="p-3.5 bg-[#f5f3ff] border border-[#eee9fe] rounded-xl flex items-start gap-3 text-xs text-[#4338ca]">
                <span className="shrink-0 mt-0.5 font-bold">{i + 1}.</span>
                <span className="font-medium">{it}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Task đề xuất */}
      {tasks.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">Task đề xuất ({tasks.length})</h5>
          <div className="space-y-2">
            {tasks.map((t, i) => (
              <div key={i} className="p-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColor(t.priority)}`} />
                  <span className="text-[11px] font-bold text-slate-600">{t.priority}</span>
                  <p className="font-bold text-[#0b1c30] truncate">{t.detail_task}</p>
                </div>
                {(t.assigned_name || t.deadline) && (
                  <div className="flex items-center gap-3 text-[11px] text-[#64748b] font-medium pl-4">
                    {t.assigned_name && <span>👤 {t.assigned_name}</span>}
                    {t.deadline && <span>📅 {t.deadline}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
