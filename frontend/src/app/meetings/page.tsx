'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { Search, Sparkles } from 'lucide-react';
import Navbar from '@/components/Navbar';
import MeetingCard from '@/components/meetings/MeetingCard';
import CreateMeetingModal from '@/components/meetings/CreateMeetingModal';
import PromptSettingsModal from '@/components/meetings/PromptSettingsModal';
import SummarizeModal from '@/components/meetings/SummarizeModal';
import { getMeetings, createMeeting, updateMeeting, deleteMeeting, syncMeeting, getGoogleAuthUrl, getGoogleStatus } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

export default function MeetingsPage() {
  const [canManage, setCanManage] = useState(false);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState('All');
  const [monthFilter, setMonthFilter] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<any>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSummarizeOpen, setIsSummarizeOpen] = useState(false);
  const [summarizingMeeting, setSummarizingMeeting] = useState<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [googleConnected, setGoogleConnected] = useState(false);

  useEffect(() => {
    getGoogleStatus().then(res => {
      if (res && res.connected) setGoogleConnected(true);
    }).catch(() => {});
  }, []);

  const handleConnectGoogle = async () => {
    try {
      const data = await getGoogleAuthUrl();
      if (data && data.auth_url) {
        window.location.href = data.auth_url;
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || "Vui lòng cấu hình GOOGLE_CLIENT_ID trong .env");
    }
  };

  // Dynamic week calculation logic
  const currentWeekInfo = useMemo(() => {
    const now = new Date();
    const currentDay = now.getDay();
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;

    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday + weekOffset * 7);

    const days = [];
    const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6'];

    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);

      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      const formattedDate = `${dd}/${mm}`;
      const isoDate = `${yyyy}-${mm}-${dd}`;

      days.push({
        label: `${dayNames[i]} · ${formattedDate}`,
        formattedDate,
        isoDate,
        dayNum: dd,
        yearNum: yyyy,
        fullDate: d
      });
    }

    const startFormatted = days[0].formattedDate;
    const endFormatted = days[4].formattedDate;
    const weekTitle = `LỊCH LÀM VIỆC TUẦN ${startFormatted}–${endFormatted}`;

    return { days, weekTitle, startFormatted, endFormatted };
  }, [weekOffset]);

  useEffect(() => {
    setCanManage(isAdmin());
  }, []);

  const fetchMeetings = async () => {
    setIsLoading(true);
    try {
      const data = await getMeetings();
      if (data && data.success && Array.isArray(data.data)) {
        setMeetings(data.data);
      } else if (Array.isArray(data)) {
        setMeetings(data);
      }
    } catch (error) { console.error("Failed to fetch meetings", error); }
    finally { setIsLoading(false); }
  };

  useEffect(() => { fetchMeetings(); }, []);

  const filteredMeetings = useMemo(() => {
    return (meetings || []).filter(m => {
      if (!m) return false;
      const title = String(m.title || '');
      const project = typeof m.project === 'string' ? m.project : (m.project?.name || '');
      const matchesSearch = title.toLowerCase().includes(searchTerm.toLowerCase()) || project.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPlatform = platformFilter === 'All' || m.platform === platformFilter;
      let matchesMonth = true;
      if (monthFilter !== 'All' && monthFilter !== '') matchesMonth = Boolean(m.date && String(m.date).startsWith(monthFilter));
      return matchesSearch && matchesPlatform && matchesMonth;
    });
  }, [meetings, searchTerm, platformFilter, monthFilter]);

  const handleSaveMeeting = async (meetingData: any) => {
    try {
      if (meetingData.id) {
        const data = await updateMeeting(meetingData.id, meetingData);
        if (data.success) {
          setMeetings(meetings.map(m => m.id === meetingData.id ? data.data : m));
        }
      } else {
        const data = await createMeeting(meetingData);
        if (data.success) setMeetings([data.data, ...meetings]);
      }
      setIsModalOpen(false); setEditingMeeting(null);
    } catch (error: any) {
      console.error("Failed to save meeting", error);
      alert(error.response?.data?.detail || "Có lỗi xảy ra khi lưu cuộc họp");
    }
  };

  const executeDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteMeeting(parseInt(deleteConfirmId));
      setMeetings(prev => prev.filter(m => m.id !== parseInt(deleteConfirmId)));
      setDeleteConfirmId(null);
    } catch (error: any) {
      console.error("Failed to delete meeting", error);
      alert(error.response?.data?.detail || "Có lỗi xảy ra khi xóa cuộc họp");
    }
  };

  const handleSync = async (meeting: any) => {
    const data = await syncMeeting(parseInt(meeting.id));
    if (data.success) {
      setMeetings(prev => prev.map(m => m.id === meeting.id ? data.data : m));
    }
  };

  // Stats
  const totalMeetings = meetings.length;
  const doneMeetings = meetings.filter(m => m.status === 'ĐÃ DIỄN RA').length;
  const upcomingMeetings = meetings.filter(m => m.status === 'SẮP TỚI').length;
  const aiProcessing = meetings.filter(m => m.status === 'ĐANG XỬ LÝ AI').length;

  return (
    <div className="h-screen bg-[#f0f2f5] text-[#0b1c30] flex overflow-hidden" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">
        {/* Top bar */}
        <div className="h-[52px] bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-8 shrink-0 z-40">
          {canManage && <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#0058be] text-[20px]">calendar_month</span>
            <span className="text-xs font-bold text-[#0b1c30]">Quản lý Meetings</span>
          </div>}
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSettingsOpen(true)} className="flex items-center gap-1.5 bg-white hover:bg-[#f0f2f5] border border-[#c2c6d6] text-[#565e74] text-xs font-bold px-3 py-2 rounded-lg transition-colors">
              <Sparkles size={14} className="text-emerald-500" />Cấu hình AI
            </button>
            <button onClick={() => { setEditingMeeting(null); setIsModalOpen(true); }} className="flex items-center gap-2 bg-[#0058be] hover:bg-[#0058be]/90 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-sm">
              <span className="material-symbols-outlined text-[16px]">add</span>Tạo meeting
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* KPI Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Tổng cuộc họp</p>
              <div className="flex items-baseline gap-2 mt-1"><span className="text-2xl font-bold text-[#0b1c30]">{totalMeetings}</span></div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden"><div className="bg-[#0058be] h-full" style={{ width: '100%' }}></div></div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-purple-200 shadow-sm">
              <p className="text-[10px] text-purple-700 uppercase font-bold tracking-wider">Đã AI Summary</p>
              <div className="flex items-baseline justify-between mt-1"><span className="text-2xl font-bold text-purple-600">{doneMeetings}</span><span className="material-symbols-outlined text-purple-500 text-[18px]">auto_awesome</span></div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden"><div className="bg-purple-500 h-full" style={{ width: `${totalMeetings > 0 ? (doneMeetings / totalMeetings) * 100 : 0}%` }}></div></div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-blue-200 shadow-sm">
              <p className="text-[10px] text-[#0058be] uppercase font-bold tracking-wider">Lịch sắp tới</p>
              <div className="flex items-baseline justify-between mt-1"><span className="text-2xl font-bold text-[#0058be]">{upcomingMeetings}</span><span className="material-symbols-outlined text-[#0058be] text-[18px]">event_upcoming</span></div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden"><div className="bg-[#0058be] h-full" style={{ width: `${totalMeetings > 0 ? (upcomingMeetings / totalMeetings) * 100 : 0}%` }}></div></div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-emerald-200 shadow-sm">
              <p className="text-[10px] text-emerald-700 uppercase font-bold tracking-wider">Task AI Đề Xuất & Push</p>
              <div className="flex items-baseline justify-between mt-1"><span className="text-2xl font-bold text-emerald-600">{meetings.reduce((acc, m) => acc + (m.summary?.length ? 3 : 0), 0)}</span><span className="material-symbols-outlined text-emerald-500 text-[18px]">task_alt</span></div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden"><div className="bg-emerald-500 h-full" style={{ width: '100%' }}></div></div>
            </div>
          </div>

          {/* SCHEDULE & CALENDAR SECTION (MATCHES MENTOR DEMO IMAGE 2 EXACTLY + DYNAMIC WEEK NAVIGATION & REAL DATA) */}
          <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-bold text-[#0b1c30] uppercase tracking-wide">
                    {currentWeekInfo.weekTitle}
                  </h3>
                  {weekOffset !== 0 && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[11px] font-bold rounded-md">
                      {weekOffset < 0 ? `Quá khứ (${Math.abs(weekOffset)} tuần trước)` : `Tương lai (+${weekOffset} tuần)`}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#64748b] mt-0.5">
                  Cuộc họp bật AI sẽ được ghi nhận và xử lý sau khi kết thúc
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Week Navigation Controls */}
                <div className="flex items-center bg-[#f1f5f9] p-0.5 rounded-lg border border-[#cbd5e1]">
                  <button
                    type="button"
                    onClick={() => setWeekOffset(prev => prev - 1)}
                    className="px-2.5 py-1 text-xs font-semibold text-[#0b1c30] hover:bg-white rounded-md transition-colors"
                    title="Xem tuần trước"
                  >
                    ‹ Tuần trước
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekOffset(0)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${weekOffset === 0 ? 'bg-white text-[#0058be] shadow-xs' : 'text-[#64748b] hover:bg-white'}`}
                  >
                    Hôm nay
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekOffset(prev => prev + 1)}
                    className="px-2.5 py-1 text-xs font-semibold text-[#0b1c30] hover:bg-white rounded-md transition-colors"
                    title="Xem tuần sau"
                  >
                    Tuần sau ›
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleConnectGoogle}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors border shadow-xs flex items-center gap-1.5 ${
                    googleConnected
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'bg-[#0058be] hover:bg-[#004297] text-white border-transparent'
                  }`}
                  title="Kết nối tài khoản Google để tự động đồng bộ Google Meet & Transcript"
                >
                  <Sparkles size={13} />
                  <span>{googleConnected ? '✓ Đã kết nối Google' : 'Kết nối Google Meet'}</span>
                </button>

                <button
                  type="button"
                  onClick={fetchMeetings}
                  className="px-3 py-1.5 bg-white hover:bg-slate-50 text-[#0b1c30] text-xs font-semibold rounded-lg transition-colors border border-[#cbd5e1] shadow-xs flex items-center gap-1.5"
                >
                  <span>↻</span>
                  <span>Đồng bộ lịch</span>
                </button>
              </div>
            </div>

            {/* 5-Day Weekly Calendar Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 mt-2">
              {currentWeekInfo.days.map((d, i) => {
                const dayMeetings = meetings.filter(m => {
                  if (!m || !m.date) return false;
                  const dateStr = String(m.date).trim();

                  // 1. Strict ISO date match (YYYY-MM-DD)
                  if (dateStr.startsWith(d.isoDate)) return true;

                  // 2. Strict DD/MM/YYYY match
                  const fullFormattedDate = `${d.formattedDate}/${d.yearNum}`;
                  if (dateStr === fullFormattedDate || dateStr.startsWith(fullFormattedDate)) return true;

                  // 3. Strict DD/MM match
                  if (dateStr === d.formattedDate) return true;

                  // 4. Strict Date object comparison (Year, Month, Day)
                  try {
                    const meetingDateObj = new Date(dateStr);
                    if (!isNaN(meetingDateObj.getTime())) {
                      const mY = meetingDateObj.getFullYear();
                      const mM = meetingDateObj.getMonth();
                      const mD = meetingDateObj.getDate();

                      const dY = d.fullDate.getFullYear();
                      const dM = d.fullDate.getMonth();
                      const dD = d.fullDate.getDate();

                      return mY === dY && mM === dM && mD === dD;
                    }
                  } catch (e) {}

                  return false;
                });

                return (
                  <div key={i} className="bg-white border border-[#e2e8f0] rounded-xl p-3.5 min-h-[180px]">
                    <h4 className="text-[13px] font-bold text-[#0b1c30] mb-3">{d.label}</h4>
                    {dayMeetings.length > 0 ? (
                      dayMeetings.map(item => {
                        const timeVal = String(item.time || '').toLowerCase();
                        let isPM = timeVal.includes('pm') || timeVal.includes('chiều') || timeVal.includes('tối');
                        if (!isPM && !timeVal.includes('am') && !timeVal.includes('sáng')) {
                          const hourMatch = timeVal.match(/(\d{1,2}):/);
                          if (hourMatch) isPM = parseInt(hourMatch[1], 10) >= 12;
                        }

                        const attendeeCount = item.members?.length || item.member_count || 0;
                        const platformName = item.platform || 'Meet';

                        return (
                          <div
                            key={item.id}
                            onClick={() => { setSummarizingMeeting(item); setIsSummarizeOpen(true); }}
                            className={`rounded-lg p-2.5 mb-2.5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xs border-l-[4px] ${
                              isPM
                                ? 'bg-[#fff7e8] border-l-[#f59e0b]'
                                : 'bg-[#edf5ff] border-l-[#1769d2]'
                            }`}
                          >
                            <div className="text-[13px] font-medium text-[#0b1c30] leading-snug">
                              <span className="font-normal">{item.time || (isPM ? '14:00' : '09:00')}</span> {item.title}
                            </div>
                            <small className="block text-[11px] text-[#64748b] mt-1">
                              {platformName}{attendeeCount ? ` · ${attendeeCount} người` : ''} · <b className="text-[#0b1c30] font-bold">AI On</b>
                            </small>
                          </div>
                        );
                      })
                    ) : (
                      <div className="border border-dashed border-[#e2e8f0] rounded-xl p-4 text-center text-[12px] text-[#94a3b8] mt-1">
                        Chưa có lịch họp
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 bg-white p-3 rounded-xl border border-[#c2c6d6]/60 shadow-sm">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-2.5 text-[#c2c6d6]" />
              <input type="text" placeholder="Tìm kiếm cuộc họp, dự án..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-[#f0f2f5] border border-[#c2c6d6] rounded-lg text-xs focus:outline-none focus:border-[#0058be] transition-all text-[#0b1c30]" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold text-[#565e74] hidden sm:block whitespace-nowrap">Nền tảng:</label>
              <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)} className="px-3 py-2 bg-[#f0f2f5] border border-[#c2c6d6] rounded-lg text-xs focus:outline-none focus:border-[#0058be] min-w-[130px] text-[#0b1c30]">
                <option value="All">Tất cả</option><option value="Google Meet">Google Meet</option><option value="Zoom">Zoom</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold text-[#565e74] hidden sm:block whitespace-nowrap">Thời gian:</label>
              <input type={monthFilter === 'All' ? 'text' : 'month'} placeholder="Tháng/Năm" onFocus={e => (e.target.type = 'month')} onBlur={e => { if (!e.target.value) e.target.type = 'text'; }} value={monthFilter === 'All' ? '' : monthFilter} onChange={e => setMonthFilter(e.target.value || 'All')} className="px-3 py-2 bg-[#f0f2f5] border border-[#c2c6d6] rounded-lg text-xs focus:outline-none focus:border-[#0058be] min-w-[130px] placeholder:text-[#c2c6d6] text-[#0b1c30]" />
            </div>
          </div>

          {/* Meeting List */}
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-16 text-[#565e74] text-xs"><div className="flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" />Đang tải danh sách cuộc họp...</div></div>
            ) : filteredMeetings.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-[#c2c6d6] border-dashed">
                <div className="w-12 h-12 bg-[#eff4ff] text-[#0058be] rounded-full flex items-center justify-center mx-auto mb-3"><Search size={24} /></div>
                <p className="text-[#565e74] font-bold text-sm">Không tìm thấy cuộc họp nào</p>
                <p className="text-[#727785] text-xs mt-1">Hãy thử thay đổi điều kiện lọc hoặc tạo mới.</p>
              </div>
            ) : (
              filteredMeetings.map(meeting => (
                <MeetingCard key={meeting.id} meeting={meeting}
                  onEdit={canManage ? (m => { setEditingMeeting(m); setIsModalOpen(true); }) : undefined}
                  onDelete={canManage ? (id => setDeleteConfirmId(id)) : undefined}
                  onSummarize={canManage ? (m => { setSummarizingMeeting(m); setIsSummarizeOpen(true); }) : undefined}
                  onSync={canManage ? handleSync : undefined}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {canManage && <CreateMeetingModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveMeeting} initialData={editingMeeting} />}
      {canManage && <PromptSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />}
      {canManage && <SummarizeModal isOpen={isSummarizeOpen} onClose={() => { setIsSummarizeOpen(false); setSummarizingMeeting(null); }} meeting={summarizingMeeting} onSave={m => setMeetings(prev => prev.map(x => x.id === m.id ? m : x))} />}

      {/* Delete Confirm Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-3 text-red-600">
              <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center"><span className="material-symbols-outlined text-[20px]">delete</span></div>
              <h3 className="text-sm font-bold text-[#0b1c30]">Xóa cuộc họp</h3>
            </div>
            <p className="text-xs text-[#565e74] mb-6">Bạn có chắc chắn muốn xóa cuộc họp này? Hành động này không thể hoàn tác.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-xs font-bold text-[#565e74] bg-white border border-[#c2c6d6] hover:bg-[#f0f2f5] rounded-lg transition-colors">Hủy</button>
              <button onClick={executeDelete} className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm">Xác nhận xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
