'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Portal from '@/components/Portal';
import { getProjects, getPhases, getTaskGroups, getProjectMembers, getCategories, getMe, createTask, getApiErrorMessage } from '@/lib/api';
import { combineDateAndTime, toApiDate, toApiDateTime } from './dateUtils';

interface SkillItem { id: number; name: string; group_id: number }
interface SkillGroup { id: number; name: string; category_id: number; skills: SkillItem[] }
interface SkillCategory { id: number; name: string; groups: SkillGroup[] }
interface ProjectMember { id: number; display_name: string | null; full_name: string | null }

export interface QuickCreatePrefill {
  day: Date;
  hours: number;
  minutes: number;
}

const labelCls = 'text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1';
const selectCls = 'w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] text-[#0b1c30] focus:border-[#0058be] outline-none disabled:bg-slate-50 disabled:text-slate-400';
const inputCls = selectCls;

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
  const [projectId, setProjectId] = useState<number | ''>('');
  const [phaseId, setPhaseId] = useState<number | ''>('');
  const [taskGroupId, setTaskGroupId] = useState<number | ''>('');
  const [detail, setDetail] = useState('');
  const [assignedId, setAssignedId] = useState<number | ''>('');
  const [supportId, setSupportId] = useState<number | ''>('');
  const [mandayEst, setMandayEst] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [skillGroupId, setSkillGroupId] = useState<number | ''>(''); // -> skill_solution_id
  const [skillId, setSkillId] = useState<number | ''>(''); // -> skill_vendor_id
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const meQuery = useQuery({ queryKey: ['qc-me'], queryFn: getMe, enabled: isOpen, staleTime: 5 * 60_000 });
  const projectsQuery = useQuery({ queryKey: ['qc-projects'], queryFn: () => getProjects(), enabled: isOpen, staleTime: 60_000 });
  const phasesQuery = useQuery({ queryKey: ['qc-phases', projectId], queryFn: () => getPhases(projectId as number), enabled: isOpen && !!projectId });
  const taskGroupsQuery = useQuery({ queryKey: ['qc-groups', phaseId], queryFn: () => getTaskGroups(phaseId as number), enabled: isOpen && !!phaseId });
  const membersQuery = useQuery({ queryKey: ['qc-members', projectId], queryFn: () => getProjectMembers(projectId as number), enabled: isOpen && !!projectId });
  const categoriesQuery = useQuery({ queryKey: ['qc-categories'], queryFn: getCategories, enabled: isOpen, staleTime: 5 * 60_000 });

  const projects: { id: number; name: string }[] = projectsQuery.data || [];
  const phases: { id: number; name: string }[] = phasesQuery.data || [];
  const taskGroups: { id: number; name: string }[] = taskGroupsQuery.data || [];
  const members: ProjectMember[] = membersQuery.data || [];
  const categories: SkillCategory[] = categoriesQuery.data || [];

  const skillGroups = useMemo(
    () => (categoryId ? categories.find(c => c.id === categoryId)?.groups || [] : []),
    [categories, categoryId]
  );
  const skills = useMemo(
    () => (skillGroupId ? skillGroups.find(g => g.id === skillGroupId)?.skills || [] : []),
    [skillGroups, skillGroupId]
  );

  // Reset the entire form every time the drawer opens.
  useEffect(() => {
    if (!isOpen) return;
    setProjectId(''); setPhaseId(''); setTaskGroupId('');
    setDetail(''); setAssignedId(''); setSupportId('');
    setMandayEst(''); setCategoryId(''); setSkillGroupId(''); setSkillId('');
    setFormError(null);
  }, [isOpen]);

  // Assigned defaults to current user once profile loads.
  useEffect(() => {
    if (isOpen && meQuery.data?.member_id && !assignedId) setAssignedId(meQuery.data.member_id);
  }, [isOpen, meQuery.data, assignedId]);

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

  const workTimeLabel = prefill
    ? `${String(prefill.hours).padStart(2, '0')}:${String(prefill.minutes).padStart(2, '0')} · ${prefill.day.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}`
    : 'Chưa chọn giờ — task sẽ nằm trong khu "Chưa xếp lịch"';

  // start_date is NOT a form field — it's silently derived from Work time
  // (or today, if created via the toolbar "+" with no time picked). See
  // spec.md FR-CAL-15 — inferring this avoids asking for information the
  // user already gave once.
  //
  // Support is REQUIRED, not optional — `tasks_v2.support_id` is NOT NULL
  // (confirmed both in the model and by testing create_task() directly: a
  // request without support_id 500s). This matches the real Tasks-tab form,
  // which already validates "Cột SUPPORT là bắt buộc" the same way.
  const canSubmit = !!projectId && !!phaseId && !!taskGroupId && !!detail.trim()
    && !!assignedId && !!supportId && !!mandayEst && Number(mandayEst) > 0 && !!skillGroupId && !!skillId;

  const handleSubmit = async () => {
    if (!canSubmit) {
      setFormError('Điền đủ các trường bắt buộc (*) trước khi tạo.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const scheduledAt = prefill ? toApiDateTime(combineDateAndTime(prefill.day, prefill.hours, prefill.minutes)) : null;
      const startDate = prefill ? toApiDate(prefill.day) : toApiDate(new Date());
      await createTask(taskGroupId as number, {
        detail: detail.trim(),
        assigned_id: assignedId,
        support_id: supportId,
        manday_est: Number(mandayEst),
        start_date: startDate,
        skill_solution_id: skillGroupId,
        skill_vendor_id: skillId,
        scheduled_at: scheduledAt,
        // No KPI Ratio field in Quick Create (MVP) — send the same 90/10
        // default the Tasks-tab form falls back to, instead of letting
        // create_task() apply its own bare default (100/0, which leaves
        // Support with 0% KPI credit). Keeps both entry points consistent.
        kpi_ratio_assign: 90,
        kpi_ratio_support: 10,
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
      <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-stretch justify-end" onClick={onClose}>
        <div className="w-full max-w-md bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200" onClick={e => e.stopPropagation()}>
          <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
            <h3 className="text-sm font-extrabold text-[#0b1c30] uppercase tracking-wider">➕ Tạo Task nhanh</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-200/60 rounded-lg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Nhóm: Vị trí */}
            <div className="space-y-3 bg-slate-50/50 border border-slate-100 rounded-xl p-3.5">
              <h4 className="text-[10.5px] font-extrabold text-[#0058be] uppercase tracking-wider">📍 Vị trí</h4>
              <div>
                <label className={labelCls}>Project <span className="text-amber-500">*</span></label>
                <select className={selectCls} value={projectId} onChange={e => handleProjectChange(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">— Chọn Project —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Phase <span className="text-amber-500">*</span></label>
                <select className={selectCls} value={phaseId} disabled={!projectId} onChange={e => handlePhaseChange(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">{projectId ? '— Chọn Phase —' : 'Chọn Project trước'}</option>
                  {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Task Group <span className="text-amber-500">*</span></label>
                <select className={selectCls} value={taskGroupId} disabled={!phaseId} onChange={e => setTaskGroupId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">{phaseId ? '— Chọn Task Group —' : 'Chọn Phase trước'}</option>
                  {taskGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                {phaseId && taskGroups.length === 0 && !taskGroupsQuery.isFetching && (
                  <p className="text-[10.5px] text-amber-600 mt-1">
                    Phase này chưa có Task Group nào. Sang tab Tasks của dự án để tạo Task Group trước — Calendar không tự tạo cấu trúc mới.
                  </p>
                )}
              </div>
            </div>

            {/* Nhóm: Task */}
            <div className="space-y-3">
              <h4 className="text-[10.5px] font-extrabold text-[#0058be] uppercase tracking-wider">📝 Task</h4>
              <div>
                <label className={labelCls}>Tên task <span className="text-amber-500">*</span></label>
                <input className={inputCls} value={detail} onChange={e => setDetail(e.target.value)} placeholder="Ví dụ: Thiết kế banner Q3" maxLength={500} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Assigned <span className="text-amber-500">*</span></label>
                  <select className={selectCls} value={assignedId} disabled={!projectId} onChange={e => setAssignedId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">— Chọn —</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.full_name}</option>)}
                  </select>
                </div>
                <div>
                  {/* Support is required — tasks_v2.support_id is NOT NULL,
                      matching the real Tasks-tab form (project/detail/page.tsx:3494). */}
                  <label className={labelCls}>Support <span className="text-amber-500">*</span></label>
                  <select className={selectCls} value={supportId} disabled={!projectId} onChange={e => setSupportId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">— Chọn —</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Giờ làm việc</label>
                <div className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] text-slate-600">
                  🕐 {workTimeLabel}
                </div>
              </div>
              <div>
                <label className={labelCls}>Manday EST <span className="text-amber-500">*</span></label>
                <input
                  className={inputCls} type="number" min={0.25} max={365} step={0.25}
                  value={mandayEst} onChange={e => setMandayEst(e.target.value)} placeholder="Ví dụ: 0.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Skill Solution <span className="text-amber-500">*</span></label>
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
                  <label className={labelCls}>Skill Vendor <span className="text-amber-500">*</span></label>
                  <select className={`${selectCls} mt-[26px]`} value={skillId} disabled={!skillGroupId} onChange={e => setSkillId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">{skillGroupId ? '— Chọn Skill —' : 'Chọn Skill Solution trước'}</option>
                    {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
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
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="text-[12.5px] font-bold text-white bg-[#0058be] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Đang tạo…' : 'Tạo task'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
