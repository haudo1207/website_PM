export function parseYmdLocal(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value !== 'string') {
    return new Date();
  }

  const [year, month, day] = value.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date();
  }

  return new Date(year, month - 1, day);
}

export function dateToYMDLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isWeekendDate(value: string | Date): boolean {
  const weekday = parseYmdLocal(value).getDay();
  return weekday === 0 || weekday === 6;
}

export function getBusinessWeekdayLabel(value: string | Date): string {
  const weekday = parseYmdLocal(value).getDay();

  if (weekday === 0) return 'CN';
  if (weekday === 6) return 'T7';
  return `T${weekday + 1}`;
}

export function monthCalendarDays(year: number, month: number) {
  const totalDays = new Date(year, month, 0).getDate();

  return Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(year, month - 1, index + 1);
    const weekday = date.getDay();

    return {
      date,
      ymd: dateToYMDLocal(date),
      day: index + 1,
      weekday,
      isWeekend: weekday === 0 || weekday === 6,
    };
  });
}

export function workingDaysForMonth(year: number, month: number) {
  return monthCalendarDays(year, month).filter((day) => !day.isWeekend);
}
