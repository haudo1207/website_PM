import { CalendarTask } from '@/lib/api';

export const HOUR_START = 6;
export const HOUR_END = 23; // grid spans 06:00–23:00 — 23:00 is the last mark, nothing renders after it
export const HOUR_HEIGHT = 60; // px per hour — 30px per 30-minute snap step
export const EVENT_HEIGHT = 48; // px — fixed, no duration in MVP (spec.md FR-CAL-07)

const pad2 = (n: number) => String(n).padStart(2, '0');

// Parses Meeting's "HH:MM" (meeting_to_dict's `time`/`start_time` field —
// always a fixed hh:mm string, never a date-time value) into hour/minute
// numbers, same shape topToTimeOfDay/combineDateAndTime already use.
export function parseHHMM(value: string | null | undefined): { hours: number; minutes: number } | null {
  if (!value) return null;
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { hours: Number(m[1]), minutes: Number(m[2]) };
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function toApiDate(d: Date): string {
  return toDateKey(d);
}

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function buildRangeDays(anchor: Date, rangeDays: number): Date[] {
  const start = startOfDay(anchor);
  return Array.from({ length: rangeDays }, (_, i) => addDays(start, i));
}

// Monday of the calendar week containing `d` (ISO-style week start, not
// locale-dependent — getDay() is 0=Sun..6=Sat regardless of locale).
// Used by the 7-day view: it always shows a full Mon→Sun week, never a
// rolling 7-day window from the picked date.
export function startOfWeekMonday(d: Date): Date {
  const c = startOfDay(d);
  const dow = c.getDay(); // 0=Sun..6=Sat
  const diffFromMonday = (dow + 6) % 7;
  return addDays(c, -diffFromMonday);
}

// Parses the naive "YYYY-MM-DD HH:MM:SS" the backend sends (VN wall-clock,
// never UTC — see backend/app/utils/timezone.py) as LOCAL time. Using
// `new Date("...T...")` would let the browser reinterpret it via its own
// timezone, which happens to be correct only when the browser is also
// Asia/Ho_Chi_Minh — parse the components manually instead.
export function parseScheduledAt(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, da, h, mi] = m;
  return new Date(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi));
}

export function formatDayLabel(d: Date): { dow: string; dom: string } {
  const dow = d.toLocaleDateString('vi-VN', { weekday: 'short' }).toUpperCase();
  return { dow, dom: pad2(d.getDate()) };
}

export function formatRangeLabel(days: Date[]): string {
  if (!days.length) return '';
  const first = days[0];
  const last = days[days.length - 1];
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
  if (sameMonth) {
    return `Tháng ${first.getMonth() + 1}, ${first.getFullYear()}`;
  }
  return `${pad2(first.getDate())}/${pad2(first.getMonth() + 1)} - ${pad2(last.getDate())}/${pad2(last.getMonth() + 1)}/${last.getFullYear()}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Vertical offset (px) of a given time-of-day within the HOUR_START..HOUR_END
// grid. Clamped so a task scheduled outside the visible window still renders
// at the nearest edge instead of disappearing. 23:00 (HOUR_END) is itself a
// valid, in-bounds position — it's the calendar's last visible mark.
export function minutesToTop(hours: number, minutes: number): number {
  const totalMin = (hours - HOUR_START) * 60 + minutes;
  const maxMin = (HOUR_END - HOUR_START) * 60;
  return Math.max(0, Math.min(totalMin, maxMin)) * (HOUR_HEIGHT / 60);
}

// Rounds a pixel offset to the nearest 30-minute step (spec.md FR-CAL-12 —
// drag always snaps to :00/:30, never a free minute value).
export function snapTopToHalfHour(topPx: number): number {
  const step = HOUR_HEIGHT / 2; // 30px = 30 minutes at the current HOUR_HEIGHT scale
  return Math.round(topPx / step) * step;
}

// Inverse of minutesToTop, with the same snap-to-30-minutes applied. Used to
// turn a drag drop's pixel position back into a wall-clock time. Capped at
// 23:00 (HOUR_END) — the calendar's own hard bottom boundary — same rule as
// the visible grid itself.
export function topToTimeOfDay(topPx: number): { hours: number; minutes: number } {
  const maxTop = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
  const clamped = Math.max(0, Math.min(topPx, maxTop));
  const snapped = snapTopToHalfHour(clamped);
  const maxMin = (HOUR_END - HOUR_START) * 60;
  const totalMin = Math.min(HOUR_START * 60 + (snapped / HOUR_HEIGHT) * 60, maxMin);
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
}

// Pixel → time-of-day snapped to the nearest 15-minute mark (00/15/30/45).
// Used ONLY to prefill Quick Create when clicking an empty grid cell — a
// click never yields a free/exact minute, and it never yields a value past
// 23:00, matching Quick Create's own hard cap on the Work time field. See
// the 2026-09 "chốt 3 vấn đề về thời gian": "Click Calendar → Quick Create
// snap 15 phút", "Quick Create max: 23:00".
export function topToQuarterHour(topPx: number): { hours: number; minutes: number } {
  const maxTop = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
  const clamped = Math.max(0, Math.min(topPx, maxTop));
  const rawMin = HOUR_START * 60 + (clamped / HOUR_HEIGHT) * 60;
  const maxMin = HOUR_END * 60; // Quick Create's own hard cap — 23:00
  const snappedMin = Math.min(Math.round(rawMin / 15) * 15, maxMin);
  return { hours: Math.floor(snappedMin / 60), minutes: snappedMin % 60 };
}

export interface HourTick {
  hours: number;
  minutes: number;
  top: number;
  label: string;
  isHour: boolean; // true for :00 marks (bolder), false for :30 marks
}

// Every 30-minute mark from 06:00 to 23:00 inclusive — drives both the hour
// rail labels and the horizontal grid lines, so the two always line up.
export function buildHourTicks(): HourTick[] {
  const ticks: HourTick[] = [];
  for (let totalMin = HOUR_START * 60; totalMin <= HOUR_END * 60; totalMin += 30) {
    const hours = Math.floor(totalMin / 60);
    const minutes = totalMin % 60;
    ticks.push({
      hours,
      minutes,
      top: (totalMin - HOUR_START * 60) * (HOUR_HEIGHT / 60),
      label: `${pad2(hours)}:${pad2(minutes)}`,
      isHour: minutes === 0,
    });
  }
  return ticks;
}

export function combineDateAndTime(day: Date, hours: number, minutes: number): Date {
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

// "YYYY-MM-DD HH:MM:SS" naive local string — matches what
// backend/app/utils/kpi_engine.py:parse_datetime accepts, and avoids
// Date.toISOString() which would convert to UTC (wrong: the backend stores
// VN wall-clock time as-is, never UTC — see utils/timezone.py).
export function toApiDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}

// Parses an <input type="date"> value ("YYYY-MM-DD", always this format
// regardless of locale — only the DISPLAY is locale-dependent, the value
// attribute never is) into a local Date at midnight.
export function parseApiDate(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, da] = m;
  return new Date(Number(y), Number(mo) - 1, Number(da));
}

export interface PositionedTask {
  task: CalendarTask;
  date: Date;
  top: number;
  lane: number;
  laneCount: number;
}

// Groups a day's events into non-overlapping "lanes" so concurrent ones
// render side-by-side instead of stacking on top of each other (spec.md
// FR-CAL-14 — overlaps allowed, frontend splits the width). Generic over
// `top`/`height` so a single pass can lane-pack Task blocks (fixed
// EVENT_HEIGHT) and Meeting blocks (variable, duration-based height)
// together in the same day column — Meeting is a visually distinct but
// still time-position-aware event type, not a second Task system.
export function layoutDayItems<T extends { top: number; height: number }>(items: T[]): (T & { lane: number; laneCount: number })[] {
  const sorted = [...items].sort((a, b) => a.top - b.top);
  const laneEnds: number[] = []; // last occupied bottom-px per lane
  const placed: (T & { lane: number; laneCount: number })[] = [];
  for (const item of sorted) {
    let lane = laneEnds.findIndex(end => end <= item.top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.top + item.height);
    } else {
      laneEnds[lane] = item.top + item.height;
    }
    placed.push({ ...item, lane, laneCount: 1 });
  }
  const laneCount = Math.max(1, laneEnds.length);
  return placed.map(p => ({ ...p, laneCount }));
}
