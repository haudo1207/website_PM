export const priorityDot: Record<string, string> = {
  Critical: 'bg-red-500',
  High: 'bg-orange-500',
  Normal: 'bg-blue-500',
  Low: 'bg-slate-400',
  Interrupt: 'bg-purple-500',
};

export const statusStyle: Record<string, string> = {
  Done: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  'In Progress': 'bg-amber-100 text-amber-700 border border-amber-200',
  Doing: 'bg-amber-100 text-amber-700 border border-amber-200',
  Pending: 'bg-slate-100 text-slate-600 border border-slate-200',
  Overdue: 'bg-red-100 text-red-700 border border-red-200',
};

export const activityColor: Record<string, string> = {
  done: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  inProgress: 'bg-amber-100 text-amber-700',
  update: 'bg-blue-100 text-blue-700',
};

export const activityIcon: Record<string, string> = {
  done: '✓',
  overdue: '🚨',
  inProgress: '⚡',
  update: '📝',
};

export const projectStatusBadge: Record<string, string> = {
  Developing: 'bg-blue-100 text-blue-700',
  Active: 'bg-emerald-100 text-emerald-700',
  Completed: 'bg-purple-100 text-purple-700',
  Archived: 'bg-slate-100 text-slate-500',
  Planning: 'bg-amber-100 text-amber-700',
};

export const projectBarColor: Record<string, string> = {
  Developing: 'bg-blue-500',
  Active: 'bg-emerald-500',
  Completed: 'bg-purple-500',
  Archived: 'bg-slate-400',
  Planning: 'bg-amber-500',
};

// Company Fiscal Calendar Week Configuration per Month
export const MONTH_WEEKS_COUNT: Record<number, number> = {
  1: 4,
  2: 5,
  3: 4,
  4: 4,
  5: 5,
  6: 4,
  7: 4,
  8: 5,
  9: 4,
  10: 5,
  11: 4,
  12: 4,
};

export function getWeekOfMonth(date: Date) {
  if (!date || isNaN(date.getTime())) return 1;
  const day = date.getDate();
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  if (day <= 28) return 4;
  return 5;
}

export function getMondayToSundayRange(refDate = new Date()): { monday: Date; sunday: Date } {
  const d = new Date(refDate);
  d.setHours(0, 0, 0, 0);
  const dayOfWeek = d.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
}

export function getNextWeekRange(refDate = new Date()): { monday: Date; sunday: Date } {
  const thisWeek = getMondayToSundayRange(refDate);
  const nextMonday = new Date(thisWeek.monday);
  nextMonday.setDate(nextMonday.getDate() + 7);
  nextMonday.setHours(0, 0, 0, 0);

  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  nextSunday.setHours(23, 59, 59, 999);

  return { monday: nextMonday, sunday: nextSunday };
}

export function getPrevWeekRange(refDate = new Date()): { monday: Date; sunday: Date } {
  const thisWeek = getMondayToSundayRange(refDate);
  const prevMonday = new Date(thisWeek.monday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  prevMonday.setHours(0, 0, 0, 0);

  const prevSunday = new Date(prevMonday);
  prevSunday.setDate(prevMonday.getDate() + 6);
  prevSunday.setHours(23, 59, 59, 999);

  return { monday: prevMonday, sunday: prevSunday };
}

export function getWeekDateRange(
  weekNum: number | 'all',
  monthNum: number | 'all',
  yearNum: number | 'all',
  refDate = new Date()
): { monday: Date; sunday: Date } | null {
  if (weekNum === 'all' || typeof weekNum !== 'number') return null;

  const y = typeof yearNum === 'number' ? yearNum : refDate.getFullYear();
  const m = typeof monthNum === 'number' ? monthNum : refDate.getMonth() + 1;

  const firstDayOfMonth = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const lastDayOfMonth = new Date(y, m, 0, 23, 59, 59, 999);

  let dayOfWeek = firstDayOfMonth.getDay();
  let diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  let monday = new Date(firstDayOfMonth);
  monday.setDate(firstDayOfMonth.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const weeks: { monday: Date; sunday: Date }[] = [];
  while (monday <= lastDayOfMonth && weeks.length < 6) {
    let sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    weeks.push({ monday, sunday });

    monday = new Date(sunday);
    monday.setDate(sunday.getDate() + 1);
    monday.setHours(0, 0, 0, 0);
  }

  const idx = weekNum - 1;
  if (idx >= 0 && idx < weeks.length) {
    return weeks[idx];
  }
  return weeks[weeks.length - 1] || null;
}

export const CYCLE_TEMPLATE: Record<number, { startMd: string; endMd: string; startYo: number; endYo: number }> = {
  1:  { startMd: '12-22', endMd: '01-18', startYo: -1, endYo: 0 },
  2:  { startMd: '01-19', endMd: '02-22', startYo: 0, endYo: 0 },
  3:  { startMd: '02-23', endMd: '03-22', startYo: 0, endYo: 0 },
  4:  { startMd: '03-23', endMd: '04-19', startYo: 0, endYo: 0 },
  5:  { startMd: '04-20', endMd: '05-24', startYo: 0, endYo: 0 },
  6:  { startMd: '05-25', endMd: '06-21', startYo: 0, endYo: 0 },
  7:  { startMd: '06-22', endMd: '07-19', startYo: 0, endYo: 0 },
  8:  { startMd: '07-20', endMd: '08-23', startYo: 0, endYo: 0 },
  9:  { startMd: '08-24', endMd: '09-20', startYo: 0, endYo: 0 },
  10: { startMd: '09-21', endMd: '10-25', startYo: 0, endYo: 0 },
  11: { startMd: '10-26', endMd: '11-22', startYo: 0, endYo: 0 },
  12: { startMd: '11-23', endMd: '12-20', startYo: 0, endYo: 0 },
};

export function parseDateString(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const str = String(val).trim();
  if (!str) return null;

  // Case 1: YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) {
    const parts = str.split(/[-/]/);
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }

  // Case 2: DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY or DD-MM-YY
  const slashOrHyphen = str.split(/[-/]/);
  if (slashOrHyphen.length === 3) {
    const d = parseInt(slashOrHyphen[0], 10);
    const m = parseInt(slashOrHyphen[1], 10) - 1;
    let y = parseInt(slashOrHyphen[2], 10);
    if (y < 100) y += 2000;
    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(str);
  return isNaN(date.getTime()) ? null : date;
}

export function calculateDaysLate(task: any): number {
  if (!task) return 0;
  const status = (task.status || '').toLowerCase();
  if (status === 'done' || status === 'completed' || status === 'cancel' || status.includes('hoàn') || status.includes('finish') || status.includes('hủy')) {
    return 0;
  }

  const endEstStr = task.end_date_est || task.end_date || task.deadline;
  if (!endEstStr) {
    return typeof task.days_late === 'number' && task.days_late > 0 ? task.days_late : 0;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endEst = parseDateString(endEstStr);
  if (!endEst) {
    return typeof task.days_late === 'number' && task.days_late > 0 ? task.days_late : 0;
  }
  endEst.setHours(0, 0, 0, 0);

  if (endEst < today) {
    const diffTime = today.getTime() - endEst.getTime();
    const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return days > 0 ? days : (typeof task.days_late === 'number' && task.days_late > 0 ? task.days_late : 1);
  }

  return 0;
}

// Mirrors backend Condition 3 in `_aggregate_team_comparison`
// (system_audit.py): a NOT-yet-done task whose deadline has already
// passed the selected period's END boundary still "belongs" to that
// period (so a Leader/Member's overdue work keeps showing up in
// "Tuần này" instead of silently vanishing once its deadline is in the
// past). Also requires the task to have EXISTED by the period's end
// (created_at <= periodEnd) — same guard the backend uses — so a task
// created this week can't retroactively leak into weeks that already
// passed before it existed. Without this fallback, the frontend's
// planned-window-overlap check alone would exclude such a task from
// EVERY period, while the backend (which drives the Team Load card's
// Giao/Trễ numbers) keeps counting it — producing a card-vs-modal
// mismatch for any task that's been overdue longer than one period.
function isTaskOverdueRelativeToPeriodEnd(task: any, periodEnd: Date | null): boolean {
  if (!periodEnd) return false;
  const status = task.status === 'Done' || task.status === 'done' ? 'done'
    : task.status === 'Cancel' || task.status === 'cancel' ? 'cancel' : 'open';
  if (status !== 'open') return false;
  const endDateEst = parseDateString(task.end_date_est);
  if (!endDateEst || endDateEst >= periodEnd) return false;
  const createdAt = parseDateString(task.created_at);
  if (createdAt && createdAt > periodEnd) return false;
  return true;
}

function dateFallsInPeriod(d: Date | null, periodStart: Date | null, periodEnd: Date | null): boolean {
  if (!d) return false;
  if (periodStart && d < periodStart) return false;
  if (periodEnd && d > periodEnd) return false;
  return true;
}

// Mirrors backend `giao_time_filters` in `_aggregate_team_comparison`
// (system_audit.py) EXACTLY: 3 independent point-in-range checks —
// `start_date`, `created_at`, `end_date_est` — OR'd together, each tested
// against the period on its own (like separate SQL `BETWEEN` clauses),
// plus the "quá hạn tương đối với kỳ" fallback for still-open tasks whose
// deadline has already passed the period's end.
//
// Deliberately NOT an interval-overlap test (checking whether the task's
// whole [start, end] span merely touches the period) — that shape has 2
// concrete failure modes, both confirmed against real prod data:
//   1. A long-running task (start far before its deadline) would match
//      EVERY week in between, not just the week(s) one of its own dates
//      actually falls in — Giao gets spread across weeks the backend
//      never attributes it to.
//   2. A Done task's real work happened days before it was actually
//      logged into the system (`created_at` lags the real dates on a
//      backfilled entry) — an overlap test built from `start_date`/
//      `end_date_actual` never even looks at `created_at`, so the task
//      silently vanishes from the week it was actually entered, even
//      though the backend's `created_at`-in-period check counts it there.
// `end_date_actual` is deliberately NOT consulted here — a Done task's
// real completion-period membership is `isTaskDoneInPeriod`'s job only;
// mixing it into this lenient check is what caused failure mode 2 above.
export function checkTaskInPeriod(
  task: any,
  selectedYear: number | 'all',
  selectedMonth: number | 'all',
  selectedWeek: number | 'all',
  activeQuickFilter: string | null = null
): boolean {
  if (!task) return false;

  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  // 1. WEEK filter (selectedWeek !== 'all' or a 'Tuần…' quick filter)
  if (selectedWeek !== 'all' || (activeQuickFilter && activeQuickFilter.startsWith('Tuần'))) {
    let range: { monday: Date; sunday: Date } | null = null;
    if (activeQuickFilter === 'Tuần này') {
      range = getMondayToSundayRange(new Date());
    } else if (activeQuickFilter === 'Tuần trước') {
      range = getPrevWeekRange(new Date());
    } else if (activeQuickFilter === 'Tuần tới') {
      range = getNextWeekRange(new Date());
    } else if (typeof selectedWeek === 'number') {
      range = getWeekDateRange(selectedWeek, selectedMonth, selectedYear);
    }
    if (range) {
      periodStart = range.monday;
      periodEnd = range.sunday;
    }
  } else if (selectedMonth !== 'all' && typeof selectedMonth === 'number') {
    // 2. MONTH filter (KPI fiscal cycle, or a plain calendar month fallback)
    const cycle = CYCLE_TEMPLATE[selectedMonth];
    const yr = typeof selectedYear === 'number' ? selectedYear : new Date().getFullYear();
    if (cycle) {
      periodStart = new Date(`${yr + cycle.startYo}-${cycle.startMd}T00:00:00`);
      periodEnd = new Date(`${yr + cycle.endYo}-${cycle.endMd}T23:59:59`);
    } else {
      periodStart = new Date(yr, selectedMonth - 1, 1, 0, 0, 0, 0);
      periodEnd = new Date(yr, selectedMonth, 0, 23, 59, 59, 999);
    }
  } else if (selectedYear !== 'all' && typeof selectedYear === 'number') {
    // 3. YEAR filter only
    periodStart = new Date(selectedYear, 0, 1, 0, 0, 0, 0);
    periodEnd = new Date(selectedYear, 11, 31, 23, 59, 59, 999);
  }

  if (!periodStart && !periodEnd) return true; // "Tất cả" — no period filter active

  const startDate = parseDateString(task.start_date);
  const createdAt = parseDateString(task.created_at);
  const endDateEst = parseDateString(task.end_date_est || task.end_date || task.deadline);

  if (dateFallsInPeriod(startDate, periodStart, periodEnd)) return true;
  if (dateFallsInPeriod(createdAt, periodStart, periodEnd)) return true;
  if (dateFallsInPeriod(endDateEst, periodStart, periodEnd)) return true;

  return isTaskOverdueRelativeToPeriodEnd(task, periodEnd);
}

// Dedicated matcher for the KPI → Project "Tasks" drill-in (kpi/page.tsx
// navigating to /project/detail/tasks with ?month=&year=). Deliberately NOT
// `checkTaskInPeriod`: that one mirrors the backend's fiscal-cycle KPI math
// (OR-ing start_date/created_at/end_date_est, collapsing "mọi năm" down to
// the current real year) — a different feature with its own tuned
// semantics that must not change. Here the ask is literal: match the
// task's own `start_date` (the date already shown on the Project table)
// against a plain calendar month, and — when year is 'all' — against that
// month in EVERY year, not a single collapsed year.
export function taskMatchesKpiMonthYear(
  task: any,
  month: number | 'all',
  year: number | 'all'
): boolean {
  if (month === 'all' && year === 'all') return true;
  const startDate = parseDateString(task?.start_date);
  if (!startDate) return false;
  if (month !== 'all' && typeof month === 'number' && (startDate.getMonth() + 1) !== month) return false;
  if (year !== 'all' && typeof year === 'number' && startDate.getFullYear() !== year) return false;
  return true;
}

// Strict HT-only companion to `checkTaskInPeriod`. Returns true only for a
// DONE task whose end_date_actual falls EXACTLY inside the selected
// period — used to gate the HT (completed KPI) sum specifically, so a
// task's completed KPI counts ONCE, into the single period it actually
// finished in (never both the period it was started/due AND the period
// it finished). `checkTaskInPeriod` itself stays lenient (planned-window
// overlap) for ALL tasks because that broader check also selects the
// candidate set for Giao (assigned KPI/Manday), which must NOT depend on
// completion status or date — see the comment on its week-filter branch.
export function isTaskDoneInPeriod(
  task: any,
  selectedYear: number | 'all',
  selectedMonth: number | 'all',
  selectedWeek: number | 'all',
  activeQuickFilter: string | null = null
): boolean {
  if (!task) return false;
  const isDone = task.status === 'Done' || task.status === 'done';
  if (!isDone || !task.end_date_actual) return false;

  const taskDate = parseDateString(task.end_date_actual);
  if (!taskDate) return false;

  if (selectedWeek !== 'all' || (activeQuickFilter && activeQuickFilter.startsWith('Tuần'))) {
    let range: { monday: Date; sunday: Date } | null = null;
    if (activeQuickFilter === 'Tuần này') {
      range = getMondayToSundayRange(new Date());
    } else if (activeQuickFilter === 'Tuần trước') {
      range = getPrevWeekRange(new Date());
    } else if (activeQuickFilter === 'Tuần tới') {
      range = getNextWeekRange(new Date());
    } else if (typeof selectedWeek === 'number') {
      range = getWeekDateRange(selectedWeek, selectedMonth, selectedYear);
    }
    if (range) return taskDate >= range.monday && taskDate <= range.sunday;
  }

  if (selectedYear !== 'all' && typeof selectedYear === 'number' && taskDate.getFullYear() !== selectedYear) {
    return false;
  }

  if (selectedMonth !== 'all' && typeof selectedMonth === 'number') {
    const cycle = CYCLE_TEMPLATE[selectedMonth];
    if (cycle) {
      const yr = typeof selectedYear === 'number' ? selectedYear : taskDate.getFullYear();
      const startDt = new Date(`${yr + cycle.startYo}-${cycle.startMd}T00:00:00`);
      const endDt = new Date(`${yr + cycle.endYo}-${cycle.endMd}T23:59:59`);
      if (taskDate < startDt || taskDate > endDt) return false;
    } else {
      if ((taskDate.getMonth() + 1) !== selectedMonth) return false;
    }
  }

  return true;
}


