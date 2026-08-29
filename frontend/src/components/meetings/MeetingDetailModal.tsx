'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Video, ExternalLink, Calendar, Clock, User, Sparkles, Check, Plus, MoreHorizontal, Info, FileText, Download, Copy, ListTodo, Search, FolderPlus, Users, Gauge, ThumbsUp, ThumbsDown } from 'lucide-react';
import { pushMeetingTasks, getProjects, getAccounts, updateMeeting, recalculateMeetingScore, submitMeetingFeedback, getPhases, createPhase, getTaskGroups, createTaskGroup, getCategories, getMe } from '@/lib/api';
import SearchableSelect from '@/components/common/SearchableSelect';
import ProgressBar from '@/components/dashboard/ProgressBar';
import { useQueryClient } from '@tanstack/react-query';

interface PickedRef { id: number; name: string; }

// Per-task Phase + "Task cha" (TaskGroup) pickers used in the AI task table.
// Split into two standalone cell components (instead of one combined block)
// so each can sit in its own <td> in the task table. Both include a
// "+ Tạo mới" option that reveals an inline text input — if the project
// doesn't have the right Phase/Task cha yet, the user can create it right
// here instead of leaving the meeting screen.
const NEW_PHASE = '__new_phase__';
const NEW_GROUP = '__new_group__';

function PhaseSelectCell({
  projectId,
  phase,
  onPhaseChange,
  onTaskGroupChange,
}: {
  projectId?: number | string;
  phase?: PickedRef;
  onPhaseChange: (p: PickedRef | undefined) => void;
  onTaskGroupChange: (tg: PickedRef | undefined) => void;
}) {
  const [phases, setPhases] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPhases([]);
    if (!projectId) return;
    getPhases(Number(projectId)).then((res: any) => setPhases(Array.isArray(res) ? res : (res?.data || []))).catch(() => setPhases([]));
  }, [projectId]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !projectId) return;
    setBusy(true);
    try {
      const ph = await createPhase(Number(projectId), { name });
      setPhases(prev => [...prev, ph]);
      onPhaseChange({ id: ph.id, name: ph.name });
      onTaskGroupChange(undefined);
      setNewName('');
      setCreating(false);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Không tạo được Phase mới');
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
          placeholder="Tên phase mới..."
          disabled={busy}
          className="w-24 px-2 py-1 text-xs border border-[#cbd5e1] rounded-lg focus:outline-none focus:border-[#6366f1]"
        />
        <button type="button" onClick={handleCreate} disabled={busy} className="text-emerald-600 font-bold text-xs px-1">✓</button>
        <button type="button" onClick={() => setCreating(false)} disabled={busy} className="text-slate-400 font-bold text-xs px-1">✕</button>
      </div>
    );
  }

  return (
    <select
      disabled={!projectId}
      value={phase?.id || ''}
      onChange={e => {
        const val = e.target.value;
        if (val === NEW_PHASE) { setCreating(true); return; }
        const pid = Number(val);
        const found = phases.find((p: any) => p.id === pid);
        onPhaseChange(found ? { id: found.id, name: found.name } : undefined);
        onTaskGroupChange(undefined);
      }}
      className={`text-xs border rounded-lg px-2 py-1.5 bg-white disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:border-[#6366f1] w-full ${phase?.id ? 'border-[#cbd5e1]' : 'border-red-400'}`}
    >
      <option value="">-- Chọn phase --</option>
      {phases.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value={NEW_PHASE}>+ Tạo phase mới</option>
    </select>
  );
}

function TaskGroupSelectCell({
  phase,
  taskGroup,
  onTaskGroupChange,
}: {
  phase?: PickedRef;
  taskGroup?: PickedRef;
  onTaskGroupChange: (tg: PickedRef | undefined) => void;
}) {
  const [groups, setGroups] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGroups([]);
    if (!phase?.id) return;
    getTaskGroups(phase.id).then((res: any) => setGroups(Array.isArray(res) ? res : (res?.data || []))).catch(() => setGroups([]));
  }, [phase?.id]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !phase?.id) return;
    setBusy(true);
    try {
      const tg = await createTaskGroup(phase.id, { name });
      setGroups(prev => [...prev, tg]);
      onTaskGroupChange({ id: tg.id, name: tg.name });
      setNewName('');
      setCreating(false);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Không tạo được Task cha mới');
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
          placeholder="Tên task cha mới..."
          disabled={busy}
          className="w-24 px-2 py-1 text-xs border border-[#cbd5e1] rounded-lg focus:outline-none focus:border-[#6366f1]"
        />
        <button type="button" onClick={handleCreate} disabled={busy} className="text-emerald-600 font-bold text-xs px-1">✓</button>
        <button type="button" onClick={() => setCreating(false)} disabled={busy} className="text-slate-400 font-bold text-xs px-1">✕</button>
      </div>
    );
  }

  return (
    <select
      disabled={!phase?.id}
      value={taskGroup?.id || ''}
      onChange={e => {
        const val = e.target.value;
        if (val === NEW_GROUP) { setCreating(true); return; }
        const gid = Number(val);
        const found = groups.find((g: any) => g.id === gid);
        onTaskGroupChange(found ? { id: found.id, name: found.name } : undefined);
      }}
      className={`text-xs border rounded-lg px-2 py-1.5 bg-white disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:border-[#6366f1] w-full ${taskGroup?.id ? 'border-[#cbd5e1]' : 'border-red-400'}`}
    >
      <option value="">-- Chọn task cha --</option>
      {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
      <option value={NEW_GROUP}>+ Tạo task cha mới</option>
    </select>
  );
}

// Mirrors backend's recalculate_task_group_dates() formula so the table can
// preview the computed End Date before push, without needing a round trip.
function getEstimatedEndDate(startDateStr?: string, mandayStr?: string | number): string | null {
  if (!startDateStr) return null;
  const manday = Number(mandayStr);
  if (!manday || isNaN(manday) || manday <= 0) return null;
  const start = new Date(startDateStr + 'T00:00:00');
  if (isNaN(start.getTime())) return null;
  const days = Math.ceil(manday) - 1;
  const end = new Date(start.getTime() + Math.max(days, 0) * 86400000);
  return end.toISOString().slice(0, 10);
}

function getIsoWeekNumber(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

interface MeetingDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: any;
  onEdit?: (meeting: any) => void;
  onSummarize?: (meeting: any) => void;
  onSync?: (meeting: any) => Promise<any>;
}

export default function MeetingDetailModal({
  isOpen,
  onClose,
  meeting,
  onEdit,
  onSummarize,
  onSync
}: MeetingDetailModalProps) {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'overview' | 'summary' | 'tasks' | 'transcript' | 'score'>('overview');
  const [isRecalculatingScore, setIsRecalculatingScore] = useState(false);
  const [localScore, setLocalScore] = useState<any>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackChoice, setFeedbackChoice] = useState<'helpful' | 'not_helpful' | null>(null);
  const [isPushing, setIsPushing] = useState(false);
  const [pushedSuccess, setPushedSuccess] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Assign Project Modal State
  const [isAssignProjectOpen, setIsAssignProjectOpen] = useState(false);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  // Meeting created with projects pre-selected → route recommended tasks to
  // that shortlist instead of every project in the system.
  const taskProjectOptions = (meeting?.projects && meeting.projects.length > 0) ? meeting.projects : projectsList;
  const [isAssigningProject, setIsAssigningProject] = useState(false);

  // Add Member Modal State (Multi-Select Supported)
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [accountsList, setAccountsList] = useState<any[]>([]);

  // Best-effort match of an AI-extracted name string against the real member
  // list — used to pre-select "Assigned" in the task table so the user only
  // has to fix it when the guess is wrong, not pick from scratch every time.
  const matchAccountByName = (name?: string): PickedRef | undefined => {
    if (!name) return undefined;
    const target = name.trim().toLowerCase();
    if (!target) return undefined;
    const found = accountsList.find((acc: any) => {
      const accName = (acc.full_name || acc.display_name || '').trim().toLowerCase();
      return accName && (accName === target || accName.includes(target) || target.includes(accName));
    });
    if (!found) return undefined;
    return { id: found.id, name: found.full_name || found.display_name };
  };

  const [selectedMemberNames, setSelectedMemberNames] = useState<string[]>([]);
  const [customMemberInput, setCustomMemberInput] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberRole, setMemberRole] = useState('Thành viên');
  const [isAddingMember, setIsAddingMember] = useState(false);

  const [toastText, setToastText] = useState<string | null>(null);

  // Per-task project selection and check state
  const [taskProjectsMap, setTaskProjectsMap] = useState<Record<number, number>>({});
  const [taskPhaseMap, setTaskPhaseMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskGroupMap, setTaskGroupMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskAssigneeMap, setTaskAssigneeMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskSupportMap, setTaskSupportMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskSkillSolutionMap, setTaskSkillSolutionMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskSkillVendorMap, setTaskSkillVendorMap] = useState<Record<number, PickedRef | undefined>>({});
  const [categoriesList, setCategoriesList] = useState<any[]>([]);
  const [taskEditMap, setTaskEditMap] = useState<Record<number, { detail_task?: string; priority?: string; manday_est?: string; start_date?: string; notes?: string }>>({});
  const [taskCheckedMap, setTaskCheckedMap] = useState<Record<number, boolean>>({});

  // Skill Solution = Group, Skill Vendor = Skill nested under it (categories → groups → skills).
  const allSkillGroups: any[] = categoriesList.flatMap((c: any) => c.groups || []);
  const getSkillVendorsForGroup = (groupId?: number) => {
    if (!groupId) return [];
    const group = allSkillGroups.find((g: any) => g.id === groupId);
    return group?.skills || [];
  };

  // Local State for Instant UI Feedback
  const [localProjectName, setLocalProjectName] = useState('');
  const [localProjectId, setLocalProjectId] = useState<number | null>(null);
  const [localMembers, setLocalMembers] = useState<any[]>([]);

  const creatorName = meeting?.creator_name || meeting?.creator?.display_name || meeting?.created_by_name || 'Host mkt.szone';

  const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);
  const isMeetingCreator = !!(meeting?.created_by && currentMemberId && meeting.created_by === currentMemberId);

  // Auto fetch projects list when modal opens
  useEffect(() => {
    if (isOpen) {
      getMe().then(me => setCurrentMemberId(me?.member_id ?? null)).catch(() => setCurrentMemberId(null));
      getProjects().then((res: any) => {
        const items = res?.data || res || [];
        if (Array.isArray(items)) setProjectsList(items);
      }).catch(console.error);
      // Cần sẵn danh sách nhân sự cho cột Assigned/Support ở bảng Task đề xuất —
      // trước đây chỉ tải khi mở modal "Thêm thành viên", nên bảng task luôn rỗng.
      getAccounts().then((res: any) => {
        const items = res?.data || res || [];
        if (Array.isArray(items)) setAccountsList(items);
      }).catch(console.error);
      // Skill Solution / Skill Vendor cho bảng Task đề xuất (categories → groups → skills)
      getCategories().then((res: any) => {
        const items = res?.data || res || [];
        if (Array.isArray(items)) setCategoriesList(items);
      }).catch(console.error);
    }
  }, [isOpen]);

  useEffect(() => {
    if (meeting) {
      const pName = typeof meeting.project === 'string' ? meeting.project : (meeting.project?.name || meeting.project_name || '');
      setLocalProjectName(pName);
      setLocalProjectId(meeting.project_id || null);

      const rawMembers = Array.isArray(meeting.members) ? meeting.members : [];
      const hostObj = { display_name: creatorName, role: 'Người tạo (Host)' };
      const hasHost = rawMembers.some((m: any) =>
        (m.display_name && m.display_name.includes('Host')) || (m.role && m.role.includes('Host')) || m.display_name === creatorName
      );
      setLocalMembers(hasHost ? rawMembers : [hostObj, ...rawMembers]);
    }
  }, [meeting, creatorName]);

  useEffect(() => {
    setLocalScore(null);
    setFeedbackChoice(null);
  }, [meeting?.id]);

  if (!isOpen || !meeting) return null;

  const score = localScore || meeting;
  const scoreTotal = score.score_total ?? null;

  const handleRecalculateScore = async () => {
    if (!meeting?.id) return;
    setIsRecalculatingScore(true);
    try {
      const res = await recalculateMeetingScore(meeting.id);
      if (res?.data) {
        setLocalScore(res.data);
        queryClient.setQueryData(['meetings'], (prev: any[] = []) => prev.map(m => m.id === meeting.id ? { ...m, ...res.data } : m));
      }
    } catch (e) {
      console.error('Failed to recalculate meeting score', e);
    } finally {
      setIsRecalculatingScore(false);
    }
  };

  const handleSubmitFeedback = async (helpful: boolean) => {
    if (!meeting?.id) return;
    setFeedbackSubmitting(true);
    try {
      const res = await submitMeetingFeedback(meeting.id, { helpful });
      setFeedbackChoice(helpful ? 'helpful' : 'not_helpful');
      if (res) {
        setLocalScore((prev: any) => ({ ...(prev || meeting), score_feedback: res.score_feedback, score_total: res.score_total }));
      }
    } catch (e) {
      console.error('Failed to submit meeting feedback', e);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // Real Meeting Fields
  const meetingTitle = meeting.title || 'Cuộc họp chưa có tên';
  const durationStr = meeting.duration ? `${meeting.duration} phút` : (meeting.time ? '30 phút' : 'Chưa xác định');
  const platformName = meeting.platform || 'Google Meet';
  const projectName = localProjectName || (typeof meeting.project === 'string' ? meeting.project : (meeting.project?.name || meeting.project_name || ''));
  const isUnassignedProject = !localProjectId && (!projectName || projectName === 'Dự án chung' || projectName === 'Chưa gán dự án');

  const statusUpper = String(meeting.status || 'UPCOMING').toUpperCase();
  const isDone = statusUpper === 'ĐÃ DIỄN RA' || statusUpper === 'DONE' || statusUpper === 'COMPLETED';

  // Join Link carry Host authuser
  const rawLink = meeting.meet_link || meeting.link || meeting.meeting_url || meeting.join_url || '';
  const baseLink = rawLink ? (rawLink.startsWith('http') ? rawLink : `https://${rawLink}`) : 'https://meet.google.com/new';
  const hostJoinLink = baseLink.includes('authuser=')
    ? baseLink
    : `${baseLink}${baseLink.includes('?') ? '&' : '?'}authuser=mkt.szone@gmail.com`;

  // Real AI & Summary Data
  const execSummary = meeting.executive_summary || (meeting.ai_summary?.executive_summary) || (Array.isArray(meeting.summary) && meeting.summary.length ? meeting.summary[0] : '');

  const decisionsList: string[] = meeting.decisions || (meeting.ai_summary?.decisions) || [];
  const issuesList: string[] = meeting.issues || (meeting.ai_summary?.issues) || [];
  const nextStepsList: string[] = meeting.next_steps || (meeting.ai_summary?.next_steps) || [];
  const tasksList: any[] = score.recommended_tasks || (score.ai_summary?.recommended_tasks) || [];
  const tasksNeedingReviewCount = tasksList.filter((t: any, idx: number) => {
    const pid = taskProjectsMap[idx] || localProjectId || meeting.project_id || '';
    const assignee = taskAssigneeMap[idx] ?? matchAccountByName(t.owner || t.assigned_name);
    const edit = taskEditMap[idx] || {};
    return !pid || !assignee || !taskPhaseMap[idx] || !taskGroupMap[idx]
      || !edit.start_date || !taskSkillSolutionMap[idx] || !taskSkillVendorMap[idx];
  }).length;
  const summaryTeamName: string = meeting.team_name || meeting.ai_summary?.team_name || '';
  const summaryOrganizerName: string = meeting.organizer_name || meeting.ai_summary?.organizer_name || '';
  const summaryParticipantCount = meeting.participant_count ?? meeting.ai_summary?.participant_count ?? null;
  const summaryWeekLabel = getIsoWeekNumber(meeting.date || meeting.meeting_date);
  const isAutoCreated: boolean = Boolean(meeting.is_auto_created ?? meeting.ai_summary?.is_auto_created);
  const membersList: any[] = localMembers;
  const rawTranscript = meeting.transcript || meeting.ai_summary?.transcript || '';

  const isN8nSource = meeting.ai_summary?.source === 'n8n_google_sheet' || meeting.ai_summary?.n8n_metadata;
  const n8nTime = meeting.ai_summary?.n8n_metadata?.received_at || meeting.updated_at || meeting.created_at;

  const triggerToast = (msg: string) => {
    setToastText(msg);
    setTimeout(() => setToastText(null), 3000);
  };

  const handleOpenAssignProject = async () => {
    setIsAssignProjectOpen(true);
    try {
      const res = await getProjects();
      const items = res?.data || res || [];
      setProjectsList(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectProject = async (proj: any) => {
    setIsAssigningProject(true);
    try {
      const data = await updateMeeting(meeting.id, { project_id: proj.id });
      setLocalProjectName(proj.name);
      setLocalProjectId(proj.id);
      meeting.project_id = proj.id;
      meeting.project = proj.name;

      if (data?.data) {
        queryClient.setQueryData(['meetings'], (prev: any[] = []) =>
          prev.map(m => m.id === meeting.id ? data.data : m)
        );
      }
      setIsAssignProjectOpen(false);
      triggerToast(`✓ Đã gán dự án "${proj.name}" thành công!`);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Lỗi khi gán dự án');
    } finally {
      setIsAssigningProject(false);
    }
  };

  const toggleSelectMember = (name: string) => {
    setSelectedMemberNames(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const handleOpenAddMember = async () => {
    setIsAddMemberOpen(true);
    setSelectedMemberNames([]);
    setCustomMemberInput('');
    setMemberSearch('');
    try {
      const res = await getAccounts();
      const items = res?.data || res || [];
      setAccountsList(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const namesToAdd = [...selectedMemberNames];
    if (customMemberInput.trim() && !namesToAdd.includes(customMemberInput.trim())) {
      namesToAdd.push(customMemberInput.trim());
    }

    if (namesToAdd.length === 0) {
      alert("Vui lòng chọn ít nhất 1 thành viên hoặc tự nhập tên thành viên!");
      return;
    }

    setIsAddingMember(true);
    try {
      const hostObj = { display_name: creatorName, role: 'Người tạo (Host)' };
      const hasHost = localMembers.some((m: any) =>
        (m.display_name && m.display_name.includes('Host')) || (m.role && m.role.includes('Host')) || m.display_name === creatorName
      );
      const baseList = hasHost ? localMembers : [hostObj, ...localMembers];

      const existingNamesSet = new Set(baseList.map((m: any) => m.display_name || m.full_name || m.name));
      const newMemberObjects = namesToAdd
        .filter(name => !existingNamesSet.has(name))
        .map(name => ({
          display_name: name,
          role: memberRole
        }));

      const updatedMembers = [...baseList, ...newMemberObjects];
      const data = await updateMeeting(meeting.id, { members: updatedMembers });

      setLocalMembers(updatedMembers);
      meeting.members = updatedMembers;

      if (data?.data) {
        queryClient.setQueryData(['meetings'], (prev: any[] = []) =>
          prev.map(m => m.id === meeting.id ? data.data : m)
        );
      }
      setIsAddMemberOpen(false);
      setSelectedMemberNames([]);
      setCustomMemberInput('');
      triggerToast(`✓ Đã thêm ${namesToAdd.length} thành viên tham dự!`);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Lỗi khi thêm thành viên');
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleCopyLink = () => {
    if (!hostJoinLink) return;
    navigator.clipboard.writeText(hostJoinLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSyncClick = async () => {
    if (!onSync || isSyncing) return;
    setIsSyncing(true);
    try {
      await onSync(meeting);
      triggerToast('✓ Đã đồng bộ transcript & AI Summary thành công!');
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Lỗi khi đồng bộ cuộc họp');
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePushTasks = async () => {
    if (!tasksList.length) {
      alert("Cuộc họp này chưa có Task AI đề xuất để push!");
      return;
    }

    const tasksToPush = tasksList
      .map((t: any, idx: number) => {
        const selectedPid = taskProjectsMap[idx] || localProjectId || meeting.project_id || (projectsList[0]?.id);
        const selectedProj = projectsList.find((p: any) => p.id === selectedPid);
        const phase = taskPhaseMap[idx];
        const taskGroup = taskGroupMap[idx];
        const edit = taskEditMap[idx] || {};
        const assignee = taskAssigneeMap[idx] ?? matchAccountByName(t.owner || t.assigned_name);
        const mandayRaw = edit.manday_est ?? t.manday_est;
        const manday = mandayRaw === '' || mandayRaw === undefined || mandayRaw === null ? undefined : Number(mandayRaw);
        return {
          ...t,
          detail_task: edit.detail_task ?? t.detail_task,
          priority: edit.priority ?? t.priority,
          manday_est: (manday === undefined || isNaN(manday)) ? undefined : manday,
          // Assignee đã được xác nhận trực tiếp trên bảng (chọn từ danh sách nhân sự
          // thật) — gửi kèm assigned_id để backend dùng thẳng, khỏi phải dò tên nữa.
          assigned_id: assignee?.id,
          assigned_name: assignee?.name || t.assigned_name || t.owner,
          project_id: selectedPid,
          project_name: selectedProj?.name || t.project_name || localProjectName,
          phase_id: phase?.id,
          phase_name: phase?.name,
          task_group_id: taskGroup?.id,
          task_group_name: taskGroup?.name,
          checked: taskCheckedMap[idx] !== false
        };
      })
      .filter((t: any) => t.checked);

    if (tasksToPush.length === 0) {
      alert("Vui lòng chọn ít nhất 1 task để đẩy vào dự án.");
      return;
    }

    if (tasksToPush.some((t: any) => !t.phase_id || !t.task_group_id)) {
      const proceed = confirm(
        "Có task chưa chọn đủ Phase / Task cha. Task đó sẽ được đẩy vào Inbox nhưng chưa gắn đúng vị trí trong kế hoạch dự án — bạn vẫn muốn tiếp tục?"
      );
      if (!proceed) return;
    }

    // Bảng Task Đề Xuất giờ đã là bước review (mọi field đều sửa được ngay
    // tại đây, ô còn thiếu viền đỏ) — push thẳng, không cần màn hình review
    // trung gian nữa.
    setIsPushing(true);
    try {
      await pushMeetingTasks(meeting.id, tasksToPush);
      setPushedSuccess(true);
      triggerToast(`✓ Đã đẩy ${tasksToPush.length} task vào dự án thành công!`);
      setTimeout(() => setPushedSuccess(false), 3000);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Có lỗi khi push task vào dự án");
    } finally {
      setIsPushing(false);
    }
  };

  const handleDownloadTranscript = () => {
    if (!rawTranscript) {
      alert("Chưa có nội dung biên bản cuộc họp để tải về.");
      return;
    }
    const filename = `${meetingTitle.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_')}_Bien_ban.txt`;
    const blob = new Blob([rawTranscript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyTranscript = () => {
    if (!rawTranscript) return;
    navigator.clipboard.writeText(rawTranscript);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs animate-in fade-in duration-200 p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col border border-slate-200 animate-in zoom-in-95 duration-200 max-h-[92vh] my-auto">
        
        {/* Top Header Bar with Back Link */}
        <div className="px-6 pt-5 pb-4 bg-white border-b border-[#e2e8f0]">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#64748b] hover:text-[#0b1c30] transition-colors mb-3"
          >
            <ArrowLeft size={14} />
            <span>Quay lại danh sách cuộc họp</span>
          </button>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Title & Badges */}
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-extrabold text-[#0b1c30] tracking-tight">
                  {meetingTitle}
                </h2>
                <span className={`px-3 py-0.5 rounded-full text-xs font-bold ${
                  isDone 
                    ? 'bg-[#dcfce7] text-[#166534]' 
                    : 'bg-blue-50 text-blue-700'
                }`}>
                  {isDone ? 'Completed' : 'Scheduled'}
                </span>
              </div>

              {/* Sub-Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {isAutoCreated && (
                  <span
                    className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-50 text-teal-700 border border-teal-200 flex items-center gap-1"
                    title="Meeting này không được tạo qua nút 'Tạo meeting' trên web — n8n tự động tạo từ video ghi hình phát hiện được"
                  >
                    🤖 Tự động tạo từ n8n
                  </span>
                )}
                {execSummary ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#f5f3ff] text-[#6366f1]">
                    AI Summary sẵn sàng
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                    Chưa có AI Summary
                  </span>
                )}

                {isUnassignedProject ? (
                  <button 
                    type="button"
                    onClick={handleOpenAssignProject}
                    className="px-3 py-1 rounded-full text-[11px] font-extrabold bg-[#fef3c7] hover:bg-[#fde68a] text-[#92400e] border border-[#f59e0b]/40 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    title="Bấm để chọn và gán dự án"
                  >
                    <span>⚠️ Chưa gán Dự án</span>
                    <span className="underline text-[10px] font-bold opacity-80">(Bấm để gán)</span>
                  </button>
                ) : (
                  <button 
                    type="button"
                    onClick={handleOpenAssignProject}
                    className="px-3 py-1 rounded-full text-[11px] font-bold bg-blue-50 hover:bg-blue-100 text-[#0058be] border border-blue-200 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    title="Bấm để thay đổi dự án"
                  >
                    <span>📁 {projectName}</span>
                    <span className="text-[10px] opacity-75 font-semibold">(Đổi)</span>
                  </button>
                )}

                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#f1f5f9] text-[#64748b]">
                  {platformName}
                </span>

                {scoreTotal !== null && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('score')}
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 ${
                      scoreTotal >= 75 ? 'bg-emerald-50 text-emerald-700' : scoreTotal >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                    }`}
                    title="Xem chi tiết điểm hiệu quả"
                  >
                    <Gauge size={12} />
                    <span>Hiệu quả {scoreTotal}/100</span>
                  </button>
                )}
              </div>

              {/* Sub-Info Line */}
              <div className="flex items-center gap-4 text-xs text-[#64748b] flex-wrap font-medium pt-1">
                <span className="flex items-center gap-1">
                  <Calendar size={14} className="text-[#94a3b8]" />
                  {meeting.date || meeting.meeting_date || 'Chưa chọn'} · {meeting.time || meeting.start_time || 'Chưa chọn'}
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={14} className="text-[#94a3b8]" />
                  {durationStr}
                </span>
                <span className="flex items-center gap-1">
                  <User size={14} className="text-[#94a3b8]" />
                  {creatorName}
                </span>
                {rawLink && (
                  <div className="flex items-center gap-1.5 bg-[#f5f3ff] px-2.5 py-1 rounded-lg border border-[#e0e7ff]">
                    <a
                      href={hostJoinLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#6366f1] font-bold hover:underline flex items-center gap-1 text-[11px]"
                      title="Mở Google Meet"
                    >
                      <ExternalLink size={12} />
                      <span>{rawLink.replace(/^https?:\/\//, '')}</span>
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="text-[#6366f1] hover:text-[#4f46e5] p-0.5 rounded hover:bg-[#eee9fe] transition-colors flex items-center gap-1"
                      title="Sao chép đường link cuộc họp"
                    >
                      {copiedLink ? (
                        <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">
                          ✓ Đã chép!
                        </span>
                      ) : (
                        <Copy size={13} className="text-[#6366f1]" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons Top Right */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-2.5 text-[#64748b] hover:text-[#0b1c30] rounded-xl hover:bg-slate-100 transition-colors border border-[#cbd5e1]"
                  title="Tùy chọn khác"
                >
                  <MoreHorizontal size={18} />
                </button>

                {showMenu && (
                  <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 text-xs font-medium space-y-0.5">
                    <button
                      onClick={() => { setShowMenu(false); onEdit?.(meeting); }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-[#0b1c30] flex items-center gap-2"
                    >
                      <span>✏️ Chỉnh sửa cuộc họp</span>
                    </button>
                    <button
                      onClick={() => { setShowMenu(false); handleCopyLink(); }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-[#6366f1] flex items-center gap-2"
                    >
                      <span>📋 Sao chép link họp</span>
                    </button>
                    {onSummarize && (
                      <button
                        onClick={() => { setShowMenu(false); onSummarize(meeting); }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-purple-700 flex items-center gap-2 border-t border-slate-100"
                      >
                        <span>✨ Dán biên bản / Chạy AI</span>
                      </button>
                    )}
                    {onSync && (
                      <button
                        onClick={() => { setShowMenu(false); handleSyncClick(); }}
                        disabled={isSyncing}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-[#0058be] flex items-center gap-2 disabled:opacity-50"
                      >
                        <span>{isSyncing ? '⏳ Đang đồng bộ...' : '🔄 Đồng bộ (Sync)'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <a
                href={hostJoinLink}
                target="_blank"
                rel="noreferrer"
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-2"
                title="Vào Google Meet bằng tài khoản Host mkt.szone@gmail.com"
              >
                <Video size={16} />
                <span>Tham gia (Host mkt.szone)</span>
                <ExternalLink size={13} />
              </a>
            </div>
          </div>

          {/* Sub Navigation Tabs */}
          <div className="flex items-center gap-6 border-t border-[#e2e8f0] mt-5 pt-3 text-xs font-bold text-[#64748b]">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'overview' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              Tổng quan
            </button>
            <button
              onClick={() => setActiveTab('summary')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'summary' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              AI Summary
            </button>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'tasks' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              Task đề xuất ({tasksList.length})
            </button>
            <button
              onClick={() => setActiveTab('transcript')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'transcript' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              Biên bản
            </button>
            <button
              onClick={() => setActiveTab('score')}
              className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'score' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              <Gauge size={13} />
              <span>Hiệu quả{scoreTotal !== null ? ` (${scoreTotal})` : ''}</span>
            </button>
          </div>
        </div>

        {/* Modal Body Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-[#f8fafc]">
          
          {/* TAB 1: TỔNG QUAN */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column (7 Cols ~ 60%) */}
              <div className="lg:col-span-7 space-y-5">
                
                {/* Card 1: Thông tin cuộc họp */}
                <div className="bg-white rounded-2xl p-5 border border-[#e2e8f0] shadow-2xs space-y-4">
                  <h3 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider">
                    Thông tin cuộc họp
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-[#64748b] block mb-1">Dự án</span>
                      <div className="flex items-center gap-2 flex-wrap">
                        {isUnassignedProject ? (
                          <span className="px-2.5 py-1 rounded-lg bg-[#fef3c7] text-[#92400e] font-bold text-[11px]">
                            ⚠️ Chưa gán dự án
                          </span>
                        ) : (
                          <span className="font-bold text-[#0b1c30] text-xs">{projectName}</span>
                        )}
                        <button 
                          type="button"
                          onClick={handleOpenAssignProject} 
                          className="px-3 py-1.5 text-xs font-extrabold text-[#6366f1] bg-[#f5f3ff] hover:bg-[#6366f1] hover:text-white border border-[#c7d2fe] hover:border-[#6366f1] rounded-xl transition-all shadow-2xs cursor-pointer flex items-center gap-1.5 active:scale-95"
                        >
                          <FolderPlus size={14} />
                          <span>{isUnassignedProject ? '+ Gán Dự Án Ngay' : 'Đổi Dự Án'}</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Nguồn dữ liệu</span>
                      <span className="px-2.5 py-1 rounded-lg bg-[#ccfbf1] text-[#0f766e] font-bold text-[11px] inline-block">
                        {isN8nSource ? 'Tự động / Webhook' : 'Trực tiếp / Hệ thống'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Người tạo / Host</span>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-200 text-[#475569] font-bold text-[10px] flex items-center justify-center">
                          {creatorName[0]}
                        </div>
                        <span className="font-bold text-[#0b1c30]">{creatorName}</span>
                      </div>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Nền tảng</span>
                      <span className="font-bold text-[#0b1c30] flex items-center gap-1.5">
                        <Video size={14} className="text-[#6366f1]" />
                        {platformName}
                      </span>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Thời gian</span>
                      <span className="font-bold text-[#0b1c30]">
                        {meeting.date || meeting.meeting_date || 'Chưa chọn'} · {meeting.time || meeting.start_time || 'Chưa chọn'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Trạng thái</span>
                      <span className={`font-bold flex items-center gap-1.5 ${isDone ? 'text-[#166534]' : 'text-blue-600'}`}>
                        <span className={`w-2 h-2 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                        {isDone ? 'Completed' : 'Scheduled'}
                      </span>
                    </div>
                  </div>

                  {/* Sync Notification Box if n8n source */}
                  {isN8nSource && (
                    <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-xl p-3 flex items-center justify-between gap-3 text-xs text-[#1e40af]">
                      <div className="flex items-center gap-2">
                        <Info size={16} className="text-[#2563eb] shrink-0" />
                        <span>Cuộc họp này đã được xử lý và đồng bộ tự động lúc {n8nTime ? String(n8nTime).slice(0, 16) : 'gần đây'}.</span>
                      </div>
                    </div>
                  )}

                  {/* Host account reminder — only shown to the meeting creator, since only they need to act as host */}
                  {isMeetingCreator && rawLink && (
                    <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-xl p-3 flex items-start gap-2 text-xs text-[#1e40af]">
                      <Info size={16} className="text-[#2563eb] shrink-0 mt-0.5" />
                      <span><span className="font-bold">Lưu ý host:</span> Bạn là người tạo cuộc họp này — hãy đăng nhập Google bằng tài khoản <b>mkt.szone@gmail.com</b> trước khi vào Meet để có quyền duyệt người tham gia phòng chờ.</span>
                    </div>
                  )}
                </div>

                {/* Card 2: Thành viên tham dự */}
                <div className="bg-white rounded-2xl p-5 border border-[#e2e8f0] shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider">
                      Thành viên tham dự ({membersList.length > 0 ? membersList.length : 1} người)
                    </h3>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap">
                    {membersList.length > 0 ? (
                      membersList.map((mb: any, idx: number) => {
                        const name = mb.display_name || mb.full_name || mb.name || 'Thành viên';
                        const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
                        const colors = ['bg-[#e0e7ff] text-[#4338ca]', 'bg-[#dcfce7] text-[#15803d]', 'bg-[#fef3c7] text-[#b45309]', 'bg-[#fae8ff] text-[#a21caf]'];

                        return (
                          <div key={idx} className="flex items-center gap-2">
                            <div className={`w-9 h-9 rounded-full ${colors[idx % colors.length]} font-bold text-xs flex items-center justify-center shadow-2xs`}>
                              {initials}
                            </div>
                            <div className="text-xs">
                              <p className="font-bold text-[#0b1c30] leading-none">{name}</p>
                              <p className="text-[10px] text-[#64748b] mt-0.5">{mb.role || 'Thành viên'}</p>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-full bg-[#e0e7ff] text-[#4338ca] font-bold text-xs flex items-center justify-center">
                          {creatorName[0]}
                        </div>
                        <div className="text-xs">
                          <p className="font-bold text-[#0b1c30] leading-none">{creatorName}</p>
                          <p className="text-[10px] text-[#64748b] mt-0.5">Người tạo (Host)</p>
                        </div>
                      </div>
                    )}

                    <button 
                      onClick={handleOpenAddMember} 
                      className="w-9 h-9 rounded-full border-2 border-dashed border-[#cbd5e1] hover:border-[#6366f1] text-[#64748b] hover:text-[#6366f1] font-bold text-xs flex items-center justify-center transition-colors cursor-pointer"
                      title="Thêm thành viên tham dự"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                {/* Card 3: Real Timeline */}
                <div className="bg-white rounded-2xl p-5 border border-[#e2e8f0] shadow-2xs space-y-4">
                  <h3 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider">
                    Nhật ký hoạt động
                  </h3>

                  <div className="space-y-4 relative pl-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                    <div className="relative">
                      <div className="absolute -left-5 top-1 w-3 h-3 rounded-full bg-[#6366f1] ring-4 ring-white"></div>
                      <div className="flex items-start justify-between text-xs">
                        <div>
                          <p className="font-bold text-[#0b1c30]">Khởi tạo cuộc họp</p>
                          <p className="text-[#64748b] mt-0.5">Cuộc họp đã được tạo trong hệ thống bởi {creatorName}</p>
                        </div>
                        <span className="text-[11px] text-[#94a3b8]">
                          {meeting.created_at ? String(meeting.created_at).slice(0, 16) : 'Gần đây'}
                        </span>
                      </div>
                    </div>

                    {execSummary && (
                      <div className="relative">
                        <div className="absolute -left-5 top-1 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-white"></div>
                        <div className="flex items-start justify-between text-xs">
                          <div>
                            <p className="font-bold text-[#0b1c30]">AI Summary & Task Đề Xuất</p>
                            <p className="text-[#64748b] mt-0.5">Đã cập nhật bản tóm tắt và bóc tách công việc đề xuất</p>
                          </div>
                          <span className="text-[11px] text-[#94a3b8]">
                            {n8nTime ? String(n8nTime).slice(0, 16) : 'Hoàn tất'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Right Column: AI TÓM TẮT Widget (5 Cols ~ 40%) */}
              <div className="lg:col-span-5">
                <div className="bg-white rounded-2xl p-5 border border-[#e0e7ff] shadow-sm space-y-4 sticky top-4">
                  
                  {/* Widget Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[#6366f1]">
                      <Sparkles size={16} />
                      <h3 className="text-xs font-extrabold uppercase tracking-wider">AI TÓM TẮT</h3>
                    </div>
                    {onSummarize && (
                      <button onClick={() => onSummarize?.(meeting)} className="text-[11px] font-bold text-[#6366f1] hover:underline bg-[#f5f3ff] px-2.5 py-1 rounded-lg">
                        Dán / Chạy AI
                      </button>
                    )}
                  </div>

                  {/* Section 1: TÓM TẮT ĐIỀU HÀNH */}
                  <div className="space-y-1.5">
                    <h4 className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#6366f1]"></span>
                      Tóm tắt điều hành
                    </h4>
                    {execSummary ? (
                      <p className="text-xs text-[#334155] leading-relaxed font-normal bg-[#f8f6ff] p-3 rounded-xl border border-[#eee9fe]">
                        {execSummary}
                      </p>
                    ) : (
                      <p className="text-xs text-[#94a3b8] italic bg-slate-50 p-3 rounded-xl border border-slate-200">
                        Chưa có bản tóm tắt. Bạn có thể nhấn 'Dán / Chạy AI' để tạo tóm tắt tự động.
                      </p>
                    )}
                  </div>

                  {/* Section 2: QUYẾT ĐỊNH CHÍNH */}
                  {decisionsList.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        Quyết định chính
                      </h4>
                      <div className="space-y-1.5">
                        {decisionsList.map((dec: string, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 text-xs text-[#334155] bg-emerald-50/60 border border-emerald-100 rounded-lg px-2.5 py-2">
                            <Check size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                            <span>{dec}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section 2b: VẤN ĐỀ & RỦI RO */}
                  {issuesList.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        Vấn đề & rủi ro
                      </h4>
                      <div className="space-y-1.5">
                        {issuesList.map((it: string, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50/60 border border-amber-100 rounded-lg px-2.5 py-2">
                            <span className="text-amber-600 shrink-0 leading-4">⚠</span>
                            <span>{it}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section 2c: BƯỚC TIẾP THEO */}
                  {nextStepsList.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#6366f1]"></span>
                        Bước tiếp theo
                      </h4>
                      <div className="space-y-1.5">
                        {nextStepsList.map((it: string, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 text-xs text-[#4338ca] bg-[#f5f3ff] border border-[#eee9fe] rounded-lg px-2.5 py-2">
                            <span className="shrink-0 leading-4">→</span>
                            <span>{it}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section 3: TASK ĐỀ XUẤT */}
                  {tasksList.length > 0 && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-100">
                      <div className="flex items-center justify-between pt-3">
                        <h4 className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          Task đề xuất
                        </h4>
                        <span className="px-2 py-0.5 bg-[#f1f5f9] text-[#475569] text-[10px] font-bold rounded-full">
                          {tasksList.length} tasks
                        </span>
                      </div>

                      <div className="space-y-2">
                        {tasksList.map((t: any, idx: number) => {
                          const priority = t.priority || 'Normal';
                          const pColor = priority === 'High' || priority === 'Critical' 
                            ? 'bg-red-500' 
                            : priority === 'Medium' 
                            ? 'bg-blue-500' 
                            : 'bg-emerald-500';

                          return (
                            <div key={idx} className="p-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl flex items-center justify-between gap-3 text-xs">
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${pColor}`}></span>
                                  <span className="text-[11px] font-bold text-slate-600">{priority}</span>
                                  <p className="font-bold text-[#0b1c30] truncate">{t.detail_task || t.title || t.name}</p>
                                </div>
                                <div className="flex items-center gap-3 text-[11px] text-[#64748b] font-medium pl-4">
                                  <span>👤 {t.owner || t.assigned_name || creatorName}</span>
                                  {t.deadline && <span>📅 {t.deadline}</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={handlePushTasks}
                          disabled={isPushing}
                          className="w-full py-3 bg-[#6366f1] hover:bg-[#4f46e5] disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                        >
                          {isPushing ? (
                            <span>Đang push task...</span>
                          ) : pushedSuccess ? (
                            <span>✓ Đã push task thành công!</span>
                          ) : (
                            <span>📥 Đẩy task vào dự án</span>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              </div>

            </div>
          )}

          {/* TAB 2: AI SUMMARY (DEDICATED FULL VIEW) */}
          {activeTab === 'summary' && (
            <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0] shadow-2xs space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-[#6366f1]">
                  <Sparkles size={20} />
                  <h3 className="text-base font-extrabold text-[#0b1c30]">Bản Tóm Tắt AI Chi Tiết</h3>
                </div>
                {onSummarize && (
                  <button onClick={() => onSummarize?.(meeting)} className="px-4 py-2 bg-[#f5f3ff] hover:bg-[#eee9fe] text-[#6366f1] text-xs font-bold rounded-xl transition-colors">
                    Dán biên bản / Chạy lại AI
                  </button>
                )}
              </div>

              {execSummary ? (
                <div className="space-y-6">
                  {/* Header info — mirrors the Google Sheet's meeting info table */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs">
                    <div>
                      <p className="text-[#94a3b8] font-semibold">Ngày họp</p>
                      <p className="text-[#0b1c30] font-bold mt-0.5">{meeting.date || meeting.meeting_date || 'Chưa xác định'} · {meeting.time || meeting.start_time || ''}</p>
                    </div>
                    <div>
                      <p className="text-[#94a3b8] font-semibold">Tuần</p>
                      <p className="text-[#0b1c30] font-bold mt-0.5">{summaryWeekLabel ? `Tuần ${summaryWeekLabel}` : 'Không đề cập'}</p>
                    </div>
                    <div>
                      <p className="text-[#94a3b8] font-semibold">Thời lượng</p>
                      <p className="text-[#0b1c30] font-bold mt-0.5">{durationStr}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[#94a3b8] font-semibold">Link record</p>
                      {meeting.meeting_url || meeting.link ? (
                        <a href={meeting.meeting_url || meeting.link} target="_blank" rel="noreferrer" className="text-[#6366f1] font-bold mt-0.5 hover:underline break-all block">
                          {meeting.meeting_url || meeting.link}
                        </a>
                      ) : (
                        <p className="text-[#0b1c30] font-bold mt-0.5">Không đề cập</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[#94a3b8] font-semibold">Team</p>
                      <p className="text-[#0b1c30] font-bold mt-0.5">{summaryTeamName || 'Không đề cập'}</p>
                    </div>
                    <div>
                      <p className="text-[#94a3b8] font-semibold">Người summary</p>
                      <p className="text-[#0b1c30] font-bold mt-0.5">{summaryOrganizerName || 'Không đề cập'}</p>
                    </div>
                    <div>
                      <p className="text-[#94a3b8] font-semibold">Số người tham gia</p>
                      <p className="text-[#0b1c30] font-bold mt-0.5">{summaryParticipantCount ?? 'Không đề cập'}</p>
                    </div>
                  </div>

                  {/* Executive Summary Box */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">TỔNG QUAN</h4>
                    <div className="p-4 bg-[#f8f6ff] border border-[#eee9fe] rounded-2xl text-sm text-[#334155] leading-relaxed">
                      {execSummary}
                    </div>
                  </div>

                  {/* Task cha đã chốt — mirrors the Sheet's per-project field rows */}
                  {tasksList.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">TASK CHA ĐÃ CHỐT ({tasksList.length})</h4>
                      <div className="space-y-3">
                        {tasksList.map((t, i) => (
                          <div key={i} className="border border-[#e2e8f0] rounded-2xl overflow-hidden">
                            <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 text-xs font-bold text-rose-700">
                              {i + 1}. Project: {t.project_name || ''}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 text-xs divide-y divide-slate-100 sm:divide-y-0">
                              {[
                                ['Task cha', t.detail_task || 'Không đề cập'],
                                ['Priority', t.priority || 'Normal'],
                                ['Manday Budget', t.manday_est ?? 'Không đề cập'],
                                ['Owner', t.assigned_name || t.owner || 'Không đề cập'],
                                ['Deadline', t.deadline || 'Không đề cập'],
                                ['KPI / Output', t.kpi_output || 'Không đề cập'],
                              ].map(([label, value], fi) => (
                                <div key={fi} className="px-4 py-2">
                                  <span className="text-[#94a3b8] font-semibold">{label}: </span>
                                  <span className="text-[#334155] font-medium">{String(value)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Decisions List */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">CÁC QUYẾT ĐỊNH CHÍNH ({decisionsList.length})</h4>
                    {decisionsList.length > 0 ? (
                      <div className="space-y-2">
                        {decisionsList.map((dec, i) => (
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

                  {/* Issues & Risks */}
                  {issuesList.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">VẤN ĐỀ & RỦI RO ({issuesList.length})</h4>
                      <div className="space-y-2">
                        {issuesList.map((it, i) => (
                          <div key={i} className="p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-xl flex items-start gap-3 text-xs text-amber-900">
                            <span className="shrink-0 mt-0.5 font-bold">{i + 1}.</span>
                            <span className="font-medium">{it}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Next Steps */}
                  {nextStepsList.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">BƯỚC TIẾP THEO ({nextStepsList.length})</h4>
                      <div className="space-y-2">
                        {nextStepsList.map((it, i) => (
                          <div key={i} className="p-3.5 bg-[#f5f3ff] border border-[#eee9fe] rounded-xl flex items-start gap-3 text-xs text-[#4338ca]">
                            <span className="shrink-0 mt-0.5 font-bold">{i + 1}.</span>
                            <span className="font-medium">{it}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 space-y-3">
                  <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center mx-auto">
                    <Sparkles size={24} />
                  </div>
                  <p className="text-sm font-bold text-[#0b1c30]">Chưa có AI Summary cho cuộc họp này</p>
                  <p className="text-xs text-[#64748b]">Bấm "Dán biên bản / Chạy AI" để phân tích tóm tắt cuộc họp.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TASK ĐỀ XUẤT (DEDICATED FULL VIEW WITH PER-TASK PROJECT SELECTOR & PUSH BUTTON) */}
          {activeTab === 'tasks' && (
            <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0] shadow-2xs space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-[#6366f1]">
                  <ListTodo size={20} />
                  <h3 className="text-base font-extrabold text-[#0b1c30]">Task Đề Xuất Từ AI ({tasksList.length})</h3>
                </div>

                {tasksList.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Global Apply Project SearchableSelect */}
                    {taskProjectOptions.length > 0 && (
                      <div className="flex items-center gap-1.5 min-w-[200px]">
                        <span className="hidden sm:inline text-xs font-semibold text-[#475569] shrink-0">Gán tất cả:</span>
                        <SearchableSelect
                          label="dự án"
                          options={taskProjectOptions.map((p: any) => ({ id: p.id, name: p.name }))}
                          value=""
                          onChange={(val: any) => {
                            const pid = Number(val);
                            if (!pid) return;
                            const updated: Record<number, number> = {};
                            tasksList.forEach((_, i) => { updated[i] = pid; });
                            setTaskProjectsMap(updated);
                            // Phase/Task cha thuộc về 1 project cụ thể — đổi project hàng
                            // loạt thì phải reset hết, tránh giữ lại lựa chọn của dự án cũ.
                            setTaskPhaseMap({});
                            setTaskGroupMap({});
                          }}
                          placeholder="Gõ tìm & gán tất cả..."
                          searchThreshold={0}
                          className="w-48 sm:w-56"
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handlePushTasks}
                      disabled={isPushing}
                      className="px-5 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] disabled:bg-slate-300 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-2"
                    >
                      {isPushing ? 'Đang push task...' : pushedSuccess ? '✓ Đã push task thành công!' : '📥 Đẩy task đã chọn vào Dự án'}
                    </button>
                  </div>
                )}
              </div>

              {tasksList.length > 0 && (
                <p className="text-xs text-[#64748b]">
                  Đã nhận diện <b className="text-[#0b1c30]">{tasksList.length} task</b> từ AI Summary.
                  {tasksNeedingReviewCount > 0 ? (
                    <> Các ô <span className="text-red-500 font-bold">viền đỏ</span> cần chọn/nhập lại trước khi push — <b className="text-red-500">{tasksNeedingReviewCount}/{tasksList.length} task</b>.</>
                  ) : (
                    <> Tất cả task đã đủ thông tin, sẵn sàng push.</>
                  )}
                </p>
              )}

              {tasksList.length > 0 ? (
                <div className="space-y-4">
                  {tasksList.map((t, idx) => {
                    const isChecked = taskCheckedMap[idx] !== false;
                    const currentTaskProjectId = taskProjectsMap[idx] || localProjectId || meeting.project_id || '';
                    const edit = taskEditMap[idx] || {};
                    const detailValue = edit.detail_task ?? (t.detail_task || t.title || t.name || '');
                    const priorityValue = edit.priority ?? (t.priority || 'Normal');
                    const mandayValue = edit.manday_est ?? (t.manday_est ?? '');
                    const currentAssignee = taskAssigneeMap[idx] ?? matchAccountByName(t.owner || t.assigned_name);
                    const currentPhase = taskPhaseMap[idx];
                    const endDate = getEstimatedEndDate(edit.start_date, mandayValue);
                    const fieldLabelCls = "block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1";

                    return (
                      <div key={idx} className={`border rounded-2xl p-4 transition-all ${isChecked ? 'border-[#cbd5e1] bg-white shadow-2xs' : 'border-slate-200 opacity-50 bg-slate-50'}`}>
                        {/* Header: checkbox + Detail Task */}
                        <div className="flex items-start gap-3 mb-4">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => setTaskCheckedMap(prev => ({ ...prev, [idx]: e.target.checked }))}
                            className="w-4 h-4 mt-1.5 text-[#6366f1] rounded border-slate-300 focus:ring-[#6366f1] cursor-pointer shrink-0"
                            title="Chọn task để đẩy vào dự án"
                          />
                          <div className="flex-1 min-w-0">
                            <label className={fieldLabelCls}>Detail Task</label>
                            <input
                              type="text"
                              value={detailValue}
                              onChange={(e) => setTaskEditMap(prev => ({ ...prev, [idx]: { ...prev[idx], detail_task: e.target.value } }))}
                              className="w-full px-2.5 py-1.5 text-sm font-bold text-[#0b1c30] border border-[#cbd5e1] rounded-lg focus:outline-none focus:border-[#6366f1]"
                            />
                            {t.kpi_output && (
                              <p className="text-[11px] text-[#94a3b8] mt-1.5 leading-relaxed">
                                <b className="text-[#64748b]">KPI/Output (AI):</b> {t.kpi_output}
                              </p>
                            )}
                            {t.deadline && (
                              <p className="text-[11px] text-[#94a3b8]">📅 AI gợi ý hạn: {t.deadline}</p>
                            )}
                          </div>
                        </div>

                        {/* Field grid — tự xuống dòng theo bề rộng màn hình, không cuộn ngang */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          <div>
                            <label className={fieldLabelCls}>Priority</label>
                            <select
                              value={priorityValue}
                              onChange={(e) => setTaskEditMap(prev => ({ ...prev, [idx]: { ...prev[idx], priority: e.target.value } }))}
                              className="text-xs border border-[#cbd5e1] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[#6366f1] w-full"
                            >
                              <option value="Critical">Critical</option>
                              <option value="High">High</option>
                              <option value="Normal">Normal</option>
                            </select>
                          </div>

                          <div>
                            <label className={fieldLabelCls}>Manday Est</label>
                            <input
                              type="number"
                              min={0}
                              step={0.25}
                              value={mandayValue}
                              onChange={(e) => setTaskEditMap(prev => ({ ...prev, [idx]: { ...prev[idx], manday_est: e.target.value } }))}
                              placeholder="—"
                              className="text-xs border border-[#cbd5e1] rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-[#6366f1]"
                            />
                          </div>

                          <div>
                            <label className={fieldLabelCls}>Start Date</label>
                            <input
                              type="date"
                              value={edit.start_date ?? ''}
                              onChange={(e) => setTaskEditMap(prev => ({ ...prev, [idx]: { ...prev[idx], start_date: e.target.value } }))}
                              className={`text-xs border rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-[#6366f1] ${edit.start_date ? 'border-[#cbd5e1]' : 'border-red-400'}`}
                            />
                            {endDate && <p className="text-[10px] text-[#94a3b8] mt-1">→ Kết thúc dự kiến: {endDate}</p>}
                          </div>

                          <div>
                            <label className={fieldLabelCls}>Assigned</label>
                            <SearchableSelect
                              label="người thực hiện"
                              options={accountsList.map((a: any) => ({ id: a.id, name: a.full_name || a.display_name || a.email || `#${a.id}` }))}
                              value={currentAssignee?.id || ''}
                              onChange={(val: any) => {
                                const aid = Number(val);
                                const found = accountsList.find((a: any) => a.id === aid);
                                setTaskAssigneeMap(prev => ({ ...prev, [idx]: found ? { id: found.id, name: found.full_name || found.display_name || found.email } : undefined }));
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
                              options={accountsList.map((a: any) => ({ id: a.id, name: a.full_name || a.display_name || a.email || `#${a.id}` }))}
                              value={taskSupportMap[idx]?.id || ''}
                              onChange={(val: any) => {
                                const aid = Number(val);
                                const found = accountsList.find((a: any) => a.id === aid);
                                setTaskSupportMap(prev => ({ ...prev, [idx]: found ? { id: found.id, name: found.full_name || found.display_name || found.email } : undefined }));
                              }}
                              placeholder="Không bắt buộc..."
                              searchThreshold={0}
                              className="w-full"
                            />
                          </div>

                          <div>
                            <label className={fieldLabelCls}>Skill Solution</label>
                            <SearchableSelect
                              label="skill solution"
                              options={allSkillGroups.map((g: any) => ({ id: g.id, name: g.name }))}
                              value={taskSkillSolutionMap[idx]?.id || ''}
                              onChange={(val: any) => {
                                const gid = Number(val);
                                const found = allSkillGroups.find((g: any) => g.id === gid);
                                setTaskSkillSolutionMap(prev => ({ ...prev, [idx]: found ? { id: found.id, name: found.name } : undefined }));
                                setTaskSkillVendorMap(prev => ({ ...prev, [idx]: undefined }));
                              }}
                              placeholder="Gõ tìm..."
                              searchThreshold={0}
                              className={`w-full ${taskSkillSolutionMap[idx] ? '' : 'ring-2 ring-red-400 rounded-lg'}`}
                            />
                          </div>

                          <div>
                            <label className={fieldLabelCls}>Skill Vendor</label>
                            <SearchableSelect
                              label="skill vendor"
                              options={getSkillVendorsForGroup(taskSkillSolutionMap[idx]?.id).map((s: any) => ({ id: s.id, name: s.name }))}
                              value={taskSkillVendorMap[idx]?.id || ''}
                              onChange={(val: any) => {
                                const sid = Number(val);
                                const found = getSkillVendorsForGroup(taskSkillSolutionMap[idx]?.id).find((s: any) => s.id === sid);
                                setTaskSkillVendorMap(prev => ({ ...prev, [idx]: found ? { id: found.id, name: found.name } : undefined }));
                              }}
                              disabled={!taskSkillSolutionMap[idx]}
                              placeholder={taskSkillSolutionMap[idx] ? 'Gõ tìm...' : 'Chọn Skill Solution trước'}
                              searchThreshold={0}
                              className={`w-full ${!taskSkillSolutionMap[idx] || taskSkillVendorMap[idx] ? '' : 'ring-2 ring-red-400 rounded-lg'}`}
                            />
                          </div>

                          <div>
                            <label className={fieldLabelCls}>Dự án</label>
                            <SearchableSelect
                              label="dự án"
                              options={taskProjectOptions.map((p: any) => ({ id: p.id, name: p.name }))}
                              value={currentTaskProjectId}
                              onChange={(val: any) => {
                                const pid = Number(val);
                                setTaskProjectsMap(prev => ({ ...prev, [idx]: pid }));
                                // Phase/Task cha thuộc về 1 project cụ thể — đổi project thì reset lại 2 lựa chọn này
                                setTaskPhaseMap(prev => ({ ...prev, [idx]: undefined }));
                                setTaskGroupMap(prev => ({ ...prev, [idx]: undefined }));
                              }}
                              placeholder="Gõ tìm dự án..."
                              searchThreshold={0}
                              className={`w-full ${currentTaskProjectId ? '' : 'ring-2 ring-red-400 rounded-lg'}`}
                            />
                          </div>

                          <div>
                            <label className={fieldLabelCls}>Phase</label>
                            {currentTaskProjectId ? (
                              <PhaseSelectCell
                                projectId={currentTaskProjectId}
                                phase={currentPhase}
                                onPhaseChange={(p) => setTaskPhaseMap(prev => ({ ...prev, [idx]: p }))}
                                onTaskGroupChange={(g) => setTaskGroupMap(prev => ({ ...prev, [idx]: g }))}
                              />
                            ) : (
                              <p className="text-[11px] text-slate-400 py-1.5">Chọn dự án trước</p>
                            )}
                          </div>

                          <div>
                            <label className={fieldLabelCls}>Task cha</label>
                            {currentPhase ? (
                              <TaskGroupSelectCell
                                phase={currentPhase}
                                taskGroup={taskGroupMap[idx]}
                                onTaskGroupChange={(g) => setTaskGroupMap(prev => ({ ...prev, [idx]: g }))}
                              />
                            ) : (
                              <p className="text-[11px] text-slate-400 py-1.5">Chọn phase trước</p>
                            )}
                          </div>
                        </div>

                        {/* Notes — full width */}
                        <div className="mt-3">
                          <label className={fieldLabelCls}>Notes</label>
                          <textarea
                            value={edit.notes ?? (t.kpi_output || '')}
                            onChange={(e) => setTaskEditMap(prev => ({ ...prev, [idx]: { ...prev[idx], notes: e.target.value } }))}
                            rows={2}
                            placeholder="Ghi chú thêm (không bắt buộc)..."
                            className="text-xs border border-[#cbd5e1] rounded-lg px-2.5 py-1.5 w-full focus:outline-none focus:border-[#6366f1] resize-y"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 space-y-3">
                  <div className="w-12 h-12 bg-slate-100 text-[#64748b] rounded-full flex items-center justify-center mx-auto">
                    <ListTodo size={24} />
                  </div>
                  <p className="text-sm font-bold text-[#0b1c30]">Chưa có task đề xuất</p>
                  <p className="text-xs text-[#64748b]">AI chưa phát hiện hành động hoặc công việc cụ thể từ biên bản cuộc họp này.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: BIÊN BẢN (TRANSCRIPT) */}
          {activeTab === 'transcript' && (
            <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0] shadow-2xs space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-[#6366f1]">
                  <FileText size={20} />
                  <h3 className="text-base font-extrabold text-[#0b1c30]">Biên Bản Cuộc Họp (Transcript)</h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyTranscript}
                    disabled={!rawTranscript}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-[#cbd5e1] text-[#475569] text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1.5"
                  >
                    <Copy size={14} />
                    <span>{copiedTranscript ? 'Đã sao chép!' : 'Sao chép'}</span>
                  </button>

                  <button
                    onClick={handleDownloadTranscript}
                    disabled={!rawTranscript}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-[#cbd5e1] text-[#0b1c30] text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1.5"
                  >
                    <Download size={14} />
                    <span>Tải file (.txt)</span>
                  </button>
                </div>
              </div>

              {rawTranscript ? (
                <div className="p-4 bg-[#f8fafc] border border-[#e2e8f0] rounded-2xl text-xs font-mono text-[#334155] whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto select-all">
                  {rawTranscript}
                </div>
              ) : (
                <div className="text-center py-12 space-y-3">
                  <div className="w-12 h-12 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center mx-auto">
                    <FileText size={24} />
                  </div>
                  <p className="text-sm font-bold text-[#0b1c30]">Cuộc họp chưa có file biên bản / Transcript</p>
                  <p className="text-xs text-[#64748b]">Bạn có thể nhấn 'Dán biên bản / Chạy AI' để thêm nội dung cuộc họp.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: HIỆU QUẢ (điểm hiệu quả — deterministic, tính từ dữ liệu thật) */}
          {activeTab === 'score' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 space-y-5">
                <div className="bg-white rounded-2xl p-5 border border-[#e2e8f0] shadow-2xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2 text-[#6366f1]">
                      <Gauge size={18} />
                      <h3 className="text-sm font-extrabold text-[#0b1c30]">Chi tiết điểm hiệu quả</h3>
                    </div>
                    <button
                      type="button"
                      onClick={handleRecalculateScore}
                      disabled={isRecalculatingScore}
                      className="px-3 py-1.5 text-[11px] font-bold text-[#6366f1] border border-[#e0e7ff] bg-[#f5f3ff] hover:bg-[#eee9fe] rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isRecalculatingScore ? '⏳ Đang tính...' : '↻ Tính lại điểm'}
                    </button>
                  </div>

                  {scoreTotal === null ? (
                    <p className="text-xs text-[#64748b]">Chưa có điểm hiệu quả — bấm "Tính lại điểm" để tính từ dữ liệu hiện tại.</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <span className={`text-3xl font-extrabold ${scoreTotal >= 75 ? 'text-emerald-600' : scoreTotal >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                          {scoreTotal}
                        </span>
                        <span className="text-xs text-[#64748b]">/ 100 điểm · {score.score_status === 'final' ? 'Đã chốt' : 'Tạm tính (chờ task tới hạn)'}</span>
                      </div>

                      {[
                        { label: 'Chuẩn bị', value: score.score_prep, max: 25, color: 'bg-[#6366f1]' },
                        { label: 'Điều hành', value: score.score_execution, max: 15, color: 'bg-[#5aa1ed]' },
                        { label: 'Kết quả & KPI Tasks', value: score.score_result, max: 35, color: 'bg-[#07966d]' },
                        { label: 'Thực thi', value: score.score_followthrough, max: 20, color: 'bg-[#f5a542]' },
                        { label: 'Phản hồi', value: score.score_feedback, max: 5, color: 'bg-[#37b792]' },
                      ].map(row => (
                        <div key={row.label} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-bold text-[#475569]">
                            <span>{row.label}</span>
                            <span>{row.value ?? 0}/{row.max}</span>
                          </div>
                          <ProgressBar value={((row.value ?? 0) / row.max) * 100} color={row.color} showLabel={false} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl p-5 border border-[#e2e8f0] shadow-2xs space-y-3">
                  <h3 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider">Đồng bộ KPI Tasks</h3>
                  {tasksList.length === 0 ? (
                    <p className="text-xs text-[#64748b]">Chưa có task sau họp.</p>
                  ) : (
                    <div className="space-y-2">
                      {tasksList.map((t: any, idx: number) => {
                        const synced = Boolean(t.imported_task_id || t.kpi_task_id);
                        const pushed = Boolean(t.ai_task_inbox_id);
                        return (
                          <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                            <span className="font-semibold text-[#0b1c30] truncate pr-3">{t.detail_task || t.title || t.name}</span>
                            {synced ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 shrink-0">✓ Đã vào KPI Tasks</span>
                            ) : pushed ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 shrink-0">! Chờ import ở Project</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 shrink-0">× Chưa push</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-4">
                <div className="bg-white rounded-2xl p-5 border border-[#e2e8f0] shadow-2xs space-y-3">
                  <h3 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider">Đánh giá nhanh</h3>
                  <p className="text-[11px] text-[#64748b]">Cuộc họp này có hữu ích với bạn không?</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSubmitFeedback(true)}
                      disabled={feedbackSubmitting}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-colors disabled:opacity-50 ${
                        feedbackChoice === 'helpful' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-[#cbd5e1] text-[#475569] hover:bg-slate-50'
                      }`}
                    >
                      <ThumbsUp size={14} /> Hữu ích
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSubmitFeedback(false)}
                      disabled={feedbackSubmitting}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-colors disabled:opacity-50 ${
                        feedbackChoice === 'not_helpful' ? 'bg-red-50 border-red-300 text-red-700' : 'border-[#cbd5e1] text-[#475569] hover:bg-slate-50'
                      }`}
                    >
                      <ThumbsDown size={14} /> Chưa hữu ích
                    </button>
                  </div>
                  {feedbackChoice && <p className="text-[11px] text-emerald-600 font-semibold">✓ Đã ghi nhận phản hồi.</p>}
                </div>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* Toast Notification Banner */}
      {toastText && (
        <div className="fixed top-6 right-6 z-[99] bg-[#0b1c30] text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-bold border border-slate-700 animate-in fade-in slide-in-from-top-3 duration-200">
          <Check size={18} className="text-emerald-400" />
          <span>{toastText}</span>
        </div>
      )}

      {/* Gán Dự Án Modal */}
      {isAssignProjectOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-extrabold text-[#0b1c30] flex items-center gap-2">
                <span>📁 Gán dự án cho cuộc họp</span>
              </h3>
              <button onClick={() => setIsAssignProjectOpen(false)} className="text-[#94a3b8] hover:text-[#0b1c30] text-xs font-bold">✕</button>
            </div>

            <div className="relative">
              <Search size={15} className="absolute left-3 top-2.5 text-[#94a3b8]" />
              <input
                type="text"
                placeholder="Tìm tên dự án..."
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs text-[#0b1c30] focus:outline-none focus:border-[#6366f1]"
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1.5 pt-1">
              {projectsList.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">Đang tải danh sách dự án...</p>
              ) : (
                projectsList
                  .filter(p => (p.name || '').toLowerCase().includes(projectSearch.toLowerCase()))
                  .map(proj => (
                    <button
                      key={proj.id}
                      disabled={isAssigningProject}
                      onClick={() => handleSelectProject(proj)}
                      className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-[#f5f3ff] transition-all flex items-center justify-between border border-transparent hover:border-[#e0e7ff] text-xs"
                    >
                      <div>
                        <p className="font-bold text-[#0b1c30]">{proj.name}</p>
                        <p className="text-[10px] text-[#64748b]">{proj.code || proj.customer_name || 'Dự án hệ thống'}</p>
                      </div>
                      <span className="text-xs font-bold text-[#6366f1]">Chọn →</span>
                    </button>
                  ))
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={() => setIsAssignProjectOpen(false)} className="px-4 py-2 text-xs font-bold text-[#64748b] bg-white border border-[#cbd5e1] hover:bg-slate-50 rounded-xl transition-colors">
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thêm Thành Viên Modal (Multi-Select Supported) */}
      {isAddMemberOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4 border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-[#0b1c30] flex items-center gap-2">
                  <Users size={18} className="text-[#6366f1]" />
                  <span>Thêm thành viên tham dự (Chọn nhiều)</span>
                </h3>
                <p className="text-[11px] text-[#64748b] mt-0.5">Tích chọn nhiều nhân sự công ty hoặc tự nhập tên người ngoài</p>
              </div>
              <button onClick={() => setIsAddMemberOpen(false)} className="text-[#94a3b8] hover:text-[#0b1c30] text-xs font-bold p-1">✕</button>
            </div>

            <form onSubmit={handleAddMemberSubmit} className="space-y-4">
              {/* Search Input */}
              <div className="relative">
                <Search size={15} className="absolute left-3 top-2.5 text-[#94a3b8]" />
                <input
                  type="text"
                  placeholder="Tìm tên hoặc email nhân sự..."
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs text-[#0b1c30] focus:outline-none focus:border-[#6366f1]"
                />
              </div>

              {/* Staff Multi-Select List */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-bold text-[#64748b] uppercase">Danh sách nhân sự công ty</label>
                  <span className="text-[11px] font-bold text-[#6366f1]">Đã chọn: {selectedMemberNames.length} người</span>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1 p-2 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl">
                  {accountsList.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">Đang tải danh sách nhân sự...</p>
                  ) : (
                    accountsList
                      .filter(acc => {
                        const name = acc.full_name || acc.display_name || acc.email || '';
                        return name.toLowerCase().includes(memberSearch.toLowerCase());
                      })
                      .map((acc, idx) => {
                        const name = acc.full_name || acc.display_name || acc.email || `Nhân sự #${acc.id}`;
                        const isChecked = selectedMemberNames.includes(name);
                        const isAlreadyInMeeting = localMembers.some(m => (m.display_name || m.name) === name);

                        return (
                          <label
                            key={acc.id || idx}
                            className={`flex items-center justify-between p-2 rounded-lg transition-all text-xs cursor-pointer ${
                              isAlreadyInMeeting 
                                ? 'opacity-50 bg-slate-100 cursor-not-allowed'
                                : isChecked 
                                ? 'bg-[#f5f3ff] border border-[#e0e7ff] text-[#4338ca]' 
                                : 'hover:bg-white text-[#0b1c30]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                disabled={isAlreadyInMeeting}
                                checked={isChecked || isAlreadyInMeeting}
                                onChange={() => !isAlreadyInMeeting && toggleSelectMember(name)}
                                className="w-4 h-4 text-[#6366f1] rounded border-slate-300 focus:ring-[#6366f1] cursor-pointer"
                              />
                              <div className="w-7 h-7 rounded-full bg-[#e0e7ff] text-[#4338ca] font-bold text-[10px] flex items-center justify-center shrink-0">
                                {name[0]?.toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold truncate leading-tight">{name}</p>
                                <p className="text-[10px] text-[#64748b] truncate">{acc.email || acc.role || 'Thành viên công ty'}</p>
                              </div>
                            </div>
                            {isAlreadyInMeeting && (
                              <span className="text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-md">Đã tham gia</span>
                            )}
                          </label>
                        );
                      })
                  )}
                </div>
              </div>

              {/* Custom External Name Input */}
              <div>
                <label className="block text-[10px] font-bold text-[#64748b] uppercase mb-1">Hoặc tự nhập tên người ngoài (Nếu có)</label>
                <input
                  type="text"
                  placeholder="Nhập tên người tham dự ngoài công ty..."
                  value={customMemberInput}
                  onChange={e => setCustomMemberInput(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs text-[#0b1c30] focus:outline-none focus:border-[#6366f1]"
                />
              </div>

              {/* Role Select */}
              <div>
                <label className="block text-[10px] font-bold text-[#64748b] uppercase mb-1">Vai trò cho các thành viên được chọn</label>
                <select
                  value={memberRole}
                  onChange={e => setMemberRole(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs text-[#0b1c30] font-medium focus:outline-none focus:border-[#6366f1]"
                >
                  <option value="Thành viên">Thành viên (Participant)</option>
                  <option value="PM / Chủ trì">PM / Chủ trì</option>
                  <option value="Host">Host</option>
                  <option value="Người ghi chép">Người ghi chép</option>
                </select>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-[#6366f1]">
                  Tổng thêm: {selectedMemberNames.length + (customMemberInput.trim() ? 1 : 0)} người
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsAddMemberOpen(false)} className="px-4 py-2 text-xs font-bold text-[#64748b] bg-white border border-[#cbd5e1] hover:bg-slate-50 rounded-xl transition-colors">
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isAddingMember || (selectedMemberNames.length === 0 && !customMemberInput.trim())}
                    className="px-4 py-2 text-xs font-bold text-white bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 rounded-xl transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check size={15} />
                    <span>{isAddingMember ? 'Đang thêm...' : `Xác nhận thêm (${selectedMemberNames.length + (customMemberInput.trim() ? 1 : 0)})`}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


