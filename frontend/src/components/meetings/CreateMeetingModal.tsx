import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar as CalendarIcon, Sparkles, RefreshCw, Copy, Check, Clipboard } from 'lucide-react';
import { generateMeetingLink, retryMeetingLink, checkMeetingConflict, generateAiMeetingContent, getProjects, getMembers, getProjectMembers, getMeetingHosts, getApiErrorMessage } from '@/lib/api';
import SearchableSelect, { SearchableSelectHandle } from '@/components/common/SearchableSelect';

interface CreateMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (meeting: any) => void | Promise<void>;
  initialData?: any;
}

interface MeetingFormData {
  title: string;
  platform: string;
  date: string;
  time: string;
  duration: string;
  link: string;
  // Stamped by handleGenerateLink alongside `link` — carried into the create/
  // update payload so the backend can record the REAL Calendar event/organizer
  // from that exact call instead of leaving both NULL (meeting_url already
  // being non-empty by then makes create_meeting skip its own creation path).
  google_event_id?: string;
  organizer_google_email?: string;
  // HOST * field (chốt 2026-09-14): which Workspace's Google account
  // organizes this meeting — independent of the project's own Workspace,
  // so a broken/unavailable account can be worked around at creation time.
  // Immutable after creation (not sent/used on edit — see retryMeetingLink
  // for the only path allowed to reassign the organizer post-creation).
  host_workspace_id?: number | null;
  transcript?: string;
  auto_summarize?: boolean;
  objective?: string;
  agenda?: string;
  project_ids: number[];
  member_ids: number[];
  reminder_minutes: number;
  notify_channels: string[];
}

const NOTIFY_CHANNEL_OPTIONS = ['App', 'Telegram', 'Zalo', 'Nhóm dự án'];

// Numbered-list UX for Mục tiêu / Agenda — Enter continues "1. / 2. / 3. ..."
// so leaders don't have to type the numbers by hand.
function seedNumberedIfEmpty(value: string): string {
  return value.trim() ? value : '1. ';
}
function continueNumberedList(el: HTMLTextAreaElement): { value: string; caret: number } {
  const value = el.value;
  const pos = el.selectionStart;
  const before = value.slice(0, pos);
  const after = value.slice(pos);
  const lineCount = before.split('\n').filter(x => x.trim() !== '').length;
  const insert = `\n${lineCount + 1}. `;
  return { value: before + insert + after, caret: pos + insert.length };
}


const SUMMARY_WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
function formatSummaryDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${SUMMARY_WEEKDAYS[d.getDay()]} ${dd}/${mm}`;
}
function addMinutes(time: string, durationStr: string): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + (m || 0) + (parseInt(durationStr || '60', 10) || 60);
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function HourMinutePicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [h, m] = (value || '00:00').split(':');
  const hour = HOUR_OPTIONS.includes(h) ? h : '00';
  const minute = MINUTE_OPTIONS.includes(m) ? m : '00';
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={hour}
        onChange={e => onChange(`${e.target.value}:${minute}`)}
        className="w-[74px] px-2 py-2.5 border border-[#c2c6d6] rounded-lg text-xs bg-white focus:outline-none focus:border-[#0058be] transition-colors text-center font-bold text-[#0b1c30]"
      >
        {HOUR_OPTIONS.map(hh => <option key={hh} value={hh}>{hh}</option>)}
      </select>
      <span className="text-sm font-black text-[#565e74]">:</span>
      <select
        value={minute}
        onChange={e => onChange(`${hour}:${e.target.value}`)}
        className="w-[74px] px-2 py-2.5 border border-[#c2c6d6] rounded-lg text-xs bg-white focus:outline-none focus:border-[#0058be] transition-colors text-center font-bold text-[#0b1c30]"
      >
        {MINUTE_OPTIONS.map(mm => <option key={mm} value={mm}>{mm}</option>)}
      </select>
    </div>
  );
}

// Default start time for a freshly-opened create form: the next half-hour
// mark strictly after "now" (08:05 -> 08:30, 08:30 -> 09:00, 23:45 -> next
// day 00:00) so the form never proposes a time that's already passed.
function computeDefaultDateTime(now: Date): { date: string; time: string } {
  const totalMin = now.getHours() * 60 + now.getMinutes();
  const nextBoundary = Math.floor(totalMin / 30) * 30 + 30;
  const dayOverflow = Math.floor(nextBoundary / 1440);
  const wrapped = nextBoundary % 1440;
  // Build the date from local y/m/d (+ day rollover), never toISOString() —
  // that converts to UTC first, which silently lands on the wrong calendar
  // day for Vietnam (UTC+7) whenever "now" is between 00:00 and 06:59 local.
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOverflow);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    date,
    time: `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`,
  };
}

function toDateTimeMs(dateStr: string, timeStr: string): number {
  return new Date(`${dateStr}T${timeStr}:00`).getTime();
}

function SectionLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <span className="w-5 h-5 rounded-full bg-[#ede9fe] text-[#5b4ff6] text-[10px] font-black flex items-center justify-center shrink-0">{n}</span>
      <span className="text-[11px] font-black text-[#8b93a7] uppercase tracking-wider">{label}</span>
      <span className="flex-1 h-px bg-[#e6ebf3]" />
    </div>
  );
}

export default function CreateMeetingModal({ isOpen, onClose, onSave, initialData }: CreateMeetingModalProps) {
  const [formData, setFormData] = useState<MeetingFormData>({
    title: '',
    platform: 'Google Meet',
    date: '',
    time: '',
    duration: '60',
    link: '',
    transcript: '',
    auto_summarize: true,
    objective: '',
    agenda: '',
    project_ids: [],
    member_ids: [],
    reminder_minutes: 15,
    notify_channels: ['App']
  });
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [membersList, setMembersList] = useState<any[]>([]);
  const [hostsList, setHostsList] = useState<{ workspace_id: number; workspace_name: string; google_email: string }[]>([]);
  // Tracks whether the user picked a Host by hand — once true, the
  // auto-select-by-project-Workspace effect below stops overwriting it
  // (same "don't clobber a manual choice" pattern as manualTitleEdit).
  const [hostManuallySet, setHostManuallySet] = useState(false);
  // Latest project-Workspace-derived suggestion (chốt 2026-09-14 Edit rule
  // 6) — auto-applied on create, offered as a dismissible chip on edit
  // (never silently overwrites a meeting's already-organized Host).
  const [autoSuggestedWorkspaceId, setAutoSuggestedWorkspaceId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Ref, not state: reads/writes happen synchronously so rapid repeated
  // clicks within the same render tick still see the lock (state would be
  // stale-closured across those clicks since React hasn't re-rendered yet).
  const isSubmittingRef = useRef(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [isGeneratingAiContent, setIsGeneratingAiContent] = useState(false);
  const [isFillingTeam, setIsFillingTeam] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState('');
  const [manualTitleEdit, setManualTitleEdit] = useState(false);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  // Overlap rule (chốt 2026-09-13): organizer is the source of truth, not
  // participants — at most ONE conflicting meeting is possible per the
  // backend's own check (same Gmail host can't be in two calls at once),
  // so this is a single nullable result, not a per-member list.
  const [organizerConflict, setOrganizerConflict] = useState<{ message: string; organizer_google_email: string } | null>(null);
  const [suggestedSlots, setSuggestedSlots] = useState<string[]>([]);
  // Tracks project_ids across renders so the member-cascade effect below can
  // tell which project was just REMOVED (vs. this being the modal's initial
  // open/reset, where "removing" everything would be wrong).
  const prevProjectIdsRef = useRef<number[]>([]);
  const membersPickerRef = useRef<SearchableSelectHandle>(null);
  // Captured once when editing opens — the Host workspace actually in effect
  // right now, resolved from the meeting's frozen organizer email once
  // hostsList loads. Compared against formData.host_workspace_id at submit
  // time to decide whether the user actually changed Host (chốt 2026-09-14
  // Edit rule 5) — a plain re-save with the same Host must never trigger a
  // retry-link regeneration.
  const originalHostWorkspaceIdRef = useRef<number | null>(null);
  const hostAlreadyResolvedRef = useRef(false);

  useEffect(() => {
    let openedProjectIds: number[] = [];
    if (initialData) {
      openedProjectIds = Array.isArray(initialData.project_ids) && initialData.project_ids.length
        ? initialData.project_ids
        : (initialData.project_id ? [initialData.project_id] : []);
      setFormData({
        ...initialData,
        title: initialData.title || '',
        platform: initialData.platform || 'Google Meet',
        link: initialData.link || initialData.meeting_url || '',
        transcript: initialData.transcript || '',
        auto_summarize: true,
        objective: initialData.objective || '',
        agenda: initialData.agenda || '',
        project_ids: openedProjectIds,
        duration: String(initialData.duration || 60),
        // Prefill from the meeting's real MeetingMember rows (member_id, not
        // the synthesized "Host" entry which has no member_id) so editing
        // doesn't silently drop everyone already added.
        member_ids: (initialData.members || [])
          .map((mm: any) => mm.member_id)
          .filter((id: any) => id !== undefined && id !== null),
        reminder_minutes: initialData.reminder_minutes ?? 15,
        notify_channels: Array.isArray(initialData.notify_channels) && initialData.notify_channels.length
          ? initialData.notify_channels
          : ['App']
      });
      // Editing an existing meeting: keep its title as-is, don't auto-overwrite.
      setManualTitleEdit(true);
      // Host starts at whatever this meeting is already using — resolved
      // from hostsList once it loads (see the hosts-fetch effect below).
      // hostManuallySet starts true here so the project-based auto-select
      // never silently overwrites the meeting's actual current Host; the
      // "Workspace mới" suggestion chip is the only way it changes in edit.
      originalHostWorkspaceIdRef.current = null;
      hostAlreadyResolvedRef.current = false;
      setHostManuallySet(true);
    } else {
      const { date: defaultDate, time: defaultTime } = computeDefaultDateTime(new Date());
      setFormData({
        title: '',
        platform: 'Google Meet',
        date: defaultDate,
        time: defaultTime,
        duration: '60',
        link: '',
        transcript: '',
        auto_summarize: true,
        objective: '',
        agenda: '',
        project_ids: [],
        member_ids: [],
        reminder_minutes: 15,
        notify_channels: ['App']
      });
      setManualTitleEdit(false);
      setHostManuallySet(false);
    }
    prevProjectIdsRef.current = openedProjectIds;
    setError('');
  }, [initialData, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    getProjects().then((res: any) => {
      const items = res?.data || res || [];
      if (Array.isArray(items)) setProjectsList(items);
    }).catch(() => {});
    getMembers().then((res: any) => {
      const items = res?.data || res || [];
      if (Array.isArray(items)) setMembersList(items);
    }).catch(() => {});
  }, [isOpen]);

  // HOST * field (chốt 2026-09-14): fetch available accounts + the
  // project-Workspace-derived suggestion, re-resolved every time
  // project_ids changes. On CREATE the suggestion auto-applies (unless the
  // user already picked by hand). On EDIT it never auto-applies — instead
  // this also does a ONE-TIME resolution of the meeting's CURRENT Host (by
  // matching its frozen organizer email against the fetched list) so the
  // dropdown opens pre-filled with what's actually organizing the meeting
  // right now, not a fresh guess (Rule 4: Host doesn't silently change).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    getMeetingHosts(formData.project_ids).then((res: any) => {
      if (cancelled) return;
      const hosts = Array.isArray(res?.hosts) ? res.hosts : [];
      setHostsList(hosts);
      setAutoSuggestedWorkspaceId(res?.auto_selected_workspace_id ?? null);
      if (initialData) {
        if (!hostAlreadyResolvedRef.current) {
          hostAlreadyResolvedRef.current = true;
          const currentEmail = String(initialData.host_google_email || initialData.organizer_google_email || '').trim().toLowerCase();
          const match = hosts.find((h: any) => String(h.google_email || '').trim().toLowerCase() === currentEmail);
          const resolvedId = match ? match.workspace_id : null;
          originalHostWorkspaceIdRef.current = resolvedId;
          setFormData(prev => ({ ...prev, host_workspace_id: resolvedId }));
        }
      } else if (!hostManuallySet) {
        setFormData(prev => ({ ...prev, host_workspace_id: res?.auto_selected_workspace_id ?? null }));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialData, formData.project_ids.join(','), hostManuallySet]);

  // Bỏ chọn 1 dự án -> tự bỏ luôn các thành viên CHỈ thuộc dự án đó (thành
  // viên nào vẫn còn thuộc 1 dự án khác đang được chọn thì giữ nguyên).
  useEffect(() => {
    const prevIds = prevProjectIdsRef.current;
    const currentIds = formData.project_ids;
    const removedIds = prevIds.filter(id => !currentIds.includes(id));
    prevProjectIdsRef.current = currentIds;
    if (removedIds.length === 0 || formData.member_ids.length === 0) return;

    let cancelled = false;
    (async () => {
      const [remainingRosters, removedRosters] = await Promise.all([
        Promise.all(currentIds.map(pid => getProjectMembers(pid).catch(() => []))),
        Promise.all(removedIds.map(pid => getProjectMembers(pid).catch(() => []))),
      ]);
      if (cancelled) return;

      const toIdSet = (rosters: any[]) => {
        const ids = new Set<number>();
        rosters.forEach((res: any) => {
          const arr = Array.isArray(res) ? res : (res?.data || []);
          arr.forEach((m: any) => { if (m && m.id) ids.add(m.id); });
        });
        return ids;
      };
      const stillCoveredIds = toIdSet(remainingRosters);
      const droppedProjectMemberIds = toIdSet(removedRosters);

      setFormData(prev => {
        const kept = prev.member_ids.filter(mid => !droppedProjectMemberIds.has(mid) || stillCoveredIds.has(mid));
        return kept.length === prev.member_ids.length ? prev : { ...prev, member_ids: kept };
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.project_ids.join(',')]);

  // Tên cuộc họp tự gợi ý từ dự án đã chọn + mục tiêu — chỉ khi người dùng
  // chưa tự sửa tay, để không đè lên nội dung họ đang gõ.
  const buildTitleSuggestion = () => {
    const objectiveText = (formData.objective || '').replace(/^\d+\.\s*/gm, '').trim();
    const projectNames = formData.project_ids
      .map(pid => projectsList.find((p: any) => p.id === pid)?.name)
      .filter(Boolean) as string[];
    const projectText = projectNames.length === 0
      ? ''
      : projectNames.length === 1
      ? projectNames[0]
      : `${projectNames.slice(0, 2).join(' + ')}${projectNames.length > 2 ? ` +${projectNames.length - 2}` : ''}`;
    if (!projectText && !objectiveText) return '';
    let goalHint = 'review tiến độ';
    if (objectiveText) {
      const t = objectiveText.toLowerCase();
      if (t.includes('blocker')) goalHint = 'xử lý blocker';
      else if (t.includes('chốt')) goalHint = 'chốt action items';
      else if (!t.includes('tiến độ') && !t.includes('progress')) goalHint = 'review mục tiêu';
    }
    return projectText
      ? `${goalHint.charAt(0).toUpperCase() + goalHint.slice(1)} ${projectText}`
      : `Meeting ${projectText || 'dự án'}`;
  };
  useEffect(() => {
    if (manualTitleEdit) return;
    const suggestion = buildTitleSuggestion();
    if (suggestion) setFormData(prev => ({ ...prev, title: suggestion }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.project_ids.join(','), formData.objective, manualTitleEdit, projectsList.length]);
  const regenerateTitle = () => {
    setManualTitleEdit(false);
    const suggestion = buildTitleSuggestion();
    if (suggestion) setFormData(prev => ({ ...prev, title: suggestion }));
  };

  // Overlap check (chốt 2026-09-13): organizer is the source of truth, not
  // participants — calls the backend's /meetings/check-conflict, the EXACT
  // same rule create/update/retry-link enforce, instead of a separately
  // hand-rolled member-based heuristic that could disagree with what
  // submitting the form will actually do.
  useEffect(() => {
    if (!isOpen || !formData.date || !formData.time || formData.project_ids.length === 0) {
      setOrganizerConflict(null);
      setSuggestedSlots([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCheckingConflicts(true);
      try {
        const check = (time: string) => checkMeetingConflict({
          project_id: formData.project_ids[0],
          date: formData.date,
          time,
          duration: formData.duration,
          exclude_meeting_id: initialData?.id,
          host_workspace_id: formData.host_workspace_id,
        });
        const res = await check(formData.time);
        if (cancelled) return;
        if (!res?.conflict) {
          setOrganizerConflict(null);
          setSuggestedSlots([]);
          return;
        }
        setOrganizerConflict({ message: res.message, organizer_google_email: res.organizer_google_email });
        // Scan half-hour slots across business hours, offer the first few
        // that are free for the same organizer.
        const candidates: string[] = [];
        for (let h = 8; h <= 18; h++) {
          candidates.push(`${String(h).padStart(2, '0')}:00`, `${String(h).padStart(2, '0')}:30`);
        }
        const results = await Promise.all(
          candidates.filter(t => t !== formData.time).map(t => check(t).then(r => ({ t, conflict: !!r?.conflict })).catch(() => ({ t, conflict: true })))
        );
        if (cancelled) return;
        setSuggestedSlots(results.filter(r => !r.conflict).map(r => r.t).slice(0, 4));
      } catch {
        if (!cancelled) { setOrganizerConflict(null); setSuggestedSlots([]); }
      } finally {
        if (!cancelled) setCheckingConflicts(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, formData.date, formData.time, formData.duration, formData.project_ids.join(','), formData.host_workspace_id, initialData?.id]);

  if (!isOpen) return null;

  const isEditingPastMeeting = !!initialData && !!formData.date && !!formData.time && toDateTimeMs(formData.date, formData.time) < Date.now();
  // Edit lifecycle lock (chốt 2026-09-14): mirrors the backend's own guard —
  // only a not-yet-started meeting (status "SẮP TỚI", the live display value
  // meeting_to_dict already computes) may be edited. ONGOING/DONE/CANCELLED
  // all read-only, no per-field exceptions. This is a frontend UX signal
  // only — the backend 400s regardless of what this modal lets through.
  const isLocked = !!initialData && initialData.status !== 'SẮP TỚI';

  const handleFillTeam = async () => {
    if (formData.project_ids.length === 0) {
      setError('Vui lòng chọn dự án trước khi bấm "Cả team"');
      return;
    }
    setIsFillingTeam(true);
    setError('');
    try {
      const results = await Promise.all(formData.project_ids.map((pid) => getProjectMembers(pid).catch(() => [])));
      const union = new Set(formData.member_ids);
      results.forEach((res: any) => {
        const arr = Array.isArray(res) ? res : (res?.data || []);
        arr.forEach((m: any) => { if (m && m.id) union.add(m.id); });
      });
      setFormData(prev => ({ ...prev, member_ids: Array.from(union) }));
    } catch {
      setError('Không thể lấy danh sách thành viên của dự án đã chọn');
    } finally {
      setIsFillingTeam(false);
    }
  };

  const handleGenerateLink = async () => {
    if (!formData.title || !formData.date || !formData.time) {
      setError('Vui lòng điền tiêu đề, ngày và giờ bắt đầu trước khi tạo link');
      return;
    }
    setIsGeneratingLink(true);
    setError('');
    try {
      // Organizer rule (chốt 2026-09-13): for an EXISTING meeting, "🔄 Tạo lại"
      // must go through /{id}/retry-link — the only backend path allowed to
      // reassign organizer_google_email — instead of generate-link + a plain
      // PUT, since PUT no longer accepts organizer_google_email at all.
      if (initialData?.id) {
        const data = await retryMeetingLink(initialData.id);
        if (data.success && data.data?.link) {
          setFormData(prev => ({ ...prev, link: data.data.link }));
        } else {
          setError('Không thể tạo lại link meeting tự động');
        }
        return;
      }
      if (formData.platform === 'Google Meet' && !formData.host_workspace_id) {
        setError('Vui lòng chọn Host trước khi tạo link Google Meet');
        return;
      }
      const data = await generateMeetingLink({
        platform: formData.platform,
        title: formData.title,
        date: formData.date,
        time: formData.time,
        duration: formData.duration,
        project_id: formData.project_ids[0],
        host_workspace_id: formData.host_workspace_id,
      });
      if (data.success && data.join_url) {
        const fullUrl = data.join_url.startsWith('http') ? data.join_url : `https://${data.join_url}`;
        setFormData(prev => ({
          ...prev,
          link: fullUrl,
          google_event_id: data.google_event_id,
          organizer_google_email: data.organizer_google_email,
        }));
      } else {
        setError('Không thể tạo link meeting tự động');
      }
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Lỗi khi tạo link meeting'));
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const handlePasteLink = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) setFormData(prev => ({ ...prev, link: text.trim() }));
      else setError('Clipboard đang trống — hãy copy link trước khi dán');
    } catch {
      setError('Không đọc được clipboard — hãy dán link trực tiếp vào ô link (Ctrl/Cmd + V)');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return; // synchronous guard — see ref comment above
    isSubmittingRef.current = true;
    setError('');

    if (isLocked) {
      setError(`Cuộc họp đang ở trạng thái ${initialData?.status} — không thể chỉnh sửa.`);
      isSubmittingRef.current = false;
      return;
    }
    if (!formData.title || !formData.date || !formData.time) {
      const missing = [
        !formData.title && 'Tên',
        !formData.date && 'Ngày',
        !formData.time && 'Giờ',
      ].filter(Boolean);
      setError(`Vui lòng điền đầy đủ thông tin bắt buộc (${missing.join(', ')})`);
      isSubmittingRef.current = false;
      return;
    }
    if (!initialData && toDateTimeMs(formData.date, formData.time) < Date.now()) {
      setError('Thời gian họp phải lớn hơn thời gian hiện tại.');
      isSubmittingRef.current = false;
      return;
    }
    if (formData.project_ids.length === 0) {
      setError('Vui lòng chọn ít nhất một dự án cho cuộc họp');
      isSubmittingRef.current = false;
      return;
    }
    // Chốt 2026-09-13: "Phải có ít nhất 1 participant mới tạo Meeting" — scoped
    // to CREATE only. Many meetings created before this rule have zero real
    // MeetingMember rows (the old synthetic "Host" display entry was never a
    // real participant), so enforcing this on EDIT too would block a simple
    // title/time fix on any of them until someone first backfills participants.
    if (!initialData && formData.member_ids.length === 0) {
      setError('Vui lòng chọn ít nhất một thành viên tham gia cuộc họp');
      isSubmittingRef.current = false;
      return;
    }
    // HOST * field (chốt 2026-09-14): required for Google Meet whenever the
    // field is shown (create, or edit while still SẮP TỚI) — Zoom's
    // organizer comes from ZOOM_ACCOUNT_ID, not a per-Workspace Google
    // account, so Host has no meaning there.
    if (formData.platform === 'Google Meet' && !formData.host_workspace_id) {
      setError('Vui lòng chọn Host cho cuộc họp');
      isSubmittingRef.current = false;
      return;
    }
    if (!formData.objective || !formData.objective.replace(/^\d+\.\s*/gm, '').trim()) {
      setError('Vui lòng nhập Mục tiêu / Kết quả mong đợi của cuộc họp');
      isSubmittingRef.current = false;
      return;
    }

    setIsLoading(true);
    try {
      // Edit rule 5 (chốt 2026-09-14): changing Host has no meaning other
      // than "regenerate under a new account" — Calendar has no operation to
      // reassign an existing event's organizer — so it must go through the
      // exact same retry-link path as the dedicated "🔄 Tạo lại" button,
      // never a plain DB field write. Runs BEFORE the main save, and aborts
      // the whole submit on failure (old Host/link/DB untouched) rather than
      // partially applying other field changes with a stale Host.
      let freshLink = formData.link;
      if (initialData?.id && formData.host_workspace_id !== originalHostWorkspaceIdRef.current) {
        const hostRes = await retryMeetingLink(initialData.id, { host_workspace_id: formData.host_workspace_id });
        if (!hostRes?.success || !hostRes.data?.link) {
          throw new Error('Không thể đổi Host cho cuộc họp');
        }
        // The PUT below still sends meeting_url/link — without overriding it
        // here, it would carry the OLD link and silently clobber the brand
        // new Calendar event retryMeetingLink just created.
        freshLink = hostRes.data.link;
      }
      // Must await — otherwise isLoading resets before the create request
      // finishes, the button re-enables while still in flight, and repeated
      // clicks fire off duplicate meetings.
      await onSave({ ...formData, link: freshLink, meeting_url: freshLink });
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Có lỗi xảy ra'));
    } finally {
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  };

  // Powers the inline "AI gợi ý" (Mục tiêu) / "AI tạo" (Agenda) triggers —
  // same backend call either way, only the requested field gets applied.
  const handleGenerateAiContent = async (field: 'objective' | 'agenda') => {
    if (!formData.title) {
      setError('Nhập tên cuộc họp trước để AI đề xuất nội dung');
      return;
    }
    setIsGeneratingAiContent(true);
    setError('');
    try {
      const firstProject = projectsList.find((p: any) => p.id === formData.project_ids[0]);
      const res = await generateAiMeetingContent({ title: formData.title, project_name: firstProject?.name });
      if (res?.success) {
        setFormData(prev => ({
          ...prev,
          objective: field === 'objective' ? (res.goal || prev.objective) : prev.objective,
          agenda: field === 'agenda' ? (res.agenda || prev.agenda) : prev.agenda,
        }));
      } else {
        setError('AI không đề xuất được nội dung, hãy nhập trực tiếp');
      }
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'AI đề xuất thất bại'));
    } finally {
      setIsGeneratingAiContent(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      {/* Backdrop */}
      <div onClick={onClose} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300" />

      {/* Drawer Body */}
      <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col z-10 transition-transform duration-300 animate-slide-in">

        {/* Header */}
        <div className="px-6 py-5 border-b border-[#c2c6d6]/40 flex items-center justify-between bg-[#f8f9fe] shrink-0">
          <div className="flex items-center gap-2 text-[#0058be]">
            <CalendarIcon size={18} />
            <h2 className="text-[14px] font-bold text-[#0b1c30]">
              {initialData ? 'Chỉnh sửa cuộc họp' : 'Tạo Meeting mới'}
            </h2>
          </div>
          <button onClick={onClose} disabled={isLoading} className="p-1.5 text-[#565e74] hover:text-[#0b1c30] rounded-lg hover:bg-[#eff4ff] transition-colors disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        {/* Body & Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
            {error && <div className="mb-1 p-3 bg-red-50 text-red-600 text-xs rounded-lg font-semibold border border-red-200">{error}</div>}
            {isLocked && (
              <div className="mb-1 p-3 bg-amber-50 text-amber-800 text-xs rounded-lg font-semibold border border-amber-200">
                ⚠ Cuộc họp này đang ở trạng thái <b>{initialData?.status}</b> — chỉ có thể xem, không thể chỉnh sửa. Cuộc họp chưa bắt đầu (SẮP TỚI) mới được sửa.
              </div>
            )}

            {/* 1. Phạm vi cuộc họp */}
            <SectionLabel n={1} label="Phạm vi cuộc họp" />
            <div>
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Dự án liên quan *</label>
              <SearchableSelect
                label="dự án"
                icon="📁"
                isMulti
                className="w-full"
                options={projectsList.map((p: any) => ({ id: p.id, name: p.name }))}
                value={formData.project_ids}
                onChange={(ids: number[]) => setFormData({ ...formData, project_ids: ids })}
              />
            </div>

            {/* 2. Nội dung cuộc họp */}
            <SectionLabel n={2} label="Nội dung cuộc họp" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Mục tiêu & kết quả mong đợi *</label>
                  <button
                    type="button"
                    onClick={() => handleGenerateAiContent('objective')}
                    disabled={isGeneratingAiContent}
                    className="flex items-center gap-1 text-[10px] font-bold text-[#6d28d9] hover:underline disabled:opacity-50"
                  >
                    <Sparkles size={11} /> AI gợi ý
                  </button>
                </div>
                <textarea
                  value={formData.objective}
                  onFocus={() => setFormData(prev => ({ ...prev, objective: seedNumberedIfEmpty(prev.objective || '') }))}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    const { value, caret } = continueNumberedList(el);
                    setFormData(prev => ({ ...prev, objective: value }));
                    requestAnimationFrame(() => el.setSelectionRange(caret, caret));
                  }}
                  onChange={e => setFormData({ ...formData, objective: e.target.value })}
                  placeholder="1. Nhập mục tiêu — Enter để tự thêm số tiếp theo..."
                  rows={4}
                  className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors resize-y"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Agenda / vấn đề cần xử lý</label>
                  <button
                    type="button"
                    onClick={() => handleGenerateAiContent('agenda')}
                    disabled={isGeneratingAiContent}
                    className="flex items-center gap-1 text-[10px] font-bold text-[#6d28d9] hover:underline disabled:opacity-50"
                  >
                    <Sparkles size={11} /> AI tạo
                  </button>
                </div>
                <textarea
                  value={formData.agenda}
                  onFocus={() => setFormData(prev => ({ ...prev, agenda: seedNumberedIfEmpty(prev.agenda || '') }))}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    const { value, caret } = continueNumberedList(el);
                    setFormData(prev => ({ ...prev, agenda: value }));
                    requestAnimationFrame(() => el.setSelectionRange(caret, caret));
                  }}
                  onChange={e => setFormData({ ...formData, agenda: e.target.value })}
                  placeholder={'1. Nội dung cần cập nhật\n2. Vấn đề cần thảo luận\n3. Quyết định cần chốt'}
                  rows={4}
                  className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors resize-y"
                />
              </div>
            </div>

            {/* 3. Người tham gia & thời gian */}
            <SectionLabel n={3} label="Người tham gia & thời gian" />
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Thành viên tham gia *</label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleFillTeam}
                      disabled={isFillingTeam}
                      className="text-[11px] font-bold text-[#0058be] hover:underline disabled:opacity-50"
                    >
                      {isFillingTeam ? 'Đang tải...' : '+ Cả team'}
                    </button>
                    <button
                      type="button"
                      onClick={() => membersPickerRef.current?.open()}
                      className="text-[11px] font-bold text-[#0058be] hover:underline"
                    >
                      + Thêm người
                    </button>
                    {formData.member_ids.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, member_ids: [] }))}
                        className="text-[11px] font-bold text-[#565e74] hover:underline"
                      >
                        Xoá người
                      </button>
                    )}
                  </div>
                </div>
                <SearchableSelect
                  ref={membersPickerRef}
                  label="thành viên"
                  icon="👥"
                  showAvatar
                  isMulti
                  className="w-full"
                  options={membersList.map((m: any) => ({ id: m.id, name: m.display_name || m.full_name || `#${m.id}` }))}
                  value={formData.member_ids}
                  onChange={(ids: number[]) => setFormData({ ...formData, member_ids: ids })}
                />
                {formData.member_ids.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {formData.member_ids.map(id => {
                      const m = membersList.find((mm: any) => mm.id === id);
                      const name = m?.display_name || m?.full_name || `#${id}`;
                      return (
                        <span key={id} className="inline-flex items-center gap-1 bg-[#f0f2f5] text-[#334155] text-[11px] font-semibold pl-2 pr-1.5 py-1 rounded-full">
                          {name}
                          <button
                            type="button"
                            onClick={() => setFormData(prev => ({ ...prev, member_ids: prev.member_ids.filter(mid => mid !== id) }))}
                            className="text-slate-400 hover:text-slate-700 font-bold leading-none px-0.5"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <p className="text-[11px] text-[#94a3b8] mt-1.5 leading-relaxed">Bắt buộc chọn ít nhất 1 thành viên tham gia cuộc họp. Bấm <b>“+ Cả team”</b> để thêm nhanh toàn bộ thành viên của dự án đã chọn.</p>
              </div>

              {/* HOST * (chốt 2026-09-14): auto-selected by project's Workspace on
                  create; on edit it's pre-filled with the meeting's CURRENT Host
                  and only offers a suggestion chip when the project's Workspace
                  changed (Rule 6) — never silently overwritten (Rule 4).
                  Full-width so it reads as its own decision, not squeezed beside
                  time/duration. Locked (ONGOING/DONE/CANCELLED) shows read-only. */}
              {isLocked ? (
                <div>
                  <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Host</label>
                  <div className="w-full px-3 py-2.5 border border-[#e2e8f0] rounded-lg text-xs text-[#565e74] bg-[#f8f9fb]">
                    {initialData.host_google_email || initialData.organizer_google_email || 'Không xác định'}
                  </div>
                </div>
              ) : formData.platform === 'Google Meet' && (
                <div>
                  <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Host *</label>
                  <select
                    value={formData.host_workspace_id ?? ''}
                    onChange={e => {
                      setHostManuallySet(true);
                      setFormData(prev => ({ ...prev, host_workspace_id: e.target.value ? Number(e.target.value) : null }));
                    }}
                    className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
                  >
                    <option value="">— Chọn tài khoản Host —</option>
                    {hostsList.map(h => (
                      <option key={h.workspace_id} value={h.workspace_id}>{h.google_email}</option>
                    ))}
                  </select>
                  {initialData && autoSuggestedWorkspaceId !== null && autoSuggestedWorkspaceId !== formData.host_workspace_id && (
                    <button
                      type="button"
                      onClick={() => {
                        setHostManuallySet(true);
                        setFormData(prev => ({ ...prev, host_workspace_id: autoSuggestedWorkspaceId }));
                      }}
                      className="mt-1.5 text-[11px] font-bold text-[#0058be] hover:underline"
                    >
                      Dự án thuộc Workspace khác — bấm để cập nhật Host theo Workspace mới ({hostsList.find(h => h.workspace_id === autoSuggestedWorkspaceId)?.google_email})
                    </button>
                  )}
                  {initialData && formData.host_workspace_id !== originalHostWorkspaceIdRef.current && (
                    <p className="text-[11px] text-amber-700 font-semibold mt-1.5">⚠ Đổi Host sẽ tạo lại link Google Meet mới (organizer cũ không còn hiệu lực).</p>
                  )}
                </div>
              )}

              <div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Thời gian họp *</label>
                    <input
                      type="date"
                      value={formData.date}
                      onChange={e => setFormData({ ...formData, date: e.target.value })}
                      className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Thời lượng</label>
                    <select
                      value={formData.duration}
                      onChange={e => setFormData({ ...formData, duration: e.target.value })}
                      className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
                    >
                      <option value="15">15 phút</option>
                      <option value="30">30 phút</option>
                      <option value="45">45 phút</option>
                      <option value="60">1 giờ</option>
                      <option value="90">1.5 giờ</option>
                    </select>
                  </div>
                </div>

                <div className="mt-2">
                  <label className="block text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider mb-1">Giờ bắt đầu</label>
                  <HourMinutePicker
                    value={formData.time}
                    onChange={t => setFormData({ ...formData, time: t })}
                  />
                </div>

                {isEditingPastMeeting && (
                  <p className="text-[11px] text-amber-700 font-semibold mt-1.5 leading-relaxed">⚠ Cuộc họp này đã diễn ra hoặc đã bắt đầu. Vẫn có thể lưu thay đổi nếu cần.</p>
                )}

                {checkingConflicts && (
                  <p className="text-[11px] text-[#94a3b8] mt-2">Đang kiểm tra trùng lịch (theo tài khoản host)...</p>
                )}
                {!checkingConflicts && formData.project_ids.length > 0 && (
                  organizerConflict ? (
                    <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800">
                      <p className="font-bold mb-1">⚠ Trùng lịch host: {organizerConflict.message}</p>
                      {suggestedSlots.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-amber-200">
                          <span className="font-bold">✨ Gợi ý giờ khác:</span>
                          {suggestedSlots.map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setFormData(prev => ({ ...prev, time: t }))}
                              className="px-2.5 py-1 text-[11px] font-bold text-[#0058be] bg-white border border-[#bfdbfe] rounded-full hover:bg-[#eff4ff]"
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-700 font-semibold">
                      ✓ Tài khoản host đang rảnh trong khung giờ này
                    </div>
                  )
                )}
              </div>
            </div>

            {/* 4. Kết nối & thông báo */}
            <SectionLabel n={4} label="Kết nối & thông báo" />
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Nền tảng họp + Link họp</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!formData.link.trim()) {
                        setError('Chưa có link để copy');
                        return;
                      }
                      navigator.clipboard.writeText(formData.link);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:underline"
                  >
                    {copiedLink ? <Check size={13} /> : <Copy size={13} />}
                    {copiedLink ? 'Đã sao chép!' : 'Sao chép link'}
                  </button>
                  {(formData.platform === 'Zoom' || formData.platform === 'Google Meet') && (
                    // Google Meet with a link already generated: swap the button for a
                    // non-actionable "created" badge + a separate, deliberately smaller
                    // "Tạo lại" action — prevents an accidental re-click from silently
                    // spawning a second Meet event for the same meeting. Zoom keeps the
                    // one-click regenerate since it doesn't carry Google's Host/authuser
                    // identity concern that motivated this for Meet.
                    formData.platform === 'Google Meet' && formData.link.trim() ? (
                      <span className="flex items-center gap-2 text-[11px] font-bold">
                        <span className="flex items-center gap-1 text-emerald-600">
                          <Check size={13} /> Đã tạo link
                        </span>
                        <button
                          type="button"
                          onClick={handleGenerateLink}
                          disabled={isGeneratingLink || isLocked}
                          className="flex items-center gap-1 text-[#94a3b8] hover:text-[#0058be] hover:underline disabled:opacity-50"
                          title="Tạo link Google Meet mới, thay thế link hiện tại"
                        >
                          <Sparkles size={12} className={isGeneratingLink ? 'animate-spin text-amber-500' : ''} />
                          {isGeneratingLink ? 'Đang tạo lại...' : 'Tạo lại'}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleGenerateLink}
                        disabled={isGeneratingLink}
                        className="flex items-center gap-1 text-[11px] font-bold text-[#0058be] hover:underline disabled:opacity-50"
                      >
                        <Sparkles size={13} className={isGeneratingLink ? 'animate-spin text-amber-500' : 'text-[#0058be]'} />
                        {isGeneratingLink ? 'Đang tạo link...' : `⚡ Tạo link ${formData.platform}`}
                      </button>
                    )
                  )}
                  {formData.platform !== 'Google Meet' && (
                    <button
                      type="button"
                      onClick={handlePasteLink}
                      className="flex items-center gap-1 text-[11px] font-bold text-[#565e74] hover:underline"
                    >
                      <Clipboard size={13} /> Dán link họp
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={formData.platform}
                  onChange={e => {
                    const platform = e.target.value;
                    // Switching TO Google Meet locks the link field to read-only
                    // (see below) — clear out whatever link belonged to the
                    // previous platform so it can't get saved stuck behind a
                    // Meet-only field the user has no way left to edit/clear.
                    const shouldClearLink = platform === 'Google Meet' && !formData.link.includes('meet.google.com');
                    setFormData({ ...formData, platform, link: shouldClearLink ? '' : formData.link });
                  }}
                  className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
                >
                  <option value="Google Meet">💻 Google Meet</option>
                  <option value="Zoom">🎥 Zoom</option>
                  <option value="Microsoft Teams">👥 Microsoft Teams</option>
                  <option value="Khác">🔗 Khác</option>
                </select>
                <input
                  type="text"
                  value={formData.link}
                  onChange={e => setFormData({ ...formData, link: e.target.value })}
                  readOnly={formData.platform === 'Google Meet'}
                  placeholder={formData.platform === 'Zoom' ? 'https://zoom.us/j/...' : formData.platform === 'Google Meet' ? 'Bấm "Tạo link Google Meet" ở trên' : formData.platform === 'Microsoft Teams' ? 'https://teams.microsoft.com/l/meetup-join/...' : 'https://...'}
                  className={`w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors placeholder:text-[#c2c6d6] ${formData.platform === 'Google Meet' ? 'bg-[#f8f9fe] cursor-not-allowed' : ''}`}
                />
              </div>

              {formData.platform === 'Zoom' && (
                <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 leading-relaxed flex items-start gap-2">
                  <span className="material-symbols-outlined text-amber-600 text-[16px] shrink-0 mt-0.5">info</span>
                  <div>
                    <span className="font-bold text-amber-900">Lưu ý khi chọn Zoom:</span> Hệ thống dùng 1 tài khoản Zoom cố định. Tại cùng một khung giờ chỉ khởi tạo được 1 cuộc họp Zoom. Nếu trùng giờ với cuộc họp Zoom khác, sẽ không tạo thêm được link mới (khuyên dùng <b>Google Meet</b>).
                  </div>
                </div>
              )}
              {!initialData && !formData.link && (
                <>
                  {formData.platform === 'Zoom' && (
                    <p className="text-[11px] text-[#0058be] mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">auto_awesome</span>
                      Link Zoom sẽ tự động được tạo khi nhấn &quot;Tạo meeting&quot; nếu để trống.
                    </p>
                  )}
                  {formData.platform === 'Google Meet' && (
                    <p className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">auto_awesome</span>
                      Link Google Meet sẽ tự động được tạo khi nhấn &quot;Tạo meeting&quot; nếu để trống (yêu cầu kết nối Google).
                    </p>
                  )}
                </>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Tên cuộc họp *</label>
                <button
                  type="button"
                  onClick={regenerateTitle}
                  className="flex items-center gap-1 text-[11px] font-bold text-[#0058be] hover:underline"
                >
                  <RefreshCw size={12} /> Hệ thống gợi ý lại
                </button>
              </div>
              <input
                type="text"
                value={formData.title}
                onChange={e => { setFormData({ ...formData, title: e.target.value }); setManualTitleEdit(true); }}
                placeholder="Hệ thống sẽ gợi ý tên cuộc họp dựa trên dự án + mục tiêu"
                className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] font-semibold focus:outline-none focus:border-[#0058be] transition-colors"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Nhắc lịch & kênh thông báo</label>
              <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
                <select
                  value={formData.reminder_minutes}
                  onChange={e => setFormData({ ...formData, reminder_minutes: parseInt(e.target.value, 10) })}
                  className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
                >
                  <option value={5}>Trước 5 phút</option>
                  <option value={10}>Trước 10 phút</option>
                  <option value={15}>Trước 15 phút</option>
                  <option value={30}>Trước 30 phút</option>
                </select>
                <SearchableSelect
                  label="kênh thông báo"
                  isMulti
                  className="w-full"
                  options={NOTIFY_CHANNEL_OPTIONS}
                  value={formData.notify_channels}
                  onChange={(vals: string[]) => setFormData({ ...formData, notify_channels: vals })}
                />
              </div>
              <p className="text-[11px] text-[#94a3b8] mt-1.5 leading-relaxed">Hệ thống sẽ tự động nhắc qua các kênh đã chọn đúng vào mốc thời gian này.</p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-[#f8f9fe] border-t border-[#c2c6d6]/40 flex items-center justify-between gap-3 shrink-0">
            <div className="text-[11px] text-[#565e74] font-medium min-w-0 truncate">
              {formData.date && formData.time && (
                <>
                  <b className="text-[#0b1c30]">{formatSummaryDate(formData.date)}</b>
                  {' · '}{formData.time}–{addMinutes(formData.time, formData.duration)}
                  {' · '}{formData.member_ids.length} người
                  {' · '}{formData.platform}
                </>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-xs font-bold text-[#565e74] bg-white border border-[#c2c6d6] rounded-lg hover:bg-[#f0f2f5] transition-colors disabled:opacity-40"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isLoading || isLocked}
              className="px-4 py-2 flex items-center gap-2 text-xs font-bold text-white bg-[#0058be] rounded-lg hover:bg-[#0058be]/90 transition-colors disabled:opacity-50 shadow-sm"
            >
              {isLoading ? 'Đang xử lý...' : (initialData ? 'Lưu thay đổi' : 'Tạo meeting')}
            </button>
            </div>
          </div>
        </form>

      </div>
    </div>
  );
}
