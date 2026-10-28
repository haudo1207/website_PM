'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import SummaryCard from '@/components/leave-request/SummaryCard';
import StatusBadge, { LeaveTypeBadge } from '@/components/leave-request/StatusBadge';
import LeaveRequestForm from '@/components/leave-request/LeaveRequestForm';
import Portal from '@/components/Portal';
import { formatDateLabel, formatLeaveRange, LeaveRequest, LeaveRequestFormValues, getStorageKey, mockLeaveRequests } from '@/lib/leave-request';
import { getMembers, getLeaveRequests, createLeaveRequest, updateLeaveRequest, deleteLeaveRequest, approveLeaveRequest, getLunchRecords, upsertLunchRecord, deleteLunchRecord, getLunchMonthlySummary, getWorkingLunchConfig, getWorkingLunchMembers, toggleWorkingLunchMember } from '@/lib/api';
import { getBusinessWeekdayLabel, isWeekendDate, monthCalendarDays, workingDaysForMonth } from '@/lib/business-date';

const ITEMS_PER_PAGE = 5;

interface TeamMember {
  id: number;
  name: string;
  team: string;
  role: string;
  email?: string;
  telegram_username?: string;
  phone?: string;
  position?: string;
  user_id?: number;         
}

// ═══════════════════════════════════════════════════════════════
// LUNCH CHECK-IN COMPONENT (with backend API)
// ═══════════════════════════════════════════════════════════════
type LunchStatus = '' | 'lunch' | 'no_lunch' | 'onsite' | 'bonus';

const LUNCH_PRICE = 40000;
const LUNCH_STATUS_OPTIONS: { value: LunchStatus; label: string }[] = [
  { value: 'no_lunch', label: 'Không đặt' },
  { value: 'lunch', label: 'Đặt' },
  { value: 'onsite', label: 'Onsite' },
  { value: 'bonus', label: 'Bonus' },
  { value: '', label: 'Chưa chọn' },
];
const MEMBER_LUNCH_STATUS_OPTIONS = LUNCH_STATUS_OPTIONS.filter((item) => item.value === '' || item.value === 'lunch' || item.value === 'no_lunch');

function getLunchStatus(record?: { has_lunch: boolean; status?: string }): LunchStatus {
  if (!record) return '';
  if (record.status === 'lunch' || record.status === 'no_lunch' || record.status === 'onsite' || record.status === 'bonus') {
    return record.status;
  }
  return record.has_lunch ? 'lunch' : 'no_lunch';
}

function lunchStatusClass(status: LunchStatus) {
  switch (status) {
    case 'lunch':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'no_lunch':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'onsite':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    case 'bonus':
      return 'border-violet-200 bg-violet-50 text-violet-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600';
  }
}

function LunchCheckIn({ members, calendarDate, isAdmin }: { members: TeamMember[]; leaveRequests: LeaveRequest[]; calendarDate: string; isAdmin: boolean }) {
  const now = new Date(calendarDate);
  const todayDate = dateToYMD(new Date());
  const [lunchRecords, setLunchRecords] = useState<{ id: number; member_id: number; date: string; has_lunch: boolean; status?: string }[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('All');
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDate, setSelectedDate] = useState(calendarDate);
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [dailyMembers, setDailyMembers] = useState<TeamMember[]>([]);
  const [configMembers, setConfigMembers] = useState<Array<TeamMember & { enabled?: boolean }>>([]);
  const [savingConfigId, setSavingConfigId] = useState<number | 'bulk' | null>(null);

  const fetchLunchRecords = useCallback(async () => {
    const [monthRecords, todayRecords] = await Promise.all([
      getLunchRecords({ year: selectedYear, month: selectedMonth }),
      isAdmin ? Promise.resolve([]) : getLunchRecords({ date: todayDate }),
    ]);
    const recordsByKey = new Map<string, (typeof monthRecords)[number]>();
    [...monthRecords, ...todayRecords].forEach((record) => recordsByKey.set(`${record.member_id}-${record.date}`, record));
    setLunchRecords(Array.from(recordsByKey.values()));
  }, [isAdmin, selectedMonth, selectedYear, todayDate]);

  useEffect(() => {
    const loadDailyRoster = async () => {
      try {
        const rosterDate = isAdmin ? selectedDate : todayDate;
        const rosterPromise = getWorkingLunchMembers({ enabled_only: true, date: rosterDate });
        const configPromise = isAdmin ? getWorkingLunchConfig(undefined, rosterDate) : Promise.resolve([]);
        const [roster, config] = await Promise.all([rosterPromise, configPromise]);
        const userId = Number(localStorage.getItem('user_id') || 0);
        const memberId = Number(localStorage.getItem('member_id') || 0);
        const rosterMembers = roster.map((member: any) => ({
          ...member,
          name: member.name || member.full_name || member.display_name || 'Chưa có tên',
          team: member.team || '',
          role: member.position || 'Member',
        }));
        setDailyMembers(rosterMembers);
        setCurrentMemberId(rosterMembers.find((member: any) => member.user_id === userId)?.id || memberId || (!isAdmin && rosterMembers.length === 1 ? rosterMembers[0].id : null));
        if (isAdmin) {
          setConfigMembers(config.map((member: any) => ({
            ...member,
            name: member.name || member.full_name || member.display_name || 'Chưa có tên',
            team: member.team || '',
            role: member.position || 'Member',
          })));
        }
      } catch (error) {
        console.error('Error fetching daily Check Lunch roster:', error);
        setDailyMembers([]);
      }
    };
    loadDailyRoster();
  }, [isAdmin, selectedDate, todayDate]);

  useEffect(() => {
    fetchLunchRecords().catch((err: unknown) => console.error('Error fetching lunch records:', err));
  }, [fetchLunchRecords]);

  const teams = useMemo(() => {
    const set = new Set<string>();
    dailyMembers.forEach((m) => { if (m.team) set.add(m.team); });
    return ['All', ...Array.from(set).sort()];
  }, [dailyMembers]);

  const visibleMembers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return dailyMembers
      .filter((m) => selectedTeam === 'All' || m.team === selectedTeam)
      .filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [dailyMembers, searchTerm, selectedTeam]);

  const calendarDays = useMemo(() => monthCalendarDays(selectedYear, selectedMonth), [selectedYear, selectedMonth]);
  const workDays = useMemo(() => workingDaysForMonth(selectedYear, selectedMonth), [selectedYear, selectedMonth]);

  useEffect(() => {
    if (!isAdmin || workDays.length === 0) return;
    if (!selectedDate.startsWith(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`)) setSelectedDate(workDays[0].ymd);
  }, [isAdmin, selectedDate, selectedMonth, selectedYear, workDays]);

  const recordsByCell = useMemo(() => {
    const map = new Map<string, { id: number; member_id: number; date: string; has_lunch: boolean; status?: string }>();
    lunchRecords.forEach((r) => map.set(`${r.member_id}-${r.date}`, r));
    return map;
  }, [lunchRecords]);

  const memberMonthlySummary = useMemo(() => {
    if (!currentMemberId) return { lunch: 0, noLunch: 0, empty: workDays.length };
    let lunch = 0;
    let noLunch = 0;
    let empty = 0;

    workDays.forEach((day) => {
      const status = getLunchStatus(recordsByCell.get(`${currentMemberId}-${day.ymd}`));
      if (status === 'lunch') lunch += 1;
      else if (status === 'no_lunch') noLunch += 1;
      else empty += 1;
    });

    return { lunch, noLunch, empty };
  }, [currentMemberId, recordsByCell, workDays]);

  const summary = useMemo(() => {
    let lunch = 0;
    let noLunch = 0;
    let onsite = 0;
    let bonus = 0;
    let empty = 0;

    visibleMembers.forEach((m) => {
      workDays.forEach((day) => {
        const status = getLunchStatus(recordsByCell.get(`${m.id}-${day.ymd}`));
        if (status === 'lunch') lunch += 1;
        else if (status === 'no_lunch') noLunch += 1;
        else if (status === 'onsite') onsite += 1;
        else if (status === 'bonus') bonus += 1;
        else empty += 1;
      });
    });

    return {
      lunch,
      noLunch,
      onsite,
      bonus,
      empty,
      totalCost: (noLunch + bonus) * LUNCH_PRICE,
    };
  }, [recordsByCell, visibleMembers, workDays]);

  const saveStatus = async (memberId: number, date: string, status: LunchStatus) => {
    if (isWeekendDate(date) || (!isAdmin && date !== todayDate)) return;

    const key = `${memberId}-${date}`;
    const current = recordsByCell.get(key);
    setSavingKey(key);
    try {
      if (!status) {
        if (current) await deleteLunchRecord(current.id);
      } else {
        await upsertLunchRecord({
          member_id: memberId,
          date,
          has_lunch: status === 'lunch' || status === 'bonus',
          status,
        });
      }
      await fetchLunchRecords();
    } catch (err) {
      console.error('Error saving lunch status:', err);
    } finally {
      setSavingKey(null);
    }
  };

  const toggleDailyMember = async (memberId: number, enabled: boolean) => {
    setSavingConfigId(memberId);
    try {
      await toggleWorkingLunchMember(memberId, enabled, selectedDate);
      const [roster, config] = await Promise.all([
        getWorkingLunchMembers({ enabled_only: true, date: selectedDate }),
        getWorkingLunchConfig(undefined, selectedDate),
      ]);
      setDailyMembers(roster.map((member: any) => ({
        ...member,
        name: member.name || member.full_name || member.display_name || 'Chưa có tên',
        team: member.team || '',
        role: member.position || 'Member',
      })));
      setConfigMembers(config.map((member: any) => ({
        ...member,
        name: member.name || member.full_name || member.display_name || 'Chưa có tên',
        team: member.team || '',
        role: member.position || 'Member',
      })));
    } finally {
      setSavingConfigId(null);
    }
  };

  const toggleAllDailyMembers = async (enabled: boolean) => {
    setSavingConfigId('bulk');
    try {
      await Promise.all(configMembers.map((member) => toggleWorkingLunchMember(member.id, enabled, selectedDate)));
      const [roster, config] = await Promise.all([
        getWorkingLunchMembers({ enabled_only: true, date: selectedDate }),
        getWorkingLunchConfig(undefined, selectedDate),
      ]);
      setDailyMembers(roster.map((member: any) => ({
        ...member,
        name: member.name || member.full_name || member.display_name || 'Chưa có tên',
        team: member.team || '',
        role: member.position || 'Member',
      })));
      setConfigMembers(config.map((member: any) => ({
        ...member,
        name: member.name || member.full_name || member.display_name || 'Chưa có tên',
        team: member.team || '',
        role: member.position || 'Member',
      })));
    } finally {
      setSavingConfigId(null);
    }
  };

  if (!isAdmin) {
    const currentMember = currentMemberId ? dailyMembers.find((m) => m.id === currentMemberId) : null;
    const todayStatus = currentMemberId ? getLunchStatus(recordsByCell.get(`${currentMemberId}-${todayDate}`)) : '';
    const todayIsWeekend = isWeekendDate(todayDate);
    return (
      <div className="rounded-xl border border-[#c2c6d6]/70 bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#061733]">Check Lunch</h2>
            <p className="mt-1 text-sm text-[#565e74]">Đăng ký hôm nay · Lịch tháng chỉ xem</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#565e74]">Xem tháng</span>
              <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} className="h-9 w-full rounded-lg border border-[#c2c6d6] bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => <option key={month} value={month}>Tháng {String(month).padStart(2, '0')}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#565e74]">Năm xem</span>
              <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className="h-9 w-full rounded-lg border border-[#c2c6d6] bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
          </div>
        </div>

        {currentMemberId ? (
          <>
            <section className="mb-4 flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold text-blue-700">ĐĂNG KÝ CỦA BẠN · {formatDateLabel(todayDate)}</div>
                <div className="mt-1 text-sm text-[#565e74]">{currentMember?.name || 'Member'} · Chỉ có thể thay đổi lựa chọn trong ngày hôm nay.</div>
              </div>
              {todayIsWeekend ? (
                <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm font-medium text-slate-500">Cuối tuần · Không làm việc</div>
              ) : (
                <select
                  value={todayStatus}
                  onChange={(event) => saveStatus(currentMemberId, todayDate, event.target.value as LunchStatus)}
                  disabled={savingKey === `${currentMemberId}-${todayDate}`}
                  aria-label="Đăng ký cơm trưa hôm nay"
                  className={`h-10 w-full rounded-lg border px-3 text-sm font-bold outline-none transition sm:w-44 ${lunchStatusClass(todayStatus)} ${savingKey === `${currentMemberId}-${todayDate}` ? 'cursor-wait opacity-70' : ''}`}
                >
                  {MEMBER_LUNCH_STATUS_OPTIONS.map((item) => <option key={item.value || 'empty'} value={item.value}>{item.label}</option>)}
                </select>
              )}
            </section>

            <div className="mb-3 grid grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <div className="text-xs text-[#565e74]">Ngày làm việc</div>
                <div className="mt-1 text-xl font-bold text-[#061733]">{workDays.length}</div>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2.5">
                <div className="text-xs text-[#565e74]">Đặt</div>
                <div className="mt-1 text-xl font-bold text-blue-700">{memberMonthlySummary.lunch}</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2.5">
                <div className="text-xs text-[#565e74]">Không đặt / Chưa chọn</div>
                <div className="mt-1 text-xl font-bold text-emerald-700">{memberMonthlySummary.noLunch} / {memberMonthlySummary.empty}</div>
              </div>
            </div>

            <section className="overflow-hidden rounded-lg border border-[#c2c6d6]/70 bg-white">
              <div className="flex items-center justify-between border-b border-[#c2c6d6]/70 px-3 py-2.5">
                <h3 className="text-sm font-bold text-[#061733]">Lịch sử tháng {String(selectedMonth).padStart(2, '0')}/{selectedYear}</h3>
                <span className="text-xs text-[#565e74]">{workDays.length} ngày làm việc</span>
              </div>
              <div className="max-h-[52vh] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10">
                      <th className="border-b border-r border-[#c2c6d6]/70 bg-[#f8f9ff] px-3 py-2 text-left text-xs font-bold">Ngày</th>
                      <th className="border-b border-r border-[#c2c6d6]/70 bg-[#f8f9ff] px-3 py-2 text-left text-xs font-bold">Thứ</th>
                      <th className="border-b border-[#c2c6d6]/70 bg-[#f8f9ff] px-3 py-2 text-left text-xs font-bold">Cơm trưa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workDays.map((day) => {
                      const key = `${currentMemberId}-${day.ymd}`;
                      const status = getLunchStatus(recordsByCell.get(key));
                      const isToday = day.ymd === todayDate;

                      return (
                        <tr key={day.ymd} className={isToday ? 'bg-blue-50/70' : 'bg-white'}>
                          <td className={`border-b border-r border-slate-100 px-3 py-2 font-semibold ${isToday ? 'text-blue-700' : 'text-[#061733]'}`}>
                            {`${String(day.day).padStart(2, '0')}/${String(selectedMonth).padStart(2, '0')}/${selectedYear}`}
                            {isToday && <span className="ml-2 text-[10px] font-semibold text-blue-600">Hôm nay</span>}
                          </td>
                          <td className="border-b border-r border-slate-100 px-3 py-2 text-[#565e74]">
                            {getBusinessWeekdayLabel(day.ymd)}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <span className={`inline-flex min-w-24 justify-center rounded-md border px-2.5 py-1 text-xs font-semibold ${lunchStatusClass(status)}`}>
                              {MEMBER_LUNCH_STATUS_OPTIONS.find((item) => item.value === status)?.label || 'Chưa chọn'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {workDays.length === 0 && <tr><td colSpan={3} className="px-3 py-8 text-center text-sm text-slate-500">Không có ngày làm việc trong tháng này.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            Không thể xác định member của bạn. Vui lòng liên hệ admin để thiết lập tài khoản.
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-[#061733]">Check Lunch</h2>
          <p className="mt-2 text-sm text-[#565e74]">Quản lý đăng ký cơm trưa và tự động tính Bonus theo tuần làm việc.</p>
        </div>
      </div>

      <section className="mb-4 rounded-xl border border-[#c2c6d6]/70 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[150px_130px_130px_130px_minmax(220px,1fr)] md:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[#565e74]">Ngày chọn người</span>
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="h-10 w-full rounded-lg border border-[#c2c6d6] bg-white px-3 text-sm outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[#565e74]">Team</span>
            <select value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)} className="h-10 w-full rounded-lg border border-[#c2c6d6] bg-white px-3 text-sm outline-none">
              {teams.map((team) => <option key={team} value={team}>{team === 'All' ? 'Tất cả team' : team}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[#565e74]">Tháng</span>
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} className="h-10 w-full rounded-lg border border-[#c2c6d6] bg-white px-3 text-sm outline-none">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => <option key={month} value={month}>Tháng {String(month).padStart(2, '0')}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[#565e74]">Năm</span>
            <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className="h-10 w-full rounded-lg border border-[#c2c6d6] bg-white px-3 text-sm outline-none">
              {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[#565e74]">Tìm thành viên</span>
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Nhập tên thành viên..." className="h-10 w-full rounded-lg border border-[#c2c6d6] bg-white px-3 text-sm outline-none" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-[11px] text-[#565e74]">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-blue-200 bg-blue-50" />Đặt</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-emerald-200 bg-emerald-50" />Không đặt</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-orange-200 bg-orange-50" />Onsite</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-violet-200 bg-violet-50" />Bonus</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-slate-200 bg-slate-50" />Chưa chọn</span>
        </div>
      </section>

      {isAdmin && (
        <section className="mb-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#061733]">Chọn người có mặt ngày {formatDateLabel(selectedDate)}</h3>
              <p className="mt-1 text-xs text-[#565e74]">Chỉ người được tích mới xuất hiện trong bảng và được phép tự đăng ký Đặt/Không đặt.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-blue-700">{configMembers.filter((member) => member.enabled).length}/{configMembers.length} người</span>
              <button type="button" onClick={() => toggleAllDailyMembers(true)} disabled={savingConfigId !== null || configMembers.length === 0} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Chọn tất cả</button>
              <button type="button" onClick={() => toggleAllDailyMembers(false)} disabled={savingConfigId !== null || configMembers.length === 0} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Bỏ chọn tất cả</button>
            </div>
          </div>
          <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-4">
            {configMembers.map((member) => (
              <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-blue-300">
                <input
                  type="checkbox"
                  checked={member.enabled === true}
                  disabled={savingConfigId !== null}
                  onChange={(event) => toggleDailyMember(member.id, event.target.checked)}
                  className="h-4 w-4 accent-blue-600"
                />
                <span className="min-w-0 truncate font-medium text-slate-700">{member.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-slate-400">{member.team || ''}</span>
              </label>
            ))}
            {configMembers.length === 0 && <div className="text-sm text-slate-500">Chưa có member trong Workspace này.</div>}
          </div>
        </section>
      )}

      <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Thành viên hiển thị</div>
          <div className="mt-2 text-3xl font-black text-slate-700">{visibleMembers.length}</div>
          <div className="mt-1 text-xs text-slate-500">theo bộ lọc hiện tại</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Ngày làm việc</div>
          <div className="mt-2 text-3xl font-black text-slate-700">{workDays.length}</div>
          <div className="mt-1 text-xs text-slate-500">Thứ 2 - Thứ 6</div>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-rose-100 p-4 shadow-sm shadow-rose-100/60 ring-1 ring-rose-100">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-600">Không đặt</div>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-100 text-sm font-bold text-rose-700">!</span>
          </div>
          <div className="mt-2 text-3xl font-black text-rose-700">{summary.noLunch}</div>
          <div className="mt-1 text-xs text-rose-700/80">được tính 40.000đ/ngày</div>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-violet-100 p-4 shadow-sm shadow-violet-100/60 ring-1 ring-violet-100">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-600">Bonus</div>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">★</span>
          </div>
          <div className="mt-2 text-3xl font-black text-violet-700">{summary.bonus}</div>
          <div className="mt-1 text-xs text-violet-700/80">tự động theo tuần</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-100 p-4 shadow-sm shadow-amber-100/60 ring-1 ring-amber-100">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700">Tổng tiền</div>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">₫</span>
          </div>
          <div className="mt-2 text-3xl font-black text-amber-700">{summary.totalCost.toLocaleString('vi-VN')}đ</div>
          <div className="mt-1 text-xs text-amber-700/80">Không đặt + Bonus x 40.000đ</div>
        </div>
      </section>

      {visibleMembers.length > 0 ? (
        <section className="rounded-xl border border-[#c2c6d6]/70 bg-white">
          <div className="flex items-center justify-between border-b border-[#c2c6d6]/70 px-4 py-3">
            <h3 className="text-sm font-bold">Check Lunch - Tháng {String(selectedMonth).padStart(2, '0')}/{selectedYear}</h3>
            <span className="text-xs text-[#565e74]">{visibleMembers.length} thành viên · {workDays.length} ngày làm việc · {calendarDays.length - workDays.length} cuối tuần</span>
          </div>
          <div className="max-h-[68vh] overflow-auto">
            <table className="min-w-max border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 w-28 border-b border-r border-[#c2c6d6]/70 bg-[#f8f9ff] px-3 py-3 text-left text-xs font-bold">Ngày</th>
                  {visibleMembers.map((member) => (
                    <th key={member.id} className="sticky top-0 z-20 w-32 min-w-32 border-b border-r border-[#c2c6d6]/70 bg-[#f8f9ff] px-3 py-3 text-center">
                      <div className="max-w-28 truncate text-xs font-bold">{member.name}</div>
                      <div className="mt-1 max-w-28 truncate text-[10px] font-medium text-[#565e74]">{member.team || 'N/A'}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workDays.map((day) => {
                  const isSelected = day.ymd === selectedDate;
                  const isToday = day.ymd === dateToYMD(new Date());
                  return (
                    <tr key={day.ymd} className={isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : isToday ? 'bg-amber-50/60' : 'bg-white'}>
                      <th className={`sticky left-0 z-10 w-28 border-b border-r border-slate-200 px-3 py-2.5 text-left ${isSelected ? 'bg-blue-100 text-blue-800' : isToday ? 'bg-amber-50 text-amber-800' : 'bg-white text-[#061733]'}`}>
                        <div className="text-xs font-bold">{`${String(day.day).padStart(2, '0')}/${String(selectedMonth).padStart(2, '0')}/${selectedYear}`}</div>
                        <div className="mt-1 text-[11px] font-medium">T{day.weekday + 1}</div>
                        {(isSelected || isToday) && <div className="mt-1 text-[10px] font-bold">{isSelected ? 'ĐANG CHỌN' : 'HÔM NAY'}</div>}
                      </th>
                      {visibleMembers.map((member) => {
                        const key = `${member.id}-${day.ymd}`;
                        const status = getLunchStatus(recordsByCell.get(key));
                        return (
                          <td key={key} className={`w-32 min-w-32 border-b border-r border-slate-100 p-1.5 ${isSelected ? 'bg-blue-50' : ''}`}>
                            <select
                              value={status}
                              onChange={(e) => saveStatus(member.id, day.ymd, e.target.value as LunchStatus)}
                              disabled={savingKey === key}
                              className={`h-11 w-28 rounded-lg border px-2 text-xs font-bold outline-none transition ${lunchStatusClass(status)} ${savingKey === key ? 'cursor-wait opacity-70' : ''}`}
                            >
                              {LUNCH_STATUS_OPTIONS.map((item) => <option key={item.value || 'empty'} value={item.value}>{item.label}</option>)}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-700">{dailyMembers.length === 0 ? 'Chưa có member được chọn cho ngày này' : 'Không tìm thấy member phù hợp'}</p>
          <p className="mt-1 text-xs text-slate-500">{dailyMembers.length === 0 ? 'Tick member phía trên để hiển thị bảng Check Lunch.' : 'Thử đổi team hoặc từ khóa tìm kiếm.'}</p>
        </div>
      )}
    </div>
  );
}

function LegacyLunchCheckIn({ members, leaveRequests, calendarDate, isAdmin }: { members: TeamMember[]; leaveRequests: LeaveRequest[]; calendarDate: string; isAdmin: boolean }) {
  const [lunchRecords, setLunchRecords] = useState<{ id: number; member_id: number; date: string; has_lunch: boolean; status?: string }[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('All');
  const [saving, setSaving] = useState(false);
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);
  const [lunchView, setLunchView] = useState<'daily' | 'monthly'>('daily');
  const [monthlyYear, setMonthlyYear] = useState(new Date().getFullYear());
  const [monthlyMonth, setMonthlyMonth] = useState(new Date().getMonth() + 1);
  const [monthlyData, setMonthlyData] = useState<any>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  const lunchMemberByUserId = useMemo(() => {
    const map: Record<number, number> = {};
    members.forEach((m) => {
      if (m.user_id) map[m.user_id] = m.id;
    });
    return map;
  }, [members]);

  useEffect(() => {
    const storedMemberId = localStorage.getItem('member_id');
    if (storedMemberId) setCurrentMemberId(Number(storedMemberId));
  }, []);

  // Fetch lunch records from API when date changes or view switches
  useEffect(() => {
    const fetchLunch = async () => {
      try {
        const records = await getLunchRecords({ date: calendarDate });
        setLunchRecords(records);
      } catch (err) {
        console.error('Error fetching lunch records:', err);
      }
    };
    fetchLunch();
  }, [calendarDate]);

  // Fetch monthly summary when admin switches to monthly view
  useEffect(() => {
    if (!isAdmin || lunchView !== 'monthly') return;
    const fetchMonthly = async () => {
      setMonthlyLoading(true);
      try {
        const data = await getLunchMonthlySummary(monthlyYear, monthlyMonth);
        setMonthlyData(data);
      } catch (err) {
        console.error('Error fetching monthly summary:', err);
      } finally {
        setMonthlyLoading(false);
      }
    };
    fetchMonthly();
  }, [isAdmin, lunchView, monthlyYear, monthlyMonth]);

  const teamsFromDB = useMemo(() => {
    const teams = new Set<string>();
    members.forEach((m) => { if (m.team) teams.add(m.team); });
    return ['All', ...Array.from(teams).sort()];
  }, [members]);

  const target = new Date(calendarDate);
  const offMap: Record<number, boolean> = {};
  leaveRequests.forEach((req) => {
    // Only count approved leave requests as off
    if (req.status !== 'Approved') return;
    const s = new Date(req.start_date);
    const e = new Date(req.end_date);
    if (s <= target && target <= e) {
      // Try member_id first, then user.member_id, then user_id (same as Calendar Team)
      const mid = lunchMemberByUserId[req.user_id];
      if (mid) offMap[mid] = true;
    }
  });

  // Filter members based on role
  const membersToShow = useMemo(() => {
    if (isAdmin) {
      if (selectedTeam === 'All') return members;
      return members.filter((m) => m.team === selectedTeam);
    }
    const memberId = currentMemberId;
    if (memberId) return members.filter((m) => m.id === memberId);
    return [];
  }, [isAdmin, members, selectedTeam, currentMemberId]);

  const handleToggle = async (memberId: number, hasLunchVal: boolean) => {
    if (!isAdmin && memberId !== currentMemberId) {
      alert('Bạn chỉ có thể đăng ký cơm cho chính mình');
      return;
    }
    setSaving(true);
    try {
      const status = hasLunchVal ? 'lunch' : 'no_lunch';
      await upsertLunchRecord({ member_id: memberId, date: calendarDate, has_lunch: hasLunchVal, status: status });
      const records = await getLunchRecords({ date: calendarDate });
      setLunchRecords(records);
    } catch (err) {
      console.error('Error saving lunch record:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (memberId: number, status: string) => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const hasLunch = status === 'lunch' || status === 'bonus';
      await upsertLunchRecord({ member_id: memberId, date: calendarDate, has_lunch: hasLunch, status: status });
      const records = await getLunchRecords({ date: calendarDate });
      setLunchRecords(records);
    } catch (err) {
      console.error('Error saving lunch record:', err);
    } finally {
      setSaving(false);
    }
  };

  // Admin summary
  const summary = useMemo(() => {
    if (!isAdmin) return null;
    const total = membersToShow.length;
    const offCount = membersToShow.filter((m) => offMap[m.id]).length;
    const working = membersToShow.filter((m) => !offMap[m.id]);
    const registeredLunch = working.filter((m) =>
      lunchRecords.some((r) => r.member_id === m.id && (r.status === 'lunch' || r.status === 'bonus' || (!r.status && r.has_lunch)))
    ).length;
    const bonusCount = working.filter((m) =>
      lunchRecords.some((r) => r.member_id === m.id && r.status === 'bonus')
    ).length;
    const notRegistered = working.length - registeredLunch;
    return { total, offCount, working: working.length, registeredLunch, notRegistered, bonusCount };
  }, [isAdmin, membersToShow, offMap, lunchRecords]);

  return (
    <div>
      {/* View toggle - Admin only */}
      {isAdmin && (
        <div className="mb-4 flex items-center gap-3">
          <div className="flex rounded-lg border border-[#c2c6d6] overflow-hidden">
            <button
              onClick={() => setLunchView('daily')}
              className={`px-4 py-2 text-sm font-semibold ${lunchView === 'daily' ? 'bg-[#0058be] text-white' : 'bg-white text-[#565e74] hover:bg-[#f8f9ff]'}`}
            >
              Theo ngay
            </button>
            <button
              onClick={() => setLunchView('monthly')}
              className={`px-4 py-2 text-sm font-semibold ${lunchView === 'monthly' ? 'bg-[#0058be] text-white' : 'bg-white text-[#565e74] hover:bg-[#f8f9ff]'}`}
            >
              Theo thang
            </button>
          </div>
        </div>
      )}

      {/* Monthly Summary View - Admin only */}
      {isAdmin && lunchView === 'monthly' && (
        <div>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-sm font-semibold">Nam</label>
              <select
                value={monthlyYear}
                onChange={e => setMonthlyYear(Number(e.target.value))}
                className="rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm outline-none"
              >
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">Thang</label>
              <select
                value={monthlyMonth}
                onChange={e => setMonthlyMonth(Number(e.target.value))}
                className="rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm outline-none"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>Thang {m}</option>
                ))}
              </select>
            </div>
          </div>

          {monthlyLoading && (
            <div className="py-8 text-center text-sm text-[#565e74]">Dang tai du lieu...</div>
          )}

          {monthlyData && !monthlyLoading && (
            <>
              {/* Summary cards */}
              <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-white p-3 text-center">
                  <div className="text-lg font-bold text-[#0b1c30]">{monthlyData.working_days}</div>
                  <div className="text-xs text-[#565e74]">Ngay lam viec</div>
                </div>
                <div className="rounded-lg border bg-emerald-50 p-3 text-center">
                  <div className="text-lg font-bold text-emerald-600">{monthlyData.total_lunch}</div>
                  <div className="text-xs text-[#565e74]">Tong so suat an</div>
                </div>
                <div className="rounded-lg border bg-rose-50 p-3 text-center">
                  <div className="text-lg font-bold text-rose-600">{monthlyData.total_no_lunch}</div>
                  <div className="text-xs text-[#565e74]">Tong khong an</div>
                </div>
                <div className="rounded-lg border bg-blue-50 p-3 text-center">
                  <div className="text-lg font-bold text-blue-600">{monthlyData.members.length}</div>
                  <div className="text-xs text-[#565e74]">Tong nhan vien</div>
                </div>
                <div className="rounded-lg border bg-amber-50 p-3 text-center">
                  <div className="text-lg font-bold text-amber-600">{(monthlyData.total_cost || 0).toLocaleString('vi-VN')}d</div>
                  <div className="text-xs text-[#565e74]">Tong tien</div>
                </div>
              </div>

              {/* Member table */}
              <div className="overflow-x-auto rounded-xl border border-[#c2c6d6]/70">
                <table className="min-w-full divide-y divide-[#c2c6d6] text-sm">
                  <thead className="bg-[#f8f9ff] text-[#565e74]">
                    <tr>
                      <th className="px-3 py-3 text-left font-semibold">No.</th>
                      <th className="px-3 py-3 text-left font-semibold">Họ và tên</th>
                      <th className="px-3 py-3 text-left font-semibold">Team</th>
                      <th className="px-3 py-3 text-center font-semibold">Số ngày ăn cơm</th>
                      <th className="px-3 py-3 text-center font-semibold">Số ngày không ăn</th>
                      <th className="px-3 py-3 text-center font-semibold">Số ngày working</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eef2f7] bg-white">
                    {monthlyData.members.map((m: any, idx: number) => (
                      <tr key={m.member_id} className="hover:bg-[#f8f9ff]">
                        <td className="px-3 py-3 font-semibold text-[#0b1c30]">{idx + 1}</td>
                        <td className="px-3 py-3 text-[#0b1c30]">{m.full_name}</td>
                        <td className="px-3 py-3 text-[#565e74]">{m.team}</td>
                        <td className="px-3 py-3 text-center">
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                            {m.lunch_count}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                            {m.no_lunch_count}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center font-semibold text-[#0b1c30]">
                          {m.total_registered_days}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Daily View */}
      {lunchView === 'daily' && (
        <>
      <div className="mb-4 flex items-center gap-3">
        {isAdmin && (
          <div>
            <label className="mb-1 block text-sm font-semibold">Team</label>
            <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)} className="rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm outline-none">
              {teamsFromDB.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {saving && <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">Saving...</div>}

      {/* Admin summary cards */}
      {isAdmin && summary && (
        <div className="mb-4 grid grid-cols-2 md:grid-cols-7 gap-3">
          <div className="rounded-lg border bg-white p-3 text-center">
            <div className="text-lg font-bold text-[#0b1c30]">{summary.total}</div>
            <div className="text-xs text-[#565e74]">Total</div>
          </div>
          <div className="rounded-lg border bg-white p-3 text-center">
            <div className="text-lg font-bold text-emerald-600">{summary.working}</div>
            <div className="text-xs text-[#565e74]">Working</div>
          </div>
          <div className="rounded-lg border bg-white p-3 text-center">
            <div className="text-lg font-bold text-rose-600">{summary.offCount}</div>
            <div className="text-xs text-[#565e74]">Off</div>
          </div>
          <div className="rounded-lg border bg-emerald-50 p-3 text-center">
            <div className="text-lg font-bold text-emerald-600">{summary.registeredLunch}</div>
            <div className="text-xs text-[#565e74]">Đã đăng ký cơm</div>
          </div>
          <div className="rounded-lg border bg-amber-50 p-3 text-center">
            <div className="text-lg font-bold text-amber-600">{summary.notRegistered}</div>
            <div className="text-xs text-[#565e74]">Chưa đăng ký</div>
          </div>
          <div className="rounded-lg border bg-amber-50 p-3 text-center">
            <div className="text-lg font-bold text-amber-600">{summary.bonusCount || 0}</div>
            <div className="text-xs text-[#565e74]">Bonus</div>
          </div>
          <div className="rounded-lg border bg-amber-50 p-3 text-center">
            <div className="text-lg font-bold text-amber-600">{(summary.registeredLunch * 40000).toLocaleString('vi-VN')}đ</div>
            <div className="text-xs text-[#565e74]">Tổng tiền</div>
          </div>
        </div>
      )}

      {/* Daily table view */}
      <div className="overflow-x-auto rounded-xl border border-[#c2c6d6]/70">
        <table className="min-w-full divide-y divide-[#c2c6d6] text-sm">
          <thead className="bg-[#f8f9ff] text-[#565e74]">
            <tr>
              <th className="px-3 py-3 text-left font-semibold">STT</th>
              <th className="px-3 py-3 text-left font-semibold">Họ tên</th>
              <th className="px-3 py-3 text-left font-semibold">Team</th>
              <th className="px-3 py-3 text-center font-semibold">Trạng thái</th>
              <th className="px-3 py-3 text-center font-semibold">Cơm trưa</th>
              <th className="px-3 py-3 text-center font-semibold">Tiền (VNĐ)</th>
              {!isAdmin && <th className="px-3 py-3 text-center font-semibold">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#eef2f7] bg-white">
            {membersToShow.map((m, idx) => {
              const isOff = !!offMap[m.id];
              const lunch = lunchRecords.find(r => r.member_id === m.id);
              const hasRegistered = lunch !== undefined;
              const cost = (!isOff && (lunch?.status === 'lunch' || lunch?.status === 'bonus' || (!lunch?.status && lunch?.has_lunch))) ? 40000 : 0;

              return (
                <tr key={m.id} className="hover:bg-[#f8f9ff]">
                  <td className="px-3 py-3 font-semibold text-[#0b1c30]">{idx + 1}</td>
                  <td className="px-3 py-3 text-[#0b1c30]">{m.name}</td>
                  <td className="px-3 py-3 text-[#565e74]">{m.team}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${isOff ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {isOff ? 'Off' : 'Working'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {isAdmin ? (
                      <select
                        value={isOff ? 'no_lunch' : (lunch?.status || (lunch?.has_lunch ? 'lunch' : 'no_lunch'))}
                        onChange={(e) => handleStatusChange(m.id, e.target.value)}
                        disabled={saving || isOff}
                        className="rounded-lg border border-[#c2c6d6] bg-white px-2 py-1 text-xs font-semibold outline-none"
                      >
                        <option value="off">Off</option>
                        <option value="lunch">Có ăn</option>
                        <option value="no_lunch">Không ăn</option>
                        <option value="bonus">Bonus</option>
                      </select>
                    ) : isOff ? (
                      <span className="text-[#565e74]">-</span>
                    ) : hasRegistered ? (
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                        lunch.status === 'bonus' ? 'bg-amber-100 text-amber-700' :
                        lunch.status === 'off' ? 'bg-rose-100 text-rose-700' :
                        lunch.has_lunch ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                      }`}>
                        {lunch.status === 'bonus' ? 'Bonus' :
                         lunch.status === 'off' ? 'Off' :
                         lunch.has_lunch ? 'Có ăn' : 'Không ăn'}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600">Chưa đăng ký</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center font-semibold text-amber-700">
                    {cost > 0 ? cost.toLocaleString('vi-VN') : '0'}
                  </td>
                  {!isAdmin && (
                    <td className="px-3 py-3">
                      {!isOff && (
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => handleToggle(m.id, true)} disabled={saving}
                            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${lunch?.has_lunch === true ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400' : 'bg-gray-100 text-gray-600 hover:bg-emerald-50'}`}>
                            Có ăn
                          </button>
                          <button onClick={() => handleToggle(m.id, false)} disabled={saving}
                            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${lunch?.has_lunch === false ? 'bg-rose-100 text-rose-700 ring-2 ring-rose-400' : 'bg-gray-100 text-gray-600 hover:bg-rose-50'}`}>
                            Không ăn
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!isAdmin && !currentMemberId && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          Không thể xác định member của bạn. Vui lòng liên hệ admin để thiết lập tài khoản.
        </div>
      )}
      {membersToShow.length === 0 && (
        <div className="py-8 text-center text-sm text-[#565e74]">
          {isAdmin ? 'No members found.' : 'No member information found for your account.'}
        </div>
      )}
        </>
      )}
    </div>
  );
}

function dateToYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatVietnameseWeekday(value: string | Date) {
  return getBusinessWeekdayLabel(value);
}

export default function LeaveRequestPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [toast, setToast] = useState('');
  const [viewingRequest, setViewingRequest] = useState<LeaveRequest | null>(null);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [selectedMemberDetail, setSelectedMemberDetail] = useState<any>(null);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; height?: number } | null>(null);
  const [view, setView] = useState<'list' | 'calendar' | 'lunch'>('list');
  const todayDefault = dateToYMD(new Date());
  const [calendarDate, setCalendarDate] = useState<string>(todayDefault);
  // Month selector for the Calendar Team view (YYYY-MM).
  const [calendarMonth, setCalendarMonth] = useState<string>(todayDefault.slice(0, 7));
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const actionBtnRef = useRef<HTMLElement | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Calendar team filter
  const [calendarSelectedTeam, setCalendarSelectedTeam] = useState('All');

  useEffect(() => {
    const role = localStorage.getItem('role');
    const canManage = role === 'admin' || role === 'super_admin' || role === 'leader';
    setIsAdmin(canManage);
  }, []);

  const QUERY_KEY = ['leave-requests'] as const;

  const { data: leaveData, isLoading: loading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      try {
        const requests = await getLeaveRequests();
        return { requests: requests as LeaveRequest[], teamMembers: [] as TeamMember[] };
      } catch (error) {
        console.error('Error fetching data:', error);
        return { requests: mockLeaveRequests, teamMembers: [] as TeamMember[] };
      }
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const requests: LeaveRequest[] = leaveData?.requests || [];
  const { data: memberData } = useQuery({
    queryKey: ['leave-request-members'],
    queryFn: async () => {
      const membersData = await getMembers({ light: true, scope: true });
      return membersData.map((m: any): TeamMember => ({
        id: m.id,
        name: m.full_name || m.display_name || m.name || 'Unknown',
        team: m.team || 'Unassigned',
        role: m.position || 'Member',
        email: m.email,
        telegram_username: m.telegram_username,
        phone: m.phone,
        position: m.position,
        user_id: m.user_id,
      }));
    },
    enabled: view === 'calendar',
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const teamMembers: TeamMember[] = memberData || [];

  const editingId = useMemo(() => {
    const idParam = searchParams.get('edit');
    if (!idParam) return null;
    const parsed = Number(idParam);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  // Telegram "View Leave Request" deep link: /leave-request?view=<id>
  // Auto-opens the detail modal for the given request.
  const viewId = useMemo(() => {
    const idParam = searchParams.get('view');
    if (!idParam) return null;
    const parsed = Number(idParam);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  const editingRequest = useMemo(() => requests.find((item) => item.id === editingId) ?? null, [editingId, requests]);

  // When arriving via a Telegram "View Leave Request" link, open the modal for
  // that request as soon as the list is loaded.
  useEffect(() => {
    if (viewId == null) return;
    const target = requests.find((item) => item.id === viewId);
    if (target) {
      setViewingRequest(target);
    }
  }, [viewId, requests]);

  // Same shape as the old setRequests(prev => ...) calls, just writing to the
  // React Query cache instead of local state so the list stays in sync with
  // whatever else reads the same ['leave-requests'] query.
  const updateRequests = (updater: (prev: LeaveRequest[]) => LeaveRequest[]) => {
    queryClient.setQueryData(QUERY_KEY, (prev: { requests: LeaveRequest[]; teamMembers: TeamMember[] } | undefined) => ({
      requests: updater(prev?.requests || []),
      teamMembers: prev?.teamMembers || [],
    }));
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!openActionId) return;
    function onDocClick(e: MouseEvent) {
      const dr = dropdownRef.current;
      const tgt = e.target as HTMLElement;
      if (dr && dr.contains(tgt)) return;
      if (tgt.closest('[data-action-button]')) return;
      setOpenActionId(null);
      setDropdownPos(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenActionId(null);
        setDropdownPos(null);
      }
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);

    function onScrollResize() {
      if (!openActionId || !actionBtnRef.current || !dropdownPos) return;
      const btn = actionBtnRef.current as HTMLElement;
      const btnRect = btn.getBoundingClientRect();
      const scrollY = window.scrollY || window.pageYOffset;
      const scrollX = window.scrollX || window.pageXOffset;
      const viewportW = document.documentElement.clientWidth;
      const dropdownWidth = dropdownPos.width;
      const top = btnRect.bottom + scrollY + 6;
      let left = btnRect.right + scrollX - dropdownWidth;
      left = Math.max(8 + scrollX, Math.min(left, viewportW - dropdownWidth - 8 + scrollX));
      setDropdownPos((prev) => prev ? { ...prev, top, left } : { top, left, width: dropdownWidth });
    }
    window.addEventListener('scroll', onScrollResize);
    window.addEventListener('resize', onScrollResize);

    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollResize);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [openActionId, dropdownPos]);

  const summary = useMemo(() => {
    const approved = requests.filter((item) => item.status === 'Approved').length;
    const pending = requests.filter((item) => item.status === 'Pending').length;
    const rejected = requests.filter((item) => item.status === 'Rejected').length;
    return {
      total: requests.length,
      approved,
      pending,
      rejected,
    };
  }, [requests]);

  const memberByUserId = useMemo(() => {
    const map: Record<number, number> = {};
    teamMembers.forEach((m) => {
      if (m.user_id) map[m.user_id] = m.id;
    });
    return map;
  }, [teamMembers]);

  // Per-member leave summary for the selected month (YYYY-MM). For every team
  // member we compute: total approved leave days in the month and the list of
  // approved leave requests that fall (partially) into that month.
  const monthlyLeaveByMember = useMemo(() => {
    const [yearStr, monthStr] = calendarMonth.split('-');
    if (!yearStr || !monthStr) return {} as Record<number, { totalDays: number; leaves: any[] }>;

    const result: Record<number, { totalDays: number; leaves: any[] }> = {};
    teamMembers.forEach((m) => {
      result[m.id] = { totalDays: 0, leaves: [] };
    });

    const monthStart = new Date(Number(yearStr), Number(monthStr) - 1, 1);
    const monthEnd = new Date(Number(yearStr), Number(monthStr), 0); // last day of month

    requests.forEach((req) => {
      if (req.status !== 'Approved') return;

      const memberId = req.member_id ?? memberByUserId[req.user_id];
      if (!memberId || !result[memberId]) return;

      const s = new Date(req.start_date);
      const e = new Date(req.end_date);
      if (s > monthEnd || e < monthStart) return; // no overlap with the month

      // Count man-days that fall within the selected month. Hourly OFF is a
      // single day worth 0.5 man-day; full-day rows keep counting 1/day.
      const hourly = !!(req.start_time && req.end_time);
      let overlapDays = 0;
      const cursor = new Date(Math.max(s.getTime(), monthStart.getTime()));
      const realEnd = new Date(Math.min(e.getTime(), monthEnd.getTime()));
      while (cursor <= realEnd) {
        overlapDays += hourly ? 0.5 : 1;
        cursor.setDate(cursor.getDate() + 1);
      }

      result[memberId].leaves.push({
        ...req,
        _overlapDays: overlapDays,
      });
      result[memberId].totalDays += overlapDays;
    });

    return result;
  }, [calendarMonth, requests, teamMembers, memberByUserId]);

  const calendarStatusByMember = useMemo(() => {
    const target = new Date(calendarDate);
    const map: Record<number, { off: boolean; leave?: any }> = {};
    teamMembers.forEach((m) => (map[m.id] = { off: false }));

    requests.forEach((req) => {
      if (req.status !== "Approved") return;

      const s = new Date(req.start_date);
      const e = new Date(req.end_date);

      if (s <= target && target <= e) {
        const memberId =
          req.member_id ??
          memberByUserId[req.user_id];

        if (memberId && map[memberId]) {
          map[memberId] = {
            off: true,
            leave: req,
          };
        }
      }
    });

    return map;
  }, [calendarDate, requests, teamMembers, memberByUserId]);

  // Extract unique teams from DB for calendar filter
  const calendarTeams = useMemo(() => {
    const teams = new Set<string>();
    teamMembers.forEach((m) => { if (m.team) teams.add(m.team); });
    return ['All', ...Array.from(teams).sort()];
  }, [teamMembers]);

  // Filter team members based on calendar team filter
  const filteredCalendarMembers = useMemo(() => {
    if (calendarSelectedTeam === 'All') return teamMembers;
    return teamMembers.filter((m) => m.team === calendarSelectedTeam);
  }, [teamMembers, calendarSelectedTeam]);

  // Group filtered members by team
  const calendarTeamsGrouped = useMemo(() => {
    const teamMap = new Map<string, TeamMember[]>();
    filteredCalendarMembers.forEach((m) => {
      const t = m.team || 'Unassigned';
      if (!teamMap.has(t)) teamMap.set(t, []);
      teamMap.get(t)!.push(m);
    });
    return Array.from(teamMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredCalendarMembers]);

  // ── View-only work calendar helpers ──────────────────────────
  // The Calendar is a read-only month grid: it opens showing the current month
  // and immediately displays who is working / on leave for every day, exactly
  // like a physical work calendar/book. No selection or click is required.

  // Parse the selected month (YYYY-MM) into a Date representing the 1st.
  const calendarCursor = useMemo(() => {
    const [y, m] = (calendarMonth || '').split('-').map(Number);
    if (!y || !m) return new Date();
    return new Date(y, m - 1, 1);
  }, [calendarMonth]);

  const calendarMonthLabel = useMemo(() =>
    calendarCursor.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }),
  [calendarCursor]);

  function shiftCalendarMonth(delta: number) {
    const d = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + delta, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    setCalendarMonth(`${y}-${m}`);
  }

  function goToday() {
    const now = new Date();
    setCalendarMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  }

  // Map member id -> display name, used to label who is on leave in the grid.
  const memberNameById = useMemo(() => {
    const map: Record<number, string> = {};
    teamMembers.forEach((m) => { map[m.id] = m.name; });
    return map;
  }, [teamMembers]);

  // Builds the visual month grid: leading blanks for the first weekday, then a
  // cell per day. Each day carries the list of approved-leave entries that
  // overlap it, so the calendar shows at a glance who is off and who is working.
  const calendarDays = useMemo(() => {
    const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
    const daysInMonth = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 0).getDate();
    const dateKey = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const last = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 0);

    const byDate: Record<string, any[]> = {};
    for (const req of requests) {
      if (req.status !== 'Approved') continue;
      const s = new Date(req.start_date);
      const e = new Date(req.end_date);
      if (e < first || s > last) continue;
      const cursor = new Date(Math.max(s.getTime(), first.getTime()));
      const realEnd = new Date(Math.min(e.getTime(), last.getTime()));
      while (cursor <= realEnd) {
        const key = dateKey(cursor);
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(req);
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const todayKey = dateKey(new Date());
    const cells: ({ day: number; leaves: any[]; isToday: boolean; isWeekend: boolean } | null)[] = [];
    const lead = first.getDay(); // 0 = Sunday
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), d);
      const key = dateKey(dt);
      cells.push({
        day: d,
        leaves: byDate[key] || [],
        isToday: key === todayKey,
        isWeekend: dt.getDay() === 0 || dt.getDay() === 6,
      });
    }
    return cells;
  }, [calendarCursor, requests]);

  const totalPages = Math.max(1, Math.ceil(requests.length / ITEMS_PER_PAGE));
  const pageItems = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return requests.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [currentPage, requests]);

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this leave request?')) return;
    try {
      await deleteLeaveRequest(id);
      updateRequests((prev) => prev.filter((item) => item.id !== id));
      setToast('Leave request deleted.');
      setOpenActionId(null);
    } catch (error) {
      setToast('Error deleting leave request.');
    }
  };

  const handleSubmit = async (values: LeaveRequestFormValues) => {
    try {
      const now = new Date();
      const timeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const payload = {
        leave_type: values.leaveType,
        start_date: values.startDate,
        end_date: values.endDate,
        man_day: values.manDay,
        month: new Date(values.startDate).toLocaleString('en-US', { month: 'long' }),
        year: new Date(values.startDate).getFullYear(),
        time: timeString,
        // Hourly OFF ("OFF theo khung giờ"); null/null = existing full-day row.
        start_time: values.offMode === 'hour' ? values.startTime : null,
        end_time: values.offMode === 'hour' ? values.endTime : null,
        province: values.province,
        ward: values.ward,
        address: values.address || null,
        reason: values.reason,
        status: 'Pending' as const,
      };

      if (editingId) {
        const updated = await updateLeaveRequest(editingId, payload);
        updateRequests((prev) => prev.map((item) => (item.id === editingId ? updated : item)));
        setToast('Leave request updated successfully.');
      } else {
        const created = await createLeaveRequest(payload);
        updateRequests((prev) => [created, ...prev]);
        setToast('Leave request submitted successfully.');
      }

      router.replace('/leave-request');
    } catch (error) {
      setToast('Error saving leave request.');
    }
  };

  const handleApprove = async (id: number, status: 'Approved' | 'Rejected') => {
    try {
      const updated = await approveLeaveRequest(id, status);
      updateRequests((prev) => prev.map((item) => (item.id === id ? updated : item)));
      setToast(`Leave request ${status.toLowerCase()}.`);
      setOpenActionId(null);
    } catch (error) {
      setToast('Error updating status.');
    }
  };

  const isSubmitForm = pathname === '/leave-request/new';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] text-[#0b1c30] flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-semibold">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#0b1c30]">
      <Navbar />
      <main className="md:ml-[230px] px-4 py-6 md:px-6 lg:px-8 pt-16 md:pt-6 overflow-x-auto">
        <div className="mx-auto max-w-7xl rounded-2xl border border-[#c2c6d6]/50 bg-white p-4 shadow-sm md:p-6">
          {!isSubmitForm ? (
            <>
              <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-[#0b1c30]">Leave Request</h2>
                  <p className="mt-1 text-sm text-[#565e74]">Manage and track your leave requests.</p>
                </div>
                {view === 'list' && (
                  <button
                    onClick={() => router.push('/leave-request/new')}
                    className="rounded-lg bg-[#0058be] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#004da8]"
                  >
                    + New Request
                  </button>
                )}
              </div>

              {/* Tabs */}
              <div className="mb-5 flex gap-2 border-b border-[#c2c6d6]">
                <button
                  onClick={() => setView('list')}
                  className={`px-4 py-3 font-semibold text-sm transition-all ${
                    view === 'list'
                      ? 'text-[#0058be] border-b-2 border-[#0058be]'
                      : 'text-[#565e74] hover:text-[#0b1c30]'
                  }`}
                >
                  List Request
                </button>
                <button
                  onClick={() => setView('calendar')}
                  className={`px-4 py-3 font-semibold text-sm transition-all ${
                    view === 'calendar'
                      ? 'text-[#0058be] border-b-2 border-[#0058be]'
                      : 'text-[#565e74] hover:text-[#0b1c30]'
                  }`}
                >
                  Calendar Team
                </button>
                <button
                  onClick={() => setView('lunch')}
                  className={`px-4 py-3 font-semibold text-sm transition-all ${
                    view === 'lunch'
                      ? 'text-[#0058be] border-b-2 border-[#0058be]'
                      : 'text-[#565e74] hover:text-[#0b1c30]'
                  }`}
                >
                  Check Working / Lunch
                </button>
              </div>

              {view === 'list' ? (
                <>
                  <div className="mb-5 grid gap-3 md:grid-cols-4">
                    <SummaryCard title="Total Balance" value={summary.total} accent="blue" />
                    <SummaryCard title="Approved" value={summary.approved} accent="green" />
                    <SummaryCard title="Pending" value={summary.pending} accent="yellow" />
                    <SummaryCard title="Rejected" value={summary.rejected} accent="red" />
                  </div>

                  <div ref={tableWrapRef} className="relative overflow-x-auto rounded-xl border border-[#c2c6d6]/70">
                    {/* Mobile card view */}
                    <div className="md:hidden space-y-3 p-3">
                      {pageItems.map((item) => (
                        <div key={item.id} className="rounded-lg border bg-white p-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-sm font-semibold text-[#0b1c30]">
                                {item.leave_type} • {item.man_day} Day{item.man_day > 1 ? 's' : ''}
                              </div>
                              <div className="text-xs text-[#565e74]">
                                {formatLeaveRange(item)}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <StatusBadge status={item.status} />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setViewingRequest(item)}
                                  className="rounded px-3 py-1 text-sm text-[#0058be] hover:bg-slate-50"
                                >
                                  View
                                </button>
                                {(item.status === 'Pending' || isAdmin) && (
                                  <button
                                    onClick={() => router.push(`/leave-request/new?edit=${item.id}`)}
                                    className="rounded px-3 py-1 text-sm text-amber-600 hover:bg-slate-50"
                                  >
                                    Edit
                                  </button>
                                )}
                                {(item.status !== 'Pending' || isAdmin) && (
                                  <button
                                    onClick={() => handleDelete(item.id)}
                                    className="rounded px-3 py-1 text-sm text-rose-600 hover:bg-slate-50"
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 text-sm text-[#565e74]">{item.reason}</div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop table */}
                    <table className="hidden md:table min-w-full divide-y divide-[#c2c6d6] text-xs md:text-sm">
                      <thead className="bg-[#f8f9ff] text-[#565e74]">
                        <tr>
                          <th className="px-3 py-3 text-left font-semibold">No.</th>
                          <th className="px-3 py-3 text-left font-semibold">User</th>
                          <th className="px-3 py-3 text-left font-semibold">Leave Type</th>
                          <th className="px-3 py-3 text-left font-semibold">Start Date</th>
                          <th className="px-3 py-3 text-left font-semibold">End Date</th>
                          <th className="px-3 py-3 text-left font-semibold">Time</th>
                          <th className="px-3 py-3 text-left font-semibold">Man-day</th>
                          <th className="px-3 py-3 text-left font-semibold">Location</th>
                          <th className="px-3 py-3 text-left font-semibold">Reason</th>
                          <th className="px-3 py-3 text-left font-semibold">Status</th>
                          <th className="px-3 py-3 text-left font-semibold">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#eef2f7] bg-white">
                        {pageItems.map((item, index) => (
                          <tr key={item.id} className="align-top">
                            <td className="px-3 py-3 font-semibold text-[#0b1c30]">
                              {(currentPage - 1) * ITEMS_PER_PAGE + index + 1}
                            </td>
                            <td className="px-3 py-3 text-[#565e74]">
                              {item.member ? (
                                <span className="font-semibold text-[#0b1c30]">{item.member.full_name}</span>
                              ) : item.user?.full_name ? (
                                <span>{item.user.full_name}</span>
                              ) : (
                                `User ${item.user_id}`
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <LeaveTypeBadge type={item.leave_type} />
                            </td>
                            <td className="px-3 py-3 text-[#565e74]">
                              {formatDateLabel(item.start_date)}
                              {item.start_time && <span className="block text-[11px] text-[#0b1c30] font-semibold">{item.start_time} – {item.end_time}</span>}
                            </td>
                            <td className="px-3 py-3 text-[#565e74]">{formatDateLabel(item.end_date)}</td>
                            <td className="px-3 py-3 text-[#565e74]">
                              {item.time ? (() => {
                                const timeParts = item.time.split(' ');
                                const time = timeParts.length > 1 ? timeParts[1] : timeParts[0];
                                const dateStr = item.created_at ? formatDateLabel(item.created_at) : '';
                                return `${time} ${dateStr}`;
                              })() : '-'}
                            </td>
                            <td className="px-3 py-3 text-[#565e74]">{item.man_day}</td>
                            <td className="px-3 py-3 text-[#565e74]">
                              {item.ward}, {item.province}
                            </td>
                            <td className="px-3 py-3 max-w-[180px] text-[#565e74]">{item.reason}</td>
                            <td className="px-3 py-3">
                              <StatusBadge status={item.status} />
                            </td>
                            <td className="px-3 py-3 relative">
                              <div className="inline-block text-sm">
                                <button
                                  onClick={(e) => {
                                    const btn = e.currentTarget as HTMLElement;
                                    const wrap = tableWrapRef.current;
                                    const dropdownWidth = 144;
                                    const dropdownHeight = 140;
                                    if (!wrap) {
                                      setOpenActionId((prev) => (prev === item.id ? null : item.id));
                                      return;
                                    }
                                    const btnRect = btn.getBoundingClientRect();
                                    const scrollY = window.scrollY || window.pageYOffset;
                                    const scrollX = window.scrollX || window.pageXOffset;
                                    const viewportW = document.documentElement.clientWidth;

                                    const top = btnRect.bottom + scrollY + 6;
                                    let left = btnRect.right + scrollX - dropdownWidth;
                                    left = Math.max(8 + scrollX, Math.min(left, viewportW - dropdownWidth - 8 + scrollX));

                                    actionBtnRef.current = btn;
                                    setDropdownPos({ top, left, width: dropdownWidth, height: dropdownHeight });
                                    setOpenActionId((prev) => (prev === item.id ? null : item.id));
                                  }}
                                  data-action-button
                                  className="rounded px-3 py-1 bg-[#0058be] text-white font-semibold hover:bg-[#004a9a]"
                                >
                                  Actions
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {openActionId && dropdownPos && (
                      <Portal>
                        <div
                          ref={dropdownRef}
                          style={{
                            position: 'absolute',
                            top: dropdownPos.top,
                            left: dropdownPos.left,
                            width: dropdownPos.width,
                            maxHeight: dropdownPos.height ?? 240,
                            overflowY: 'auto',
                          }}
                          className="rounded border bg-white shadow-lg z-50"
                        >
                          {(() => {
                            const act = requests.find((r) => r.id === openActionId);
                            if (!act) return null;
                            return (
                              <>
                                <button
                                  onClick={() => {
                                    setViewingRequest(act);
                                    setOpenActionId(null);
                                    setDropdownPos(null);
                                  }}
                                  className="w-full text-left px-3 py-2 text-[#0058be] hover:bg-slate-50"
                                >
                                  View
                                </button>
                                <button
                                  onClick={() => {
                                    if (act.status === 'Pending') {
                                      router.push(`/leave-request/new?edit=${act.id}`);
                                      setOpenActionId(null);
                                      setDropdownPos(null);
                                    }
                                  }}
                                  disabled={act.status !== 'Pending'}
                                  className={`w-full text-left px-3 py-2 ${
                                    act.status === 'Pending' ? 'text-amber-600 hover:bg-slate-50' : 'text-amber-300 cursor-not-allowed'
                                  }`}
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => {
                                    if (act.status !== 'Pending') {
                                      handleDelete(act.id);
                                      setDropdownPos(null);
                                    }
                                  }}
                                  disabled={act.status === 'Pending'}
                                  className={`w-full text-left px-3 py-2 ${
                                    act.status !== 'Pending' ? 'text-rose-600 hover:bg-slate-50' : 'text-rose-300 cursor-not-allowed'
                                  }`}
                                >
                                  Delete
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </Portal>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-[#565e74]">
                      Showing {pageItems.length} of {requests.length} requests
                    </p>
                    <div className="flex gap-2">
                      <button
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((prev) => prev - 1)}
                        className="rounded border border-[#c2c6d6] px-3 py-1 text-sm text-[#565e74] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Prev
                      </button>
                      <button
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage((prev) => prev + 1)}
                        className="rounded border border-[#c2c6d6] px-3 py-1 text-sm text-[#565e74] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              ) : view === 'lunch' ? (
                /* ========== LUNCH CHECK-IN VIEW ========== */
                <LunchCheckIn 
                  members={teamMembers} 
                  leaveRequests={requests}
                  calendarDate={calendarDate}
                  isAdmin={isAdmin}
                />
              ) : (
                /* ========== CALENDAR VIEW (view-only work calendar) ========== */
                <>
                  <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-[#0b1c30]">Lịch làm việc tháng</h3>
                      <p className="text-sm text-[#565e74]">
                        Lịch nghỉ (đã duyệt) của các thành viên. Ngày không đánh dấu là ngày làm việc bình thường.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1 rounded-lg border border-[#c2c6d6] bg-white p-1 text-sm">
                        <button
                          onClick={() => shiftCalendarMonth(-1)}
                          className="rounded-md px-2.5 py-1 text-[#565e74] hover:bg-[#f8f9ff]"
                          title="Tháng trước"
                        >
                          ‹
                        </button>
                        <span className="min-w-[160px] text-center font-semibold text-[#0b1c30]">{calendarMonthLabel}</span>
                        <button
                          onClick={() => shiftCalendarMonth(1)}
                          className="rounded-md px-2.5 py-1 text-[#565e74] hover:bg-[#f8f9ff]"
                          title="Tháng sau"
                        >
                          ›
                        </button>
                      </div>
                      <button
                        onClick={goToday}
                        className="rounded-lg border border-[#c2c6d6] bg-white px-3 py-1.5 text-sm font-semibold text-[#0058be] hover:bg-[#f8f9ff]"
                      >
                        Hôm nay
                      </button>
                      <select
                        value={calendarSelectedTeam}
                        onChange={(e) => setCalendarSelectedTeam(e.target.value)}
                        className="rounded-lg border border-[#c2c6d6] bg-white px-3 py-1.5 text-sm outline-none"
                      >
                        {calendarTeams.map((team) => (
                          <option key={team} value={team}>{team}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-[#565e74]">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded ring-1 ring-rose-200 bg-rose-50" /> Ngày có người nghỉ
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded bg-white ring-1 ring-[#c2c6d6]" /> Ngày làm việc bình thường
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded border-2 border-[#0058be] bg-white" /> Hôm nay
                    </span>
                  </div>

                  {/* Day-of-week header */}
                  <div className="grid grid-cols-7 border-b border-[#c2c6d6] bg-[#f8f9ff]">
                    {['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((d) => (
                      <div key={d} className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-[#565e74]">
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Month grid (aspect-ratio cells, view-only) */}
                  <div className="grid grid-cols-7">
                    {calendarDays.map((cell, idx) => (
                      <div
                        key={idx}
                        className={`min-h-[92px] border-b border-r border-[#eef2f7] p-1.5 ${
                          idx % 7 === 0 ? 'border-l' : ''
                        } ${cell ? (cell.isWeekend ? 'bg-[#fbfcff]' : 'bg-white') : 'bg-[#fafafa]'}`}
                      >
                        {cell && (
                          <>
                            <div className="flex items-center justify-between">
                              <span
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${
                                  cell.isToday
                                    ? 'bg-[#0058be] text-white'
                                    : cell.leaves.length > 0
                                    ? 'bg-rose-100 text-rose-700'
                                    : 'text-[#0b1c30]'
                                }`}
                              >
                                {cell.day}
                              </span>
                              {cell.leaves.length > 0 && (
                                <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
                                  {cell.leaves.length} nghỉ
                                </span>
                              )}
                            </div>
                            {cell.leaves.length > 0 && (
                              <ul className="mt-1.5 space-y-1">
                                {cell.leaves.slice(0, 3).map((leaf: any) => {
                                  const memberId = leaf.member_id ?? memberByUserId[leaf.user_id];
                                  const name = memberId ? (memberNameById[memberId] || `User ${leaf.user_id}`) : `User ${leaf.user_id}`;
                                  return (
                                    <li
                                      key={leaf.id}
                                      title={`${name} — ${leaf.leave_type}`}
                                      className="truncate rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700"
                                    >
                                      {name} · {leaf.leave_type}
                                    </li>
                                  );
                                })}
                                {cell.leaves.length > 3 && (
                                  <li className="px-1.5 text-[11px] font-semibold text-rose-600">
                                    +{cell.leaves.length - 3} người khác
                                  </li>
                                )}
                              </ul>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">
                    Leave Request / {editingId ? 'Edit Request' : 'New Request'}
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-[#0b1c30]">
                    {editingId ? 'Edit Leave Request' : 'Submit Leave Request'}
                  </h2>
                </div>
                <div>
                  <button
                    onClick={() => router.replace('/leave-request')}
                    className="rounded-lg border border-[#c2c6d6] px-3 py-2 text-sm font-semibold text-[#565e74] hover:bg-[#f8f9ff]"
                  >
                    Back
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-[#c2c6d6]/70 bg-[#f8f9ff] p-5">
                <p className="text-sm text-[#565e74]">
                  Fill in the form and submit your request. The system will validate the leave duration and location details.
                </p>
              </div>
              <div className="rounded-xl border border-[#c2c6d6]/70 p-5">
              <LeaveRequestForm
                  initialValues={
                    editingRequest
                      ? {
                          leaveType: editingRequest.leave_type,
                          offMode: editingRequest.start_time && editingRequest.end_time ? ('hour' as const) : ('day' as const),
                          startDate: editingRequest.start_date,
                          endDate: editingRequest.end_date,
                          startTime: editingRequest.start_time ?? '',
                          endTime: editingRequest.end_time ?? '',
                          reason: editingRequest.reason,
                          province: editingRequest.province,
                          ward: editingRequest.ward,
                          address: editingRequest.address ?? '',
                          manDay: editingRequest.man_day,
                        }
                      : undefined
                  }
                  onSubmit={handleSubmit}
                  onCancel={() => router.push('/leave-request')}
                  submitLabel={editingRequest ? 'Update Request' : 'Submit Request'}
                />
              </div>
            </div>
          )}
        </div>

        {toast && (
          <div className="fixed bottom-4 right-4 rounded-lg bg-[#0b1c30] px-4 py-3 text-sm font-medium text-white shadow-lg">
            {toast}
          </div>
        )}

        {selectedMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-[#0b1c30]">Thông tin thành viên</h3>
                  <p className="text-sm text-[#565e74]">Chi tiết liên hệ và thông tin cá nhân.</p>
                </div>
                <button onClick={() => setSelectedMember(null)} className="text-sm text-[#565e74]">
                  Close
                </button>
              </div>
              <div className="space-y-3 text-sm text-[#0b1c30]">
                <div className="flex justify-between">
                  <span className="text-[#565e74]">Tên hiển thị</span>
                  <span className="font-semibold">{selectedMember.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#565e74]">Team</span>
                  <span className="font-semibold">{selectedMember.team}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#565e74]">Role</span>
                  <span className="font-semibold">{selectedMember.role}</span>
                </div>
                {selectedMember.email && (
                  <div className="flex justify-between">
                    <span className="text-[#565e74]">Email</span>
                    <span className="font-semibold">{selectedMember.email}</span>
                  </div>
                )}
                {selectedMember.telegram_username && (
                  <div className="flex justify-between">
                    <span className="text-[#565e74]">Telegram</span>
                    <span className="font-semibold">{selectedMember.telegram_username}</span>
                  </div>
                )}
                {selectedMember.phone && (
                  <div className="flex justify-between">
                    <span className="text-[#565e74]">Phone</span>
                    <span className="font-semibold">{selectedMember.phone}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {viewingRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-[#0b1c30]">Leave Request Details</h3>
                  <p className="text-sm text-[#565e74]">Review details of the selected request.</p>
                </div>
                <button onClick={() => setViewingRequest(null)} className="text-sm text-[#565e74]">
                  Close
                </button>
              </div>
              <div className="space-y-3 text-sm text-[#0b1c30]">
                <div className="flex justify-between">
                  <span className="text-[#565e74]">Leave Type</span>
                  <LeaveTypeBadge type={viewingRequest.leave_type} />
                </div>
                <div className="flex justify-between">
                  <span className="text-[#565e74]">Date Range</span>
                  <span className="font-semibold">
                    {formatLeaveRange(viewingRequest)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#565e74]">Man-day</span>
                  <span className="font-semibold">{viewingRequest.man_day}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#565e74]">Location</span>
                  <span className="font-semibold">
                    {viewingRequest.address ? `${viewingRequest.address}, ` : ''}
                    {viewingRequest.ward}, {viewingRequest.province}
                  </span>
                </div>
                {viewingRequest.member && (
                  <div className="flex justify-between">
                    <span className="text-[#565e74]">Member</span>
                    <span className="font-semibold">
                      {viewingRequest.member.full_name}
                      {viewingRequest.member.member_id && ` (ID: ${viewingRequest.member.member_id})`}
                      {viewingRequest.member.team && ` • ${viewingRequest.member.team}`}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#565e74]">Reason</span>
                  <span className="font-semibold">{viewingRequest.reason}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#565e74]">Status</span>
                  <span>
                    <StatusBadge status={viewingRequest.status} />
                  </span>
                </div>
                {isAdmin && viewingRequest.status === 'Pending' && (
                  <div className="flex gap-2 pt-3 border-t">
                    <button
                      onClick={() => {
                        handleApprove(viewingRequest.id, 'Approved');
                        setViewingRequest(null);
                      }}
                      className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        handleApprove(viewingRequest.id, 'Rejected');
                        setViewingRequest(null);
                      }}
                      className="flex-1 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
