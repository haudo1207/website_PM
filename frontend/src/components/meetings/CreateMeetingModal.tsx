import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar as CalendarIcon, Sparkles, RefreshCw, Copy, Check, Clipboard } from 'lucide-react';
import { generateMeetingLink, generateAiMeetingContent, getProjects, getMembers, getProjectMembers, getMeetings, getApiErrorMessage } from '@/lib/api';
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

// Shared by the live conflict check and the "gợi ý giờ khác" slot scan below —
// both need the same "does this member already have an overlapping meeting"
// logic, just evaluated at different candidate times.
function findConflicts(time: string, durationMin: number, items: any[], memberIds: number[], excludeId?: any) {
  const [sh, sm] = time.split(':').map(Number);
  const startMin = sh * 60 + (sm || 0);
  const endMin = startMin + durationMin;
  const found: { member_id: number; name: string; meetingTitle: string }[] = [];
  (Array.isArray(items) ? items : []).forEach((mt: any) => {
    if (!mt || mt.id === excludeId || !mt.time) return;
    const [oh, om] = String(mt.time).split(':').map(Number);
    const oStart = oh * 60 + (om || 0);
    let oEnd = oStart + 60;
    if (mt.end_time) {
      const [eh, em] = String(mt.end_time).split(':').map(Number);
      oEnd = eh * 60 + (em || 0);
    }
    if (startMin >= oEnd || oStart >= endMin) return;
    (mt.members || []).forEach((mm: any) => {
      if (mm.member_id && memberIds.includes(mm.member_id)) {
        found.push({ member_id: mm.member_id, name: mm.display_name || `#${mm.member_id}`, meetingTitle: mt.title });
      }
    });
  });
  return found;
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
  const [scheduleConflicts, setScheduleConflicts] = useState<{ member_id: number; name: string; meetingTitle: string }[]>([]);
  const [suggestedSlots, setSuggestedSlots] = useState<string[]>([]);
  // Tracks project_ids across renders so the member-cascade effect below can
  // tell which project was just REMOVED (vs. this being the modal's initial
  // open/reset, where "removing" everything would be wrong).
  const prevProjectIdsRef = useRef<number[]>([]);
  const membersPickerRef = useRef<SearchableSelectHandle>(null);

  useEffect(() => {
    let openedProjectIds: number[] = [];
    if (initialData) {
      openedProjectIds = Array.isArray(initialData.project_ids) && initialData.project_ids.length
        ? initialData.project_ids
        : (initialData.project_id ? [initialData.project_id] : []);
      setFormData({
        ...initialData,
        platform: initialData.platform || 'Google Meet',
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

  // Real trùng-lịch check: pull meetings already scheduled on the same date
  // and see whether any selected participant is already booked in an
  // overlapping time window. No fabricated/demo data — if the API has
  // nothing for that day, nothing is reported.
  useEffect(() => {
    if (!isOpen || !formData.date || !formData.time || formData.member_ids.length === 0) {
      setScheduleConflicts([]);
      setSuggestedSlots([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCheckingConflicts(true);
      try {
        const res: any = await getMeetings({ from_date: formData.date, to_date: formData.date });
        const items: any[] = res?.data || res || [];
        const dur = parseInt(formData.duration || '60', 10) || 60;
        const found = findConflicts(formData.time, dur, items, formData.member_ids, initialData?.id);
        if (cancelled) return;
        setScheduleConflicts(found);
        if (found.length === 0) {
          setSuggestedSlots([]);
        } else {
          // Scan half-hour slots across business hours, offer the first few
          // that are free for every currently selected member.
          const candidates: string[] = [];
          for (let h = 8; h <= 18; h++) {
            candidates.push(`${String(h).padStart(2, '0')}:00`, `${String(h).padStart(2, '0')}:30`);
          }
          const free = candidates
            .filter(t => t !== formData.time)
            .filter(t => findConflicts(t, dur, items, formData.member_ids, initialData?.id).length === 0)
            .slice(0, 4);
          setSuggestedSlots(free);
        }
      } catch {
        if (!cancelled) { setScheduleConflicts([]); setSuggestedSlots([]); }
      } finally {
        if (!cancelled) setCheckingConflicts(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, formData.date, formData.time, formData.duration, formData.member_ids.join(','), initialData?.id]);

  if (!isOpen) return null;

  const isEditingPastMeeting = !!initialData && !!formData.date && !!formData.time && toDateTimeMs(formData.date, formData.time) < Date.now();

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
      const data = await generateMeetingLink({
        platform: formData.platform,
        title: formData.title,
        date: formData.date,
        time: formData.time,
        duration: formData.duration,
        project_id: formData.project_ids[0]
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
    if (!formData.objective || !formData.objective.replace(/^\d+\.\s*/gm, '').trim()) {
      setError('Vui lòng nhập Mục tiêu / Kết quả mong đợi của cuộc họp');
      isSubmittingRef.current = false;
      return;
    }

    setIsLoading(true);
    try {
      // Must await — otherwise isLoading resets before the create request
      // finishes, the button re-enables while still in flight, and repeated
      // clicks fire off duplicate meetings.
      await onSave({ ...formData, meeting_url: formData.link });
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra');
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Thành viên tham gia</label>
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
                <p className="text-[11px] text-[#94a3b8] mt-1.5 leading-relaxed">Bấm <b>“+ Cả team”</b> để nạp toàn bộ thành viên của (các) dự án đã chọn, rồi bỏ bớt người không cần.</p>
              </div>

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
                  <p className="text-[11px] text-[#94a3b8] mt-2">Đang kiểm tra trùng lịch...</p>
                )}
                {!checkingConflicts && formData.member_ids.length > 0 && (
                  scheduleConflicts.length > 0 ? (
                    <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800">
                      <p className="font-bold mb-1">⚠ {scheduleConflicts.length} người có thể trùng lịch:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {scheduleConflicts.map((c, i) => (
                          <li key={i}><b>{c.name}</b> đang có meeting khác: {c.meetingTitle}</li>
                        ))}
                      </ul>
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
                      ✓ Người tham gia hiện tại đang rảnh trong khung giờ này
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
                          disabled={isGeneratingLink}
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
              disabled={isLoading}
              className="px-4 py-2 flex items-center gap-2 text-xs font-bold text-white bg-[#0058be] rounded-lg hover:bg-[#0058be]/90 transition-colors disabled:opacity-70 shadow-sm"
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
