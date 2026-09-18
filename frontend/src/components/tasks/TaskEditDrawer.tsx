'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import Portal from '@/components/Portal';
import SearchableSelect from '@/components/common/SearchableSelect';
import {
  CalendarTask, getProjectMembers, getCategories, getPriorities, getStatuses, updateTask, getApiErrorMessage,
  blockTask, unblockTask, getAllProjectTasks,
} from '@/lib/api';
import { LinkChipsEditor, appendLinkValue } from '@/components/LinkChipsEditor';
import { toApiDate, parseApiDate, parseScheduledAt, combineDateAndTime, toApiDateTime } from '@/components/calendar/dateUtils';

// Copied verbatim from project/detail/page.tsx (not exported there, and
// this drawer must not modify that file) — same "X phút/giờ/ngày trước"
// formatting Task Detail's own block card uses for "bởi {ai} · {khi nào}".
function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'Vừa xong';
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} ngày trước`;
  return d.toLocaleDateString('vi-VN');
}

interface SkillItem { id: number; name: string; group_id: number; is_active?: boolean }
interface SkillGroup { id: number; name: string; category_id: number; skills: SkillItem[]; is_active?: boolean }
interface SkillCategory { id: number; name: string; groups: SkillGroup[]; is_active?: boolean }
interface ProjectMember { id: number; display_name: string | null; full_name: string | null }
interface PriorityItem { id: number; name: string; kpi_base: number; color: string }
interface StatusItem { id: number; name: string }

// Visual language copied verbatim from the Tasks tab's own Task Detail
// drawer (project/detail/page.tsx, "Task Detail Drawer" section) — labels,
// input/select classes, grid grouping — so this doesn't read as a second,
// Calendar-only version of Task Detail. See the 2026-09 "Calendar UI Sync
// pass" chốt: reuse the same component/style language, not just the same
// API.
const labelCls = 'text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5';
const fieldCls = 'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors';
const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const QUARTER_MINUTES = ['00', '15', '30', '45'];

// Edit form for an EXISTING task — reused by every surface that needs to
// edit a task from outside the Tasks tab (currently: Calendar). Same
// fields, same PATCH endpoint (updateTask -> /task-groups/{gid}/tasks/{tid})
// the Tasks tab itself uses — no Calendar-only editing logic (2026-09
// "Click Task → cho phép chỉnh sửa luôn" chốt). Partial payload: only
// fields the user actually touched are sent, so untouched fields (KPI
// snapshot, block/review state, remark, send, ...) are never clobbered.
export default function TaskEditDrawer({
  task,
  onClose,
  onSaved,
}: {
  task: CalendarTask | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState('');
  const [assignedId, setAssignedId] = useState<number | ''>('');
  const [supportId, setSupportId] = useState<number | ''>('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [mandayEst, setMandayEst] = useState('');
  const [startDate, setStartDate] = useState('');
  // Work time — independent of Start Date here (unlike Quick Create, which
  // derives Start Date from it): this is an EDIT of a task that already has
  // its own Start Date, so both are freely, separately editable. This is
  // the one field Task Detail doesn't have at all (Calendar-only concept),
  // styled to match everything around it rather than left as its own thing.
  const [wtDate, setWtDate] = useState('');
  const [wtHour, setWtHour] = useState('');
  const [wtMinute, setWtMinute] = useState('');
  // No separate Category selector — Task Detail's own "Skill Area" field
  // searches across every active Group directly (flattened across active
  // Categories), it never asks for Category first. Matching that exactly,
  // not the 3-level Category→Group→Skill cascade Quick Create uses for
  // brand-new tasks.
  const [skillGroupId, setSkillGroupId] = useState<number | ''>(''); // -> skill_solution_id
  const [skillId, setSkillId] = useState<number | ''>(''); // -> skill_vendor_id
  const [link, setLink] = useState('');
  const [linkDraft, setLinkDraft] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Blocking workflow — separate boolean layer from status (same as Task
  // Detail: backend/app/routers/task_groups.py update_task never folds
  // is_blocked into status). Tracked as local state (not just read off the
  // `task` prop) so the block card updates immediately after block/unblock
  // without needing the parent to hand back a fresh task object.
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedReasonText, setBlockedReasonText] = useState<string | null>(null);
  const [blockedByName, setBlockedByName] = useState<string | null>(null);
  const [blockedAt, setBlockedAt] = useState<string | null>(null);
  const [blockedByTask, setBlockedByTask] = useState<{ task_code: string | null; detail: string } | null>(null);
  const [blockPromptOpen, setBlockPromptOpen] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [blockDependencyTaskId, setBlockDependencyTaskId] = useState('');
  const [blockActionBusy, setBlockActionBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const isOpen = !!task;
  const projectId = task?.project_id;

  // "Task phụ thuộc" dependency picker — same source Task Detail's own
  // block modal uses (every other task in the project), fetched lazily
  // only once the modal actually opens.
  const projectTasksQuery = useQuery({
    queryKey: ['ted-project-tasks', projectId],
    queryFn: () => getAllProjectTasks(projectId as number),
    enabled: blockPromptOpen && !!projectId,
  });
  const dependencyTaskOptions: { id: number; task_code: string | null; detail: string }[] =
    (projectTasksQuery.data || []).filter((t: any) => t.id !== task?.id);

  const membersQuery = useQuery({ queryKey: ['ted-members', projectId], queryFn: () => getProjectMembers(projectId as number), enabled: isOpen && !!projectId });
  const categoriesQuery = useQuery({ queryKey: ['ted-categories'], queryFn: getCategories, enabled: isOpen, staleTime: 5 * 60_000 });
  const prioritiesQuery = useQuery({ queryKey: ['ted-priorities'], queryFn: getPriorities, enabled: isOpen, staleTime: 60_000 });
  const statusesQuery = useQuery({ queryKey: ['ted-statuses'], queryFn: getStatuses, enabled: isOpen, staleTime: 60_000 });

  const members: ProjectMember[] = membersQuery.data || [];
  const categories: SkillCategory[] = categoriesQuery.data || [];
  const priorities: PriorityItem[] = prioritiesQuery.data || [];
  const statuses: StatusItem[] = statusesQuery.data || [];

  // Skill Area options: every active Group under every active Category,
  // flattened — exact same expression Task Detail uses.
  const skillAreaOptions = useMemo(
    () => categories.filter(c => c.is_active !== false).flatMap(c => c.groups || []),
    [categories]
  );
  // Skill options: skills of the chosen Group, or — if no Group is chosen
  // — every active skill across every group (Task Detail's own fallback,
  // not a "pick Skill Area first" hard gate).
  const skillOptions = useMemo(() => {
    if (skillGroupId) {
      const grp = skillAreaOptions.find(g => g.id === skillGroupId);
      return (grp?.skills || []).filter(s => s.is_active !== false);
    }
    return skillAreaOptions.flatMap(g => g.skills || []).filter(s => s.is_active !== false);
  }, [skillAreaOptions, skillGroupId]);
  const minuteOptions = wtHour === '23' ? ['00'] : QUARTER_MINUTES;

  // Prefill every field from the task each time a different one is opened.
  useEffect(() => {
    if (!task) return;
    setDetail(task.detail || '');
    setAssignedId(task.assigned_id || '');
    setSupportId(task.support_id || '');
    setPriority(task.priority || '');
    setStatus(task.status || '');
    setMandayEst(task.manday_est != null ? String(task.manday_est) : '');
    setStartDate(task.start_date ? task.start_date.slice(0, 10) : '');
    const scheduled = task.scheduled_at ? parseScheduledAt(task.scheduled_at) : null;
    if (scheduled) {
      setWtDate(toApiDate(scheduled));
      setWtHour(String(scheduled.getHours()).padStart(2, '0'));
      setWtMinute(String(scheduled.getMinutes()).padStart(2, '0'));
    } else {
      setWtDate(''); setWtHour(''); setWtMinute('');
    }
    setSkillGroupId(task.skill_solution_id || '');
    setSkillId(task.skill_vendor_id || '');
    setLink(task.ticket_id || '');
    setLinkDraft('');
    setNote(task.notes || '');
    setFormError(null);
    setIsBlocked(!!task.is_blocked);
    setBlockedReasonText(task.blocked_reason || null);
    setBlockedByName(task.blocked_by_name || null);
    setBlockedAt(task.blocked_at || null);
    setBlockedByTask(task.blocked_by_task || null);
    setBlockPromptOpen(false);
    setBlockReason('');
    setBlockDependencyTaskId('');
    setBlockError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  if (!isOpen || !task) return null;

  const mandayNum = mandayEst === '' ? null : Number(mandayEst);
  const mandayValid = mandayEst === '' || (!Number.isNaN(mandayNum) && (mandayNum as number) >= 0.25 && (mandayNum as number) <= 365);
  const canSubmit = !!detail.trim() && !!assignedId && !!supportId && !!priority && !!status && mandayValid;

  const handleSave = async () => {
    if (!canSubmit) {
      setFormError('Điền đủ các trường bắt buộc trước khi lưu.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const wtDay = wtDate ? parseApiDate(wtDate) : null;
      const workTimeDate = wtDay && wtHour !== '' && wtMinute !== ''
        ? combineDateAndTime(wtDay, Number(wtHour), Number(wtMinute))
        : null;
      const payload: Record<string, any> = {
        detail: detail.trim(),
        assigned_id: assignedId,
        support_id: supportId,
        priority,
        status,
        manday_est: mandayNum,
        start_date: startDate || null,
        scheduled_at: workTimeDate ? toApiDateTime(workTimeDate) : null,
        skill_solution_id: skillGroupId || null,
        skill_vendor_id: skillId || null,
        ticket_id: link.trim() || null,
        notes: note.trim() || null,
      };
      // KPI Ratio only changes when Support actually changes — never
      // silently overwritten otherwise (same rule the Tasks tab drawer
      // uses: 100/0 with no Support, 90/10 once one is assigned).
      const supportChanged = supportId !== (task.support_id || '');
      if (supportChanged) {
        if (!supportId) {
          payload.kpi_ratio_assign = 100;
          payload.kpi_ratio_support = 0;
        } else if (!task.support_id) {
          payload.kpi_ratio_assign = 90;
          payload.kpi_ratio_support = 10;
        }
      }
      await updateTask(task.task_group_id, task.id, payload);
      // Same fix as project/detail/page.tsx's Task Detail drawer — this
      // drawer can be opened from Calendar itself, so Calendar's own cache
      // needs telling too, not just whichever page happens to be open.
      queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] });
      onSaved?.();
      onClose();
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Không thể lưu task.'));
    } finally {
      setSaving(false);
    }
  };

  // Same handler shape as Task Detail's handleConfirmBlockTask — same
  // validation (reason ≥5 ký tự), same API call, same "bởi {ai} · {khi}"
  // fields updated from the response. Doesn't touch `status` the way Task
  // Detail's Status-dropdown entry point does — this button is a direct
  // action, not routed through the Status select.
  const handleConfirmBlock = async () => {
    const reason = blockReason.trim();
    if (reason.length < 5) {
      setBlockError('Vui lòng nhập lý do bị chặn (tối thiểu 5 ký tự).');
      return;
    }
    if (blockActionBusy) return;
    setBlockActionBusy(true);
    setBlockError(null);
    try {
      const depId = blockDependencyTaskId ? Number(blockDependencyTaskId) : undefined;
      const updated = await blockTask(task.task_group_id, task.id, reason, depId);
      setIsBlocked(true);
      setBlockedReasonText(updated.blocked_reason ?? reason);
      setBlockedByName(updated.blocked_by_name ?? null);
      setBlockedAt(updated.blocked_at ?? null);
      setBlockedByTask(updated.blocked_by_task ?? null);
      setBlockPromptOpen(false);
      setBlockReason('');
      setBlockDependencyTaskId('');
      queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] });
      onSaved?.();
    } catch (err) {
      setBlockError(getApiErrorMessage(err, 'Lỗi khi đánh dấu bị chặn.'));
    } finally {
      setBlockActionBusy(false);
    }
  };

  const handleUnblock = async () => {
    if (blockActionBusy) return;
    setBlockActionBusy(true);
    try {
      await unblockTask(task.task_group_id, task.id);
      setIsBlocked(false);
      setBlockedReasonText(null);
      setBlockedByName(null);
      setBlockedAt(null);
      setBlockedByTask(null);
      queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] });
      onSaved?.();
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Lỗi khi gỡ chặn.'));
    } finally {
      setBlockActionBusy(false);
    }
  };

  return (
    <Portal>
      {/* No dimming/blur backdrop — matches Task Detail's own click-outside
          catcher (project/detail/page.tsx: "bg-slate-900/40 backdrop-blur-sm
          removed ... so the page stays fully visible/legible behind the
          drawer"). */}
      <div className="fixed inset-0 z-50 flex justify-end">
        <div onClick={onClose} className="absolute inset-0" />
        <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-200" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-[#f8faff] to-white shrink-0">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[#e8f0fe] text-[#0058be]">
                <span className="material-symbols-outlined text-[18px]">task_alt</span>
              </span>
              <div>
                <h3 className="text-sm font-bold text-[#0b1c30]">Chi tiết Task</h3>
                <span className="font-mono text-[13px] text-[#0058be] font-bold tracking-wide">{task.task_code || ''}</span>
                {task.project_name && <span className="text-[11px] text-slate-400 ml-1.5">· {task.project_name}</span>}
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* KPI Snapshot — read-only, same 4-tile layout/labels as Task
                Detail (Base/Perform/OT/Final, Final tile highlighted blue).
                No Phase tile: the real Task Edit Drawer doesn't show Phase
                either (that pill only exists in the separate, read-only
                Leader Review Detail Drawer) — not adding something Task
                Detail itself doesn't have. */}
            <div>
              <label className={labelCls}>KPI Snapshot</label>
              <div className="grid grid-cols-4 gap-3 mt-2">
                <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-center border border-slate-100">
                  <div className="text-[9px] text-slate-500 font-semibold uppercase">Base</div>
                  <div className="text-[13px] font-bold text-[#0b1c30] mt-0.5">{task.kpi_base ?? '—'}</div>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-center border border-slate-100">
                  <div className="text-[9px] text-slate-500 font-semibold uppercase">Perform</div>
                  <div className="text-[13px] font-bold text-[#0b1c30] mt-0.5">{task.kpi_perform ?? '—'}</div>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-center border border-slate-100">
                  <div className="text-[9px] text-slate-500 font-semibold uppercase">OT</div>
                  <div className="text-[13px] font-bold text-[#0b1c30] mt-0.5">{task.kpi_ot ?? '—'}</div>
                </div>
                <div className="bg-[#e8f0fe] rounded-lg px-3 py-2.5 text-center border border-[#c2d6f0]">
                  <div className="text-[9px] text-[#0058be] font-semibold uppercase">Final</div>
                  <div className="text-[13px] font-bold text-[#0058be] mt-0.5">{task.kpi_final ?? '—'}</div>
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Detail Task</label>
              <textarea className={`${fieldCls} resize-none`} rows={3} value={detail} onChange={e => setDetail(e.target.value)} maxLength={500} />
            </div>

            {/* Status / Priority / Manday Est / Start Date / Assigned /
                Support — one unified grid, same grouping as Task Detail's
                own "Status & Priority" + "Manday Est & Start Date" +
                "Assigned & Support" block. */}
            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              <div>
                <label className={labelCls}>Status</label>
                <select className={fieldCls} value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="">— Chọn —</option>
                  {statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Priority</label>
                <select className={fieldCls} value={priority} onChange={e => setPriority(e.target.value)}>
                  <option value="">— Chọn —</option>
                  {priorities.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Manday Est</label>
                <input className={fieldCls} type="number" step="0.25" min="0.25" max="365" value={mandayEst} onChange={e => setMandayEst(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Start Date</label>
                <input className={fieldCls} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Assigned</label>
                <SearchableSelect
                  label="thành viên"
                  icon=""
                  options={members.map(m => ({ id: String(m.id), name: m.display_name || m.full_name || '' }))}
                  value={assignedId || ''}
                  onChange={(val: any) => setAssignedId(val === 'all' || !val ? '' : Number(val))}
                  placeholder="Tìm thành viên..."
                  className="w-full"
                />
              </div>
              <div>
                <label className={labelCls}>Support</label>
                <SearchableSelect
                  label="thành viên"
                  icon=""
                  options={members.map(m => ({ id: String(m.id), name: m.display_name || m.full_name || '' }))}
                  value={supportId || ''}
                  onChange={(val: any) => setSupportId(val === 'all' || !val ? '' : Number(val))}
                  placeholder="Tìm thành viên..."
                  className="w-full"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Skill Area</label>
              <SearchableSelect
                label="Skill Area"
                icon=""
                options={skillAreaOptions.map(g => ({ id: g.id, name: g.name }))}
                value={skillGroupId || ''}
                onChange={(val: any) => {
                  const grpId = val === 'all' || !val ? '' : Number(val);
                  setSkillGroupId(grpId);
                  setSkillId('');
                }}
                placeholder="Tìm Skill Area..."
                className="w-full"
              />
            </div>
            <div>
              <label className={labelCls}>Skill</label>
              <SearchableSelect
                label="Skill"
                icon=""
                options={skillOptions.map(s => ({ id: s.id, name: s.name }))}
                value={skillId || ''}
                onChange={(val: any) => setSkillId(val === 'all' || !val ? '' : Number(val))}
                placeholder="Tìm Skill..."
                className="w-full"
              />
            </div>

            {/* Work time — Calendar's one genuinely new field (Task Detail
                has no equivalent), same input language as everything above
                it rather than a visually distinct block. */}
            <div>
              <label className={labelCls}>Work time</label>
              <input className={fieldCls} type="date" value={wtDate} onChange={e => setWtDate(e.target.value)} />
              <div className="flex items-center gap-1.5 mt-1.5">
                <select
                  className={`${fieldCls} flex-1`}
                  value={wtHour}
                  onChange={e => {
                    const h = e.target.value;
                    setWtHour(h);
                    if (h === '23' && wtMinute !== '' && wtMinute !== '00') setWtMinute('00');
                  }}
                >
                  <option value="">Giờ --</option>
                  {HOURS_24.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <span className="text-slate-400 font-bold shrink-0">:</span>
                <select className={`${fieldCls} flex-1`} value={wtMinute} onChange={e => setWtMinute(e.target.value)}>
                  <option value="">Phút --</option>
                  {minuteOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {(wtDate || wtHour !== '' || wtMinute !== '') && (
                <button type="button" onClick={() => { setWtDate(''); setWtHour(''); setWtMinute(''); }} className="text-[10.5px] font-semibold text-slate-400 hover:text-rose-500 mt-1">
                  ✕ Xoá giờ
                </button>
              )}
              <p className="text-[10.5px] text-slate-400 mt-1">
                {wtDate && wtHour !== '' && wtMinute !== ''
                  ? 'Định dạng 24 giờ, không dùng SA/CH.'
                  : 'Để trống — task hiện ở hàng Date-only (chỉ có ngày, chưa có giờ).'}
              </p>
            </div>

            <div>
              <label className={labelCls}>Link</label>
              <LinkChipsEditor
                value={link}
                onChange={setLink}
                inputValue={linkDraft}
                onInputChange={setLinkDraft}
                onInputKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setLink(prev => appendLinkValue(prev, linkDraft));
                    setLinkDraft('');
                  }
                }}
                onInputBlur={() => {
                  if (linkDraft.trim()) {
                    setLink(prev => appendLinkValue(prev, linkDraft));
                    setLinkDraft('');
                  }
                }}
              />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <textarea className={`${fieldCls} resize-none`} rows={2} value={note} onChange={e => setNote(e.target.value)} />
            </div>

            {/* Đánh dấu bị chặn — same is_blocked layer, same blockTask/
                unblockTask API, same card/button copy as Task Detail's own
                block UI (not a Calendar-invented status or wording). */}
            {isBlocked ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[12.5px]">
                <div className="font-bold text-amber-800 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5"><Ban size={14} /> Task đang bị chặn</span>
                  <button
                    onClick={handleUnblock}
                    disabled={blockActionBusy}
                    className="h-7 px-2.5 rounded-md text-[11.5px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-60"
                  >
                    {blockActionBusy ? 'Đang gỡ...' : 'Gỡ chặn'}
                  </button>
                </div>
                {blockedReasonText && <div className="mt-1.5 text-amber-800">{blockedReasonText}</div>}
                {blockedByTask && (
                  <div className="mt-1 text-amber-700">Đang chờ: <span className="font-semibold">{blockedByTask.task_code}</span> - {blockedByTask.detail}</div>
                )}
                <div className="mt-1 text-amber-600 text-[11px]">
                  bởi {blockedByName || 'Một thành viên'}{blockedAt ? ` · ${formatTimeAgo(blockedAt)}` : ''}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setBlockReason(''); setBlockDependencyTaskId(''); setBlockError(null); setBlockPromptOpen(true); }}
                className="h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-colors flex items-center gap-1.5 w-fit"
              >
                <Ban size={14} /> Đánh dấu bị chặn
              </button>
            )}

            {formError && (
              <p className="text-[11.5px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{formError}</p>
            )}
          </div>

          {/* Single full-width Save — Task Detail's own footer has no
              separate Cancel button either (closing is the header's X or a
              backdrop click, same as here). */}
          <div className="px-6 py-4 border-t border-slate-200 bg-white shrink-0">
            <button
              onClick={handleSave}
              disabled={!canSubmit || saving}
              className="w-full px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#004a9e] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </div>
      </div>

      {/* Block-reason prompt — same fields/copy/validation as Task Detail's
          own blockPrompt modal (reason textarea ≥5 chars, optional
          dependency-task picker), just a local piece of JSX here since that
          modal is inline in project/detail/page.tsx, not an exported
          component. Backdrop blur kept here (unlike the drawer itself) —
          Task Detail's own confirm-style modals (block, delete) do use
          bg-slate-900/40 backdrop-blur-sm; only the drawer's own outer
          backdrop was asked to lose the dimming. */}
      {blockPromptOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3 text-amber-600">
                <Ban size={22} />
                <h3 className="text-base font-bold text-[#0b1c30]">Đánh dấu bị chặn</h3>
              </div>
              <p className="text-xs text-slate-500 truncate">{task.task_code} - {task.detail}</p>
              <div>
                <label className={labelCls}>Lý do bị chặn *</label>
                <textarea
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  placeholder="Nhập lý do task bị chặn (bắt buộc)..."
                  rows={3}
                  autoFocus
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-amber-400 transition-colors resize-none"
                />
                {blockReason.trim().length > 0 && blockReason.trim().length < 5 && (
                  <p className="text-[11px] text-rose-600 mt-1">Cần tối thiểu 5 ký tự ({blockReason.trim().length}/5).</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Task phụ thuộc (không bắt buộc)</label>
                <select
                  value={blockDependencyTaskId}
                  onChange={e => setBlockDependencyTaskId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-amber-400"
                >
                  <option value="">-- Không có --</option>
                  {dependencyTaskOptions.map(t => (
                    <option key={t.id} value={t.id}>{t.task_code} - {(t.detail || '').slice(0, 60)}</option>
                  ))}
                </select>
              </div>
              {blockError && <p className="text-[11px] text-rose-600">{blockError}</p>}
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <button
                onClick={() => { setBlockPromptOpen(false); setBlockReason(''); setBlockDependencyTaskId(''); setBlockError(null); }}
                disabled={blockActionBusy}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-60"
              >
                Huỷ
              </button>
              <button
                onClick={handleConfirmBlock}
                disabled={blockActionBusy}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-colors shadow-sm disabled:opacity-60"
              >
                {blockActionBusy ? 'Đang lưu...' : 'Đánh dấu bị chặn'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Portal>
  );
}
