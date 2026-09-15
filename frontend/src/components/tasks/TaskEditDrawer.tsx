'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Portal from '@/components/Portal';
import { CalendarTask, getProjectMembers, getCategories, getPriorities, getStatuses, updateTask, getApiErrorMessage } from '@/lib/api';
import { LinkChipsEditor, appendLinkValue } from '@/components/LinkChipsEditor';
import { toApiDate, parseApiDate, parseScheduledAt, combineDateAndTime, toApiDateTime } from '@/components/calendar/dateUtils';

interface SkillItem { id: number; name: string; group_id: number }
interface SkillGroup { id: number; name: string; category_id: number; skills: SkillItem[] }
interface SkillCategory { id: number; name: string; groups: SkillGroup[] }
interface ProjectMember { id: number; display_name: string | null; full_name: string | null }
interface PriorityItem { id: number; name: string; kpi_base: number; color: string }
interface StatusItem { id: number; name: string }

const labelCls = 'text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1';
const selectCls = 'w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] text-[#0b1c30] focus:border-[#0058be] outline-none disabled:bg-slate-50 disabled:text-slate-400';
const inputCls = selectCls;
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
  // its own Start Date, so both are freely, separately editable.
  const [wtDate, setWtDate] = useState('');
  const [wtHour, setWtHour] = useState('');
  const [wtMinute, setWtMinute] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [skillGroupId, setSkillGroupId] = useState<number | ''>(''); // -> skill_solution_id
  const [skillId, setSkillId] = useState<number | ''>(''); // -> skill_vendor_id
  const [link, setLink] = useState('');
  const [linkDraft, setLinkDraft] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isOpen = !!task;
  const projectId = task?.project_id;

  const membersQuery = useQuery({ queryKey: ['ted-members', projectId], queryFn: () => getProjectMembers(projectId as number), enabled: isOpen && !!projectId });
  const categoriesQuery = useQuery({ queryKey: ['ted-categories'], queryFn: getCategories, enabled: isOpen, staleTime: 5 * 60_000 });
  const prioritiesQuery = useQuery({ queryKey: ['ted-priorities'], queryFn: getPriorities, enabled: isOpen, staleTime: 60_000 });
  const statusesQuery = useQuery({ queryKey: ['ted-statuses'], queryFn: getStatuses, enabled: isOpen, staleTime: 60_000 });

  const members: ProjectMember[] = membersQuery.data || [];
  const categories: SkillCategory[] = categoriesQuery.data || [];
  const priorities: PriorityItem[] = prioritiesQuery.data || [];
  const statuses: StatusItem[] = statusesQuery.data || [];

  const skillGroups = useMemo(
    () => (categoryId ? categories.find(c => c.id === categoryId)?.groups || [] : []),
    [categories, categoryId]
  );
  const skills = useMemo(
    () => (skillGroupId ? skillGroups.find(g => g.id === skillGroupId)?.skills || [] : []),
    [skillGroups, skillGroupId]
  );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  // skill_solution_id alone doesn't say which Category it's under — once
  // the categories tree loads, find it so the cascading Category select is
  // correctly pre-selected too (Skill Area's own select just shows Groups
  // directly, but Category gates which Groups are offered).
  useEffect(() => {
    if (!task?.skill_solution_id || categoryId || !categories.length) return;
    const owner = categories.find(c => c.groups.some(g => g.id === task.skill_solution_id));
    if (owner) setCategoryId(owner.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.skill_solution_id, categories]);

  if (!isOpen || !task) return null;

  const mandayNum = mandayEst === '' ? null : Number(mandayEst);
  const mandayValid = mandayEst === '' || (!Number.isNaN(mandayNum) && (mandayNum as number) >= 0.25 && (mandayNum as number) <= 365);
  const canSubmit = !!detail.trim() && !!assignedId && !!supportId && !!priority && !!status && mandayValid;

  const handleSave = async () => {
    if (!canSubmit) {
      setFormError('Điền đủ các trường bắt buộc (*) trước khi lưu.');
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

  return (
    <Portal>
      <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-stretch justify-end" onClick={onClose}>
        <div className="w-full max-w-md bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200" onClick={e => e.stopPropagation()}>
          <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-sm font-extrabold text-[#0b1c30] uppercase tracking-wider">📋 Chi tiết Task</h3>
              {task.task_code && <p className="text-[10.5px] font-bold text-slate-400 mt-0.5">{task.task_code} · {task.project_name}</p>}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-200/60 rounded-lg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <div>
              <label className={labelCls}>Tên task <span className="text-amber-500">*</span></label>
              <input className={inputCls} value={detail} onChange={e => setDetail(e.target.value)} maxLength={500} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Assigned <span className="text-amber-500">*</span></label>
                <select className={selectCls} value={assignedId} onChange={e => setAssignedId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">— Chọn —</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Support <span className="text-amber-500">*</span></label>
                <select className={selectCls} value={supportId} onChange={e => setSupportId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">— Chọn —</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.full_name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Priority <span className="text-amber-500">*</span></label>
                <select className={selectCls} value={priority} onChange={e => setPriority(e.target.value)}>
                  <option value="">— Chọn —</option>
                  {priorities.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Status <span className="text-amber-500">*</span></label>
                <select className={selectCls} value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="">— Chọn —</option>
                  {statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Manday EST</label>
              <input className={inputCls} type="number" min={0.25} max={365} step={0.25} value={mandayEst} onChange={e => setMandayEst(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Skill Area</label>
                <select className={selectCls} value={categoryId} onChange={e => { setCategoryId(e.target.value ? Number(e.target.value) : ''); setSkillGroupId(''); setSkillId(''); }}>
                  <option value="">— Nhóm kỹ năng —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className={`${selectCls} mt-1.5`} value={skillGroupId} disabled={!categoryId} onChange={e => { setSkillGroupId(e.target.value ? Number(e.target.value) : ''); setSkillId(''); }}>
                  <option value="">{categoryId ? '— Chọn Group —' : '—'}</option>
                  {skillGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Skill</label>
                <select className={`${selectCls} mt-[26px]`} value={skillId} disabled={!skillGroupId} onChange={e => setSkillId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">{skillGroupId ? '— Chọn Skill —' : 'Chọn Skill Area trước'}</option>
                  {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Start Date</label>
              <input className={inputCls} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Work time</label>
              <input className={inputCls} type="date" value={wtDate} onChange={e => setWtDate(e.target.value)} />
              <div className="flex items-center gap-1.5 mt-1.5">
                <select
                  className={`${selectCls} flex-1`}
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
                <select className={`${selectCls} flex-1`} value={wtMinute} onChange={e => setWtMinute(e.target.value)}>
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
              <label className={labelCls}>Note</label>
              <textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Nhập ghi chú cho Task..." />
            </div>

            {formError && (
              <p className="text-[11.5px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{formError}</p>
            )}
          </div>

          <div className="px-5 py-3.5 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
            <button onClick={onClose} className="text-[12.5px] font-semibold text-[#0b1c30] border border-slate-200 px-3.5 py-2 rounded-lg hover:bg-slate-50">
              Huỷ
            </button>
            <button
              onClick={handleSave}
              disabled={!canSubmit || saving}
              className="text-[12.5px] font-bold text-white bg-[#0058be] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
