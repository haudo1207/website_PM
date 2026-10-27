import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Calendar as CalendarIcon, Sparkles, RefreshCw, Copy, Check, Clipboard } from 'lucide-react';
import { generateMeetingLink, retryMeetingLink, checkMeetingConflict, generateAiMeetingContent, getProjects, getMembersForProjects, getMeetingHosts, getApiErrorMessage } from '@/lib/api';
import SearchableSelect, { SearchableSelectHandle } from '@/components/common/SearchableSelect';

interface CreateMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (meeting: any) => void | Promise<void>;
  initialData?: any;
  // Workspace→Project filter (chốt 2026-09-15): the caller's currently-active
  // Navbar Workspace switcher value (useWorkspaceFilter's workspaceCode), so
  // a multi-Workspace admin picking a project for a NEW meeting only sees
  // one Workspace's projects at a time instead of everything mixed together.
  workspaceCode?: string | null;
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
  // External guests, email-only (chốt 2026-10-28) — added to the Calendar
  // event's attendees[] purely so they can join the Meet call directly
  // (Quick Access/Trusted), no system account. Separate from member_ids —
  // never shown in "Thành viên tham gia", never attendance-tracked.
  guest_emails: string[];
}

const NOTIFY_CHANNEL_OPTIONS = ['App', 'Zalo', 'Nhóm dự án'];
// Default duration for a freshly-opened create form (chốt 2026-09-22).
const DEFAULT_DURATION_MINUTES = '30';
// Mirrors backend's _EMAIL_RE (meetings.py) — basic format check only.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

// Weekday + day + tháng, no year (chốt 2026-09-22 — wheel picker never shows a year).
function formatWheelDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  return `${SUMMARY_WEEKDAYS[d.getDay()]}, ${dd} tháng ${d.getMonth() + 1}`;
}
function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WHEEL_ITEM_HEIGHT = 36;
const WHEEL_VISIBLE_ROWS = 3;

// One scrollable, snap-to-center column of a wheel picker (date, hour or
// minute) — the selected item is whichever one lands in the middle row.
function WheelColumn<T>({ items, selectedIndex, onSelect, renderItem, width }: {
  items: T[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  renderItem: (item: T, isSelected: boolean) => React.ReactNode;
  width?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards the onScroll handler against the programmatic scrollTo below —
  // without it, re-centering after a prop change would misread its OWN
  // scroll as a fresh user pick and immediately re-trigger onSelect.
  const isProgrammaticScrollRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTo({ top: selectedIndex * WHEEL_ITEM_HEIGHT, behavior: 'auto' });
    const t = setTimeout(() => { isProgrammaticScrollRef.current = false; }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, items.length]);

  const handleScroll = () => {
    if (isProgrammaticScrollRef.current) return;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / WHEEL_ITEM_HEIGHT)));
      if (idx !== selectedIndex) onSelect(idx);
    }, 100);
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      // `relative` (chốt 2026-09-22 fix): without an explicit position, this
      // column paints BELOW the highlight band next door — which is
      // `absolute` — regardless of DOM order (positioned elements always
      // paint over static in-flow content), hiding the selected row's text
      // behind the opaque highlight. Being positioned + later in the DOM
      // than the highlight puts this column's text on top instead.
      className="relative overflow-y-auto snap-y snap-mandatory no-scrollbar"
      style={{ height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ROWS, width }}
    >
      <div style={{ height: WHEEL_ITEM_HEIGHT }} />
      {items.map((item, i) => (
        <div
          key={i}
          onClick={() => onSelect(i)}
          className="snap-center flex items-center justify-center cursor-pointer select-none"
          style={{ height: WHEEL_ITEM_HEIGHT }}
        >
          {renderItem(item, i === selectedIndex)}
        </div>
      ))}
      <div style={{ height: WHEEL_ITEM_HEIGHT }} />
    </div>
  );
}

// Single-row wheel picker: date, giờ, phút side by side, no calendar grid and
// no separate tiers (chốt 2026-09-22). The centered row is the selection.
function DateTimeWheelPicker({ date, time, onChange, onConfirm }: {
  date: string;
  time: string;
  onChange: (date: string, time: string) => void;
  onConfirm: () => void;
}) {
  const { dates, dateIndex } = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const base = date ? new Date(date + 'T00:00:00') : today;
    let start = new Date(today); start.setDate(start.getDate() - 30);
    let end = new Date(today); end.setDate(end.getDate() + 180);
    if (base < start) start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 5);
    if (base > end) end = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 5);
    const list: Date[] = [];
    for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) list.push(new Date(cur));
    const idx = list.findIndex(d => toDateInputValue(d) === toDateInputValue(base));
    return { dates: list, dateIndex: idx < 0 ? 0 : idx };
  }, [date]);

  const [hh, mm] = (time || '00:00').split(':');
  const hourIndex = HOUR_OPTIONS.indexOf(hh) >= 0 ? HOUR_OPTIONS.indexOf(hh) : 0;
  const minuteIndex = MINUTE_OPTIONS.indexOf(mm) >= 0 ? MINUTE_OPTIONS.indexOf(mm) : 0;

  return (
    <div className="absolute z-20 top-full left-0 mt-2 w-[320px] bg-white border border-[#c2c6d6] rounded-xl shadow-xl p-3">
      <div className="relative flex items-stretch justify-center">
        <div
          className="pointer-events-none absolute left-0 right-0 bg-[#eff4ff] border border-[#bfdbfe] rounded-lg"
          style={{ top: WHEEL_ITEM_HEIGHT, height: WHEEL_ITEM_HEIGHT }}
        />
        <WheelColumn
          items={dates}
          selectedIndex={dateIndex}
          onSelect={i => onChange(toDateInputValue(dates[i]), time)}
          renderItem={(d, sel) => (
            <span className={`text-xs whitespace-nowrap ${sel ? 'font-black text-[#0058be]' : 'font-medium text-[#94a3b8]'}`}>{formatWheelDate(d)}</span>
          )}
          width={188}
        />
        <WheelColumn
          items={HOUR_OPTIONS}
          selectedIndex={hourIndex}
          onSelect={i => onChange(date, `${HOUR_OPTIONS[i]}:${mm}`)}
          renderItem={(h, sel) => (
            <span className={`text-sm ${sel ? 'font-black text-[#0058be]' : 'font-medium text-[#94a3b8]'}`}>{h}</span>
          )}
          width={44}
        />
        <div className="relative flex items-center justify-center text-sm font-black text-[#565e74]" style={{ height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ROWS }}>:</div>
        <WheelColumn
          items={MINUTE_OPTIONS}
          selectedIndex={minuteIndex}
          onSelect={i => onChange(date, `${hh}:${MINUTE_OPTIONS[i]}`)}
          renderItem={(m, sel) => (
            <span className={`text-sm ${sel ? 'font-black text-[#0058be]' : 'font-medium text-[#94a3b8]'}`}>{m}</span>
          )}
          width={44}
        />
      </div>
      <div className="flex justify-end mt-2 pt-2 border-t border-[#e6ebf3]">
        <button
          type="button"
          onClick={onConfirm}
          className="px-4 py-1.5 bg-[#0058be] text-white text-xs font-bold rounded-lg hover:bg-[#00479a] transition-colors"
        >
          Xác nhận
        </button>
      </div>
    </div>
  );
}

// ── Typed date/time entry (in addition to the wheel picker) ──
// Digits only: separators are inserted automatically ("2210" → "22/10",
// "1430" → "14:30"), anything else typed is dropped.
function maskFourDigits(raw: string, sep: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}${sep}${digits.slice(2)}` : digits;
}
function formatDayMonth(dateStr: string): string {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}
// "22" → day 22 of the current value's month; "2210" → 22/10. No year is
// typed: keep the current value's year, but roll a date that would land more
// than 30 days in the past into next year (the wheel's own range starts
// 30 days back). Returns YYYY-MM-DD, or null if the day/month don't exist.
function parseDayMonth(digits: string, baseDate: string, today: Date = new Date()): string | null {
  if (!digits) return null;
  const base = baseDate ? new Date(baseDate + 'T00:00:00') : new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = Number(digits.slice(0, 2));
  const month = digits.length > 2 ? Number(digits.slice(2)) : base.getMonth() + 1;
  if (day < 1 || month < 1 || month > 12) return null;
  const build = (year: number) => {
    const d = new Date(year, month - 1, day);
    return d.getMonth() === month - 1 ? d : null;
  };
  let d = build(base.getFullYear());
  if (!d) return null;
  const floor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
  if (d < floor) d = build(base.getFullYear() + 1) || d;
  return toDateInputValue(d);
}
// "9" → 09:00, "930" → 09:30, "1430" → 14:30. Returns HH:MM or null.
function parseHourMinute(digits: string): string | null {
  if (!digits) return null;
  let h: number, m: number;
  if (digits.length <= 2) { h = Number(digits); m = 0; }
  else if (digits.length === 3) { h = Number(digits[0]); m = Number(digits.slice(1)); }
  else { h = Number(digits.slice(0, 2)); m = Number(digits.slice(2)); }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// The closed "Thời gian bắt đầu" field: day and time are typeable; the
// calendar icon still opens DateTimeWheelPicker. Drafts stay local while
// typing and only reach formData once committed, so the conflict check
// (keyed on formData.date/time) never fires on a half-typed "14:3".
function DateTimeTypeInput({ date, time, onChange, onTogglePicker, onErrorChange }: {
  date: string;
  time: string;
  onChange: (date: string, time: string) => void;
  onTogglePicker: () => void;
  // Lets the parent block submit while a typed day/time is showing red —
  // the committed formData.date/time stays the last VALID value, so without
  // this the parent has no way to know an invalid draft is on screen.
  onErrorChange?: (hasError: boolean) => void;
}) {
  const [dayDraft, setDayDraft] = useState(formatDayMonth(date));
  const [timeDraft, setTimeDraft] = useState(time);
  const [error, setError] = useState('');
  const dayRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onErrorChange?.(!!error);
    // Only the error text itself should drive this — onErrorChange is an
    // inline setState passed fresh every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // Follow changes made elsewhere (wheel picker, form reset) unless the user
  // is mid-typing in that box.
  useEffect(() => {
    if (document.activeElement !== dayRef.current) setDayDraft(formatDayMonth(date));
  }, [date]);
  useEffect(() => {
    if (document.activeElement !== timeRef.current) setTimeDraft(time);
  }, [time]);

  const commitDay = (draft: string): boolean => {
    const digits = draft.replace(/\D/g, '');
    if (!digits) { setDayDraft(formatDayMonth(date)); setError(''); return false; }
    const next = parseDayMonth(digits, date);
    if (!next) { setError('Ngày không hợp lệ'); return false; }
    setError('');
    setDayDraft(formatDayMonth(next));
    if (next !== date) onChange(next, time);
    return true;
  };
  const commitTime = (draft: string): boolean => {
    const digits = draft.replace(/\D/g, '');
    if (!digits) { setTimeDraft(time); setError(''); return false; }
    const next = parseHourMinute(digits);
    if (!next) { setError('Giờ không hợp lệ'); return false; }
    setError('');
    setTimeDraft(next);
    if (next !== time) onChange(date, next);
    return true;
  };

  const weekday = date ? SUMMARY_WEEKDAYS[new Date(date + 'T00:00:00').getDay()] : '';
  const inputClass = 'bg-transparent outline-none text-xs text-[#0b1c30] font-medium tabular-nums p-0 placeholder:text-[#94a3b8]';

  return (
    <>
      <div className={`w-full px-3 py-2 border ${error ? 'border-red-400' : 'border-[#c2c6d6]'} rounded-lg bg-white focus-within:border-[#0058be] transition-colors flex items-center gap-1.5`}>
        <span className="text-xs text-[#94a3b8] font-medium w-5 shrink-0">{weekday}</span>
        <input
          ref={dayRef}
          value={dayDraft}
          inputMode="numeric"
          placeholder="dd/mm"
          aria-label="Ngày bắt đầu (dd/mm)"
          className={`${inputClass} w-[42px]`}
          onChange={e => {
            const masked = maskFourDigits(e.target.value, '/');
            setDayDraft(masked);
            if (error) setError('');
            // A full dd/mm moves straight on to the time, emptied for retyping
            // (an empty time box restores the old time on blur).
            if (masked.length === 5 && commitDay(masked)) {
              setTimeDraft('');
              timeRef.current?.focus();
            }
          }}
          // Read the live input value: on the auto-jump above, blur fires
          // before the re-render, so the dayDraft state here is one keystroke stale.
          onBlur={e => commitDay(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitDay(e.currentTarget.value); } }}
        />
        <span className="text-xs text-[#94a3b8]">·</span>
        <input
          ref={timeRef}
          value={timeDraft}
          inputMode="numeric"
          placeholder="hh:mm"
          aria-label="Giờ bắt đầu (hh:mm)"
          className={`${inputClass} w-[40px]`}
          onChange={e => {
            const masked = maskFourDigits(e.target.value, ':');
            setTimeDraft(masked);
            if (error) setError('');
            if (masked.length === 5) commitTime(masked);
          }}
          onBlur={e => commitTime(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitTime(e.currentTarget.value); } }}
        />
        <button
          type="button"
          onClick={onTogglePicker}
          aria-label="Chọn ngày giờ"
          title="Chọn ngày giờ"
          className="ml-auto text-[#0058be] hover:text-[#00479a] shrink-0"
        >
          <CalendarIcon size={13} />
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600 font-semibold mt-1">{error}</p>}
    </>
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

export default function CreateMeetingModal({ isOpen, onClose, onSave, initialData, workspaceCode }: CreateMeetingModalProps) {
  const [formData, setFormData] = useState<MeetingFormData>({
    title: '',
    platform: 'Google Meet',
    date: '',
    time: '',
    duration: DEFAULT_DURATION_MINUTES,
    link: '',
    transcript: '',
    auto_summarize: true,
    objective: '',
    agenda: '',
    project_ids: [],
    member_ids: [],
    reminder_minutes: 15,
    notify_channels: ['App'],
    guest_emails: []
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
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState('');
  const [manualTitleEdit, setManualTitleEdit] = useState(false);
  // Khách ngoài qua email (chốt 2026-10-28) — draft text for the tag input
  // below, plus a basic-format error shown only for what's currently typed.
  const [guestEmailDraft, setGuestEmailDraft] = useState('');
  const [guestEmailError, setGuestEmailError] = useState('');
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  // Overlap rule (chốt 2026-09-13): organizer is the source of truth, not
  // participants — at most ONE conflicting meeting is possible per the
  // backend's own check (same Gmail host can't be in two calls at once),
  // so this is a single nullable result, not a per-member list.
  const [organizerConflict, setOrganizerConflict] = useState<{ message: string; organizer_google_email: string } | null>(null);
  const [suggestedSlots, setSuggestedSlots] = useState<string[]>([]);
  // chốt 2026-10-28: Workspace chosen as Host has no LIVE connected Google
  // account (only Workspace.expected_google_email set, never re-consented) —
  // backend can't resolve a real account to check a schedule against, so it
  // reports this instead of guessing. Distinct from organizerConflict (which
  // means "checked, and it's busy") — this means "couldn't check at all".
  const [hostNotConnected, setHostNotConnected] = useState(false);
  // Soft, non-blocking warning only — unlike organizerConflict above, this
  // never affects whether "Tạo meeting" can be submitted (chốt: Host is
  // hard-blocked because the Bot can only hold 1 Meet tab per Gmail profile;
  // a human participant has no such limit, they can just choose which
  // meeting to actually attend).
  const [memberConflicts, setMemberConflicts] = useState<Array<{ member_id: number; member_name: string; conflicting_meeting_title: string; conflicting_meeting_time: string }>>([]);
  const [showTimePicker, setShowTimePicker] = useState(false);
  // Mirrors DateTimeTypeInput's own red-border validation state — the typed
  // day/time field only pushes a COMMITTED (valid) value into formData, so
  // without this handleSubmit would happily submit the last-valid date/time
  // while the field is still showing an error for what the user just typed.
  const [hasTimeInputError, setHasTimeInputError] = useState(false);
  const timePickerWrapperRef = useRef<HTMLDivElement>(null);
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
  // A meeting being edited can already have a participant who isn't a
  // formal project_members row of any currently-selected project (an
  // outside guest invited just for this meeting) — feature 010 scopes
  // membersList to the selected projects, so that person's name/avatar
  // would otherwise disappear from the picker/chips the moment the modal
  // opens, even though they deliberately stay selected (pruning only fires
  // on an actual project deselection, see the membersList effect below).
  // Seeded once from initialData.members at open time, used as a fallback
  // for options/name lookups only — never sent to "+ Cả team".
  const extraMemberInfoRef = useRef<Record<number, { id: number; display_name: string }>>({});

  useEffect(() => {
    if (!showTimePicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (timePickerWrapperRef.current && !timePickerWrapperRef.current.contains(e.target as Node)) {
        setShowTimePicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTimePicker]);

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
        // Explicit null, not left `undefined` (initialData never carries this
        // field) — matches originalHostWorkspaceIdRef's null default so the
        // change-detection comparison in handleSubmit can't false-positive
        // before the async hosts-resolution effect below has run.
        host_workspace_id: null,
        // Prefill from the meeting's real MeetingMember rows (member_id, not
        // the synthesized "Host" entry which has no member_id) so editing
        // doesn't silently drop everyone already added.
        member_ids: (initialData.members || [])
          .map((mm: any) => mm.member_id)
          .filter((id: any) => id !== undefined && id !== null),
        reminder_minutes: initialData.reminder_minutes ?? 15,
        notify_channels: Array.isArray(initialData.notify_channels) && initialData.notify_channels.length
          ? initialData.notify_channels
          : ['App'],
        guest_emails: Array.isArray(initialData.guest_emails) ? initialData.guest_emails : []
      });
      extraMemberInfoRef.current = {};
      (initialData.members || []).forEach((mm: any) => {
        if (mm && mm.member_id != null) {
          extraMemberInfoRef.current[mm.member_id] = { id: mm.member_id, display_name: mm.display_name };
        }
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
        duration: DEFAULT_DURATION_MINUTES,
        link: '',
        transcript: '',
        auto_summarize: true,
        objective: '',
        agenda: '',
        project_ids: [],
        member_ids: [],
        reminder_minutes: 15,
        notify_channels: ['App'],
        guest_emails: []
      });
      setManualTitleEdit(false);
      setHostManuallySet(false);
      extraMemberInfoRef.current = {};
    }
    prevProjectIdsRef.current = openedProjectIds;
    setError('');
    setShowTimePicker(false);
  }, [initialData, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    // Workspace→Project filter (chốt 2026-09-15): only narrows the picker on
    // CREATE. Never applied on EDIT — an already-assigned project must never
    // disappear from the dropdown just because the caller's Workspace switcher
    // happens to be pointed elsewhere right now (rule: "Không được làm mất
    // Project hiện tại chỉ vì FE filter sai"). `business_unit` already OR's
    // the user's own assigned projects back in regardless of Workspace
    // (backend/app/routers/projects.py), so this never hides a project a
    // restricted member/leader is genuinely assigned to.
    getProjects(!initialData && workspaceCode ? { business_unit: workspaceCode } : undefined).then((res: any) => {
      const items = res?.data || res || [];
      if (Array.isArray(items)) setProjectsList(items);
    }).catch(() => {});
  }, [isOpen, initialData, workspaceCode]);

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

  // Thành viên tham gia phải luôn nằm trong scope hiện tại (chốt
  // 2026-09-22, feature 010 + follow-up): chưa chọn project nào -> scope
  // theo Workspace đang chọn (hoặc mọi project user có quyền, nếu đang ở
  // "Tất cả Workspace"), không còn trả về rỗng — không còn load toàn bộ
  // Member hệ thống trong mọi trường hợp. Đổi project_ids -> refetch union
  // member của các project đó; đổi Workspace -> projectsList đổi theo
  // (effect ở trên) và businessUnit đổi theo đây, cả hai cùng kéo
  // membersList đổi theo scope mới.
  useEffect(() => {
    if (!isOpen) return;
    const prevIds = prevProjectIdsRef.current;
    const currentIds = formData.project_ids;
    // Chỉ prune member_ids khi có project THỰC SỰ bị bỏ chọn — không phải
    // mỗi lần effect chạy, vì lần đầu mở modal Edit prevIds === currentIds
    // (set bởi effect reset ở trên) và initialData.members có thể chứa
    // người không nằm trong project_members chính thức (khách mời ngoài dự
    // án) mà việc mở modal không được phép âm thầm xoá họ khỏi form.
    const aProjectWasRemoved = prevIds.some(id => !currentIds.includes(id));
    prevProjectIdsRef.current = currentIds;
    let cancelled = false;
    // Cùng rule workspace-narrowing với projectsList ở effect trên: chỉ áp
    // dụng lúc CREATE, không áp dụng lúc EDIT.
    const businessUnitScope = !initialData && workspaceCode ? workspaceCode : undefined;
    getMembersForProjects(currentIds, businessUnitScope).then((res: any) => {
      if (cancelled) return;
      const items = Array.isArray(res) ? res : (res?.data || []);
      setMembersList(items);
      if (!aProjectWasRemoved) return;
      // Bỏ chọn 1 dự án -> tự bỏ luôn các thành viên không còn thuộc BẤT KỲ
      // dự án nào đang chọn (thành viên vẫn thuộc 1 dự án khác đang chọn thì
      // giữ nguyên — items đã LÀ union của toàn bộ project_ids hiện tại).
      const eligibleIds = new Set(items.map((m: any) => m.id));
      setFormData(prev => {
        const kept = prev.member_ids.filter(mid => eligibleIds.has(mid));
        return kept.length === prev.member_ids.length ? prev : { ...prev, member_ids: kept };
      });
    }).catch(() => { if (!cancelled) setMembersList([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialData, workspaceCode, formData.project_ids.join(',')]);

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
      setMemberConflicts([]);
      setHostNotConnected(false);
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
          member_ids: formData.member_ids,
        });
        const res = await check(formData.time);
        if (cancelled) return;
        setMemberConflicts(Array.isArray(res?.member_conflicts) ? res.member_conflicts : []);
        setHostNotConnected(!!res?.host_not_connected);
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
        if (!cancelled) { setOrganizerConflict(null); setSuggestedSlots([]); setMemberConflicts([]); setHostNotConnected(false); }
      } finally {
        if (!cancelled) setCheckingConflicts(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, formData.date, formData.time, formData.duration, formData.project_ids.join(','), formData.host_workspace_id, formData.member_ids.join(','), initialData?.id]);

  if (!isOpen) return null;

  // membersList is scoped to the selected projects (feature 010); a
  // currently-selected participant outside that scope (edit mode's outside
  // guest, see extraMemberInfoRef above) still needs to render with their
  // real name instead of falling back to "#id" — merge them in for display
  // only, never fed to "+ Cả team".
  const displayMembersList = (() => {
    const byId = new Map(membersList.map((m: any) => [m.id, m]));
    Object.values(extraMemberInfoRef.current).forEach((m) => { if (!byId.has(m.id)) byId.set(m.id, m); });
    return Array.from(byId.values());
  })();

  const isEditingPastMeeting = !!initialData && !!formData.date && !!formData.time && toDateTimeMs(formData.date, formData.time) < Date.now();
  // Edit lifecycle lock (chốt 2026-09-14): mirrors the backend's own guard —
  // only a not-yet-started meeting (status "SẮP TỚI", the live display value
  // meeting_to_dict already computes) may be edited. ONGOING/DONE/CANCELLED
  // all read-only, no per-field exceptions. This is a frontend UX signal
  // only — the backend 400s regardless of what this modal lets through.
  const isLocked = !!initialData && initialData.status !== 'SẮP TỚI';

  // "Cả team" phải dùng chính membersList đang hiển thị trong dropdown (đã
  // scope theo project_ids qua effect ở trên, chốt feature 010) — không tự
  // fetch riêng, để không thể lệch khỏi danh sách người dùng đang thấy.
  // membersList luôn có dữ liệu (scope theo project đã chọn, hoặc theo
  // Workspace nếu chưa chọn project nào — chốt 2026-09-22 follow-up), nên
  // không còn cần chặn khi project_ids rỗng.
  const handleFillTeam = () => {
    const union = new Set(formData.member_ids);
    membersList.forEach((m: any) => { if (m && m.id) union.add(m.id); });
    setFormData(prev => ({ ...prev, member_ids: Array.from(union) }));
  };

  // Khách ngoài qua email (chốt 2026-10-28) — Enter/dấu phẩy/blur all commit
  // the current draft as one or more emails (supports pasting several at
  // once, comma or whitespace separated).
  const addGuestEmailsFromDraft = () => {
    const raw = guestEmailDraft.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (raw.length === 0) { setGuestEmailDraft(''); return; }
    const invalid = raw.filter(e => !EMAIL_RE.test(e));
    if (invalid.length > 0) {
      setGuestEmailError(`Email không hợp lệ: ${invalid.join(', ')}`);
      return;
    }
    setGuestEmailError('');
    setFormData(prev => {
      const existing = new Set(prev.guest_emails.map(e => e.toLowerCase()));
      const toAdd = raw.map(e => e.toLowerCase()).filter(e => !existing.has(e));
      return toAdd.length ? { ...prev, guest_emails: [...prev.guest_emails, ...toAdd] } : prev;
    });
    setGuestEmailDraft('');
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
    // The typed day/time box can be showing a red "invalid" error for
    // whatever the user just typed while formData.date/time still holds the
    // last COMMITTED valid value — block submit rather than silently saving
    // that stale value as if the draft didn't matter.
    if (hasTimeInputError) {
      setError('Vui lòng nhập đúng định dạng ngày/giờ');
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
      // Bug fix (found 2026-09-14, hours after shipping): this must be
      // platform-gated AND null/undefined-normalized. Two real defects
      // without both: (1) retry-link is a Google-Meet-only regeneration —
      // calling it for a Zoom meeting would silently replace its real Zoom
      // join link with a bogus Google Meet one; (2) formData.host_workspace_id
      // starts as `undefined` (never in initialData) while
      // originalHostWorkspaceIdRef.current starts as `null` — submitting
      // before the async hosts-fetch effect resolves made `undefined !== null`
      // look like a Host change on EVERY edit of EVERY platform, firing an
      // unwanted retry-link that could fail (aborting the whole save, so an
      // unrelated date/time edit silently never reached the PUT below) or
      // succeed with the wrong account/link.
      if (
        initialData?.id &&
        formData.platform === 'Google Meet' &&
        (formData.host_workspace_id ?? null) !== (originalHostWorkspaceIdRef.current ?? null)
      ) {
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
      {/* Backdrop — click-outside-to-close only; no dim/blur over the main window (chốt 2026-09-22) */}
      <div onClick={onClose} className="absolute inset-0" />

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
          <div className="p-5 space-y-3 overflow-y-auto flex-1 min-h-0">
            {error && <div className="mb-1 p-3 bg-red-50 text-red-600 text-xs rounded-lg font-semibold border border-red-200">{error}</div>}
            {isLocked && (
              <div className="mb-1 p-3 bg-amber-50 text-amber-800 text-xs rounded-lg font-semibold border border-amber-200">
                ⚠ Cuộc họp này đang ở trạng thái <b>{initialData?.status}</b> — chỉ có thể xem, không thể chỉnh sửa. Cuộc họp chưa bắt đầu (SẮP TỚI) mới được sửa.
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
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
                className="w-full px-3 py-2 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] font-semibold focus:outline-none focus:border-[#0058be] transition-colors"
              />
            </div>

            {/* 1. Phạm vi cuộc họp */}
            <SectionLabel n={1} label="Phạm vi cuộc họp" />
            <div>
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1">Dự án liên quan *</label>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
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
                  rows={3}
                  className="w-full px-3 py-2 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors resize-y"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
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
                  rows={3}
                  className="w-full px-3 py-2 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors resize-y"
                />
              </div>
            </div>

            {/* 3. Người tham gia & thời gian */}
            <SectionLabel n={3} label="Người tham gia & thời gian" />
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Thành viên tham gia *</label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleFillTeam}
                      className="text-[11px] font-bold text-[#0058be] hover:underline disabled:opacity-50"
                    >
                      + Cả team
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
                  options={displayMembersList.map((m: any) => ({ id: m.id, name: m.display_name || m.full_name || `#${m.id}` }))}
                  value={formData.member_ids}
                  onChange={(ids: number[]) => setFormData({ ...formData, member_ids: ids })}
                />
                {formData.member_ids.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {formData.member_ids.map(id => {
                      const m = displayMembersList.find((mm: any) => mm.id === id);
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
                <p className="text-[11px] text-[#94a3b8] mt-1.5 leading-relaxed">Bắt buộc chọn ít nhất 1 thành viên tham gia cuộc họp. Bấm <b>“+ Cả team”</b> để thêm nhanh toàn bộ thành viên đang hiển thị (theo dự án đã chọn, hoặc theo Workspace nếu chưa chọn dự án).</p>
              </div>

              {/* HOST * (chốt 2026-09-14): auto-selected by project's Workspace on
                  create; on edit it's pre-filled with the meeting's CURRENT Host
                  and only offers a suggestion chip when the project's Workspace
                  changed (Rule 6) — never silently overwritten (Rule 4).
                  Paired with Thành viên in the same row for a compact layout
                  (chốt 2026-09-22). Locked (ONGOING/DONE/CANCELLED) shows read-only. */}
              <div>
              {isLocked ? (
                <div>
                  <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1">Host</label>
                  <div className="w-full px-3 py-2 border border-[#e2e8f0] rounded-lg text-xs text-[#565e74] bg-[#f8f9fb]">
                    {initialData.host_google_email || initialData.organizer_google_email || 'Không xác định'}
                  </div>
                </div>
              ) : formData.platform === 'Google Meet' && (
                <div>
                  <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1">Host *</label>
                  <select
                    value={formData.host_workspace_id ?? ''}
                    onChange={e => {
                      setHostManuallySet(true);
                      setFormData(prev => ({ ...prev, host_workspace_id: e.target.value ? Number(e.target.value) : null }));
                    }}
                    className="w-full px-3 py-2 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
                  >
                    <option value="">— Chọn tài khoản Host —</option>
                    {hostsList.map(h => (
                      <option key={h.workspace_id} value={h.workspace_id}>{h.workspace_name} — {h.google_email}</option>
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
                      Dự án thuộc Workspace khác — bấm để cập nhật Host theo Workspace mới ({(() => {
                        const h = hostsList.find(h => h.workspace_id === autoSuggestedWorkspaceId);
                        return h ? `${h.workspace_name} — ${h.google_email}` : '';
                      })()})
                    </button>
                  )}
                  {initialData && (formData.host_workspace_id ?? null) !== (originalHostWorkspaceIdRef.current ?? null) && (
                    <p className="text-[11px] text-amber-700 font-semibold mt-1.5">⚠ Đổi Host sẽ tạo lại link Google Meet mới (organizer cũ không còn hiệu lực).</p>
                  )}
                </div>
              )}
              </div>
              </div>

              {/* Khách ngoài qua email (chốt 2026-10-28) — tách biệt rõ khỏi
                  "Thành viên tham gia": không có tài khoản trong hệ thống,
                  chỉ để vào thẳng Google Meet (Quick Access/Trusted), không
                  hiện trong danh sách thành viên, không điểm danh, không gửi
                  email mời gì (sendUpdates vẫn "none" như cũ). */}
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1">
                  Thêm khách ngoài qua email (chỉ để vào Meet, không cần tài khoản)
                </label>
                <input
                  type="text"
                  value={guestEmailDraft}
                  onChange={e => { setGuestEmailDraft(e.target.value); if (guestEmailError) setGuestEmailError(''); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addGuestEmailsFromDraft(); }
                  }}
                  onBlur={() => { if (guestEmailDraft.trim()) addGuestEmailsFromDraft(); }}
                  placeholder="email@vidu.com, email2@vidu.com — Enter hoặc dấu phẩy để thêm"
                  className="w-full px-3 py-2 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
                />
                {guestEmailError && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1">{guestEmailError}</p>
                )}
                {formData.guest_emails.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {formData.guest_emails.map(email => (
                      <span key={email} className="inline-flex items-center gap-1 bg-white text-[#334155] text-[11px] font-semibold pl-2 pr-1.5 py-1 rounded-full border border-slate-300">
                        {email}
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, guest_emails: prev.guest_emails.filter(e => e !== email) }))}
                          className="text-slate-400 hover:text-slate-700 font-bold leading-none px-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative" ref={timePickerWrapperRef}>
                    <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1">Thời gian bắt đầu *</label>
                    <DateTimeTypeInput
                      date={formData.date}
                      time={formData.time}
                      onChange={(d, t) => setFormData(prev => ({ ...prev, date: d, time: t }))}
                      onTogglePicker={() => setShowTimePicker(v => !v)}
                      onErrorChange={setHasTimeInputError}
                    />
                    {showTimePicker && (
                      <DateTimeWheelPicker
                        date={formData.date}
                        time={formData.time}
                        onChange={(d, t) => setFormData(prev => ({ ...prev, date: d, time: t }))}
                        onConfirm={() => setShowTimePicker(false)}
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1">Thời lượng</label>
                    <select
                      value={formData.duration}
                      onChange={e => setFormData({ ...formData, duration: e.target.value })}
                      className="w-full px-3 py-2 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
                    >
                      <option value="15">15 phút</option>
                      <option value="30">30 phút</option>
                      <option value="45">45 phút</option>
                      <option value="60">1 giờ</option>
                      <option value="90">1.5 giờ</option>
                    </select>
                  </div>
                </div>

                {isEditingPastMeeting && (
                  <p className="text-[11px] text-amber-700 font-semibold mt-1.5 leading-relaxed">⚠ Cuộc họp này đã diễn ra hoặc đã bắt đầu. Vẫn có thể lưu thay đổi nếu cần.</p>
                )}

                {checkingConflicts && (
                  <p className="text-[11px] text-[#94a3b8] mt-2">Đang kiểm tra trùng lịch (theo tài khoản host)...</p>
                )}
                {!checkingConflicts && formData.project_ids.length > 0 && (
                  hostNotConnected ? (
                    <div className="mt-2 p-2.5 bg-slate-100 border border-slate-300 rounded-lg text-[11px] text-slate-700">
                      ⚠ Workspace của Host này chưa kết nối tài khoản Google (chưa có token kết nối sống) —
                      không thể kiểm tra trùng lịch. Vào mục cài đặt AI/Prompt và bấm &quot;Ủy quyền lại&quot; cho Host này trước.
                    </div>
                  ) : organizerConflict ? (
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
                {/* Soft, non-blocking heads-up — unlike the Host warning above,
                    this never affects "Tạo meeting"/"Lưu thay đổi"; a member
                    can still choose which of their overlapping meetings to
                    actually attend. Different color/icon on purpose so it's
                    never mistaken for the hard-blocked Host rule. */}
                {!checkingConflicts && memberConflicts.length > 0 && (
                  <div className="mt-2 p-2.5 bg-sky-50 border border-sky-200 rounded-lg text-[11px] text-sky-800">
                    <p className="font-bold mb-1">👥 {memberConflicts.length} thành viên có thể trùng lịch (chỉ để tham khảo, không chặn tạo meeting):</p>
                    <ul className="space-y-0.5 list-disc list-inside">
                      {memberConflicts.map((c, idx) => (
                        <li key={`${c.member_id}-${idx}`}>
                          <b>{c.member_name}</b> đã có cuộc họp &quot;{c.conflicting_meeting_title}&quot; lúc {c.conflicting_meeting_time}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Kết nối & thông báo */}
            <SectionLabel n={4} label="Kết nối & thông báo" />
            <div>
              <div className="flex items-center justify-between mb-1">
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
                  className="w-full px-3 py-2 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
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
                  className={`w-full px-3 py-2 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors placeholder:text-[#c2c6d6] ${formData.platform === 'Google Meet' ? 'bg-[#f8f9fe] cursor-not-allowed' : ''}`}
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
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1">Nhắc lịch & kênh thông báo</label>
              <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
                <select
                  value={formData.reminder_minutes}
                  onChange={e => setFormData({ ...formData, reminder_minutes: parseInt(e.target.value, 10) })}
                  className="w-full px-3 py-2 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
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
