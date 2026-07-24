'use client';

import { useEffect, useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';
import { formatDateLabel } from '@/lib/leave-request';
import { getMembers, getLeaveRequests } from '@/lib/api';

interface Member {
  id: number;
  full_name?: string;
  display_name?: string;
  team?: string;
  department?: string;
  position?: string;
}

function dateToYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function CalendarTeamPage() {
  const todayDefault = dateToYMD(new Date());
  const [date, setDate] = useState<string>(todayDefault);
  const [selectedTeam, setSelectedTeam] = useState<string>('All');
  const [members, setMembers] = useState<Member[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [membersRes, leaveRes] = await Promise.all([
          getMembers(),
          getLeaveRequests(),
        ]);
        setMembers(membersRes);
        setLeaveRequests(leaveRes);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Extract unique team names from DB members
  const teamsFromDB = useMemo(() => {
    const teams = new Set<string>();
    members.forEach((m) => {
      if (m.team) teams.add(m.team);
    });
    return ['All', ...Array.from(teams).sort()];
  }, [members]);

  const statusByMember = useMemo(() => {
    const target = new Date(date);
    const map: Record<number, { off: boolean; leave?: any }> = {};
    members.forEach((m) => (map[m.id] = { off: false }));

    leaveRequests.forEach((req) => {
      const s = new Date(req.start_date);
      const e = new Date(req.end_date);
      if (s <= target && target <= e) {
        if (map[req.user_id]) {
          map[req.user_id] = { off: true, leave: req };
        }
      }
    });

    return map;
  }, [date, leaveRequests, members]);

  const filteredMembers = useMemo(() => {
    if (selectedTeam === 'All') return members;
    return members.filter((m) => m.team === selectedTeam);
  }, [members, selectedTeam]);

  // Summary counts
  const summary = useMemo(() => {
    const total = filteredMembers.length;
    const offCount = filteredMembers.filter((m) => statusByMember[m.id]?.off).length;
    const working = total - offCount;
    return { total, offCount, working };
  }, [filteredMembers, statusByMember]);

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
      <main className="md:ml-[230px] px-4 py-6 md:px-6 lg:px-8 pt-16 md:pt-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-[#c2c6d6]/50 bg-white p-6 shadow-sm">
          {/* Header */}
          <div className="mb-4">
            <h2 className="text-xl font-bold">Calendar Team</h2>
            <p className="mt-1 text-sm text-[#565e74]">View team working/off status for a selected day.</p>
          </div>

          {/* Filters */}
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
            </div>
            <div className="text-sm text-[#565e74]">
              Showing: <span className="font-semibold">{formatDateLabel(date)}</span> | Team: <span className="font-semibold">{selectedTeam}</span>
            </div>
          </div>

          {/* Summary cards */}
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-white p-3 text-center">
              <div className="text-lg font-bold text-[#0b1c30]">{summary.total}</div>
              <div className="text-xs text-[#565e74]">Total</div>
            </div>
            <div className="rounded-lg border bg-emerald-50 p-3 text-center">
              <div className="text-lg font-bold text-emerald-600">{summary.working}</div>
              <div className="text-xs text-[#565e74]">Working</div>
            </div>
            <div className="rounded-lg border bg-rose-50 p-3 text-center">
              <div className="text-lg font-bold text-rose-600">{summary.offCount}</div>
              <div className="text-xs text-[#565e74]">Off</div>
            </div>
          </div>

          {/* Member list */}
          <div className="grid gap-2">
            {filteredMembers.map((m) => {
              const s = statusByMember[m.id];
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
                      </div>
                    </div>
                  </div>
                  <div>
                    {s?.off ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700">Off</span>
                        <span className="text-xs text-[#565e74]">{s.leave?.leave_type}</span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Working</span>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredMembers.length === 0 && (
              <div className="py-8 text-center text-sm text-[#565e74]">No members found.</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}