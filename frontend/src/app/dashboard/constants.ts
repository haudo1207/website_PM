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
  12: 4
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
