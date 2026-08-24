'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import { formatDateLabel } from '@/lib/leave-request';
import { getMembers, getLeaveRequests, getLunchRecords, upsertLunchRecord } from '@/lib/api';

interface Member {
  id: number;
  full_name?: string;
  display_name?: string;
  team?: string;
  department?: string;
  position?: string;
}

interface LunchRecord {
  id: number;
  member_id: number;
  date: string;
  has_lunch: boolean;
}

function dateToYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function CheckLunchPage() {
  const todayDefault = dateToYMD(new Date());
  const [date, setDate] = useState<string>(todayDefault);
  const [selectedTeam, setSelectedTeam] = useState<string>('All');
  const [lunchRecords, setLunchRecords] = useState<LunchRecord[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [myLunch, setMyLunch] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);

  // Fetch all initial data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, leaveRes] = await Promise.all([
        getMembers(),
        getLeaveRequests(),
      ]);
      setMembers(membersRes);
      setLeaveRequests(leaveRes);

      const role = localStorage.getItem('role');
      const userIdStr = localStorage.getItem('user_id');
      const userId = userIdStr ? Number(userIdStr) : null;
      setIsAdmin(role === 'super_admin');
      setCurrentUserId(userId);

      // Get current user's member_id from members list (match by user_id from accounts)
      // For non-admin, try to match user_id from localStorage to member
      // Since we don't have a direct API for current user's member info,
      // we'll rely on member_id being stored somewhere
      const member = membersRes.find(
          (m: any) => m.user_id === userId
      );

      if (member) {
          setCurrentMemberId(member.id);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch lunch records for the selected date
  const fetchLunchRecords = useCallback(async (dateStr: string) => {
    try {
      const records = await getLunchRecords({ date: dateStr });
      setLunchRecords(records);

      if (!isAdmin && currentMemberId) {
        const mine = records.find((r: LunchRecord) => r.member_id === currentMemberId);
        if (mine) {
          setMyLunch(mine.has_lunch);
        } else {
          setMyLunch(null);
        }
      }
    } catch (error) {
      console.error('Error fetching lunch records:', error);
    }
  }, [isAdmin, currentMemberId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!loading) {
      fetchLunchRecords(date);
    }
  }, [date, loading, fetchLunchRecords]);

  // Get unique team names from DB
  const teamsFromDB = useMemo(() => {
    const teams = new Set<string>();
    members.forEach((m) => {
      if (m.team) teams.add(m.team);
    });
    return ['All', ...Array.from(teams).sort()];
  }, [members]);

  // Determine which members to show
  const membersToShow = useMemo(() => {
    if (isAdmin) {
      if (selectedTeam === "All") return members;
      return members.filter((m) => m.team === selectedTeam);
    }

    return [];
  }, [isAdmin, members, selectedTeam]);

  // Who is off today
  const target = new Date(date);
  const offMap: Record<number, boolean> = {};
  leaveRequests.forEach((req) => {
    const s = new Date(req.start_date);
    const e = new Date(req.end_date);
    if (s <= target && target <= e) {
      offMap[req.member_id] = true;
    }
  });

  // Admin summary counts
  const summary = useMemo(() => {
    if (!isAdmin) return null;
    const total = membersToShow.length;
    const offCount = membersToShow.filter((m) => offMap[m.id]).length;
    const working = membersToShow.filter((m) => !offMap[m.id]);
    const registeredLunch = working.filter((m) =>
      lunchRecords.some((r) => r.member_id === m.id && r.has_lunch)
    ).length;
    const notRegistered = working.length - registeredLunch;
    return { total, offCount, working: working.length, registeredLunch, notRegistered };
  }, [isAdmin, membersToShow, offMap, lunchRecords, date]);

  const handleLunchToggle = async (memberId: number, hasLunchVal: boolean) => {
    setSaving(true);
    try {
      await upsertLunchRecord({
        member_id: memberId,
        date,
        has_lunch: hasLunchVal,
      });

      setMyLunch(hasLunchVal);

      await fetchLunchRecords(date);
    } catch (error) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] text-[#0b1c30] flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-semibold">Loading...</div>
        </div>
      </div>
    );
  }

  // Find the current member's record for non-admin users
  const currentMember = useMemo(() => {
    if (!isAdmin && currentMemberId) {
      return members.find((m) => m.id === currentMemberId) || null;
    }
    return null;
  }, [isAdmin, currentMemberId, members]);

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#0b1c30]">
      <Navbar />
      <main className="md:ml-[230px] px-4 py-6 md:px-6 lg:px-8 pt-16 md:pt-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-[#c2c6d6]/50 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-xl font-bold">Check Working / Lunch</h2>
            <p className="mt-1 text-sm text-[#565e74]">
              {isAdmin
                ? 'Admin: View lunch registration status of all members.'
                : 'Create your lunch check-in for the selected day.'}
            </p>
          </div>

          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex items-center gap-3">
              <div>
                <label className="mb-1 block text-sm font-semibold">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm outline-none"
                />
              </div>
              {isAdmin && (
                <div>
                  <label className="mb-1 block text-sm font-semibold">Team</label>
                  <select
                    value={selectedTeam}
                    onChange={(e) => setSelectedTeam(e.target.value)}
                    className="rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm outline-none"
                  >
                    {teamsFromDB.map((team) => (
                      <option key={team} value={team}>{team}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="text-sm text-[#565e74]">
              Showing: <span className="font-semibold">{formatDateLabel(date)}</span>
            </div>
          </div>

          {/* Admin summary */}
          {isAdmin && summary && (
            <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
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
            </div>
          )}

          {saving && (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
              Saving...
            </div>
          )}

          <div className="grid gap-2">
            {membersToShow.map((m) => {
              const isOff = !!offMap[m.id];
              const lunch = lunchRecords.find((r) => r.member_id === m.id);
              const hasRegistered = lunch !== undefined;

              return (
                <div key={m.id} className="flex items-center justify-between rounded-lg border bg-white p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eef2f7] text-sm font-bold text-[#565e74]">
                      {(m.full_name || m.display_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold">{m.full_name || m.display_name}</div>
                      <div className="text-xs text-[#565e74]">
                        {m.team || 'N/A'} • {m.position || 'Member'}
                        {isOff && <span className="ml-2 text-rose-600">(Off today)</span>}
                        {!isOff && hasRegistered && (
                          <span className="ml-2">{lunch.has_lunch ? '✅ Cơm trưa' : '🚫 Không ăn'}</span>
                        )}
                        {!isOff && !hasRegistered && isAdmin && (
                          <span className="ml-2 text-amber-600">(Chưa đăng ký)</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {!isOff && (
                      <>
                        <button
                          onClick={() => handleLunchToggle(m.id, true)}
                          disabled={saving}
                          className={`rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                            lunch?.has_lunch === true
                              ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400'
                              : 'bg-gray-100 text-gray-600 hover:bg-emerald-50'
                          }`}
                        >
                          Có ăn
                        </button>
                        <button
                          onClick={() => handleLunchToggle(m.id, false)}
                          disabled={saving}
                          className={`rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                            lunch?.has_lunch === false
                              ? 'bg-rose-100 text-rose-700 ring-2 ring-rose-400'
                              : 'bg-gray-100 text-gray-600 hover:bg-rose-50'
                          }`}
                        >
                          Không ăn
                        </button>
                      </>
                    )}
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                      isOff ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {isOff ? 'Off' : 'Working'}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Non-admin: show current member info if member_id not set */}
            {!isAdmin && currentMemberId && (
              <div className="rounded-lg border bg-white p-6">
                <h3 className="text-lg font-semibold mb-2">
                  Đăng ký cơm ngày {formatDateLabel(date)}
                </h3>

                <p className="text-sm text-[#565e74] mb-4">
                  Chọn bạn có ăn cơm trưa hay không.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={() => handleLunchToggle(currentMemberId, true)}
                    disabled={saving}
                    className={`rounded-lg px-5 py-2 font-semibold ${
                      myLunch === true
                        ? 'bg-emerald-500 text-white'
                        : 'bg-gray-100'
                    }`}
                  >
                    🍱 Có ăn
                  </button>

                  <button
                    onClick={() => handleLunchToggle(currentMemberId, false)}
                    disabled={saving}
                    className={`rounded-lg px-5 py-2 font-semibold ${
                      myLunch === false
                        ? 'bg-rose-500 text-white'
                        : 'bg-gray-100'
                    }`}
                  >
                    ❌ Không ăn
                  </button>
                </div>

                {myLunch !== null && (
                  <p className="mt-4 text-sm text-[#565e74]">
                    Bạn đã đăng ký:{" "}
                    <span className="font-semibold">
                      {myLunch ? "Có ăn" : "Không ăn"}
                    </span>
                  </p>
                )}
              </div>
            )}

            {isAdmin && membersToShow.length === 0 && (
              <div className="py-8 text-center text-sm text-[#565e74]">
                No members found.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}