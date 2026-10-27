'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Video, ExternalLink, Calendar, Clock, User, Sparkles, Check, Plus, MoreHorizontal, Info, FileText, Copy, ListTodo, Search, FolderPlus, Users, Gauge, ThumbsUp, ThumbsDown, X } from 'lucide-react';
import { pushMeetingTasks, getProjects, getAccounts, getMembers, addMeetingMember, updateMeeting, recalculateMeetingScore, submitMeetingFeedback, getCategories, manualEndMeeting, getMeetingAttendance, saveMeetingAttendance, getApiErrorMessage } from '@/lib/api';
import SearchableSelect from '@/components/common/SearchableSelect';
import ProgressBar from '@/components/dashboard/ProgressBar';
import { PhaseSelectCell, TaskGroupSelectCell, PickedRef } from '@/components/common/PhaseTaskGroupSelect';
import { useQueryClient } from '@tanstack/react-query';
import { formatProjectCardTitle } from '@/lib/projectDisplay';

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
  // Build YYYY-MM-DD from LOCAL getters, not .toISOString() — that converts
  // to UTC first, which lands on the previous day in UTC+7 (Vietnam) for any
  // local midnight start, making the previewed end date one day early.
  const yyyy = end.getFullYear();
  const mm = String(end.getMonth() + 1).padStart(2, '0');
  const dd = String(end.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
  onDelete?: (meeting: any) => void;
}

export default function MeetingDetailModal({
  isOpen,
  onClose,
  meeting,
  onEdit,
  onDelete
}: MeetingDetailModalProps) {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'overview' | 'attendance' | 'summary' | 'tasks' | 'transcript' | 'score'>('overview');
  const [isRecalculatingScore, setIsRecalculatingScore] = useState(false);
  const [localScore, setLocalScore] = useState<any>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackChoice, setFeedbackChoice] = useState<'helpful' | 'not_helpful' | null>(null);
  const [isPushing, setIsPushing] = useState(false);
  const [pushedSuccess, setPushedSuccess] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  // Manual-end fallback (chốt 2026-09-14): local override so the status
  // badge/isDone flip immediately after marking DONE by hand, without
  // waiting for the parent to refetch and pass a fresh `meeting` prop —
  // same pattern as localScore below.
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [isEndingMeeting, setIsEndingMeeting] = useState(false);

  // Manual Attendance Phase 1 (chốt 2026-09-15)
  const [attendanceRecorded, setAttendanceRecorded] = useState(false);
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [isLoadingAttendance, setIsLoadingAttendance] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [attendanceDraft, setAttendanceDraft] = useState<Record<number, { status: string; joined_at: string }>>({});
  const [isSavingAttendance, setIsSavingAttendance] = useState(false);

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

  // Real Member roster for the picker (distinct from accountsList/getAccounts()
  // above, which is login Accounts used for task-assignee matching — meeting
  // participants must be real Member.id rows, matching addMeetingMember()'s
  // member_id and the MeetingMember table).
  const [memberOptionsList, setMemberOptionsList] = useState<any[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [customMemberInput, setCustomMemberInput] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberRole, setMemberRole] = useState('Thành viên');
  const [isAddingMember, setIsAddingMember] = useState(false);

  const [toastText, setToastText] = useState<string | null>(null);
  // 'warning' covers add_meeting_member's calendar_synced=false case (feature
  // 009) — Add still succeeded (DB is never rolled back for a Calendar
  // hiccup), so this must read as a caveat, not a failure alert().
  const [toastVariant, setToastVariant] = useState<'success' | 'warning'>('success');

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

  // Skill Area = Group, Skill = Skill nested under it (categories → groups → skills).
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

  // host_google_email is resolved server-side per the meeting's own workspace
  // (its connected WorkspaceGoogleAccount, or that workspace's expected-email
  // hint, or the shared default) — never hard-code an account here.
  const hostGoogleEmail: string = meeting?.host_google_email || 'mkt.szone@gmail.com';
  const creatorName = meeting?.creator_name || meeting?.creator?.display_name || meeting?.created_by_name || `Host ${hostGoogleEmail.split('@')[0]}`;

  // Auto fetch projects list when modal opens
  useEffect(() => {
    if (isOpen) {
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
      // Skill Area / Skill cho bảng Task đề xuất (categories → groups → skills)
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

      // Host tách khỏi participant (chốt 2026-09-13): meeting.members is now
      // only real MeetingMember/custom_members entries (backend no longer
      // injects a synthetic "Người tạo (Host)" row) — Host is shown
      // separately via the "Người tạo / Host" card below, using creatorName.
      setLocalMembers(Array.isArray(meeting.members) ? meeting.members : []);
    }
  }, [meeting]);

  useEffect(() => {
    setLocalScore(null);
    setFeedbackChoice(null);
    setLocalStatus(null);
    // Modal stays mounted across meetings (parent keeps it alive instead of
    // unmounting), and every per-task map below is keyed by array INDEX —
    // without this reset, switching to a different meeting whose task list
    // happens to share indices would show the previous meeting's edits/checks
    // bleeding onto the new one's tasks.
    setActiveTab('overview');
    setTaskEditMap({});
    setTaskCheckedMap({});
    setTaskProjectsMap({});
    setTaskPhaseMap({});
    setTaskGroupMap({});
    setTaskAssigneeMap({});
    setTaskSupportMap({});
    setTaskSkillSolutionMap({});
    setTaskSkillVendorMap({});
  }, [meeting?.id]);

  // Manual Attendance Phase 1 (chốt 2026-09-15): recorded=false from the
  // backend (no MeetingAttendance rows yet) is what drives the empty-state
  // prompt vs the stats+table view — not the meeting's own status, since a
  // DONE meeting can sit unrecorded indefinitely until someone acts on it.
  useEffect(() => {
    if (!meeting?.id) return;
    let cancelled = false;
    setIsLoadingAttendance(true);
    getMeetingAttendance(meeting.id).then((res: any) => {
      if (cancelled) return;
      setAttendanceRecorded(!!res?.recorded);
      setAttendanceRows(Array.isArray(res?.data) ? res.data : []);
    }).catch(() => {}).finally(() => { if (!cancelled) setIsLoadingAttendance(false); });
    return () => { cancelled = true; };
  }, [meeting?.id]);

  if (!isOpen || !meeting) return null;

  const score = localScore || meeting;
  const scoreTotal = score.score_total ?? null;

  const handleRecalculateScore = async () => {
    if (!meeting?.id) return;
    setIsRecalculatingScore(true);
    try {
      const res = await recalculateMeetingScore(meeting.id);
      if (res?.success === false) {
        throw new Error(res?.message || 'Không thể tính lại điểm hiệu quả cuộc họp');
      }
      if (res?.data) {
        setLocalScore(res.data);
        queryClient.setQueryData(['meetings'], (prev: any[] = []) => prev.map(m => m.id === meeting.id ? { ...m, ...res.data } : m));
      }
    } catch (e) {
      console.error('Failed to recalculate meeting score', e);
      triggerToast(getApiErrorMessage(e, 'Không thể tính lại điểm hiệu quả cuộc họp'), 'warning');
    } finally {
      setIsRecalculatingScore(false);
    }
  };

  // Manual-end fallback (chốt 2026-09-14): for when the Meeting Host Bot/VPS
  // is down and a human ended the call by hand on Google Meet. Confirmed via
  // the small inline dialog below rather than routing through a parent-page
  // confirm flow (unlike onDelete) — this action doesn't navigate away or
  // need list-level state, so a self-contained dialog avoids duplicating
  // confirm UI across both pages that render this modal.
  const handleManualEnd = async () => {
    if (!meeting?.id) return;
    setIsEndingMeeting(true);
    try {
      const res = await manualEndMeeting(meeting.id);
      if (res?.success === false) {
        throw new Error(res?.message || 'Không thể đánh dấu kết thúc cuộc họp');
      }
      if (res?.success && res.data) {
        setLocalStatus(res.data.status);
        queryClient.setQueryData(['meetings'], (prev: any[] = []) => prev.map(m => m.id === meeting.id ? { ...m, ...res.data } : m));
      }
      setShowEndConfirm(false);
    } catch (e) {
      console.error('Failed to manually end meeting', e);
      triggerToast(getApiErrorMessage(e, 'Không thể đánh dấu kết thúc cuộc họp'), 'warning');
    } finally {
      setIsEndingMeeting(false);
    }
  };

  const handleSubmitFeedback = async (helpful: boolean) => {
    if (!meeting?.id) return;
    setFeedbackSubmitting(true);
    try {
      const res = await submitMeetingFeedback(meeting.id, { helpful });
      if (res?.success === false) {
        throw new Error(res?.message || 'Không thể gửi phản hồi');
      }
      setFeedbackChoice(helpful ? 'helpful' : 'not_helpful');
      if (res) {
        setLocalScore((prev: any) => ({ ...(prev || meeting), score_feedback: res.score_feedback, score_total: res.score_total }));
      }
    } catch (e) {
      console.error('Failed to submit meeting feedback', e);
      triggerToast(getApiErrorMessage(e, 'Không thể gửi phản hồi'), 'warning');
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

  const statusUpper = String(localStatus || meeting.status || 'UPCOMING').toUpperCase();
  const isDone = statusUpper === 'ĐÃ KẾT THÚC' || statusUpper === 'ĐÃ DIỄN RA' || statusUpper === 'DONE' || statusUpper === 'COMPLETED';

  // meeting_url in DB is SUPPOSED to always stay clean (used for copy/email
  // AND the "Tham gia cuộc họp" join button — chốt 2026-09-13: the user joins
  // with their own Google account, never the Bot's Host account, so the link
  // must never carry authuser=). Some older meetings (created/edited before
  // that guarantee existed) still have authuser baked directly into the
  // stored value, so strip it defensively here rather than trust the DB.
  const rawLink = meeting.meet_link || meeting.link || meeting.meeting_url || meeting.join_url || '';
  const rawLinkWithProtocol = rawLink ? (rawLink.startsWith('http') ? rawLink : `https://${rawLink}`) : 'https://meet.google.com/new';
  const baseLink = (() => {
    try {
      const u = new URL(rawLinkWithProtocol);
      u.searchParams.delete('authuser');
      return u.toString();
    } catch {
      return rawLinkWithProtocol;
    }
  })();

  // Real AI & Summary Data
  const execSummary = meeting.executive_summary || (meeting.ai_summary?.executive_summary) || (Array.isArray(meeting.summary) && meeting.summary.length ? meeting.summary[0] : '');

  const issuesList: string[] = meeting.issues || (meeting.ai_summary?.issues) || [];
  const nextStepsList: string[] = meeting.next_steps || (meeting.ai_summary?.next_steps) || [];
  const tasksList: any[] = score.recommended_tasks || (score.ai_summary?.recommended_tasks) || [];
  // A task carrying ai_task_inbox_id was already pushed (marker written back by
  // push-tasks) — it is locked: unchecked, not editable, never re-sent.
  const isTaskPushed = (t: any) => Boolean(t?.ai_task_inbox_id);
  const isTaskChecked = (t: any, idx: number) => !isTaskPushed(t) && taskCheckedMap[idx] !== false;
  const tasksNeedingReviewCount = tasksList.filter((t: any, idx: number) => {
    if (isTaskPushed(t)) return false;
    const pid = taskProjectsMap[idx] || localProjectId || meeting.project_id || '';
    const assignee = taskAssigneeMap[idx] ?? matchAccountByName(t.owner || t.assigned_name);
    const edit = taskEditMap[idx] || {};
    return !pid || !assignee || !taskPhaseMap[idx] || !taskGroupMap[idx]
      || !edit.start_date || !taskSkillSolutionMap[idx] || !taskSkillVendorMap[idx];
  }).length;
  // Drive recording playback link — distinct from meeting.meeting_url (the
  // meet.google.com JOIN link, already shown separately in the Overview
  // tab). Only n8n's post-meeting sync populates this.
  const summaryVideoLink: string = meeting.ai_summary?.video_link || '';
  const summaryTeamName: string = meeting.team_name || meeting.ai_summary?.team_name || '';
  const summaryOrganizerName: string = meeting.organizer_name || meeting.ai_summary?.organizer_name || '';
  const summaryParticipantCount = meeting.participant_count ?? meeting.ai_summary?.participant_count ?? null;
  const summaryWeekLabel = getIsoWeekNumber(meeting.date || meeting.meeting_date);
  const isAutoCreated: boolean = Boolean(meeting.is_auto_created ?? meeting.ai_summary?.is_auto_created);
  const membersList: any[] = localMembers;

  // Manual Attendance Phase 1 (chốt 2026-09-15): only real MeetingMember rows
  // (member_id set) can be tracked — free-text custom_members guests have no
  // member_id to attach a MeetingAttendance row to.
  const attendanceMembers: any[] = membersList.filter((mb: any) => mb.member_id != null);

  function computeLatePreview(joinedAt: string, startTime: string): string {
    if (!joinedAt || !startTime) return '';
    const [jh, jm] = joinedAt.split(':').map(Number);
    const [sh, sm] = startTime.split(':').map(Number);
    if ([jh, jm, sh, sm].some(n => Number.isNaN(n))) return '';
    const diff = (jh * 60 + jm) - (sh * 60 + sm);
    return diff > 0 ? `Trễ ${diff} phút` : diff === 0 ? 'Đúng giờ' : '';
  }

  const handleOpenAttendanceModal = () => {
    const draft: Record<number, { status: string; joined_at: string }> = {};
    attendanceMembers.forEach((mb: any) => {
      const existing = attendanceRows.find((a: any) => a.member_id === mb.member_id);
      draft[mb.member_id] = {
        status: existing?.status || 'ON_TIME',
        joined_at: existing?.joined_at || '',
      };
    });
    setAttendanceDraft(draft);
    setShowAttendanceModal(true);
  };

  const handleSaveAttendance = async () => {
    if (!meeting?.id) return;
    setIsSavingAttendance(true);
    try {
      const records = attendanceMembers.map((mb: any) => {
        const d = attendanceDraft[mb.member_id] || { status: 'ON_TIME', joined_at: '' };
        return {
          member_id: mb.member_id as number,
          status: d.status as 'ON_TIME' | 'LATE' | 'NO_SHOW',
          joined_at: d.status === 'LATE' ? (d.joined_at || null) : null,
        };
      });
      const res = await saveMeetingAttendance(meeting.id, records);
      if (res?.success === false) {
        throw new Error(res?.message || 'Không thể lưu điểm danh');
      }
      if (res?.success) {
        setAttendanceRows(Array.isArray(res.data) ? res.data : []);
        setAttendanceRecorded(true);
        setShowAttendanceModal(false);
      }
    } catch (e) {
      console.error('Failed to save meeting attendance', e);
      triggerToast(getApiErrorMessage(e, 'Không thể lưu điểm danh'), 'warning');
    } finally {
      setIsSavingAttendance(false);
    }
  };

  const rawTranscript = meeting.transcript || meeting.ai_summary?.transcript || '';

  const isN8nSource = meeting.ai_summary?.source === 'n8n_google_sheet' || meeting.ai_summary?.n8n_metadata;
  const n8nTime = meeting.ai_summary?.n8n_metadata?.received_at || meeting.updated_at || meeting.created_at;

  const triggerToast = (msg: string, variant: 'success' | 'warning' = 'success') => {
    setToastText(msg);
    setToastVariant(variant);
    // Warning stays up longer — it's a caveat the user needs to actually read,
    // not a fire-and-forget confirmation.
    setTimeout(() => setToastText(null), variant === 'warning' ? 6000 : 3000);
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

  // The 4 roles MeetingMember.role actually accepts server-side (add_meeting_member
  // falls back to PARTICIPANT for anything else) — map the Vietnamese dropdown
  // label to the matching backend enum. "Người ghi chép" has no dedicated
  // backend role; PARTICIPANT is the closest fit (an active attendee, not a
  // read-only VIEWER).
  const MEMBER_ROLE_TO_BACKEND: Record<string, string> = {
    'Thành viên': 'PARTICIPANT',
    'PM / Chủ trì': 'PM',
    'Host': 'HOST',
    'Người ghi chép': 'PARTICIPANT',
  };

  const toggleSelectMember = (id: number) => {
    setSelectedMemberIds(prev =>
      prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]
    );
  };

  const handleOpenAddMember = async () => {
    setIsAddMemberOpen(true);
    setSelectedMemberIds([]);
    setCustomMemberInput('');
    setMemberSearch('');
    try {
      const res = await getMembers();
      const items = res?.data || res || [];
      setMemberOptionsList(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const existingMemberIds = new Set(localMembers.map((m: any) => m.member_id).filter((id: any) => id != null));
    const idsToAdd = selectedMemberIds.filter(id => !existingMemberIds.has(id));
    const customName = customMemberInput.trim();

    if (idsToAdd.length === 0 && !customName) {
      alert("Vui lòng chọn ít nhất 1 thành viên hoặc tự nhập tên thành viên!");
      return;
    }

    setIsAddingMember(true);
    try {
      const backendRole = MEMBER_ROLE_TO_BACKEND[memberRole] || 'PARTICIPANT';
      let latest: any = null;
      // calendar_synced only appears on the response when the meeting is
      // ONGOING (feature 009) — UPCOMING adds keep the old silent
      // best-effort sync and never set this field. Adding several members
      // in one submit means checking EVERY response, not just the last one:
      // any single sync failure must still surface the warning.
      let anyCalendarSyncFailed = false;
      for (const memberId of idsToAdd) {
        latest = await addMeetingMember(meeting.id, memberId, backendRole);
        if (latest?.calendar_synced === false) anyCalendarSyncFailed = true;
      }

      if (customName) {
        const existingNames = new Set(localMembers.map((m: any) => m.display_name || m.name));
        if (!existingNames.has(customName)) {
          const customEntries = [...localMembers, { display_name: customName, role: memberRole }];
          latest = await updateMeeting(meeting.id, { members: customEntries });
        }
      }

      if (latest?.data) {
        setLocalMembers(latest.data.members || []);
        meeting.members = latest.data.members;
        queryClient.setQueryData(['meetings'], (prev: any[] = []) =>
          prev.map(m => m.id === meeting.id ? latest.data : m)
        );
      }
      setIsAddMemberOpen(false);
      setSelectedMemberIds([]);
      setCustomMemberInput('');
      const addedCount = idsToAdd.length + (customName ? 1 : 0);
      // calendar_synced=false is NOT a failure — the member IS added (DB is
      // never rolled back for a Calendar hiccup, chốt feature 009), Calendar
      // just hasn't caught up yet. Still says "đã thêm", adds a caveat.
      if (anyCalendarSyncFailed) {
        triggerToast(
          `✓ Đã thêm ${addedCount} thành viên, nhưng Google Calendar chưa được cập nhật. Thành viên có thể chưa tham gia được cuộc họp ngay.`,
          'warning'
        );
      } else {
        triggerToast(`✓ Đã thêm ${addedCount} thành viên tham dự!`);
      }
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Lỗi khi thêm thành viên');
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleCopyLink = () => {
    // Copy the CLEAN meeting_url — recipients pasting this may not be
    // logged into hostGoogleEmail, so a link carrying authuser= would be
    // wrong for them. The join button below uses this exact same clean link.
    if (!baseLink) return;
    navigator.clipboard.writeText(baseLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handlePushTasks = async () => {
    if (!tasksList.length) {
      alert("Cuộc họp này chưa có Task AI đề xuất để push!");
      return;
    }

    const tasksToPush = tasksList
      .map((t: any, idx: number) => {
        // No fallback to "first project in the list" — a task without an
        // explicitly resolved project is blocked below instead of silently
        // landing in an unrelated project.
        const selectedPid = taskProjectsMap[idx] || localProjectId || meeting.project_id || undefined;
        const selectedProj = projectsList.find((p: any) => p.id === selectedPid);
        const phase = taskPhaseMap[idx];
        const taskGroup = taskGroupMap[idx];
        const edit = taskEditMap[idx] || {};
        const assignee = taskAssigneeMap[idx] ?? matchAccountByName(t.owner || t.assigned_name);
        const support = taskSupportMap[idx];
        const skillSolution = taskSkillSolutionMap[idx];
        const skillVendor = taskSkillVendorMap[idx];
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
          // Support/Skill Area/Skill cũng được chọn trực tiếp trên bảng
          // (SearchableSelect) — trước đây bị bỏ sót khỏi payload nên lựa chọn của
          // reviewer luôn bị rơi mất, backend lại tự fallback về Group/Skill đầu
          // tiên trong DB (sai dữ liệu). Giờ gửi kèm để backend dùng đúng lựa chọn.
          support_id: support?.id,
          skill_solution_id: skillSolution?.id,
          skill_vendor_id: skillVendor?.id,
          project_id: selectedPid,
          project_name: selectedProj?.name || t.project_name || localProjectName,
          phase_id: phase?.id,
          phase_name: phase?.name,
          task_group_id: taskGroup?.id,
          task_group_name: taskGroup?.name,
          // Lets the backend write the pushed markers back onto the right
          // entry of ai_summary.recommended_tasks.
          source_index: idx,
          checked: isTaskChecked(t, idx)
        };
      })
      .filter((t: any) => t.checked)
      .map(({ checked: _checked, ...rest }: any) => rest);

    if (tasksToPush.length === 0) {
      alert("Vui lòng chọn ít nhất 1 task chưa đẩy để đẩy vào dự án.");
      return;
    }

    const missingProject = tasksToPush.filter((t: any) => !t.project_id);
    if (missingProject.length > 0) {
      const labels = missingProject.map((t: any) => `• Task #${t.source_index + 1}: ${t.detail_task || '(chưa có tên)'}`).join('\n');
      triggerToast(`Có ${missingProject.length} task chưa chọn Dự án — vui lòng chọn dự án trước khi đẩy.`, 'warning');
      alert(`Vui lòng chọn Dự án cho các task sau trước khi đẩy:\n${labels}`);
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
      const res = await pushMeetingTasks(meeting.id, tasksToPush);
      // Reflect the pushed markers (ai_task_inbox_id/task_code/...) locally via
      // localScore — the `meeting` prop itself is never mutated.
      if (Array.isArray(res?.recommended_tasks)) {
        const updatedTasks = res.recommended_tasks;
        setLocalScore((prev: any) => {
          const base = prev || meeting;
          return {
            ...base,
            recommended_tasks: updatedTasks,
            ai_summary: base.ai_summary ? { ...base.ai_summary, recommended_tasks: updatedTasks } : base.ai_summary,
          };
        });
      }
      // Pushed tasks become non-selectable; drop their stale check state.
      const pushedIdx: number[] = (res?.pushed || []).map((p: any) => p.source_index).filter((i: any) => typeof i === 'number');
      if (pushedIdx.length) {
        setTaskCheckedMap(prev => {
          const next = { ...prev };
          pushedIdx.forEach(i => { delete next[i]; });
          return next;
        });
      }

      const pushedCount: number = res?.pushed_count ?? (res?.pushed?.length || 0);
      const skipped: any[] = Array.isArray(res?.skipped) ? res.skipped : [];
      const baseMsg: string = res?.message || `Đã đẩy ${pushedCount} task vào dự án.`;
      if (skipped.length > 0) {
        const skippedLines = skipped.map((s: any) => {
          const label = typeof s.source_index === 'number' ? `Task #${s.source_index + 1}` : 'Task';
          return `• ${label}${s.detail_task ? ` (${s.detail_task})` : ''}: ${s.reason || 'Bị bỏ qua'}`;
        }).join('\n');
        triggerToast(`${baseMsg}\nBỏ qua ${skipped.length} task:\n${skippedLines}`, 'warning');
      } else {
        triggerToast(`✓ ${baseMsg}`);
      }
      if (pushedCount > 0) {
        setPushedSuccess(true);
        setTimeout(() => setPushedSuccess(false), 3000);
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || "Có lỗi khi push task vào dự án");
    } finally {
      setIsPushing(false);
    }
  };

  const handleCopyTranscript = () => {
    if (!rawTranscript) return;
    navigator.clipboard.writeText(rawTranscript);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 animate-in fade-in duration-200 p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col border border-slate-200 animate-in zoom-in-95 duration-200 max-h-[92vh] my-auto">
        
        {/* Top Header Bar with Back Link */}
        <div className="px-6 pt-5 pb-4 bg-white border-b border-[#e2e8f0]">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#64748b] hover:text-[#0b1c30] transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Quay lại danh sách cuộc họp</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Đóng"
              className="p-1.5 text-[#64748b] hover:text-[#0b1c30] hover:bg-slate-100 rounded-lg transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>

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
                  meeting?.can_manage ? (
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
                    <span className="px-3 py-1 rounded-full text-[11px] font-extrabold bg-[#fef3c7] text-[#92400e] border border-[#f59e0b]/40 flex items-center gap-1.5">
                      ⚠️ Chưa gán Dự án
                    </span>
                  )
                ) : meeting?.can_manage ? (
                  <button
                    type="button"
                    onClick={handleOpenAssignProject}
                    className="px-3 py-1 rounded-full text-[11px] font-bold bg-blue-50 hover:bg-blue-100 text-[#0058be] border border-blue-200 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    title="Bấm để thay đổi dự án"
                  >
                    <span>📁 {projectName}</span>
                    <span className="text-[10px] opacity-75 font-semibold">(Đổi)</span>
                  </button>
                ) : (
                  <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-[#0058be] border border-blue-200 flex items-center gap-1.5">
                    📁 {projectName}
                  </span>
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
                      href={baseLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#6366f1] font-bold hover:underline flex items-center gap-1 text-[11px]"
                      title="Mở Google Meet (link gốc)"
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
                    {onEdit && (
                      <button
                        onClick={() => { setShowMenu(false); onEdit(meeting); }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-[#0b1c30] flex items-center gap-2"
                      >
                        <span>✏️ Chỉnh sửa cuộc họp</span>
                      </button>
                    )}
                    <button
                      onClick={() => { setShowMenu(false); handleCopyLink(); }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-[#6366f1] flex items-center gap-2"
                    >
                      <span>📋 Sao chép link họp</span>
                    </button>
                    {meeting?.can_manage && statusUpper.includes('DIỄN RA') && (
                      <button
                        onClick={() => { setShowMenu(false); setShowEndConfirm(true); }}
                        className="w-full text-left px-3.5 py-2 hover:bg-amber-50 text-amber-700 flex items-center gap-2 border-t border-slate-100"
                        title="Fallback khi Bot/VPS không tự động báo kết thúc được"
                      >
                        <span>✅ Đánh dấu đã kết thúc</span>
                      </button>
                    )}
                    {onDelete && (
                      <button
                        onClick={() => { setShowMenu(false); onDelete(meeting); }}
                        className="w-full text-left px-3.5 py-2 hover:bg-red-50 text-red-600 flex items-center gap-2 border-t border-slate-100"
                      >
                        <span>🗑️ Xóa cuộc họp</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <a
                href={baseLink}
                target="_blank"
                rel="noreferrer"
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-2"
                title="Vào Google Meet"
              >
                <Video size={16} />
                <span>Tham gia cuộc họp</span>
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
              onClick={() => setActiveTab('attendance')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'attendance' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              Tham gia
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
                        {meeting?.can_manage && (
                          <button
                            type="button"
                            onClick={handleOpenAssignProject}
                            className="px-3 py-1.5 text-xs font-extrabold text-[#6366f1] bg-[#f5f3ff] hover:bg-[#6366f1] hover:text-white border border-[#c7d2fe] hover:border-[#6366f1] rounded-xl transition-all shadow-2xs cursor-pointer flex items-center gap-1.5 active:scale-95"
                          >
                            <FolderPlus size={14} />
                            <span>{isUnassignedProject ? '+ Gán Dự Án Ngay' : 'Đổi Dự Án'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Nguồn dữ liệu</span>
                      <span className="px-2.5 py-1 rounded-lg bg-[#ccfbf1] text-[#0f766e] font-bold text-[11px] inline-block">
                        {isN8nSource ? 'Tự động / Webhook' : 'Trực tiếp / Hệ thống'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Host</span>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-200 text-[#475569] font-bold text-[10px] flex items-center justify-center">
                          {hostGoogleEmail[0]?.toUpperCase()}
                        </div>
                        <span className="font-bold text-[#0b1c30]">{hostGoogleEmail}</span>
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

                </div>

                {/* Card 2: Thành viên tham dự */}
                <div className="bg-white rounded-2xl p-5 border border-[#e2e8f0] shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider">
                      Thành viên tham dự ({membersList.length} người)
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
                      <p className="text-xs text-[#94a3b8] italic">Chưa có thành viên tham gia được thêm vào cuộc họp này.</p>
                    )}

                    {meeting?.can_manage && (
                      <button
                        onClick={handleOpenAddMember}
                        className="w-9 h-9 rounded-full border-2 border-dashed border-[#cbd5e1] hover:border-[#6366f1] text-[#64748b] hover:text-[#6366f1] font-bold text-xs flex items-center justify-center transition-colors cursor-pointer"
                        title="Thêm thành viên tham dự"
                      >
                        <Plus size={16} />
                      </button>
                    )}
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

              {/* Right Column: NỘI DUNG CUỘC HỌP Widget (5 Cols ~ 40%) */}
              <div className="lg:col-span-5">
                <div className="bg-white rounded-2xl p-5 border border-[#e0e7ff] shadow-sm space-y-4 sticky top-4">

                  {/* Widget Header */}
                  <div className="flex items-center gap-1.5 text-[#6366f1]">
                    <FileText size={16} />
                    <h3 className="text-xs font-extrabold uppercase tracking-wider">Nội dung cuộc họp</h3>
                  </div>

                  {/* Section 1: MỤC TIÊU & KẾT QUẢ MONG ĐỢI */}
                  <div className="space-y-1.5">
                    <h4 className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#6366f1]"></span>
                      Mục tiêu & kết quả mong đợi
                    </h4>
                    {meeting.objective ? (
                      <p className="text-xs text-[#334155] leading-relaxed font-normal bg-[#f8f6ff] p-3 rounded-xl border border-[#eee9fe] whitespace-pre-wrap">
                        {meeting.objective}
                      </p>
                    ) : (
                      <p className="text-xs text-[#94a3b8] italic bg-slate-50 p-3 rounded-xl border border-slate-200">
                        Chưa nhập mục tiêu cho cuộc họp này.
                      </p>
                    )}
                  </div>

                  {/* Section 2: AGENDA / VẤN ĐỀ CẦN XỬ LÝ */}
                  <div className="space-y-1.5">
                    <h4 className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      Agenda / vấn đề cần xử lý
                    </h4>
                    {meeting.agenda ? (
                      <p className="text-xs text-[#334155] leading-relaxed font-normal bg-[#f8fafc] p-3 rounded-xl border border-[#e2e8f0] whitespace-pre-wrap">
                        {meeting.agenda}
                      </p>
                    ) : (
                      <p className="text-xs text-[#94a3b8] italic bg-slate-50 p-3 rounded-xl border border-slate-200">
                        Chưa nhập agenda cho cuộc họp này.
                      </p>
                    )}
                  </div>

                </div>
              </div>

            </div>
          )}

          {/* TAB: THAM GIA (Manual Attendance Phase 1, chốt 2026-09-15) */}
          {activeTab === 'attendance' && (
            <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0] shadow-2xs">
              {statusUpper.includes('SẮP TỚI') ? (
                <div className="text-center py-12">
                  <Users size={40} className="mx-auto text-[#cbd5e1] mb-3" />
                  <p className="text-sm font-bold text-[#0b1c30]">Cuộc họp chưa diễn ra</p>
                  <p className="text-xs text-[#94a3b8] mt-1">Sẽ có thể ghi nhận tham gia sau khi cuộc họp kết thúc.</p>
                </div>
              ) : statusUpper.includes('DIỄN RA') ? (
                <div className="text-center py-12">
                  <Users size={40} className="mx-auto text-[#cbd5e1] mb-3" />
                  <p className="text-sm font-bold text-[#0b1c30]">Cuộc họp chưa kết thúc</p>
                  <p className="text-xs text-[#94a3b8] mt-1">Chưa thể ghi nhận tham gia khi cuộc họp đang diễn ra.</p>
                </div>
              ) : statusUpper.includes('HỦY') ? (
                <div className="text-center py-12">
                  <Users size={40} className="mx-auto text-[#cbd5e1] mb-3" />
                  <p className="text-sm font-bold text-[#0b1c30]">Cuộc họp đã hủy</p>
                  <p className="text-xs text-[#94a3b8] mt-1">Không áp dụng ghi nhận tham gia cho cuộc họp đã hủy.</p>
                </div>
              ) : isLoadingAttendance ? (
                <p className="text-xs text-[#94a3b8] text-center py-12">Đang tải...</p>
              ) : attendanceMembers.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-xs text-[#94a3b8]">Không có thành viên nào để ghi nhận tham gia.</p>
                </div>
              ) : !attendanceRecorded ? (
                <div className="text-center py-12">
                  <Users size={40} className="mx-auto text-[#6366f1] mb-3" />
                  <p className="text-sm font-extrabold text-[#0b1c30] tracking-wide">GHI NHẬN THAM GIA</p>
                  <p className="text-xs text-[#64748b] mt-2 max-w-sm mx-auto leading-relaxed">
                    Cuộc họp đã kết thúc. Hãy ghi nhận tình trạng tham gia của các thành viên.
                  </p>
                  <p className="text-xs font-bold text-[#0b1c30] mt-3">{attendanceMembers.length} thành viên cần ghi nhận</p>
                  {meeting?.can_manage && (
                    <button
                      onClick={handleOpenAttendanceModal}
                      className="mt-4 px-5 py-2.5 bg-[#6366f1] text-white text-xs font-bold rounded-xl hover:bg-[#4f46e5] transition-colors"
                    >
                      Ghi nhận tham gia
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider">Tình hình tham gia</h3>
                    {meeting?.can_manage && (
                      <button onClick={handleOpenAttendanceModal} className="text-[11px] font-bold text-[#6366f1] hover:underline">
                        Chỉnh sửa
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-3 mb-5">
                    <div className="p-3 bg-slate-50 rounded-xl text-center">
                      <p className="text-lg font-extrabold text-[#0b1c30]">{attendanceRows.length}</p>
                      <p className="text-[10px] text-[#64748b] mt-0.5">Thành viên</p>
                    </div>
                    <div className="p-3 bg-emerald-50 rounded-xl text-center">
                      <p className="text-lg font-extrabold text-emerald-700">{attendanceRows.filter((a: any) => a.status === 'ON_TIME').length}</p>
                      <p className="text-[10px] text-emerald-700 mt-0.5">Đúng giờ</p>
                    </div>
                    <div className="p-3 bg-amber-50 rounded-xl text-center">
                      <p className="text-lg font-extrabold text-amber-700">{attendanceRows.filter((a: any) => a.status === 'LATE').length}</p>
                      <p className="text-[10px] text-amber-700 mt-0.5">Tham gia trễ</p>
                    </div>
                    <div className="p-3 bg-red-50 rounded-xl text-center">
                      <p className="text-lg font-extrabold text-red-700">{attendanceRows.filter((a: any) => a.status === 'NO_SHOW').length}</p>
                      <p className="text-[10px] text-red-700 mt-0.5">Không tham gia</p>
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[#94a3b8] border-b border-[#e2e8f0]">
                        <th className="pb-2 font-bold">Thành viên</th>
                        <th className="pb-2 font-bold">Thời gian tham gia</th>
                        <th className="pb-2 font-bold">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendanceMembers.map((mb: any) => {
                        const rec = attendanceRows.find((a: any) => a.member_id === mb.member_id);
                        const name = mb.display_name || 'Thành viên';
                        const label = rec?.status === 'ON_TIME' ? 'Đúng giờ'
                          : rec?.status === 'LATE' ? (rec.late_minutes != null ? `Trễ ${rec.late_minutes} phút` : 'Tham gia trễ')
                          : 'Không tham gia';
                        const dotColor = rec?.status === 'ON_TIME' ? 'bg-emerald-500' : rec?.status === 'LATE' ? 'bg-amber-500' : 'bg-red-500';
                        const textColor = rec?.status === 'ON_TIME' ? 'text-emerald-700' : rec?.status === 'LATE' ? 'text-amber-700' : 'text-red-700';
                        const timeDisplay = rec?.status === 'NO_SHOW' ? '—' : (rec?.joined_at || (rec?.status === 'ON_TIME' ? (meeting.time || meeting.start_time || '—') : '—'));
                        return (
                          <tr key={mb.member_id} className="border-b border-[#f1f5f9] last:border-0">
                            <td className="py-2.5 font-bold text-[#0b1c30]">{name}</td>
                            <td className="py-2.5 text-[#64748b]">{timeDisplay}</td>
                            <td className="py-2.5">
                              <span className={`inline-flex items-center gap-1.5 font-bold ${textColor}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>
                                {label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
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
                      {summaryVideoLink ? (
                        <a href={summaryVideoLink} target="_blank" rel="noreferrer" className="text-[#6366f1] font-bold mt-0.5 hover:underline break-all block">
                          {summaryVideoLink}
                        </a>
                      ) : (
                        <p className="text-[#0b1c30] font-bold mt-0.5">Chưa có bản ghi</p>
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
                  <p className="text-xs text-[#64748b]">AI Summary sẽ tự động xuất hiện sau khi Bot xử lý xong cuộc họp và biên bản được đồng bộ.</p>
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
                    const isPushed = isTaskPushed(t);
                    const isChecked = isTaskChecked(t, idx);
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
                      <div key={idx} className={`border rounded-2xl p-4 transition-all ${isPushed ? 'border-emerald-200 bg-emerald-50/40' : isChecked ? 'border-[#cbd5e1] bg-white shadow-2xs' : 'border-slate-200 opacity-50 bg-slate-50'}`}>
                        {/* Header: checkbox + Detail Task */}
                        <div className="flex items-start gap-3 mb-4">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isPushed}
                            onChange={(e) => setTaskCheckedMap(prev => ({ ...prev, [idx]: e.target.checked }))}
                            className="w-4 h-4 mt-1.5 text-[#6366f1] rounded border-slate-300 focus:ring-[#6366f1] cursor-pointer disabled:cursor-not-allowed shrink-0"
                            title={isPushed ? 'Task đã được đẩy vào dự án' : 'Chọn task để đẩy vào dự án'}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <label className={fieldLabelCls}>Detail Task</label>
                              {isPushed && (
                                <span className="px-2 py-0.5 mb-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 shrink-0">
                                  ✓ Đã đẩy{t.task_code ? ` · ${t.task_code}` : ''}
                                </span>
                              )}
                            </div>
                            <input
                              type="text"
                              value={detailValue}
                              disabled={isPushed}
                              onChange={(e) => setTaskEditMap(prev => ({ ...prev, [idx]: { ...prev[idx], detail_task: e.target.value } }))}
                              className="w-full px-2.5 py-1.5 text-sm font-bold text-[#0b1c30] border border-[#cbd5e1] rounded-lg focus:outline-none focus:border-[#6366f1] disabled:bg-slate-50 disabled:text-slate-500"
                            />
                            {!isPushed && !currentTaskProjectId && (
                              <p className="text-[11px] font-semibold text-red-500 mt-1">⚠ Chưa chọn Dự án — chọn dự án ở ô &quot;Dự án&quot; bên dưới trước khi đẩy task này.</p>
                            )}
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

                        {/* Pushed tasks are read-only: fieldset disables native controls,
                            pointer-events-none also blocks the custom select cells. */}
                        <fieldset disabled={isPushed} className={`min-w-0 ${isPushed ? 'pointer-events-none opacity-60' : ''}`}>
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
                            <label className={fieldLabelCls}>Skill Area</label>
                            <SearchableSelect
                              label="skill area"
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
                            <label className={fieldLabelCls}>Skill</label>
                            <SearchableSelect
                              label="skill"
                              options={getSkillVendorsForGroup(taskSkillSolutionMap[idx]?.id).map((s: any) => ({ id: s.id, name: s.name }))}
                              value={taskSkillVendorMap[idx]?.id || ''}
                              onChange={(val: any) => {
                                const sid = Number(val);
                                const found = getSkillVendorsForGroup(taskSkillSolutionMap[idx]?.id).find((s: any) => s.id === sid);
                                setTaskSkillVendorMap(prev => ({ ...prev, [idx]: found ? { id: found.id, name: found.name } : undefined }));
                              }}
                              disabled={!taskSkillSolutionMap[idx]}
                              placeholder={taskSkillSolutionMap[idx] ? 'Gõ tìm...' : 'Chọn Skill Area trước'}
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
                        </fieldset>
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
                  <p className="text-xs text-[#64748b]">Biên bản sẽ tự động được đồng bộ sau khi cuộc họp kết thúc.</p>
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
        <div className="fixed top-6 right-6 z-[99] bg-[#0b1c30] text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-bold border border-slate-700 animate-in fade-in slide-in-from-top-3 duration-200 max-w-sm">
          {toastVariant === 'warning' ? (
            <Info size={18} className="text-amber-400 shrink-0" />
          ) : (
            <Check size={18} className="text-emerald-400 shrink-0" />
          )}
          <span className="whitespace-pre-line">{toastText}</span>
        </div>
      )}

      {/* Gán Dự Án Modal */}
      {isAssignProjectOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4 animate-in fade-in duration-150">
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
                        <p className="font-bold text-[#0b1c30]">{formatProjectCardTitle(proj)}</p>
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

      {/* Manual-end fallback confirm (chốt 2026-09-14) */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4 border border-slate-200 animate-in zoom-in-95 duration-150">
            <h3 className="text-sm font-extrabold text-[#0b1c30]">Bạn có chắc cuộc họp đã kết thúc?</h3>
            <p className="text-xs text-[#64748b] leading-relaxed">
              Thao tác này sẽ chuyển trạng thái cuộc họp sang <b>Đã kết thúc</b>. Chỉ dùng khi Bot/VPS không tự động báo kết thúc được và bạn đã tự vào Google Meet để kết thúc cuộc gọi.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowEndConfirm(false)}
                disabled={isEndingMeeting}
                className="px-4 py-2 text-xs font-bold text-[#64748b] bg-white border border-[#cbd5e1] hover:bg-slate-50 rounded-xl transition-colors disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={handleManualEnd}
                disabled={isEndingMeeting}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors disabled:opacity-50"
              >
                {isEndingMeeting ? 'Đang xử lý...' : 'Xác nhận đã kết thúc'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ghi nhận tham gia (Manual Attendance Phase 1, chốt 2026-09-15) */}
      {showAttendanceModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4 border border-slate-200 animate-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <h3 className="text-sm font-extrabold text-[#0b1c30]">Ghi nhận tham gia</h3>
              <button onClick={() => setShowAttendanceModal(false)} className="text-[#94a3b8] hover:text-[#0b1c30] text-xs font-bold p-1">✕</button>
            </div>
            <div className="space-y-3 overflow-y-auto flex-1">
              {attendanceMembers.map((mb: any) => {
                const draft = attendanceDraft[mb.member_id] || { status: 'ON_TIME', joined_at: '' };
                const name = mb.display_name || 'Thành viên';
                const latePreview = draft.status === 'LATE' ? computeLatePreview(draft.joined_at, meeting.time || meeting.start_time || '') : '';
                return (
                  <div key={mb.member_id} className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-[#0b1c30] flex-1 min-w-0 truncate">{name}</span>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <select
                        value={draft.status}
                        onChange={e => setAttendanceDraft(prev => ({ ...prev, [mb.member_id]: { ...draft, status: e.target.value } }))}
                        className="px-2.5 py-1.5 border border-[#c2c6d6] rounded-lg text-[11px] font-bold bg-white focus:outline-none focus:border-[#6366f1]"
                      >
                        <option value="ON_TIME">🟢 Đúng giờ</option>
                        <option value="LATE">🟠 Tham gia trễ</option>
                        <option value="NO_SHOW">🔴 Không tham gia</option>
                      </select>
                      {draft.status === 'LATE' && (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="time"
                            value={draft.joined_at}
                            onChange={e => setAttendanceDraft(prev => ({ ...prev, [mb.member_id]: { ...draft, joined_at: e.target.value } }))}
                            className="px-2 py-1 border border-[#c2c6d6] rounded-lg text-[11px]"
                          />
                          {latePreview && <span className="text-[10px] text-amber-700 font-bold whitespace-nowrap">{latePreview}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 shrink-0">
              <button
                onClick={() => setShowAttendanceModal(false)}
                disabled={isSavingAttendance}
                className="px-4 py-2 text-xs font-bold text-[#64748b] bg-white border border-[#cbd5e1] hover:bg-slate-50 rounded-xl transition-colors disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveAttendance}
                disabled={isSavingAttendance}
                className="px-4 py-2 text-xs font-bold text-white bg-[#6366f1] hover:bg-[#4f46e5] rounded-xl transition-colors disabled:opacity-50"
              >
                {isSavingAttendance ? 'Đang lưu...' : 'Lưu ghi nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thêm Thành Viên Modal (Multi-Select Supported) */}
      {isAddMemberOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4 animate-in fade-in duration-150">
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
                  <span className="text-[11px] font-bold text-[#6366f1]">Đã chọn: {selectedMemberIds.length} người</span>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1 p-2 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl">
                  {memberOptionsList.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">Đang tải danh sách nhân sự...</p>
                  ) : (
                    memberOptionsList
                      .filter(mo => {
                        const name = mo.full_name || mo.display_name || mo.email || '';
                        return name.toLowerCase().includes(memberSearch.toLowerCase());
                      })
                      .map((mo, idx) => {
                        const name = mo.display_name || mo.full_name || mo.email || `Nhân sự #${mo.id}`;
                        const isChecked = selectedMemberIds.includes(mo.id);
                        const isAlreadyInMeeting = localMembers.some((m: any) => m.member_id === mo.id);

                        return (
                          <label
                            key={mo.id || idx}
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
                                onChange={() => !isAlreadyInMeeting && toggleSelectMember(mo.id)}
                                className="w-4 h-4 text-[#6366f1] rounded border-slate-300 focus:ring-[#6366f1] cursor-pointer"
                              />
                              <div className="w-7 h-7 rounded-full bg-[#e0e7ff] text-[#4338ca] font-bold text-[10px] flex items-center justify-center shrink-0">
                                {name[0]?.toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold truncate leading-tight">{name}</p>
                                <p className="text-[10px] text-[#64748b] truncate">{mo.email || mo.role || 'Thành viên công ty'}</p>
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
                  Tổng thêm: {selectedMemberIds.length + (customMemberInput.trim() ? 1 : 0)} người
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsAddMemberOpen(false)} className="px-4 py-2 text-xs font-bold text-[#64748b] bg-white border border-[#cbd5e1] hover:bg-slate-50 rounded-xl transition-colors">
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isAddingMember || (selectedMemberIds.length === 0 && !customMemberInput.trim())}
                    className="px-4 py-2 text-xs font-bold text-white bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 rounded-xl transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check size={15} />
                    <span>{isAddingMember ? 'Đang thêm...' : `Xác nhận thêm (${selectedMemberIds.length + (customMemberInput.trim() ? 1 : 0)})`}</span>
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


