import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar as CalendarIcon, Sparkles, RefreshCw, Copy, Check } from 'lucide-react';
import { generateMeetingLink, generateAiMeetingContent, getProjects, getMembers, getProjectMembers, getMeetings } from '@/lib/api';
import SearchableSelect from '@/components/common/SearchableSelect';

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
  transcript?: string;
  auto_summarize?: boolean;
  objective?: string;
  agenda?: string;
  project_ids: number[];
  member_ids: number[];
  reminder_minutes: number;
  notify_channels: string[];
}

const NOTIFY_CHANNEL_OPTIONS = ['App', 'Telegram', 'Zalo', 'Nhóm dự án', 'Email'];

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
  const [aiContentGenerated, setAiContentGenerated] = useState(false);
  const [isFillingTeam, setIsFillingTeam] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState('');
  const [manualTitleEdit, setManualTitleEdit] = useState(false);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [scheduleConflicts, setScheduleConflicts] = useState<{ member_id: number; name: string; meetingTitle: string }[]>([]);
  // Tracks project_ids across renders so the member-cascade effect below can
  // tell which project was just REMOVED (vs. this being the modal's initial
  // open/reset, where "removing" everything would be wrong).
  const prevProjectIdsRef = useRef<number[]>([]);

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
      const today = new Date().toISOString().split('T')[0];
      setFormData({
        title: '',
        platform: 'Google Meet',
        date: today,
        time: '09:00',
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
    setAiContentGenerated(false);
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
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCheckingConflicts(true);
      try {
        const res: any = await getMeetings({ from_date: formData.date, to_date: formData.date });
        const items: any[] = res?.data || res || [];
        const [sh, sm] = formData.time.split(':').map(Number);
        const startMin = sh * 60 + (sm || 0);
        const dur = parseInt(formData.duration || '60', 10) || 60;
        const endMin = startMin + dur;
        const found: { member_id: number; name: string; meetingTitle: string }[] = [];
        (Array.isArray(items) ? items : []).forEach((mt: any) => {
          if (!mt || mt.id === initialData?.id || !mt.time) return;
          const [oh, om] = String(mt.time).split(':').map(Number);
          const oStart = oh * 60 + (om || 0);
          let oEnd = oStart + 60;
          if (mt.end_time) {
            const [eh, em] = String(mt.end_time).split(':').map(Number);
            oEnd = eh * 60 + (em || 0);
          }
          if (startMin >= oEnd || oStart >= endMin) return;
          (mt.members || []).forEach((mm: any) => {
            if (mm.member_id && formData.member_ids.includes(mm.member_id)) {
              found.push({ member_id: mm.member_id, name: mm.display_name || `#${mm.member_id}`, meetingTitle: mt.title });
            }
          });
        });
        if (!cancelled) setScheduleConflicts(found);
      } catch {
        if (!cancelled) setScheduleConflicts([]);
      } finally {
        if (!cancelled) setCheckingConflicts(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, formData.date, formData.time, formData.duration, formData.member_ids.join(','), initialData?.id]);

  if (!isOpen) return null;

  // Parse current HH:mm to 12-hour AM/PM
  const timeParts = (formData.time || '09:00').split(':');
  const h24 = parseInt(timeParts[0] || '9', 10);
  const minuteStr = timeParts[1] || '00';
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;

  const handleTimeChange = (h12Val: number, mVal: string, pVal: 'AM' | 'PM') => {
    let newH24 = h12Val;
    if (pVal === 'AM') {
      newH24 = h12Val === 12 ? 0 : h12Val;
    } else {
      newH24 = h12Val === 12 ? 12 : h12Val + 12;
    }
    const formattedHour = String(newH24).padStart(2, '0');
    setFormData({ ...formData, time: `${formattedHour}:${mVal}` });
  };

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
        duration: formData.duration
      });
      if (data.success && data.join_url) {
        const fullUrl = data.join_url.startsWith('http') ? data.join_url : `https://${data.join_url}`;
        setFormData(prev => ({ ...prev, link: fullUrl }));
      } else {
        setError('Không thể tạo link meeting tự động');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Lỗi khi tạo link meeting');
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return; // synchronous guard — see ref comment above
    isSubmittingRef.current = true;
    setError('');

    if (!formData.title || !formData.date || !formData.time) {
      setError('Vui lòng điền đầy đủ thông tin bắt buộc (Tên, Ngày, Giờ)');
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

  const handleGenerateAiContent = async () => {
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
        setFormData(prev => ({ ...prev, objective: res.goal || prev.objective, agenda: res.agenda || prev.agenda }));
        setAiContentGenerated(true);
      } else {
        setError('AI không đề xuất được nội dung, hãy nhập trực tiếp');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'AI đề xuất thất bại');
    } finally {
      setIsGeneratingAiContent(false);
    }
  };

  // Mirrors the server's prep-score formula (meeting_score_engine.py) for instant feedback.
  const hasObjective = Boolean(formData.objective && formData.objective.trim());
  const hasAgenda = Boolean(formData.agenda && formData.agenda.trim());
  const rawReadiness = (formData.title ? 2 : 0) + (formData.project_ids.length ? 3 : 0) + (hasObjective ? 8 : 0) + (hasAgenda ? 10 : 0) + (formData.date && formData.time ? 2 : 0);
  const readinessScore = hasObjective && hasAgenda ? rawReadiness : Math.min(rawReadiness, 5);

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
              {initialData ? 'Sửa Meeting' : 'Tạo Meeting mới'}
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Mục tiêu & kết quả mong đợi *</label>
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
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Agenda / vấn đề cần xử lý</label>
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

            {/* AI Meeting Copilot — đặt sau Mục tiêu/Agenda: gõ tay trước, cần thì mới nhờ AI đề xuất/viết lại.
                Thu gọn còn 1 dòng sau khi đã chạy 1 lần, để không chiếm diện tích cố định trong form. */}
            {aiContentGenerated ? (
              <div className="flex items-center justify-between px-3.5 py-2 bg-[#f6f3ff] border border-[#ddd6fe] rounded-xl">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#6d28d9]">
                  <Sparkles size={13} /> Đã tạo đề xuất bằng AI
                </span>
                <button
                  type="button"
                  onClick={handleGenerateAiContent}
                  disabled={isGeneratingAiContent}
                  className="flex items-center gap-1 text-[11px] font-bold text-[#6d28d9] hover:underline disabled:opacity-60"
                >
                  <RefreshCw size={12} className={isGeneratingAiContent ? 'animate-spin' : ''} />
                  {isGeneratingAiContent ? 'Đang soạn...' : 'Tạo lại'}
                </button>
              </div>
            ) : (
              <div className="bg-[#f6f3ff] border border-[#ddd6fe] rounded-xl p-3.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#e7e3ff] text-[#6d28d9] flex items-center justify-center shrink-0">
                  <Sparkles size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-[#6d28d9]">AI Meeting Copilot</p>
                  <p className="text-[11px] text-[#516079] leading-relaxed">Chưa biết viết gì? Để AI soạn hộ mục tiêu & agenda từ tên cuộc họp, rồi bạn chỉnh lại.</p>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateAiContent}
                  disabled={isGeneratingAiContent}
                  className="px-3 py-2 text-[11px] font-bold text-white bg-[#6d28d9] hover:bg-[#5b21b6] rounded-lg transition-colors disabled:opacity-60 shrink-0"
                >
                  {isGeneratingAiContent ? 'Đang soạn...' : '✦ AI đề xuất'}
                </button>
              </div>
            )}

            {/* 3. Người tham gia & thời gian */}
            <SectionLabel n={3} label="Người tham gia & thời gian" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Thành viên tham gia</label>
                  <button
                    type="button"
                    onClick={handleFillTeam}
                    disabled={isFillingTeam}
                    className="text-[11px] font-bold text-[#0058be] hover:underline disabled:opacity-50"
                  >
                    {isFillingTeam ? 'Đang tải...' : '+ Cả team'}
                  </button>
                </div>
                <SearchableSelect
                  label="thành viên"
                  icon="👥"
                  showAvatar
                  isMulti
                  className="w-full"
                  options={membersList.map((m: any) => ({ id: m.id, name: m.display_name || m.full_name || `#${m.id}` }))}
                  value={formData.member_ids}
                  onChange={(ids: number[]) => setFormData({ ...formData, member_ids: ids })}
                />
                <p className="text-[11px] text-[#94a3b8] mt-1.5 leading-relaxed">Bấm <b>“+ Cả team”</b> để nạp toàn bộ thành viên của (các) dự án đã chọn, rồi bỏ bớt người không cần.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Thời gian họp *</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={formData.date}
                    onChange={e => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  />
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

                <div className="flex items-center gap-1 mt-2">
                  <select
                    value={hour12}
                    onChange={e => handleTimeChange(parseInt(e.target.value, 10), minuteStr, period)}
                    className="flex-1 px-2 py-2.5 border border-[#c2c6d6] rounded-lg text-xs bg-white focus:outline-none focus:border-[#0058be] transition-all text-center font-bold text-[#0b1c30]"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                    ))}
                  </select>
                  <span className="text-[#c2c6d6] font-bold">:</span>
                  <select
                    value={minuteStr}
                    onChange={e => handleTimeChange(hour12, e.target.value, period)}
                    className="flex-1 px-2 py-2.5 border border-[#c2c6d6] rounded-lg text-xs bg-white focus:outline-none focus:border-[#0058be] transition-all text-center font-bold text-[#0b1c30]"
                  >
                    {Array.from(new Set(['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', minuteStr])).sort().map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <div className="flex rounded-lg border border-[#c2c6d6] overflow-hidden bg-[#f0f2f5] p-0.5 ml-0.5">
                    <button
                      type="button"
                      onClick={() => handleTimeChange(hour12, minuteStr, 'AM')}
                      className={`px-2 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                        period === 'AM' ? 'bg-[#0058be] text-white shadow-sm' : 'text-[#565e74] hover:text-[#0b1c30]'
                      }`}
                    >
                      AM
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTimeChange(hour12, minuteStr, 'PM')}
                      className={`px-2 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                        period === 'PM' ? 'bg-[#0058be] text-white shadow-sm' : 'text-[#565e74] hover:text-[#0b1c30]'
                      }`}
                    >
                      PM
                    </button>
                  </div>
                </div>

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
                  {formData.link && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(formData.link);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:underline"
                    >
                      {copiedLink ? <Check size={13} /> : <Copy size={13} />}
                      {copiedLink ? 'Đã sao chép!' : 'Sao chép link'}
                    </button>
                  )}
                  {(formData.platform === 'Zoom' || formData.platform === 'Google Meet') && (
                    <button
                      type="button"
                      onClick={handleGenerateLink}
                      disabled={isGeneratingLink}
                      className="flex items-center gap-1 text-[11px] font-bold text-[#0058be] hover:underline disabled:opacity-50"
                    >
                      <Sparkles size={13} className={isGeneratingLink ? 'animate-spin text-amber-500' : 'text-[#0058be]'} />
                      {isGeneratingLink ? 'Đang tạo link...' : `⚡ Tạo link ${formData.platform}`}
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={formData.platform}
                  onChange={e => setFormData({ ...formData, platform: e.target.value })}
                  className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
                >
                  <option value="Google Meet">💻 Google Meet</option>
                  <option value="Zoom">🎥 Zoom</option>
                </select>
                <input
                  type="text"
                  value={formData.link}
                  onChange={e => setFormData({ ...formData, link: e.target.value })}
                  placeholder={formData.platform === 'Zoom' ? 'https://zoom.us/j/...' : formData.platform === 'Google Meet' ? 'https://meet.google.com/...' : 'https://...'}
                  className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors placeholder:text-[#c2c6d6]"
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
              {formData.platform === 'Google Meet' && (
                <div className="mt-2 p-3 bg-[#eff6ff] border border-[#bfdbfe] rounded-lg text-[11px] text-[#1e40af] leading-relaxed flex items-start gap-2">
                  <span className="material-symbols-outlined text-[#2563eb] text-[16px] shrink-0 mt-0.5">info</span>
                  <div>
                    <span className="font-bold">Lưu ý host cuộc họp:</span> Link Google Meet dùng tài khoản chung <b>mkt.szone@gmail.com</b>. Người đóng vai trò host (duyệt người tham gia vào phòng chờ) cần đăng nhập Google bằng đúng tài khoản này trước khi bấm vào link, nếu không sẽ không ai duyệt được.
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
              <div className="grid grid-cols-[140px_1fr] gap-3">
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
              <p className="text-[11px] text-[#94a3b8] mt-1.5 leading-relaxed">Hệ thống sẽ tự động nhắc qua các kênh đã chọn đúng vào mốc thời gian này (Email chỉ gửi được nếu SMTP đã được cấu hình).</p>
            </div>

            <div className="border border-[#e2e8f0] rounded-xl p-3 bg-[#fafbfc] space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-[#475569]">
                <span>Mức sẵn sàng trước họp</span>
                <span>{readinessScore}/25 điểm</span>
              </div>
              <div className="h-1.5 bg-[#e7ebf1] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${(readinessScore / 25) * 100}%`, background: 'linear-gradient(90deg,#635bff,#35b58d)' }}
                />
              </div>
              {(!hasObjective || !hasAgenda) && (
                <p className="text-[10px] text-amber-700">Thiếu mục tiêu hoặc agenda sẽ giới hạn điểm Chuẩn bị tối đa 5/25.</p>
              )}
            </div>

            {/* Auto AI Summary Notice */}
            <div className="bg-[#f6f3ff] border border-[#ddd6fe] rounded-xl p-3.5 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-[#6d28d9] text-xs">
                <Sparkles size={14} />
                <span>Tự động thu âm & AI Summary</span>
              </div>
              <p className="text-[11px] text-[#516079] leading-relaxed font-medium">
                Khi cuộc họp kết thúc, hệ thống sẽ tự động đồng bộ transcript từ link Zoom hoặc Google Meet để AI phân tích và gợi ý task vào dự án.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-[#f8f9fe] border-t border-[#c2c6d6]/40 flex items-center justify-end gap-3 shrink-0">
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
              {isLoading ? 'Đang xử lý...' : (initialData ? 'Cập nhật' : 'Tạo meeting')}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
