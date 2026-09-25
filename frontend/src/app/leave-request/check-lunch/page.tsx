'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Navbar from '@/components/Navbar';
import { formatDateLabel } from '@/lib/leave-request';
import { deleteLunchRecord, getLunchRecords, getWorkingLunchConfig, getWorkingLunchMembers, toggleWorkingLunchMember, upsertLunchRecord } from '@/lib/api';
import { getBusinessWeekdayLabel, isWeekendDate, monthCalendarDays, parseYmdLocal, workingDaysForMonth } from '@/lib/business-date';

type LunchStatus = '' | 'lunch' | 'no_lunch' | 'onsite' | 'bonus';

interface Member {
  id: number;
  full_name?: string;
  display_name?: string;
  name?: string;
  team?: string;
  department?: string;
  position?: string;
  user_id?: number;
  workspace_id?: number;
  workspace_code?: string;
  enabled?: boolean;
}

interface LunchRecord {
  id: number;
  member_id: number;
  date: string;
  has_lunch: boolean;
  status?: LunchStatus | string;
}

const LUNCH_PRICE = 40000;
const ADMIN_ROLES = new Set(['admin', 'super_admin', 'leader']);
const STATUS_OPTIONS: { value: LunchStatus; label: string }[] = [
  { value: 'no_lunch', label: 'Không đặt' },
  { value: 'lunch', label: 'Đặt' },
  { value: 'onsite', label: 'Onsite' },
  { value: 'bonus', label: 'Bonus' },
  { value: '', label: 'Chưa chọn' },
];
const MEMBER_STATUS_OPTIONS = STATUS_OPTIONS.filter((item) => item.value === '' || item.value === 'lunch' || item.value === 'no_lunch');

function dateToYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

let tempSeq = 0;
function makeTempId(): number {
  tempSeq += 1;
  return -(Date.now() + tempSeq);
}

function memberName(member: Member) {
  return member.full_name || member.display_name || member.name || 'Chưa có tên';
}

function getRecordStatus(record?: LunchRecord): LunchStatus {
  if (!record) return '';
  if (record.status === 'lunch' || record.status === 'no_lunch' || record.status === 'onsite' || record.status === 'bonus') {
    return record.status;
  }
  return record.has_lunch ? 'lunch' : 'no_lunch';
}

function statusClass(status: LunchStatus) {
  switch (status) {
    case 'lunch':
      return 'border-blue-200 bg-blue-50 text-blue-700 focus:border-blue-400';
    case 'no_lunch':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 focus:border-emerald-400';
    case 'onsite':
      return 'border-orange-200 bg-orange-50 text-orange-700 focus:border-orange-400';
    case 'bonus':
      return 'border-violet-200 bg-violet-50 text-violet-700 focus:border-violet-400';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600 focus:border-slate-400';
  }
}

interface LunchCellProps {
  memberId: number;
  ymd: string;
  isWeekend: boolean;
  status: LunchStatus;
  saving: boolean;
  onStatusChange: (memberId: number, day: string, status: LunchStatus) => void;
}

/**
 * A single lunch table cell. Memoized so that changing the status of one cell
 * does not re-render the thousands of sibling cells (only this one passes a
 * different `status`/`saving` prop, and the callback reference is stable).
 */
const LunchCell = memo(function LunchCell({
  memberId,
  ymd,
  isWeekend,
  status,
  saving,
  onStatusChange,
}: LunchCellProps) {
  const disabled = isWeekend || saving;
  return (
    <td className={`w-32 min-w-32 border-b border-r border-slate-100 p-1.5 ${isWeekend ? 'bg-slate-100/90' : 'bg-white'}`}>
      {isWeekend ? (
        <div className="flex h-11 w-28 items-center justify-center rounded-lg border border-slate-200 bg-slate-200/80 text-[11px] font-semibold text-slate-500">
          Không làm việc
        </div>
      ) : (
        <select
          value={status}
          onChange={(e) => {
            onStatusChange(memberId, ymd, e.target.value as LunchStatus);
          }}
          disabled={disabled}
          className={`h-11 w-28 rounded-lg border px-2 text-xs font-bold outline-none transition ${statusClass(status)} ${disabled ? 'cursor-wait opacity-70' : ''}`}
        >
          {STATUS_OPTIONS.map((item) => (
            <option key={item.value || 'empty'} value={item.value}>{item.label}</option>
          ))}
        </select>
      )}
    </td>
  );
});

export default function CheckLunchPage() {
  const today = new Date();
  const todayDefault = dateToYMD(today);
  const [selectedDate, setSelectedDate] = useState<string>(todayDefault);
  const [selectedTeam, setSelectedTeam] = useState<string>('All');
  const [selectedMonth, setSelectedMonth] = useState<number>(today.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());
  const [searchTerm, setSearchTerm] = useState('');
  const [lunchRecords, setLunchRecords] = useState<LunchRecord[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);
  /** Workspace-scoped roster incl. not-yet-enabled members, for manager
   *  (SUPER ADMIN / Leader) configuration. Empty for plain Members. */
  const [configMembers, setConfigMembers] = useState<Member[]>([]);
  const [savingConfigId, setSavingConfigId] = useState<number | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const monthCacheRef = useRef<Map<string, LunchRecord[]>>(new Map());

  const commitCache = useCallback((year: number, month: number, records: LunchRecord[]) => {
    monthCacheRef.current.set(monthKey(year, month), records);
  }, []);

  const fetchMonthRecords = useCallback(async (year: number, month: number) => {
    const key = monthKey(year, month);
    const cached = monthCacheRef.current.get(key);
    if (cached) {
      setLunchRecords(cached);
      return;
    }
    const records = await getLunchRecords({ year, month });
    monthCacheRef.current.set(key, records);
    setLunchRecords(records);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const role = localStorage.getItem('role') || '';
        const userId = Number(localStorage.getItem('user_id') || 0);
        const canManage = ADMIN_ROLES.has(role);

        setIsAdmin(canManage);

        // The Check Working/Lunch roster is decided by the BACKEND from the
        // current user's DB Workspace relationship — the client never picks a
        // workspace. `/lunch/members` returns only Members that a manager has
        // explicitly enabled inside the caller's Workspace (and, for a plain
        // Member/Viewer, only the caller themselves when enabled).
        const [membersRes, records] = await Promise.all([
          getWorkingLunchMembers({ enabled_only: true, date: selectedDate }),
          getLunchRecords({ year: selectedYear, month: selectedMonth }),
        ]);
        setMembers(membersRes);
        commitCache(selectedYear, selectedMonth, records);
        setLunchRecords(records);

        // Managers (SUPER ADMIN / Leader) additionally load the Workspace-scoped
        // configuration list so they can enable/disable participants.
        if (canManage) {
          try {
            const configRes = await getWorkingLunchConfig(undefined, selectedDate);
            setConfigMembers(configRes);
          } catch (configError) {
            console.error('Error fetching working/lunch configuration:', configError);
          }
        }

        const member = membersRes.find((m: Member) => m.user_id === userId);
        setCurrentMemberId(member?.id || null);
      } catch (error) {
        console.error('Error fetching check lunch data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Run once on mount. selectedYear/selectedMonth for the initial month are
    // intentionally read from the initial render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;
    const refreshDailyRoster = async () => {
      try {
        const roster = await getWorkingLunchMembers({ enabled_only: true, date: selectedDate });
        setMembers(roster);
        const userId = Number(localStorage.getItem('user_id') || 0);
        setCurrentMemberId(roster.find((member: Member) => member.user_id === userId)?.id || null);
        if (isAdmin) {
          const config = await getWorkingLunchConfig(undefined, selectedDate);
          setConfigMembers(config);
        }
      } catch (error) {
        console.error('Error fetching daily Check Lunch roster:', error);
      }
    };
    refreshDailyRoster();
  }, [isAdmin, loading, selectedDate]);

  useEffect(() => {
    if (loading) return;
    fetchMonthRecords(selectedYear, selectedMonth).catch((error) => console.error('Error fetching lunch month:', error));
  }, [fetchMonthRecords, loading, selectedMonth, selectedYear]);

  const teamsFromDB = useMemo(() => {
    const teams = new Set<string>();
    members.forEach((m) => {
      if (m.team) teams.add(m.team);
    });
    return ['All', ...Array.from(teams).sort()];
  }, [members]);

  const visibleMembers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return members
      .filter((m) => selectedTeam === 'All' || m.team === selectedTeam)
      .filter((m) => {
        if (!normalizedSearch) return true;
        return memberName(m).toLowerCase().includes(normalizedSearch);
      });
  }, [members, searchTerm, selectedTeam]);

  const recordsByCell = useMemo(() => {
    const map = new Map<string, LunchRecord>();
    lunchRecords.forEach((r) => map.set(`${r.member_id}-${r.date}`, r));
    return map;
  }, [lunchRecords]);

  // Latest-value refs so the status-change callback stays referentially stable
  // across renders (required for <LunchCell> memoization to avoid re-rendering
  // the whole table when a single cell changes).
  const lunchRecordsRef = useRef(lunchRecords);
  lunchRecordsRef.current = lunchRecords;
  const recordsByCellRef = useRef(recordsByCell);
  recordsByCellRef.current = recordsByCell;
  const selectedYearRef = useRef(selectedYear);
  selectedYearRef.current = selectedYear;
  const selectedMonthRef = useRef(selectedMonth);
  selectedMonthRef.current = selectedMonth;

  const calendarDays = useMemo(() => monthCalendarDays(selectedYear, selectedMonth), [selectedMonth, selectedYear]);
  const workDays = useMemo(() => workingDaysForMonth(selectedYear, selectedMonth), [selectedMonth, selectedYear]);

  useEffect(() => {
    if (isAdmin || workDays.length === 0) return;
    if (!selectedDate.startsWith(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`)) {
      setSelectedDate(workDays[0].ymd);
    }
  }, [isAdmin, selectedDate, selectedMonth, selectedYear, workDays]);

  const summary = useMemo(() => {
    let lunchCount = 0;
    let noLunchCount = 0;
    let onsiteCount = 0;
    let bonusCount = 0;
    let emptyCount = 0;

    visibleMembers.forEach((m) => {
      workDays.forEach((day) => {
        const status = getRecordStatus(recordsByCell.get(`${m.id}-${day.ymd}`));
        if (status === 'lunch') lunchCount += 1;
        else if (status === 'no_lunch') noLunchCount += 1;
        else if (status === 'onsite') onsiteCount += 1;
        else if (status === 'bonus') bonusCount += 1;
        else emptyCount += 1;
      });
    });

    return {
      lunchCount,
      noLunchCount,
      onsiteCount,
      bonusCount,
      emptyCount,
      totalCost: (noLunchCount + bonusCount) * LUNCH_PRICE,
    };
  }, [recordsByCell, visibleMembers, workDays]);

  const memberMonthlySummary = useMemo(() => {
    if (!currentMemberId) return { lunchCount: 0, noLunchCount: 0, emptyCount: workDays.length };
    let lunchCount = 0;
    let noLunchCount = 0;
    let emptyCount = 0;

    workDays.forEach((day) => {
      const status = getRecordStatus(recordsByCell.get(`${currentMemberId}-${day.ymd}`));
      if (status === 'lunch') lunchCount += 1;
      else if (status === 'no_lunch') noLunchCount += 1;
      else emptyCount += 1;
    });

    return { lunchCount, noLunchCount, emptyCount };
  }, [currentMemberId, recordsByCell, workDays]);

  const myLunch = useMemo<boolean | null>(() => {
    if (!currentMemberId) return null;
    const record = recordsByCell.get(`${currentMemberId}-${selectedDate}`);
    if (!record) return null;

    const status = getRecordStatus(record);
    if (status === 'lunch' || status === 'bonus') return true;
    if (status === 'no_lunch') return false;
    return record.has_lunch ? true : false;
  }, [currentMemberId, recordsByCell, selectedDate]);

  const handleMyLunchToggle = useCallback(async (nextLunch: boolean) => {
    if (!currentMemberId) return;
    if (isWeekendDate(selectedDate)) return;

    const key = `${currentMemberId}-${selectedDate}`;
    const currentRecord = recordsByCell.get(key);
    const snapshot = lunchRecords;
    const cacheKey = monthKey(selectedYear, selectedMonth);

    const willDelete = !nextLunch && !!currentRecord;
    const nextStatus: LunchStatus = nextLunch ? 'lunch' : (willDelete ? '' : 'no_lunch');
    setSavingKey(key);

    // Optimistic update of the affected cell.
    setLunchRecords((prev) => {
      let next = prev.filter((r) => !(r.member_id === currentMemberId && r.date === selectedDate));
      if (!willDelete) {
        next = [
          ...next,
          {
            id: makeTempId(),
            member_id: currentMemberId,
            date: selectedDate,
            has_lunch: nextLunch,
            status: nextStatus,
          },
        ];
      }
      monthCacheRef.current.set(cacheKey, next);
      return next;
    });

    try {
      if (willDelete && currentRecord) {
        await deleteLunchRecord(currentRecord.id);
        setLunchRecords((prev) => {
          const next = prev.filter(
            (r) => !(r.id === currentRecord.id || (r.member_id === currentMemberId && r.date === selectedDate))
          );
          monthCacheRef.current.set(cacheKey, next);
          return next;
        });
      } else {
        const updated = await upsertLunchRecord({
          member_id: currentMemberId,
          date: selectedDate,
          has_lunch: nextLunch,
          status: nextStatus,
        });
        setLunchRecords((prev) => {
          const filtered = prev.filter((r) => !(r.member_id === currentMemberId && r.date === selectedDate));
          const next = [...filtered, updated];
          monthCacheRef.current.set(cacheKey, next);
          return next;
        });
      }
    } catch (error) {
      console.error('Error saving my lunch status:', error);
      setLunchRecords(snapshot);
      monthCacheRef.current.set(cacheKey, snapshot);
    } finally {
      setSavingKey(null);
    }
  }, [currentMemberId, lunchRecords, recordsByCell, selectedDate, selectedMonth, selectedYear]);

  const handleStatusChange = useCallback(async (memberId: number, day: string, nextStatus: LunchStatus) => {
    if (isWeekendDate(day)) return;

    const key = `${memberId}-${day}`;
    const currentRecord = recordsByCellRef.current.get(key);
    const snapshot = lunchRecordsRef.current;
    setSavingKey(key);

    const cacheKey = monthKey(selectedYearRef.current, selectedMonthRef.current);

    // Optimistically update the single affected cell so the UI responds instantly.
    setLunchRecords((prev) => {
      let next = prev.filter((r) => !(r.member_id === memberId && r.date === day));
      if (nextStatus) {
        next = [
          ...next,
          {
            id: makeTempId(),
            member_id: memberId,
            date: day,
            has_lunch: nextStatus === 'lunch' || nextStatus === 'bonus',
            status: nextStatus,
          },
        ];
      }
      monthCacheRef.current.set(cacheKey, next);
      return next;
    });

    try {
      if (!nextStatus) {
        if (currentRecord) {
          await deleteLunchRecord(currentRecord.id);
          // Remove the affected record from local state (and cache) only.
          setLunchRecords((prev) => {
            const next = prev.filter(
              (r) => !(r.id === currentRecord.id || (r.member_id === memberId && r.date === day))
            );
            monthCacheRef.current.set(cacheKey, next);
            return next;
          });
        }
      } else {
        const updated = await upsertLunchRecord({
          member_id: memberId,
          date: day,
          has_lunch: nextStatus === 'lunch' || nextStatus === 'bonus',
          status: nextStatus,
        });
        // Reconcile the affected record with the server response (no month refetch).
        setLunchRecords((prev) => {
          const filtered = prev.filter((r) => !(r.member_id === memberId && r.date === day));
          const next = [...filtered, updated];
          monthCacheRef.current.set(cacheKey, next);
          return next;
        });
      }
    } catch (error) {
      console.error('Error saving lunch status:', error);
      // Roll back to the state captured before the optimistic update.
      setLunchRecords(snapshot);
      monthCacheRef.current.set(cacheKey, snapshot);
    } finally {
      setSavingKey(null);
    }
  }, []);

  const handleRosterToggle = useCallback(async (memberId: number, enabled: boolean) => {
    setSavingConfigId(memberId);
    setConfigError(null);
    try {
      await toggleWorkingLunchMember(memberId, enabled, selectedDate);
      const [config, roster] = await Promise.all([
        getWorkingLunchConfig(undefined, selectedDate),
        getWorkingLunchMembers({ enabled_only: true, date: selectedDate }),
      ]);
      setConfigMembers(config);
      setMembers(roster);
    } catch (error) {
      console.error('Error updating daily Check Lunch roster:', error);
      setConfigError('Không thể cập nhật danh sách cho ngày này.');
    } finally {
      setSavingConfigId(null);
    }
  }, [selectedDate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f1f5f9] text-[#0b1c30]">
        <Navbar />
        <main className="md:ml-[230px] px-4 py-6 md:px-6 lg:px-8 pt-16 md:pt-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600">Loading...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f1f5f9] text-[#061733]">
      <Navbar />
      <main className="md:ml-[230px] px-3 py-5 md:px-6 lg:px-8 pt-16 md:pt-6">
        {isAdmin ? (
          <div className="mx-auto max-w-[1600px]">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-normal text-[#061733]">Check Lunch</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Quản lý đăng ký cơm trưa và tự động tính Bonus theo tuần làm việc.
                </p>
              </div>
            </div>

            <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-[150px_130px_130px_130px_minmax(220px,1fr)] md:items-end">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Ngày chọn người</span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Team</span>
                  <select
                    value={selectedTeam}
                    onChange={(e) => setSelectedTeam(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                  >
                    {teamsFromDB.map((team) => (
                      <option key={team} value={team}>{team === 'All' ? 'Tất cả team' : team}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Tháng</span>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(Number(e.target.value))}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                      <option key={month} value={month}>Tháng {String(month).padStart(2, '0')}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Năm</span>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                  >
                    {Array.from({ length: 7 }, (_, i) => today.getFullYear() - 3 + i).map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Tìm thành viên</span>
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Nhập tên thành viên..."
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-blue-200 bg-blue-50" />Đặt</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-emerald-200 bg-emerald-50" />Không đặt</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-orange-200 bg-orange-50" />Onsite</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-violet-200 bg-violet-50" />Bonus</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-slate-200 bg-slate-50" />Chưa chọn</span>
              </div>
            </section>

            <section className="mb-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Chọn thành viên Check Lunch</h2>
                  <p className="mt-1 text-xs text-slate-600">
                    Danh sách áp dụng riêng cho ngày {formatDateLabel(selectedDate)}. Chỉ người được bật mới thấy tab đăng ký của mình.
                  </p>
                </div>
                <span className="text-xs font-semibold text-blue-700">
                  {configMembers.filter((member) => member.enabled).length} người được chọn
                </span>
              </div>
              {configError && <p className="mt-2 text-xs font-semibold text-rose-600">{configError}</p>}
              <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-4">
                {configMembers.map((member) => (
                  <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-blue-300">
                    <input
                      type="checkbox"
                      checked={member.enabled === true}
                      disabled={savingConfigId === member.id}
                      onChange={(event) => handleRosterToggle(member.id, event.target.checked)}
                      className="h-4 w-4 accent-blue-600"
                    />
                    <span className="min-w-0 truncate font-medium text-slate-700">{memberName(member)}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400">{member.team || ''}</span>
                  </label>
                ))}
                {configMembers.length === 0 && <div className="text-sm text-slate-500">Chưa có thành viên trong Workspace này.</div>}
              </div>
            </section>

            <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs text-slate-500">Thành viên hiển thị</div>
                <div className="mt-1 text-2xl font-bold">{visibleMembers.length}</div>
                <div className="mt-1 text-xs text-slate-500">theo bộ lọc hiện tại</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs text-slate-500">Ngày đang xem</div>
                <div className="mt-1 text-2xl font-bold">{workDays.length}</div>
                <div className="mt-1 text-xs text-slate-500">ngày Thứ 2 - Thứ 6</div>
              </div>
              <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-rose-100 p-4 shadow-sm shadow-rose-100/60 ring-1 ring-rose-100">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-600">Không đặt</div>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-100 text-sm font-bold text-rose-700">!</span>
                </div>
                <div className="mt-2 text-3xl font-black text-rose-700">{summary.noLunchCount}</div>
                <div className="mt-1 text-xs text-rose-700/80">được tính 40.000đ/ngày</div>
              </div>
              <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-violet-100 p-4 shadow-sm shadow-violet-100/60 ring-1 ring-violet-100">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-600">Bonus</div>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">★</span>
                </div>
                <div className="mt-2 text-3xl font-black text-violet-700">{summary.bonusCount}</div>
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

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-bold">
                  Check Lunch - Tháng {String(selectedMonth).padStart(2, '0')}/{selectedYear}
                </h2>
                <span className="text-xs text-slate-500">
                  {visibleMembers.length} thành viên · {workDays.length} ngày làm việc · {calendarDays.length - workDays.length} cuối tuần
                </span>
              </div>
              <div className="max-h-[68vh] overflow-auto">
                <table className="min-w-max border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-30 w-28 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left text-xs font-bold">
                        Ngày
                      </th>
                      {visibleMembers.map((member) => (
                        <th key={member.id} className="sticky top-0 z-20 w-32 min-w-32 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-center">
                          <div className="max-w-28 truncate text-xs font-bold">{memberName(member)}</div>
                          <div className="mt-1 max-w-28 truncate text-[10px] font-medium text-slate-500">{member.team || 'N/A'}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {calendarDays.map((day) => (
                      <tr key={day.ymd} aria-disabled={day.isWeekend} className={day.isWeekend ? 'bg-slate-100/80 opacity-75' : 'bg-white'}>
                        <th className={`sticky left-0 z-10 w-28 border-b border-r border-slate-200 px-3 py-3 text-left ${day.isWeekend ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-700'}`}>
                          <div className="text-xs font-bold">{`${String(day.day).padStart(2, '0')}/${String(selectedMonth).padStart(2, '0')}/${selectedYear}`}</div>
                          <div className="mt-1 text-[11px] font-medium">{getBusinessWeekdayLabel(day.ymd)}</div>
                          {day.isWeekend && <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cuối tuần</div>}
                        </th>
                        {visibleMembers.map((member) => {
                          const key = `${member.id}-${day.ymd}`;
                          const record = recordsByCell.get(key);
                          const status = getRecordStatus(record);

                          return (
                            <LunchCell
                              key={key}
                              memberId={member.id}
                              ymd={day.ymd}
                              isWeekend={day.isWeekend}
                              status={status}
                              saving={savingKey === key}
                              onStatusChange={handleStatusChange}
                            />
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <h1 className="text-2xl font-bold">Check Lunch</h1>
              <p className="mt-2 text-sm text-slate-600">Đăng ký cơm trưa cho ngày bạn chọn.</p>
            </div>
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-semibold">Ngày</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
              />
            </label>
            {currentMemberId ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h2 className="text-base font-semibold">Đăng ký cơm ngày {formatDateLabel(selectedDate)}</h2>
                {isWeekendDate(selectedDate) ? (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-medium text-slate-600">
                    Cuối tuần - Không làm việc. Không gửi yêu cầu Check Lunch cho ngày này.
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      onClick={() => handleMyLunchToggle(true)}
                      disabled={!!savingKey || isWeekendDate(selectedDate)}
                      className={`rounded-lg px-5 py-2 text-sm font-semibold ${myLunch === true ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'} ${isWeekendDate(selectedDate) ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      Đặt
                    </button>
                    <button
                      onClick={() => handleMyLunchToggle(false)}
                      disabled={!!savingKey || isWeekendDate(selectedDate)}
                      className={`rounded-lg px-5 py-2 text-sm font-semibold ${myLunch === false ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'} ${isWeekendDate(selectedDate) ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      Không đặt
                    </button>
                  </div>
                )}
                {myLunch !== null && !isWeekendDate(selectedDate) && (
                  <p className="mt-4 text-sm text-slate-600">
                    Bạn đã chọn: <span className="font-semibold">{myLunch ? 'Đặt' : 'Không đặt'}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                Không thể xác định member của bạn. Vui lòng liên hệ admin để thiết lập tài khoản.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
