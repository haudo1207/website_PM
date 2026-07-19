'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import SummaryCard from '@/components/leave-request/SummaryCard';
import StatusBadge from '@/components/leave-request/StatusBadge';
import LeaveRequestForm from '@/components/leave-request/LeaveRequestForm';
import Portal from '@/components/Portal';
import { LeaveRequest, LeaveRequestFormValues, getStorageKey, mockLeaveRequests } from '@/lib/leave-request';
import { formatDateLabel } from '@/lib/leave-request';
import { getMembers, getLeaveRequests, createLeaveRequest, updateLeaveRequest, deleteLeaveRequest, approveLeaveRequest } from '@/lib/api';

const ITEMS_PER_PAGE = 5;

interface TeamMember {
  id: number;
  name: string;
  department: string;
  role: string;
}

function dateToYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function LeaveRequestPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [toast, setToast] = useState('');
  const [viewingRequest, setViewingRequest] = useState<LeaveRequest | null>(null);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; height?: number } | null>(null);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const todayDefault = dateToYMD(new Date());
  const [calendarDate, setCalendarDate] = useState<string>(todayDefault);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const actionBtnRef = useRef<HTMLElement | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const editingId = useMemo(() => {
    const idParam = searchParams.get('edit');
    if (!idParam) return null;
    const parsed = Number(idParam);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  const editingRequest = useMemo(() => requests.find((item) => item.id === editingId) ?? null, [editingId, requests]);

  // Fetch real data from API
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch leave requests
        const leaveData = await getLeaveRequests();
        setRequests(leaveData);

        // Fetch team members for calendar
        const membersData = await getMembers();
        const mapped: TeamMember[] = membersData.map((m: any) => ({
          id: m.id,
          name: m.full_name || m.display_name,
          department: m.department || 'Unassigned',
          role: m.position || m.team || 'Member',
        }));
        setTeamMembers(mapped);

        // Check if user is admin
        const role = localStorage.getItem('role');
        setIsAdmin(role === 'admin');
      } catch (error) {
        console.error('Error fetching data:', error);
        // Fallback to mock data
        setRequests(mockLeaveRequests);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

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

  const calendarStatusByMember = useMemo(() => {
    const target = new Date(calendarDate);
    const map: Record<number, { off: boolean; leave?: any }> = {};
    teamMembers.forEach((m) => (map[m.id] = { off: false }));

    requests.forEach((req) => {
      const s = new Date(req.start_date);
      const e = new Date(req.end_date);
      if (s <= target && target <= e) {
        if (map[req.user_id]) {
          map[req.user_id] = { off: true, leave: req };
        }
      }
    });

    return map;
  }, [calendarDate, requests, teamMembers]);

  const totalPages = Math.max(1, Math.ceil(requests.length / ITEMS_PER_PAGE));
  const pageItems = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return requests.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [currentPage, requests]);

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this leave request?')) return;
    try {
      await deleteLeaveRequest(id);
      setRequests((prev) => prev.filter((item) => item.id !== id));
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
        province: values.province,
        ward: values.ward,
        address: values.address || null,
        reason: values.reason,
        status: 'Pending' as const,
      };

      if (editingId) {
        const updated = await updateLeaveRequest(editingId, payload);
        setRequests((prev) => prev.map((item) => (item.id === editingId ? updated : item)));
        setToast('Leave request updated successfully.');
      } else {
        const created = await createLeaveRequest(payload);
        setRequests((prev) => [created, ...prev]);
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
      setRequests((prev) => prev.map((item) => (item.id === id ? updated : item)));
      setToast(`Leave request ${status.toLowerCase()}.`);
      setOpenActionId(null);
    } catch (error) {
      setToast('Error updating status.');
    }
  };

  const isSubmitForm = pathname === '/leave-request/new';

  // Group team members by department
  const departments = useMemo(() => {
    const deptMap = new Map<string, TeamMember[]>();
    teamMembers.forEach((m) => {
      const dept = m.department || 'Unassigned';
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(m);
    });
    return Array.from(deptMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [teamMembers]);

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
                                {formatDateLabel(item.start_date)} - {formatDateLabel(item.end_date)}
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
                              {item.user?.full_name || `User ${item.user_id}`}
                            </td>
                            <td className="px-3 py-3 text-[#565e74]">{item.leave_type}</td>
                            <td className="px-3 py-3 text-[#565e74]">{formatDateLabel(item.start_date)}</td>
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
              ) : (
                /* ========== CALENDAR VIEW ========== */
                <>
                  <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm text-[#565e74]">
                        Team working status for a selected day. Select date to view who's working and who's off.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-sm font-semibold text-[#565e74]">Select Date:</label>
                      <input
                        type="date"
                        value={calendarDate}
                        onChange={(e) => setCalendarDate(e.target.value)}
                        className="rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm outline-none"
                      />
                    </div>
                  </div>

                  <div className="mb-6 rounded-lg border bg-[#f8f9ff] p-4">
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span>
                        <span className="font-semibold">Viewing:</span>{' '}
                        <span className="text-[#0058be] font-bold">{formatDateLabel(calendarDate)}</span>
                      </span>
                      <span className="text-[#565e74]">|</span>
                      <span className="text-[#565e74]">
                        Total: <span className="font-semibold">{teamMembers.length} members</span>
                      </span>
                      <span className="text-[#565e74]">|</span>
                      <span className="text-[#565e74]">
                        Working:{' '}
                        <span className="font-semibold text-emerald-600">
                          {teamMembers.filter((m) => !calendarStatusByMember[m.id]?.off).length}
                        </span>
                      </span>
                      <span className="text-[#565e74]">|</span>
                      <span className="text-[#565e74]">
                        Off:{' '}
                        <span className="font-semibold text-rose-600">
                          {teamMembers.filter((m) => calendarStatusByMember[m.id]?.off).length}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-6">
                    {departments.length === 0 && (
                      <div className="py-8 text-center text-sm text-[#565e74]">
                        Loading team members...
                      </div>
                    )}
                    {departments.map(([dept, members]) => (
                      <div key={dept}>
                        <h3 className="mb-3 text-base font-bold text-[#0b1c30]">{dept}</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {members.map((m) => {
                            const s = calendarStatusByMember[m.id];
                            return (
                              <div
                                key={m.id}
                                className={`rounded-lg border bg-white p-4 transition-shadow hover:shadow-sm ${
                                  s.off ? 'border-rose-200 bg-rose-50/40' : 'border-emerald-200 bg-emerald-50/40'
                                }`}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-[#0b1c30] truncate">{m.name}</div>
                                    <div className="text-xs text-[#565e74]">{m.role}</div>
                                  </div>
                                  <div className="flex-shrink-0 ml-3">
                                    {s.off ? (
                                      <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                                        Off
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                                        Working
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {s.off && s.leave && (
                                  <div className="mt-3 pt-2 border-t border-rose-100 text-xs text-[#565e74]">
                                    <span className="font-semibold">{s.leave.leave_type}</span>
                                    <span className="text-[#999]"> • </span>
                                    {formatDateLabel(s.leave.start_date)} - {formatDateLabel(s.leave.end_date)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
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
                          startDate: editingRequest.start_date,
                          endDate: editingRequest.end_date,
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

        {viewingRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
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
                  <span className="font-semibold">{viewingRequest.leave_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#565e74]">Date Range</span>
                  <span className="font-semibold">
                    {formatDateLabel(viewingRequest.start_date)} - {formatDateLabel(viewingRequest.end_date)}
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