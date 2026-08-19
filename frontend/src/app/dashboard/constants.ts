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

export function calculateDaysLate(task: any): number {
  if (!task) return 0;
  const status = (task.status || '').toLowerCase();
  if (status === 'done' || status === 'completed' || status === 'cancel' || status.includes('hoàn') || status.includes('finish') || status.includes('hủy')) {
    return 0;
  }

  const endEstStr = task.end_date_est;
  if (!endEstStr) {
    return typeof task.days_late === 'number' && task.days_late > 0 ? task.days_late : 0;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endEst = new Date(endEstStr);
  if (isNaN(endEst.getTime())) {
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


