'use client';

import { useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';
import { mockLeaveRequests, formatDateLabel } from '@/lib/leave-request';

const TEAM = [
  { id: 1, name: 'Nguyen Duy Viet' },
  { id: 2, name: 'Tran Thi Hoa' },
  { id: 3, name: 'Le Van A' },
  { id: 4, name: 'Pham Thi B' },
  { id: 5, name: 'Hoang Minh' },
];

function dateToYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function CalendarTeamPage() {
  const todayDefault = dateToYMD(new Date());
  const [date, setDate] = useState<string>(todayDefault);

  const statusByMember = useMemo(() => {
    const target = new Date(date);
    // build map of off members by checking mockLeaveRequests
    const map: Record<number, { off: boolean; leave?: any }> = {};
    TEAM.forEach((m) => (map[m.id] = { off: false }));

    mockLeaveRequests.forEach((req) => {
      const s = new Date(req.start_date);
      const e = new Date(req.end_date);
      if (s <= target && target <= e) {
        // demo assignment: map request id to a team member index
        const member = TEAM[req.id % TEAM.length];
        if (member) {
          map[member.id] = { off: true, leave: req };
        }
      }
    });

    return map;
  }, [date]);

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#0b1c30]">
      <Navbar />
      <main className="md:ml-[230px] px-4 py-6 md:px-6 lg:px-8 pt-16 md:pt-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-[#c2c6d6]/50 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Calendar Team</h2>
              <p className="mt-1 text-sm text-[#565e74]">View team working/off status for a selected day. Defaults to today.</p>
            </div>
            <div className="flex items-center gap-3">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm outline-none" />
            </div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-lg border p-4">
              <div className="text-sm text-[#565e74]">Showing: <span className="font-semibold">{formatDateLabel(date)}</span></div>
            </div>

            <div className="grid gap-2">
              {TEAM.map((m) => {
                const s = statusByMember[m.id];
                return (
                  <div key={m.id} className="flex items-center justify-between rounded-lg border bg-white p-3">
                    <div>
                      <div className="font-semibold">{m.name}</div>
                      <div className="text-xs text-[#565e74]">{s.off ? `${s.leave.leave_type} (${formatDateLabel(s.leave.start_date)} - ${formatDateLabel(s.leave.end_date)})` : 'Working'}</div>
                    </div>
                    <div>
                      {s.off ? <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700">Off</span> : <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Working</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
