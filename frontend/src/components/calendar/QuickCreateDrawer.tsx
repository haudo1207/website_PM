'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import Portal from '@/components/Portal';
import {
  getProjects, getPhases, getTaskGroups, getProjectMembers, getCategories, getMe, createTask, getApiErrorMessage,
  getCalendarProjectColors, setCalendarProjectColor, getPriorities, getStatuses, createPhase, createTaskGroup, getPerformanceSettings,
} from '@/lib/api';
import { LinkChipsEditor, appendLinkValue } from '@/components/LinkChipsEditor';
import SearchableSelect from '@/components/common/SearchableSelect';
import { toApiDate, toApiDateTime, parseApiDate, combineDateAndTime } from './dateUtils';
import { PROJECT_COLOR_PRESETS, DEFAULT_PROJECT_COLOR, isValidHexColor } from './colorPalette';

interface SkillItem { id: number; name: string; group_id: number }
interface SkillGroup { id: number; name: string; category_id: number; skills: SkillItem[] }
interface SkillCategory { id: number; name: string; groups: SkillGroup[] }
interface ProjectMember { id: number; display_name: string | null; full_name: string | null; avatar_url?: string | null }
interface PriorityItem { id: number; name: string; kpi_base: number; color: string }
interface StatusItem { id: number; name: string }
interface PhaseItem { id: number; name: string }
interface TaskGroupItem { id: number; name: string }

export interface QuickCreatePrefill {
  day: Date;
  hours: number;
  minutes: number;
}

// Note → Link auto-fill: every URL found in Note gets added as its own
// chip, except ones already present in Link — never duplicates, never
// overwrites/removes a link the user added themselves (manually or from an
// earlier Note edit). Link is still its own real field (Task.ticket_id) on
// submit, just kept in sync with whatever URLs Note currently contains.
const URL_PATTERN = /https?:\/\/\S+/g;
function extractUrls(text: string): string[] {
  return text.match(URL_PATTERN) || [];
}

// Same label/field classes as Tasks tab's Task Detail drawer and
// components/tasks/TaskEditDrawer — Calendar UI Sync pass (2026-09):
// every Task-editing surface should look like one system, not a Calendar-
// specific one-off (project/detail/page.tsx "Task Detail Drawer" section).
const labelCls = 'text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5';
const selectCls = 'w-full h-10 bg-white border border-slate-200 rounded-lg px-3 py-0 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] focus:ring-2 focus:ring-[#0058be]/10 transition-colors disabled:bg-slate-50 disabled:text-slate-400';
const inputCls = selectCls;

// Exact same production presentation as project/detail/page.tsx's
// getStatusInfo/getPriorityStyle (Tasks Table + Task Detail Drawer, after
// the 2026-09 revert away from Settings-driven dbPriorities colors) — kept
// in sync by hand since no shared export exists yet. Quick Create must
// render the identical badge, not a third color mapping.
const getStatusInfo = (status: string) => {
  const s = (status || '').trim().toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'hoàn tất') return { label: 'Done', dot: 'bg-emerald-500', bg: 'bg-[#dcfce7] text-[#15803d]' };
  if (s === 'process' || s === 'doing' || s === 'in progress' || s === 'đang xử lý') return { label: 'Process', dot: 'bg-amber-500', bg: 'bg-[#fef9c3] text-[#854d0e]' };
  if (s === 'review') return { label: 'Review', dot: 'bg-blue-500', bg: 'bg-[#dbeafe] text-[#1d4ed8]' };
  if (s.includes('block')) return { label: status || 'Blocked', dot: 'bg-rose-500', bg: 'bg-rose-50 text-rose-700' };
  if (s === 'pending') return { label: 'Pending', dot: 'bg-slate-400', bg: 'bg-slate-100 text-slate-700' };
  return { label: status || 'Todo', dot: 'bg-slate-500', bg: 'bg-slate-100 text-slate-700' };
};

const getPriorityStyle = (priority: string) => {
  const p = (priority || '').trim().toLowerCase();
  if (p === 'interrupt') return 'bg-purple-50 text-purple-700 border-purple-200';
  if (p === 'critical' || p === 'urgent') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (p === 'high') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (p === 'normal' || p === 'medium') return 'bg-[#eff4ff] text-[#0058be] border-[#0058be]/20';
  return 'bg-[#eff4ff] text-[#0058be] border-[#0058be]/20';
};

// Exported so any Task-editing surface (currently: components/tasks/
// TaskEditDrawer, the Calendar-triggered edit for an EXISTING task) can
// reuse the exact same colored Status/Priority badge instead of a fourth
// copy — variant picks the badge presentation, valueKey picks whether the
// <select>'s value is the option's id or name (Quick Create's own Priority
// field is id-keyed; TaskEditDrawer's is name-keyed like Task Detail's),
// independently of which badge is shown.
export function SemanticSelect({ value, onChange, options, variant = 'status', valueKey, placeholder = '— Chọn —' }: { value: string; onChange: (value: string) => void; options: Array<{ id: number; name: string; color?: string }>; variant?: 'status' | 'priority'; valueKey?: 'id' | 'name'; placeholder?: string }) {
  const key = valueKey ?? (variant === 'priority' ? 'id' : 'name');
  const current = key === 'id' ? options.find(option => String(option.id) === value) : options.find(option => option.name === value);
  const label = current?.name || value;
  return (
    <div className="relative h-10">
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full h-10 appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-9 text-transparent outline-none transition-colors hover:border-slate-300 focus:border-[#0058be] focus:ring-2 focus:ring-[#0058be]/10">
        <option value="" className="text-[#0b1c30]">{placeholder}</option>
        {options.map(option => (
          <option key={option.id} value={key === 'id' ? String(option.id) : option.name} className="text-[#0b1c30]">{option.name}</option>
        ))}
      </select>
      {value && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center max-w-[calc(100%-40px)]">
          {variant === 'priority' ? (
            <span className={`inline-block truncate px-2 py-0.5 rounded-md border text-[11px] font-bold tracking-wide uppercase ${getPriorityStyle(label)}`}>
              {label}
            </span>
          ) : (
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border truncate ${getStatusInfo(label).bg} border-current/10 shadow-sm`}>
              <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${getStatusInfo(label).dot}`} />
              <span className="truncate">{getStatusInfo(label).label}</span>
            </span>
          )}
        </span>
      )}
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center justify-center text-[11px] text-slate-400">▾</span>
    </div>
  );
}

// Plain "00".."23" hour list + a fixed 00/15/30/45 minute list —
// deliberately NOT <input type="time">/"datetime-local">, whose displayed
// format follows the browser/OS locale and can render 12h with SA/CH
// (AM/PM) on some machines. The whole app is VN-only, 24h — these two
// <select>s guarantee that regardless of locale, since they're just
// numbers, not a native time widget.
//
// Quick Create's own hard cap is 23:00 (matching the Calendar grid's last
// visible mark) — when hour is "23", the minute list is narrowed to ["00"]
// only (see minuteOptions below), since 23:15/23:30/23:45 fall outside the
// calendar entirely. See the 2026-09 "chốt 3 vấn đề về thời gian".
const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const QUARTER_MINUTES = ['00', '15', '30', '45'];

// Per-Member Calendar color for one Project (calendar_project_preferences —
// NOT Project.color, which doesn't exist; two members can pick different
// colors for the same project). Saves instantly on pick, independent of
// task creation — see "Màu Project trong Personal Calendar" §3/§10.
export function ProjectColorPicker({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [customHex, setCustomHex] = useState('');

  const colorsQuery = useQuery({
    queryKey: ['calendar-project-colors'],
    queryFn: getCalendarProjectColors,
    staleTime: 30_000,
  });
  const currentColor = (colorsQuery.data?.[projectId] || DEFAULT_PROJECT_COLOR).toLowerCase();

  const saveMutation = useMutation({
    mutationFn: (color: string) => setCalendarProjectColor(projectId, color),
    onSuccess: (_data, color) => {
      // Optimistic cache update so the swatch (and any already-open Calendar
      // tab) reflects the new color immediately, not just after a refetch.
      queryClient.setQueryData<Record<number, string>>(['calendar-project-colors'], prev => ({ ...(prev || {}), [projectId]: color }));
      queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] });
      setOpen(false);
    },
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setCustomHex(currentColor); setOpen(o => !o); }}
        disabled={saveMutation.isPending}
        title={`Màu Project: ${currentColor.toUpperCase()}`}
        className={`flex h-10 w-full items-center justify-center gap-1.5 border border-slate-200 rounded-lg px-2 bg-white hover:bg-slate-50 transition-colors ${saveMutation.isPending ? 'opacity-60' : ''}`}
      >
        <span className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0" style={{ background: currentColor }} />
        <span className="text-[11px] text-[#0b1c30] font-mono truncate">{currentColor.toUpperCase()}</span>
      </button>

      {open && (
        <div className="absolute z-10 right-0 mt-1.5 w-64 p-3 border border-slate-200 rounded-lg bg-white shadow-lg">
          <div className="grid grid-cols-8 gap-1.5">
            {PROJECT_COLOR_PRESETS.map(hex => (
              <button
                key={hex}
                type="button"
                onClick={() => saveMutation.mutate(hex)}
                className={`w-6 h-6 rounded-full border-2 ${currentColor === hex ? 'border-[#0058be]' : 'border-transparent'}`}
                style={{ background: hex }}
                aria-label={hex}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
            <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider shrink-0">Custom</span>
            <input
              type="color"
              value={isValidHexColor(customHex) ? customHex : DEFAULT_PROJECT_COLOR}
              onChange={e => setCustomHex(e.target.value)}
              className="w-8 h-8 border border-slate-200 rounded cursor-pointer shrink-0"
            />
            <input
              className={`${inputCls} flex-1`}
              value={customHex}
              onChange={e => setCustomHex(e.target.value)}
              placeholder="#EF4444"
              maxLength={7}
            />
            <button
              type="button"
              disabled={!isValidHexColor(customHex)}
              onClick={() => saveMutation.mutate(customHex)}
              className="text-[11.5px] font-bold text-white bg-[#0058be] px-3 py-1.5 rounded-lg disabled:opacity-40 shrink-0"
            >
              Áp dụng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Small anchored popover shared by the two inline "+ Tạo ..." buttons below
// — Phase and Task Group creation reuse the exact same Project/Phase APIs
// the Tasks tab already uses (POST /projects/{pid}/phases,
// POST /phases/{phid}/task-groups); Quick Create is just a faster way to
// call them without leaving the Calendar (§12/§13).
function InlineCreatePopover({
  triggerLabel,
  fields,
  onClose,
  onSubmit,
}: {
  triggerLabel: string;
  fields: React.ReactNode;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="absolute z-10 right-0 mt-1.5 w-64 p-3 border border-slate-200 rounded-lg bg-white shadow-lg">
      <p className="text-[10.5px] font-extrabold text-[#0058be] uppercase tracking-wider mb-2">{triggerLabel}</p>
      {fields}
      <div className="flex justify-end gap-2 mt-2.5">
        <button type="button" onClick={onClose} className="text-[11px] font-semibold text-slate-500 px-2.5 py-1.5 rounded-lg hover:bg-slate-50">
          Hủy
        </button>
        <button
          type="button"
          onClick={onSubmit}
          className="text-[11px] font-bold text-white bg-[#0058be] px-3 py-1.5 rounded-lg disabled:opacity-40"
        >
          Tạo
        </button>
      </div>
    </div>
  );
}

// "+ Tạo Phase" — only a name is required (createPhase's other fields are
// all optional server-side). Newly created Phase is auto-selected by the
// parent via onCreated.
function InlineCreatePhase({ projectId, onCreated }: { projectId: number; onCreated: (phase: PhaseItem) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) { setError('Nhập tên Phase.'); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await createPhase(projectId, { name: name.trim() });
      onCreated({ id: created.id, name: created.name });
      setOpen(false);
      setName('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không thể tạo Phase.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Tạo Phase"
        aria-label="Tạo Phase"
        className="w-10 h-10 flex items-center justify-center text-[16px] font-bold text-[#0058be] border border-[#0058be]/30 rounded-lg hover:bg-[#eaf2fc] transition-colors"
      >
        +
      </button>
      {open && (
        <InlineCreatePopover
          triggerLabel="Tạo Phase mới"
          onClose={() => { setOpen(false); setError(null); }}
          onSubmit={submit}
          fields={
            <>
              <label className={labelCls}>Tên Phase</label>
              <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: 1. Triển khai" autoFocus disabled={saving} />
              {error && <p className="text-[10.5px] text-rose-600 mt-1">{error}</p>}
            </>
          }
        />
      )}
    </div>
  );
}

// "+ Tạo Group" — name + Manday EST, same integer-1..10 rule the backend's
// validate_group_manday() already enforces on TaskGroup.manday_est (this is
// TaskGroup's own rule, distinct from Task's own Manday EST field below).
function InlineCreateTaskGroup({ phaseId, onCreated }: { phaseId: number; onCreated: (group: TaskGroupItem) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [manday, setManday] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) { setError('Nhập tên Task Group.'); return; }
    const mandayNum = Number(manday);
    if (manday === '' || !Number.isInteger(mandayNum) || mandayNum < 1 || mandayNum > 10) {
      setError('Manday EST phải là số nguyên từ 1 đến 10.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createTaskGroup(phaseId, { name: name.trim(), manday_est: mandayNum });
      onCreated({ id: created.id, name: created.name });
      setOpen(false);
      setName('');
      setManday('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không thể tạo Task Group.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Tạo Task Group"
        aria-label="Tạo Task Group"
        className="w-10 h-10 flex items-center justify-center text-[16px] font-bold text-[#0058be] border border-[#0058be]/30 rounded-lg hover:bg-[#eaf2fc] transition-colors"
      >
        +
      </button>
      {open && (
        <InlineCreatePopover
          triggerLabel="Tạo Task Group mới"
          onClose={() => { setOpen(false); setError(null); }}
          onSubmit={submit}
          fields={
            <>
              <label className={labelCls}>Tên Task Group</label>
              <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Development" autoFocus disabled={saving} />
              <label className={`${labelCls} mt-2`}>Manday EST <span className="text-amber-500">*</span></label>
              <input
                className={inputCls} type="number" min={1} max={10} step={1}
                value={manday} onChange={e => setManday(e.target.value)} placeholder="1 - 10" disabled={saving}
              />
              {error && <p className="text-[10.5px] text-rose-600 mt-1">{error}</p>}
            </>
          }
        />
      )}
    </div>
  );
}

export default function QuickCreateDrawer({
  isOpen,
  prefill,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  prefill: QuickCreatePrefill | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<number | ''>('');
  const [phaseId, setPhaseId] = useState<number | ''>('');
  const [taskGroupId, setTaskGroupId] = useState<number | ''>('');
  const [detail, setDetail] = useState('');
  const [assignedId, setAssignedId] = useState<number | ''>('');
  const [supportId, setSupportId] = useState<number | ''>('');
  const [priorityId, setPriorityId] = useState('');
  const [status, setStatus] = useState('');
  const [mandayEst, setMandayEst] = useState('');
  const [kpiRatio, setKpiRatio] = useState('90/10');
  // Work time, split into 3 parts. Minute is restricted to 00/15/30/45 (not
  // free-entry) and hour is capped at 23:00 — matches the Calendar grid's
  // own 06:00–23:00 range and 30-minute drag snap being a coarser cousin of
  // this 15-minute one. All three must be set for the task to count as
  // scheduled; any one missing = unscheduled.
  const [wtDate, setWtDate] = useState(''); // <input type="date"> value, "YYYY-MM-DD"
  const [wtHour, setWtHour] = useState(''); // "00".."23"
  const [wtMinute, setWtMinute] = useState(''); // "00"/"15"/"30"/"45" — "00" only when wtHour is "23"
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [skillGroupId, setSkillGroupId] = useState<number | ''>(''); // -> skill_solution_id
  const [skillId, setSkillId] = useState<number | ''>(''); // -> skill_vendor_id
  const [link, setLink] = useState(''); // newline-joined, same shape as Task.ticket_id
  const [linkDraft, setLinkDraft] = useState(''); // "paste link and press Enter" input
  const [note, setNote] = useState('');
  const [remark, setRemark] = useState('');
  const [send, setSend] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const detailRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const meQuery = useQuery({ queryKey: ['qc-me'], queryFn: getMe, enabled: isOpen, staleTime: 5 * 60_000 });
  const projectsQuery = useQuery({ queryKey: ['qc-projects'], queryFn: () => getProjects(), enabled: isOpen, staleTime: 60_000 });
  const phasesQuery = useQuery({ queryKey: ['qc-phases', projectId], queryFn: () => getPhases(projectId as number), enabled: isOpen && !!projectId });
  const taskGroupsQuery = useQuery({ queryKey: ['qc-groups', phaseId], queryFn: () => getTaskGroups(phaseId as number), enabled: isOpen && !!phaseId });
  const membersQuery = useQuery({ queryKey: ['qc-members', projectId], queryFn: () => getProjectMembers(projectId as number), enabled: isOpen && !!projectId });
  const categoriesQuery = useQuery({ queryKey: ['qc-categories'], queryFn: getCategories, enabled: isOpen, staleTime: 5 * 60_000 });
  // Priority/Status are system-wide config (Settings → Priority/Status
  // Configuration), never hard-coded here — Quick Create must always reflect
  // whatever an Admin has currently configured (§5/§6).
  // Fetch current Settings data on every open so a newly changed priority
  // color is reflected immediately in this drawer, rather than waiting for
  // a stale cache to expire.
  const prioritiesQuery = useQuery({ queryKey: ['qc-priorities'], queryFn: getPriorities, enabled: isOpen, staleTime: 0 });
  const statusesQuery = useQuery({ queryKey: ['qc-statuses'], queryFn: getStatuses, enabled: isOpen, staleTime: 60_000 });
  const performanceQuery = useQuery({ queryKey: ['qc-performance-settings'], queryFn: getPerformanceSettings, enabled: isOpen, staleTime: 5 * 60_000 });

  const projects: { id: number; name: string }[] = projectsQuery.data || [];
  const phases: PhaseItem[] = phasesQuery.data || [];
  const taskGroups: TaskGroupItem[] = taskGroupsQuery.data || [];
  const members: ProjectMember[] = membersQuery.data || [];
  const categories: SkillCategory[] = categoriesQuery.data || [];
  const priorities: PriorityItem[] = prioritiesQuery.data || [];
  const statuses: StatusItem[] = statusesQuery.data || [];
  const performanceSettings: any[] = performanceQuery.data || [];

  const skillGroups = useMemo(
    () => (categoryId ? categories.find(c => c.id === categoryId)?.groups || [] : []),
    [categories, categoryId]
  );
  const skills = useMemo(
    () => (skillGroupId ? skillGroups.find(g => g.id === skillGroupId)?.skills || [] : []),
    [skillGroups, skillGroupId]
  );
  // 23:00 is Quick Create's hard cap — at hour 23 only minute 00 is a valid
  // combination (23:15/23:30/23:45 fall past the calendar's own boundary).
  const minuteOptions = wtHour === '23' ? ['00'] : QUARTER_MINUTES;

  // Reset the entire form every time the drawer opens. Work time prefills
  // from the clicked grid cell (exact minute, not snapped) when opened that
  // way; opening via the toolbar "+" has no prefill, so it starts empty —
  // in both cases the field stays freely editable afterwards.
  useEffect(() => {
    if (!isOpen) return;
    setProjectId(''); setPhaseId(''); setTaskGroupId('');
    setDetail(''); setAssignedId(''); setSupportId(''); setPriorityId(''); setStatus('');
    setMandayEst(''); setKpiRatio('90/10'); setCategoryId(''); setSkillGroupId(''); setSkillId(''); setLink(''); setLinkDraft(''); setNote(''); setRemark(''); setSend('');
    if (prefill) {
      setWtDate(toApiDate(prefill.day));
      setWtHour(String(prefill.hours).padStart(2, '0'));
      setWtMinute(String(prefill.minutes).padStart(2, '0'));
    } else {
      setWtDate(''); setWtHour(''); setWtMinute('');
    }
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    const autoGrow = (textarea: HTMLTextAreaElement | null, min: number, max: number) => {
      if (!textarea) return;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, min), max)}px`;
    };
    autoGrow(detailRef.current, 48, 160);
    autoGrow(noteRef.current, 64, 120);
  }, [detail, note, isOpen]);

  // Assigned defaults to current user once profile loads.
  useEffect(() => {
    if (isOpen && meQuery.data?.member_id && !assignedId) setAssignedId(meQuery.data.member_id);
  }, [isOpen, meQuery.data, assignedId]);

  // Priority/Status default to "Normal"/"Waiting" when that exact name
  // exists in the fetched system config — same bare defaults create_task()
  // itself falls back to (task_groups.py) — but the field stays a real,
  // freely-changeable required select, not a hidden hard-coded value.
  useEffect(() => {
    if (isOpen && !priorityId && priorities.length) {
      const normal = priorities.find(p => p.name.toLowerCase() === 'normal');
      if (normal) setPriorityId(String(normal.id));
    }
  }, [isOpen, priorities, priorityId]);
  useEffect(() => {
    if (isOpen && !status && statuses.length) {
      const waiting = statuses.find(s => s.name.toLowerCase() === 'waiting');
      if (waiting) setStatus(waiting.name);
    }
  }, [isOpen, statuses, status]);

  if (!isOpen) return null;

  const handleProjectChange = (v: number | '') => {
    setProjectId(v);
    setPhaseId(''); setTaskGroupId('');
    setAssignedId(meQuery.data?.member_id || '');
    setSupportId('');
  };
  const handlePhaseChange = (v: number | '') => { setPhaseId(v); setTaskGroupId(''); };
  const handleCategoryChange = (v: number | '') => { setCategoryId(v); setSkillGroupId(''); setSkillId(''); };
  const handleSkillGroupChange = (v: number | '') => { setSkillGroupId(v); setSkillId(''); };

  // Newly created Phase/Task Group are spliced straight into the relevant
  // query cache (instant, no extra round trip) and auto-selected — §12:
  // "Tạo xong → tự động chọn ... vừa tạo".
  const handlePhaseCreated = (phase: PhaseItem) => {
    queryClient.setQueryData<PhaseItem[]>(['qc-phases', projectId], prev => [...(prev || []), phase]);
    setPhaseId(phase.id);
    setTaskGroupId('');
  };
  const handleTaskGroupCreated = (group: TaskGroupItem) => {
    queryClient.setQueryData<TaskGroupItem[]>(['qc-groups', phaseId], prev => [...(prev || []), group]);
    setTaskGroupId(group.id);
  };

  const mandayNum = Number(mandayEst);
  const selectedPriority = priorities.find(priority => String(priority.id) === priorityId);
  // Task's own Manday EST in Quick Create is deliberately integer 1-10 only
  // (§7) — narrower than Task.manday_est's general 0.25-365 range (still
  // used by the full Tasks-tab edit form); Quick Create is for small,
  // fast-entry work items. The backend itself still accepts the wider
  // range, so this is a Quick-Create-only UI constraint, not a model change.
  const mandayValid = mandayEst !== '' && Number.isInteger(mandayNum) && mandayNum >= 1 && mandayNum <= 10;
  const [ratioAssignRaw, ratioSupportRaw] = kpiRatio.split('/').map(part => Number(part.trim()));
  const kpiRatioValid = Number.isInteger(ratioAssignRaw) && Number.isInteger(ratioSupportRaw)
    && ratioAssignRaw >= 0 && ratioAssignRaw <= 100 && ratioSupportRaw >= 0 && ratioSupportRaw <= 100
    && ratioAssignRaw + ratioSupportRaw === 100;

  // start_date is NOT a form field — it's silently derived from the date
  // part of Work time (or today, if Work time is left empty). See
  // spec.md FR-CAL-15 — inferring this avoids asking for information the
  // user already gave once.
  //
  // Support is REQUIRED, not optional — `tasks_v2.support_id` is NOT NULL
  // (confirmed both in the model and by testing create_task() directly: a
  // request without support_id 500s). This matches the real Tasks-tab form,
  // which already validates "Cột SUPPORT là bắt buộc" the same way.
  const canSubmit = !!projectId && !!phaseId && !!taskGroupId && !!detail.trim()
    && !!assignedId && !!supportId && !!selectedPriority && !!status
    && mandayValid && kpiRatioValid && !!skillGroupId && !!skillId;

  const handleSubmit = async () => {
    if (!canSubmit) {
      setFormError('Điền đủ các trường bắt buộc (*) trước khi tạo.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      // Work time is free-entry (any minute, 24h — no SA/CH) and optional:
      // all 3 parts (date/hour/minute) must be set, otherwise the task has
      // no scheduled_at and lands in "chưa xếp lịch", same as leaving it
      // blank via the toolbar "+" button.
      const wtDay = wtDate ? parseApiDate(wtDate) : null;
      const workTimeDate = wtDay && wtHour !== '' && wtMinute !== ''
        ? combineDateAndTime(wtDay, Number(wtHour), Number(wtMinute))
        : null;
      const scheduledAt = workTimeDate ? toApiDateTime(workTimeDate) : null;
      const startDate = workTimeDate ? toApiDate(workTimeDate) : toApiDate(new Date());
      await createTask(taskGroupId as number, {
        detail: detail.trim(),
        assigned_id: assignedId,
        support_id: supportId,
        priority: selectedPriority.name,
        status,
        manday_est: mandayNum,
        start_date: startDate,
        skill_solution_id: skillGroupId,
        skill_vendor_id: skillId,
        scheduled_at: scheduledAt,
        // Task's real Link field — same ticket_id column the Tasks tab and
        // Task Detail drawer already read/write via LinkChipsEditor. No
        // separate "quick create link" field.
        ticket_id: link.trim() || null,
        notes: note.trim() || null,
        remark: remark || null,
        send: send || null,
        kpi_ratio_assign: ratioAssignRaw,
        kpi_ratio_support: ratioSupportRaw,
      });
      onCreated();
      onClose();
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Không thể tạo task.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Portal>
      {/* No dimming/blur backdrop — same as Task Detail's own drawer and
          components/tasks/TaskEditDrawer (Calendar UI Sync pass, 2026-09):
          the page behind stays fully visible, only a click-outside catcher. */}
      <div className="fixed inset-0 z-50 flex justify-end">
        <div onClick={onClose} className="absolute inset-0" />
        <div className="relative w-full max-w-[560px] bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-200" onClick={e => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-[#f8faff] to-white shrink-0">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[#e8f0fe] text-[#0058be]">
                <span className="material-symbols-outlined text-[18px]">add_task</span>
              </span>
              <h3 className="text-sm font-bold text-[#0b1c30]">Tạo Task nhanh</h3>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Nhóm: Vị trí — Project → Phase → Task Group, cascading. Phase
                and Task Group each get an inline compact "+" next to the
                select, per §2/§3/§12. Màu Project (Personal Calendar
                preference, not a Project attribute — §4) sits right beside
                Project instead of its own card, since it's a small, always-
                visible accent for the same row. */}
            <div className="space-y-3 bg-slate-50/50 border border-slate-100 rounded-xl p-3">
              <h4 className="text-[10.5px] font-extrabold text-[#0058be] uppercase tracking-wider">📍 Vị trí</h4>
              <div className="grid grid-cols-[1fr_104px] gap-3">
                <div>
                  <label className={labelCls}>Project <span className="text-amber-500">*</span></label>
                  <select className={selectCls} value={projectId} onChange={e => handleProjectChange(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">— Chọn Project —</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Màu</label>
                  {projectId ? (
                    <ProjectColorPicker projectId={projectId} />
                  ) : (
                    <div className="h-10 rounded-lg border border-dashed border-slate-200 bg-slate-50/70" title="Chọn Project để đổi màu" />
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Phase <span className="text-amber-500">*</span></label>
                  <div className="flex items-stretch gap-1.5">
                    <select className={`${selectCls} flex-1 min-w-0`} value={phaseId} disabled={!projectId} onChange={e => handlePhaseChange(e.target.value ? Number(e.target.value) : '')}>
                      <option value="">{projectId ? '— Chọn Phase —' : 'Chọn Project trước'}</option>
                      {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {!!projectId && <InlineCreatePhase projectId={projectId} onCreated={handlePhaseCreated} />}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Task Group <span className="text-amber-500">*</span></label>
                  <div className="flex items-stretch gap-1.5">
                    <select className={`${selectCls} flex-1 min-w-0`} value={taskGroupId} disabled={!phaseId} onChange={e => setTaskGroupId(e.target.value ? Number(e.target.value) : '')}>
                      <option value="">{phaseId ? '— Chọn Task Group —' : 'Chọn Phase trước'}</option>
                      {taskGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    {!!phaseId && <InlineCreateTaskGroup phaseId={phaseId} onCreated={handleTaskGroupCreated} />}
                  </div>
                </div>
              </div>
            </div>

            {/* Nhóm: Thông tin công việc */}
            <div className="flex flex-col gap-3">
              <h4 className="text-[10.5px] font-extrabold text-[#0058be] uppercase tracking-wider">Thông tin công việc</h4>
              <div>
                <label className={labelCls}>Detail Task <span className="text-amber-500">*</span></label>
                <textarea ref={detailRef} className={`${inputCls} min-h-[52px] max-h-40 resize-none overflow-y-auto py-2.5`} rows={1} value={detail} onChange={e => setDetail(e.target.value)} placeholder="Ví dụ: Thiết kế banner Q3" maxLength={500} />
              </div>
              {/* Priority/Status are system config (Settings → Priority/
                  Status Configuration) — never hard-coded here, §5/§6. */}
              <div className="order-1 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Status <span className="text-amber-500">*</span></label>
                  <SemanticSelect value={status} onChange={setStatus} options={statuses} />
                </div>
                <div>
                  <label className={labelCls}>Priority <span className="text-amber-500">*</span></label>
                  <SemanticSelect value={priorityId} onChange={setPriorityId} options={priorities} variant="priority" />
                </div>
              </div>
              <div className="order-3 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Assigned <span className="text-amber-500">*</span></label>
                  <SearchableSelect label="thành viên" icon="" options={members.map(m => ({ id: String(m.id), name: m.display_name || m.full_name || '', avatar_url: m.avatar_url }))} value={assignedId || ''} disabled={!projectId} onChange={(value: any) => setAssignedId(value ? Number(value) : '')} placeholder="Chọn người thực hiện..." showAvatar className="w-full [&>button]:h-10 [&>button]:rounded-lg [&>button]:border-slate-200 [&>button]:px-3 [&>button]:text-[13px]" />
                </div>
                <div>
                  <label className={labelCls}>Support <span className="text-amber-500">*</span></label>
                  <SearchableSelect label="thành viên" icon="" options={members.map(m => ({ id: String(m.id), name: m.display_name || m.full_name || '', avatar_url: m.avatar_url }))} value={supportId || ''} disabled={!projectId} onChange={(value: any) => setSupportId(value ? Number(value) : '')} placeholder="Chọn người hỗ trợ..." showAvatar className="w-full [&>button]:h-10 [&>button]:rounded-lg [&>button]:border-slate-200 [&>button]:px-3 [&>button]:text-[13px]" />
                </div>
              </div>
              <div className="order-2 grid grid-cols-2 gap-3">
                <div>
                <label className={labelCls}>Manday EST <span className="text-amber-500">*</span></label>
                {/* Integer 1-10 only in Quick Create — narrower than the
                    Task model's general 0.25-365 range (still used by the
                    full Tasks-tab edit form); see the mandayValid comment
                    above for why. */}
                <input
                  className={inputCls} type="number" min={1} max={10} step={1}
                  value={mandayEst} onChange={e => setMandayEst(e.target.value)} placeholder="1 - 10"
                />
                </div>
                <div>
                  <label className={labelCls}>KPI Ratio</label>
                  <input className={`${inputCls} max-w-[190px] font-mono`} value={kpiRatio} onChange={e => setKpiRatio(e.target.value)} placeholder="90/10" aria-invalid={!kpiRatioValid} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-[10.5px] font-extrabold text-[#0058be] uppercase tracking-wider">Kỹ năng</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Skill Area <span className="text-amber-500">*</span></label>
                  <select className={selectCls} value={categoryId} onChange={e => handleCategoryChange(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">— Nhóm kỹ năng —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select className={`${selectCls} mt-1.5`} value={skillGroupId} disabled={!categoryId} onChange={e => handleSkillGroupChange(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">{categoryId ? '— Chọn Group —' : '—'}</option>
                    {skillGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Skill <span className="text-amber-500">*</span></label>
                  <select className={`${selectCls} mt-[26px]`} value={skillId} disabled={!skillGroupId} onChange={e => setSkillId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">{skillGroupId ? '— Chọn Skill —' : 'Chọn Skill Area trước'}</option>
                    {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-[10.5px] font-extrabold text-[#0058be] uppercase tracking-wider">Lịch làm việc</h4>
              <div>
                <label className={labelCls}>Work Time</label>
                {/* Date + Hour + Minute on one row now that the drawer is
                    max-w-[560px] (was max-w-md/448px when this used to
                    overflow) — flex-wrap is kept as a safety net so it still
                    degrades to two rows on a narrower viewport instead of
                    clipping. Same 3 fields/state/onChange as before. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    className={`${inputCls} flex-[1.6] min-w-[132px]`}
                    type="date"
                    value={wtDate}
                    onChange={e => setWtDate(e.target.value)}
                  />
                  {/* 24h HH:mm via two plain <select>s — never a native time
                      control, so it can never render 12h SA/CH regardless of
                      the browser/OS locale. Minute is fixed to 00/15/30/45;
                      at hour 23 it's narrowed to 00 only (23:00 is the hard cap). */}
                  <select
                    className={`${selectCls} flex-1 min-w-[64px]`}
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
                  <select className={`${selectCls} flex-1 min-w-[64px]`} value={wtMinute} onChange={e => setWtMinute(e.target.value)}>
                    <option value="">Phút --</option>
                    {minuteOptions.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {(wtDate || wtHour !== '' || wtMinute !== '') && (
                  <button
                    type="button"
                    onClick={() => { setWtDate(''); setWtHour(''); setWtMinute(''); }}
                    className="text-[10.5px] font-semibold text-slate-400 hover:text-rose-500 mt-1"
                  >
                    ✕ Xoá giờ
                  </button>
                )}
                <p className="text-[10.5px] text-slate-400 mt-1">
                  {wtDate && wtHour !== '' && wtMinute !== ''
                    ? 'Định dạng 24 giờ, phút chỉ 00/15/30/45, tối đa 23:00 — không dùng SA/CH.'
                    : 'Để trống — task sẽ nằm trong khu "Chưa xếp lịch".'}
                </p>
              </div>
            </div>

            {/* Nhóm: Thông tin bổ sung — Link dùng chung
                LinkChipsEditor với cột LINK trên bảng và Task Detail drawer,
                ghi vào Task.ticket_id (field Link thật của Task) — không
                phải field riêng cho Quick Create. Note lưu thẳng vào
                Task.notes, §11. */}
            <div className="space-y-3">
              <h4 className="text-[10.5px] font-extrabold text-[#0058be] uppercase tracking-wider">Thông tin bổ sung</h4>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Remark</label>
                  <select className={selectCls} value={remark} onChange={e => setRemark(e.target.value)}>
                    <option value="">-- Chọn --</option>
                    {performanceSettings.filter(rule => rule.is_active).map(rule => <option key={rule.id} value={String(rule.id)}>{rule.performance}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Send</label>
                  <select className={selectCls} value={send} onChange={e => setSend(e.target.value)}>
                    <option value="">-- Chọn --</option>
                    <option value="gửi">gửi</option>
                    <option value="đã gửi">đã gửi</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea
                  ref={noteRef} className={`${inputCls} min-h-[64px] max-h-[120px] resize-none overflow-y-auto py-2.5`} rows={3}
                  value={note}
                  onChange={e => {
                    const v = e.target.value;
                    setNote(v);
                    // Auto-add every URL found in Note as its own Link chip
                    // — skips ones already in Link, never removes/overwrites
                    // a link the user added themselves.
                    const found = extractUrls(v);
                    if (found.length) {
                      setLink(prev => {
                        const existing = new Set((prev || '').split('\n').filter(Boolean));
                        const toAdd = found.filter(u => !existing.has(u));
                        return toAdd.reduce((acc, u) => appendLinkValue(acc, u), prev);
                      });
                    }
                  }}
                  placeholder="Nhập ghi chú cho Task..."
                />
              </div>
            </div>

            {formError && (
              <p className="text-[11.5px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{formError}</p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-slate-200 bg-white flex items-center justify-end gap-2 shrink-0">
            <button onClick={onClose} className="text-[12.5px] font-semibold text-[#0b1c30] border border-slate-200 px-3.5 py-2 rounded-lg hover:bg-slate-50 transition-colors">
              Huỷ
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#004a9e] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Đang tạo...' : 'Tạo task'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
