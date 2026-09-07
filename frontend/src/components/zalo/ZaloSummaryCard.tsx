'use client';

import React, { useState } from 'react';
import { Sparkles, Check, Send } from 'lucide-react';
import { pushZaloSummaryTasks } from '@/lib/api';
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

const TASK_PRIORITIES = ['Normal', 'High', 'Critical', 'Interrupt'];

type TaskEdit = { detail_task: string; priority: string; assigned_name: string; deadline: string; manday_est: number };

export default function ZaloSummaryCard({
  s,
  onUpdated,
}: {
  s: ZaloConversationSummary;
  // Called with the fresh summary (recommended_tasks now carrying
  // imported_task_id/task_code for whichever entries just got pushed) so
  // the parent's cached list reflects the push without a full refetch.
  onUpdated?: (updated: ZaloConversationSummary) => void;
}) {
  // Defensive fallbacks — `issues`/`next_steps` are absent on any API
  // response served by a backend that hasn't been redeployed with those
  // columns yet, and older summary rows never had `decisions`/`recommended_tasks`
  // backfilled either. Without this, a missing array crashes the whole card.
  const decisions = s.decisions || [];
  const issues = s.issues || [];
  const nextSteps = s.next_steps || [];
  const tasks = s.recommended_tasks || [];

  const [pushing, setPushing] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  // Edits are opt-in per index — only tasks the reviewer actually touched
  // carry an entry here, everything else falls back to the AI's own value
  // (see editFor). Checked defaults to true for any pending (not-yet-
  // pushed) task, matching Meeting's "everything selected, uncheck to skip".
  const [editMap, setEditMap] = useState<Record<number, Partial<TaskEdit>>>({});
  const [checkedMap, setCheckedMap] = useState<Record<number, boolean>>({});

  const editFor = (i: number): TaskEdit => {
    const t = tasks[i];
    const e = editMap[i] || {};
    return {
      detail_task: e.detail_task ?? t.detail_task ?? '',
      priority: e.priority ?? t.priority ?? 'Normal',
      assigned_name: e.assigned_name ?? t.assigned_name ?? '',
      deadline: e.deadline ?? t.deadline ?? '',
      manday_est: e.manday_est ?? t.manday_est ?? 1,
    };
  };
  const updateEdit = (i: number, patch: Partial<TaskEdit>) =>
    setEditMap((prev) => ({ ...prev, [i]: { ...editFor(i), ...patch } }));
  const isChecked = (i: number) => checkedMap[i] !== false;

  const pendingIndices = tasks.map((_, i) => i).filter((i) => !tasks[i].imported_task_id);
  const selectedCount = pendingIndices.filter(isChecked).length;

  const handlePush = async () => {
    const indices = pendingIndices.filter(isChecked);
    if (indices.length === 0) return;
    setPushing(true);
    try {
      const res = await pushZaloSummaryTasks(
        s.id,
        indices.map((index) => ({ index, ...editFor(index) }))
      );
      const nextErrors: Record<number, string> = {};
      for (const r of res.results) {
        if (!r.ok) nextErrors[r.index] = r.error || 'Đẩy task thất bại.';
      }
      setErrors(nextErrors);
      onUpdated?.(res.summary);
    } catch (err: any) {
      alert('Lỗi đẩy task: ' + (err.response?.data?.detail || err.message));
    } finally {
      setPushing(false);
    }
  };

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

      {/* Task đề xuất — mirrors Meeting Intelligence's suggested-tasks push:
          AI-proposed tasks from this window, one click creates the real
          Task rows in the project (already fixed by this conversation's
          ZaloConversation.project_id, so no project/phase picker needed
          here unlike the meeting version). */}
      {tasks.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">Task đề xuất ({tasks.length})</h5>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={handlePush}
                disabled={pushing}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-[#0058be] text-white hover:bg-[#00499e] disabled:opacity-60"
              >
                <Send size={12} />
                {pushing ? 'Đang đẩy…' : `Đẩy ${selectedCount} task đã chọn vào dự án`}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {tasks.map((t, i) => {
              if (t.imported_task_id) {
                return (
                  <div key={i} className="p-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColor(t.priority)}`} />
                      <span className="text-[11px] font-bold text-slate-600">{t.priority}</span>
                      <p className="font-bold text-[#0b1c30] truncate flex-1">{t.detail_task}</p>
                      <span className="shrink-0 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg whitespace-nowrap">
                        ✓ Đã tạo {t.task_code}
                      </span>
                    </div>
                    {(t.assigned_name || t.deadline) && (
                      <div className="flex items-center gap-3 text-[11px] text-[#64748b] font-medium pl-4">
                        {t.assigned_name && <span>👤 {t.assigned_name}</span>}
                        {t.deadline && <span>📅 {t.deadline}</span>}
                      </div>
                    )}
                  </div>
                );
              }

              const edit = editFor(i);
              const checked = isChecked(i);
              return (
                <div key={i} className={`p-3 bg-[#f8fafc] border rounded-xl text-xs space-y-2.5 transition-colors ${checked ? 'border-[#e2e8f0]' : 'border-[#e2e8f0] opacity-50'}`}>
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setCheckedMap((prev) => ({ ...prev, [i]: e.target.checked }))}
                      className="mt-1.5 shrink-0"
                    />
                    <div className="flex-1 space-y-2">
                      <input
                        value={edit.detail_task}
                        onChange={(e) => updateEdit(i, { detail_task: e.target.value })}
                        placeholder="Tên task"
                        className="w-full px-2.5 py-1.5 text-xs font-bold text-[#0b1c30] border border-slate-300 rounded-lg focus:border-[#0058be] focus:outline-none bg-white"
                      />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <select
                          value={edit.priority}
                          onChange={(e) => updateEdit(i, { priority: e.target.value })}
                          className="px-2 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg bg-white focus:border-[#0058be] focus:outline-none"
                        >
                          {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <input
                          value={edit.assigned_name}
                          onChange={(e) => updateEdit(i, { assigned_name: e.target.value })}
                          placeholder="👤 Người thực hiện"
                          className="px-2 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg focus:border-[#0058be] focus:outline-none bg-white"
                        />
                        <input
                          type="date"
                          value={edit.deadline}
                          onChange={(e) => updateEdit(i, { deadline: e.target.value })}
                          className="px-2 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg focus:border-[#0058be] focus:outline-none bg-white"
                        />
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          value={edit.manday_est}
                          onChange={(e) => updateEdit(i, { manday_est: Number(e.target.value) || 1 })}
                          placeholder="Manday"
                          className="px-2 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg focus:border-[#0058be] focus:outline-none bg-white"
                        />
                      </div>
                    </div>
                  </div>
                  {errors[i] && <p className="text-[11px] text-red-600 font-semibold pl-6">⚠ {errors[i]}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
