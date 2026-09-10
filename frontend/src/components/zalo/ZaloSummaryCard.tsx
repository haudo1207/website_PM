'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Check, Send } from 'lucide-react';
import { pushZaloSummaryTasks, getMembers, getCategories } from '@/lib/api';
import type { ZaloConversationSummary } from '@/lib/api';
import SearchableSelect from '@/components/common/SearchableSelect';
import { PhaseSelectCell, TaskGroupSelectCell, PickedRef } from '@/components/common/PhaseTaskGroupSelect';

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

type TaskEdit = { detail_task: string; priority: string; deadline: string; manday_est: number; start_date: string };

export default function ZaloSummaryCard({
  s,
  onUpdated,
  projectId,
}: {
  s: ZaloConversationSummary;
  // Called with the fresh summary (recommended_tasks now carrying
  // imported_task_id/task_code for whichever entries just got pushed) so
  // the parent's cached list reflects the push without a full refetch.
  onUpdated?: (updated: ZaloConversationSummary) => void;
  // Needed for the Phase picker (per-project) — the conversation this
  // summary belongs to is always tied to exactly one project.
  projectId?: number;
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

  // Real picker state — mirrors MeetingDetailModal's "Task Đề Xuất Từ AI"
  // tab (taskAssigneeMap/taskSupportMap/etc.), per the finalized Push Task
  // field spec: Assigned/Support/Skill Solution/Skill Vendor are required
  // real picks, Phase/Task cha are optional (fall back on the backend).
  const [membersList, setMembersList] = useState<any[]>([]);
  const [categoriesList, setCategoriesList] = useState<any[]>([]);
  const [taskAssigneeMap, setTaskAssigneeMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskSupportMap, setTaskSupportMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskSkillSolutionMap, setTaskSkillSolutionMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskSkillVendorMap, setTaskSkillVendorMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskPhaseMap, setTaskPhaseMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskGroupMap, setTaskGroupMap] = useState<Record<number, PickedRef | undefined>>({});

  useEffect(() => {
    getMembers().then((res: any) => {
      const items = res?.data || res || [];
      if (Array.isArray(items)) setMembersList(items);
    }).catch(() => {});
    getCategories().then((res: any) => {
      const items = res?.data || res || [];
      if (Array.isArray(items)) setCategoriesList(items);
    }).catch(() => {});
  }, []);

  // Skill Solution = Group, Skill Vendor = Skill nested under it — same
  // categories → groups → skills shape MeetingDetailModal derives from.
  const allSkillGroups: any[] = categoriesList.flatMap((c: any) => c.groups || []);
  const getSkillVendorsForGroup = (groupId?: number) => {
    if (!groupId) return [];
    const group = allSkillGroups.find((g: any) => g.id === groupId);
    return group?.skills || [];
  };

  const editFor = (i: number): TaskEdit => {
    const t = tasks[i];
    const e = editMap[i] || {};
    return {
      detail_task: e.detail_task ?? t.detail_task ?? '',
      priority: e.priority ?? t.priority ?? 'Normal',
      deadline: e.deadline ?? t.deadline ?? '',
      manday_est: e.manday_est ?? t.manday_est ?? 1,
      start_date: e.start_date ?? '',
    };
  };
  const updateEdit = (i: number, patch: Partial<TaskEdit>) =>
    setEditMap((prev) => ({ ...prev, [i]: { ...editFor(i), ...patch } }));
  const isChecked = (i: number) => checkedMap[i] !== false;

  const pendingIndices = tasks.map((_, i) => i).filter((i) => !tasks[i].imported_task_id);
  const selectedCount = pendingIndices.filter(isChecked).length;

  // Required per the Push Task field spec — Phase/Task cha are deliberately
  // excluded here since the backend falls back to the project's first
  // Phase/TaskGroup instead of blocking on them.
  const missingRequiredFields = (i: number): string[] => {
    const edit = editFor(i);
    const missing: string[] = [];
    if (!taskAssigneeMap[i]) missing.push('Assigned');
    if (!taskSupportMap[i]) missing.push('Support');
    if (!taskSkillSolutionMap[i]) missing.push('Skill Solution');
    if (!taskSkillVendorMap[i]) missing.push('Skill Vendor');
    if (!edit.start_date) missing.push('Start Date');
    const manday = Number(edit.manday_est);
    if (!manday || manday !== Math.trunc(manday) || manday < 1 || manday > 10) missing.push('Manday EST (1-10)');
    return missing;
  };
  const needsReviewCount = pendingIndices.filter((i) => missingRequiredFields(i).length > 0).length;

  const handlePush = async () => {
    const indices = pendingIndices.filter(isChecked);
    if (indices.length === 0) return;

    const blocked = indices.filter((i) => missingRequiredFields(i).length > 0);
    if (blocked.length > 0) {
      alert('Vui lòng bổ sung đủ Assigned/Support/Skill Solution/Skill Vendor/Start Date/Manday EST (1-10) cho các task còn thiếu trước khi push.');
      return;
    }

    const missingPlacement = indices.some((i) => !taskPhaseMap[i]?.id || !taskGroupMap[i]?.id);
    if (missingPlacement && !window.confirm(
      'Có task chưa chọn đủ Phase / Task cha. Task đó sẽ được đẩy vào Phase/Task cha đầu tiên của dự án — bạn vẫn muốn tiếp tục?'
    )) {
      return;
    }

    setPushing(true);
    try {
      const res = await pushZaloSummaryTasks(
        s.id,
        indices.map((index) => {
          const edit = editFor(index);
          const assignee = taskAssigneeMap[index]!;
          const support = taskSupportMap[index]!;
          return {
            index,
            detail_task: edit.detail_task,
            priority: edit.priority,
            deadline: edit.deadline,
            manday_est: edit.manday_est,
            start_date: edit.start_date,
            assigned_id: assignee.id,
            assigned_name: assignee.name,
            support_id: support.id,
            skill_solution_id: taskSkillSolutionMap[index]!.id,
            skill_vendor_id: taskSkillVendorMap[index]!.id,
            phase_id: taskPhaseMap[index]?.id,
            task_group_id: taskGroupMap[index]?.id,
          };
        })
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

      {/* Task đề xuất — mirrors Meeting Intelligence's suggested-tasks push
          (MeetingDetailModal's "Task Đề Xuất Từ AI" tab): AI-proposed tasks
          from this window, one click creates the real Task rows in the
          project (already fixed by this conversation's ZaloConversation.
          project_id, so no per-task project picker needed here unlike the
          meeting version — Phase/Task cha still apply, same as meeting). */}
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
          {needsReviewCount > 0 ? (
            <p className="text-[11px] text-red-500 font-semibold">
              ⚠ {needsReviewCount}/{pendingIndices.length} task còn thiếu Assigned/Support/Skill Solution/Skill Vendor/Start Date/Manday EST hợp lệ — cần bổ sung trước khi push.
            </p>
          ) : (
            <p className="text-[11px] text-[#94a3b8]">Tất cả task đã đủ thông tin, sẵn sàng push.</p>
          )}
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
              const currentAssignee = taskAssigneeMap[i];
              const currentSupport = taskSupportMap[i];
              const currentSkillSolution = taskSkillSolutionMap[i];
              const currentSkillVendor = taskSkillVendorMap[i];
              const currentPhase = taskPhaseMap[i];
              const fieldLabelCls = 'block text-[9.5px] font-bold text-slate-500 uppercase tracking-wider mb-0.5';
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
                        <div>
                          <label className={fieldLabelCls}>Priority</label>
                          <select
                            value={edit.priority}
                            onChange={(e) => updateEdit(i, { priority: e.target.value })}
                            className="w-full px-2 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg bg-white focus:border-[#0058be] focus:outline-none"
                          >
                            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={fieldLabelCls}>Manday Est</label>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            value={edit.manday_est}
                            onChange={(e) => updateEdit(i, { manday_est: Math.round(Number(e.target.value)) || 1 })}
                            placeholder="1-10"
                            className={`w-full px-2 py-1.5 text-[11px] font-semibold border rounded-lg focus:border-[#0058be] focus:outline-none bg-white ${edit.manday_est >= 1 && edit.manday_est <= 10 ? 'border-slate-300' : 'border-red-400'}`}
                          />
                        </div>
                        <div>
                          <label className={fieldLabelCls}>Start Date</label>
                          <input
                            type="date"
                            value={edit.start_date}
                            onChange={(e) => updateEdit(i, { start_date: e.target.value })}
                            className={`w-full px-2 py-1.5 text-[11px] font-semibold border rounded-lg focus:border-[#0058be] focus:outline-none bg-white ${edit.start_date ? 'border-slate-300' : 'border-red-400'}`}
                          />
                        </div>
                        <div>
                          <label className={fieldLabelCls}>Deadline (AI)</label>
                          <input
                            type="date"
                            value={edit.deadline}
                            onChange={(e) => updateEdit(i, { deadline: e.target.value })}
                            className="w-full px-2 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg focus:border-[#0058be] focus:outline-none bg-white"
                          />
                        </div>
                        <div>
                          <label className={fieldLabelCls}>Assigned</label>
                          <SearchableSelect
                            label="người thực hiện"
                            options={membersList.map((m: any) => ({ id: m.id, name: m.display_name || m.full_name || `#${m.id}` }))}
                            value={currentAssignee?.id || ''}
                            onChange={(val: any) => {
                              const mid = Number(val);
                              const found = membersList.find((m: any) => m.id === mid);
                              setTaskAssigneeMap((prev) => ({ ...prev, [i]: found ? { id: found.id, name: found.display_name || found.full_name } : undefined }));
                            }}
                            placeholder="Gõ tìm người..."
                            searchThreshold={0}
                            className={`w-full ${currentAssignee ? '' : 'ring-2 ring-red-400 rounded-lg'}`}
                          />
                        </div>
                        <div>
                          <label className={fieldLabelCls}>Support</label>
                          <SearchableSelect
                            label="người hỗ trợ"
                            options={membersList.map((m: any) => ({ id: m.id, name: m.display_name || m.full_name || `#${m.id}` }))}
                            value={currentSupport?.id || ''}
                            onChange={(val: any) => {
                              const mid = Number(val);
                              const found = membersList.find((m: any) => m.id === mid);
                              setTaskSupportMap((prev) => ({ ...prev, [i]: found ? { id: found.id, name: found.display_name || found.full_name } : undefined }));
                            }}
                            placeholder="Gõ tìm người..."
                            searchThreshold={0}
                            className={`w-full ${currentSupport ? '' : 'ring-2 ring-red-400 rounded-lg'}`}
                          />
                        </div>
                        <div>
                          <label className={fieldLabelCls}>Skill Solution</label>
                          <SearchableSelect
                            label="skill solution"
                            options={allSkillGroups.map((g: any) => ({ id: g.id, name: g.name }))}
                            value={currentSkillSolution?.id || ''}
                            onChange={(val: any) => {
                              const gid = Number(val);
                              const found = allSkillGroups.find((g: any) => g.id === gid);
                              setTaskSkillSolutionMap((prev) => ({ ...prev, [i]: found ? { id: found.id, name: found.name } : undefined }));
                              setTaskSkillVendorMap((prev) => ({ ...prev, [i]: undefined }));
                            }}
                            placeholder="Gõ tìm..."
                            searchThreshold={0}
                            className={`w-full ${currentSkillSolution ? '' : 'ring-2 ring-red-400 rounded-lg'}`}
                          />
                        </div>
                        <div>
                          <label className={fieldLabelCls}>Skill Vendor</label>
                          <SearchableSelect
                            label="skill vendor"
                            options={getSkillVendorsForGroup(currentSkillSolution?.id).map((sv: any) => ({ id: sv.id, name: sv.name }))}
                            value={currentSkillVendor?.id || ''}
                            onChange={(val: any) => {
                              const sid = Number(val);
                              const found = getSkillVendorsForGroup(currentSkillSolution?.id).find((sv: any) => sv.id === sid);
                              setTaskSkillVendorMap((prev) => ({ ...prev, [i]: found ? { id: found.id, name: found.name } : undefined }));
                            }}
                            disabled={!currentSkillSolution}
                            placeholder={currentSkillSolution ? 'Gõ tìm...' : 'Chọn Skill Solution trước'}
                            searchThreshold={0}
                            className={`w-full ${!currentSkillSolution || currentSkillVendor ? '' : 'ring-2 ring-red-400 rounded-lg'}`}
                          />
                        </div>
                        <div>
                          <label className={fieldLabelCls}>Phase</label>
                          {projectId ? (
                            <PhaseSelectCell
                              projectId={projectId}
                              phase={currentPhase}
                              onPhaseChange={(p) => setTaskPhaseMap((prev) => ({ ...prev, [i]: p }))}
                              onTaskGroupChange={(g) => setTaskGroupMap((prev) => ({ ...prev, [i]: g }))}
                            />
                          ) : (
                            <p className="text-[11px] text-slate-400 py-1.5">Không xác định dự án</p>
                          )}
                        </div>
                        <div>
                          <label className={fieldLabelCls}>Task cha</label>
                          {currentPhase ? (
                            <TaskGroupSelectCell
                              phase={currentPhase}
                              taskGroup={taskGroupMap[i]}
                              onTaskGroupChange={(g) => setTaskGroupMap((prev) => ({ ...prev, [i]: g }))}
                            />
                          ) : (
                            <p className="text-[11px] text-slate-400 py-1.5">Chọn phase trước</p>
                          )}
                        </div>
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
