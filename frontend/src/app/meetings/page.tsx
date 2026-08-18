'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Sparkles, Calendar as CalendarIcon, Video, CheckCircle2, Clock } from 'lucide-react';
import Navbar from '@/components/Navbar';
import MeetingCard from '@/components/meetings/MeetingCard';
import CreateMeetingModal from '@/components/meetings/CreateMeetingModal';
import PromptSettingsModal from '@/components/meetings/PromptSettingsModal';
import SummarizeModal from '@/components/meetings/SummarizeModal';
import MeetingDetailModal from '@/components/meetings/MeetingDetailModal';
import { getMeetings, createMeeting, updateMeeting, deleteMeeting, syncMeeting, getGoogleStatus } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

function MeetingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [canManage, setCanManage] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'calendar'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState('All');
  const [monthFilter, setMonthFilter] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<any>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSummarizeOpen, setIsSummarizeOpen] = useState(false);
  const [summarizingMeeting, setSummarizingMeeting] = useState<any>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailMeeting, setDetailMeeting] = useState<any>(null);
  const [lastHandledId, setLastHandledId] = useState<string | null>(null);
  const [cameFromDetail, setCameFromDetail] = useState<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Helper to update URL search parameters without page refresh
  const updateUrl = (tab?: string, id?: number | string | null) => {
    const currentTab = tab || activeTab;
    const params = new URLSearchParams();
    if (currentTab) params.set('tab', currentTab);
    if (id) {
      params.set('id', String(id));
    }
    const queryString = params.toString();
    router.replace(`/meetings${queryString ? `?${queryString}` : ''}`, { scroll: false });
  };

  const handleTabSwitch = (tab: 'list' | 'calendar') => {
    setActiveTab(tab);
    updateUrl(tab, isDetailOpen && detailMeeting ? detailMeeting.id : null);
  };

  const handleOpenDetail = (m: any) => {
    setDetailMeeting(m);
    setIsDetailOpen(true);
    if (m?.id) setLastHandledId(String(m.id));
    updateUrl(activeTab, m.id);
  };

  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setDetailMeeting(null);
    updateUrl(activeTab, null);
  };

  const handleCalendarMeetingClick = (item: any) => {
    handleOpenDetail(item);
  };

  useEffect(() => {
    getGoogleStatus().then(() => {}).catch(() => {});
  }, []);

  // Dynamic week calculation logic
  const currentWeekInfo = useMemo(() => {
    const now = new Date();
    const currentDay = now.getDay();
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;

    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday + weekOffset * 7);

    const days = [];
    const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

    for (let i = 0; i < 7; i++) {
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
        fullDate: d,
        isWeekend: i >= 5
      });
    }

    const startFormatted = days[0].formattedDate;
    const endFormatted = days[6].formattedDate;
    const weekTitle = `LỊCH LÀM VIỆC TUẦN ${startFormatted} – ${endFormatted}`;

    return { days, weekTitle, startFormatted, endFormatted };
  }, [weekOffset]);

  useEffect(() => {
    setCanManage(isAdmin());
  }, []);

  const { data: meetingsData, isLoading, refetch: fetchMeetings } = useQuery({
    queryKey: ['meetings'],
    queryFn: async () => {
      const data = await getMeetings();
      if (data && data.success && Array.isArray(data.data)) return data.data;
      if (Array.isArray(data)) return data;
      return [];
    },
    staleTime: 2 * 60_000,
  });
  const meetings: any[] = meetingsData || [];

  // Parse URL search params for tab and meeting ID deep linking
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'calendar' || tabParam === 'list') {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  useEffect(() => {
    const idParam = searchParams.get('id');
    if (idParam && meetings.length > 0 && idParam !== lastHandledId) {
      const found = meetings.find((m: any) => String(m.id) === String(idParam));
      if (found) {
        setDetailMeeting(found);
        setIsDetailOpen(true);
        setLastHandledId(idParam);
      }
    } else if (!idParam && lastHandledId) {
      setLastHandledId(null);
    }
  }, [searchParams, meetings, lastHandledId]);

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

  const totalPages = Math.ceil(filteredMeetings.length / pageSize) || 1;
  const paginatedMeetings = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMeetings.slice(start, start + pageSize);
  }, [filteredMeetings, currentPage, pageSize]);

  const handleOpenEditFromDetail = (m: any) => {
    setCameFromDetail(m);
    setIsDetailOpen(false);
    setEditingMeeting(m);
    setIsModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setIsModalOpen(false);
    setEditingMeeting(null);
    if (cameFromDetail) {
      setDetailMeeting(cameFromDetail);
      setIsDetailOpen(true);
      updateUrl(activeTab, cameFromDetail.id);
      setCameFromDetail(null);
    }
  };

  const handleSaveMeeting = async (meetingData: any) => {
    try {
      let savedObj = null;
      if (meetingData.id) {
        const data = await updateMeeting(meetingData.id, meetingData);
        if (data.success) {
          savedObj = data.data;
          queryClient.setQueryData(['meetings'], (prev: any[] = []) => prev.map(m => m.id === meetingData.id ? data.data : m));
        }
      } else {
        const data = await createMeeting(meetingData);
        if (data.success) {
          savedObj = data.data;
          queryClient.setQueryData(['meetings'], (prev: any[] = []) => [data.data, ...prev]);
        }
      }
      setIsModalOpen(false);
      setEditingMeeting(null);

      // Re-open Detail Modal if user came from Detail view
      if (cameFromDetail) {
        const updatedDetail = savedObj || { ...cameFromDetail, ...meetingData };
        setDetailMeeting(updatedDetail);
        setIsDetailOpen(true);
        updateUrl(activeTab, updatedDetail.id);
        setCameFromDetail(null);
      }
    } catch (error: any) {
      console.error("Failed to save meeting", error);
      alert(error.response?.data?.detail || "Có lỗi xảy ra khi lưu cuộc họp");
    }
  };

  const executeDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteMeeting(parseInt(deleteConfirmId));
      queryClient.setQueryData(['meetings'], (prev: any[] = []) => prev.filter(m => m.id !== parseInt(deleteConfirmId)));
      setDeleteConfirmId(null);
      setToastMessage('✓ Đã xóa cuộc họp thành công!');
      setTimeout(() => setToastMessage(null), 3000);
    } catch (error: any) {
      console.error("Failed to delete meeting", error);
      alert(error.response?.data?.detail || "Có lỗi xảy ra khi xóa cuộc họp");
    }
  };

  const handleSync = async (meeting: any) => {
    const data = await syncMeeting(parseInt(meeting.id));
    if (data.success) {
      queryClient.setQueryData(['meetings'], (prev: any[] = []) => prev.map(m => m.id === meeting.id ? data.data : m));
    }
  };

  // Stats
  const totalMeetings = meetings.length;
  const doneMeetings = meetings.filter(m => String(m.status || '').toUpperCase() === 'ĐÃ DIỄN RA' || String(m.status || '').toUpperCase() === 'DONE' || String(m.status || '').toUpperCase() === 'COMPLETED' || Boolean(m.executive_summary)).length;
  const upcomingMeetings = meetings.filter(m => String(m.status || '').toUpperCase() === 'UPCOMING' || String(m.status || '').toUpperCase() === 'SẮP TỚI').length;
  const totalTasksPushed = meetings.reduce((acc, m) => acc + (Array.isArray(m.recommended_tasks) ? m.recommended_tasks.length : (m.ai_summary ? 3 : 0)), 0);

  return (
    <div className="h-screen bg-[#f8fafc] text-[#0b1c30] flex overflow-hidden relative" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <Navbar />

      {/* Delete Success Toast Banner */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-[99] bg-[#0b1c30] text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-bold border border-slate-700 animate-in fade-in slide-in-from-top-3 duration-200">
          <CheckCircle2 size={18} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">
        
        {/* Top Header Bar */}
        <div className="h-[56px] bg-white border-b border-[#e2e8f0] flex items-center justify-between px-8 shrink-0 z-40">
          <div className="flex items-center gap-3">
            <CalendarIcon className="text-[#6366f1]" size={20} />
            <h1 className="text-base font-extrabold text-[#0b1c30]">Quản lý Meetings</h1>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSettingsOpen(true)} 
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-[#cbd5e1] text-[#475569] text-xs font-bold px-3.5 py-2 rounded-xl transition-colors shadow-2xs"
            >
              <Sparkles size={15} className="text-[#6366f1]" />
              <span>Cấu hình AI & Google Admin</span>
            </button>
            <button 
              onClick={() => { setEditingMeeting(null); setIsModalOpen(true); }} 
              className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm"
            >
              <span className="text-base font-normal leading-none">+</span>
              <span>Tạo meeting</span>
            </button>
          </div>
        </div>

        {/* Main Content Scroll Container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Navigation Tabs Bar (Danh sách cuộc họp | Calendar Team) */}
          <div className="flex items-center gap-8 border-b border-[#e2e8f0] pb-2 text-xs font-bold">
            <button
              onClick={() => handleTabSwitch('list')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'list' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent text-[#64748b] hover:text-[#0b1c30]'}`}
            >
              Danh sách cuộc họp
            </button>
            <button
              onClick={() => handleTabSwitch('calendar')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'calendar' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent text-[#64748b] hover:text-[#0b1c30]'}`}
            >
              Calendar Team
            </button>
          </div>

          {/* Stat Cards Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-[#e2e8f0] shadow-2xs flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-[11px] text-[#64748b] font-bold uppercase tracking-wider">Tổng cuộc họp</p>
                <p className="text-2xl font-extrabold text-[#0b1c30]">{totalMeetings}</p>
                <p className="text-[11px] text-[#94a3b8]">Trong tháng này</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#f5f3ff] text-[#6366f1] flex items-center justify-center border border-[#e0e7ff]">
                <CalendarIcon size={22} />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-[#e2e8f0] shadow-2xs flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-[11px] text-[#64748b] font-bold uppercase tracking-wider">Đã có AI Summary</p>
                <p className="text-2xl font-extrabold text-[#6366f1]">{doneMeetings}</p>
                <p className="text-[11px] text-[#94a3b8]">{totalMeetings > 0 ? Math.round((doneMeetings / totalMeetings) * 100) : 100}% cuộc họp</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#f5f3ff] text-[#6366f1] flex items-center justify-center border border-[#e0e7ff]">
                <Sparkles size={22} />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-[#e2e8f0] shadow-2xs flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-[11px] text-[#64748b] font-bold uppercase tracking-wider">Lịch sắp tới</p>
                <p className="text-2xl font-extrabold text-amber-600">{upcomingMeetings}</p>
                <p className="text-[11px] text-[#94a3b8]">Trong 7 ngày tới</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
                <Clock size={22} />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-[#e2e8f0] shadow-2xs flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-[11px] text-[#64748b] font-bold uppercase tracking-wider">Task đã push</p>
                <p className="text-2xl font-extrabold text-emerald-600">{totalTasksPushed}</p>
                <p className="text-[11px] text-[#94a3b8]">Hoàn thành push task</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                <CheckCircle2 size={22} />
              </div>
            </div>
          </div>

          {/* TAB 1: DANH SÁCH CUỘC HỌP */}
          {activeTab === 'list' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row gap-3 bg-white p-3.5 rounded-2xl border border-[#e2e8f0] shadow-2xs">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3.5 top-3 text-[#94a3b8]" />
                  <input 
                    type="text" 
                    placeholder="Tìm kiếm cuộc họp, dự án, người tạo..." 
                    value={searchTerm} 
                    onChange={e => setSearchTerm(e.target.value)} 
                    className="w-full pl-9 pr-4 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#6366f1] transition-all text-[#0b1c30]" 
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-[#64748b] hidden sm:block whitespace-nowrap">Nền tảng:</label>
                  <select 
                    value={platformFilter} 
                    onChange={e => setPlatformFilter(e.target.value)} 
                    className="px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#6366f1] min-w-[130px] text-[#0b1c30] font-medium"
                  >
                    <option value="All">Tất cả</option>
                    <option value="Google Meet">Google Meet</option>
                    <option value="Zoom">Zoom</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-[#64748b] hidden sm:block whitespace-nowrap">Thời gian:</label>
                  <input 
                    type={monthFilter === 'All' ? 'text' : 'month'} 
                    placeholder="Tháng/Năm" 
                    onFocus={e => (e.target.type = 'month')} 
                    onBlur={e => { if (!e.target.value) e.target.type = 'text'; }} 
                    value={monthFilter === 'All' ? '' : monthFilter} 
                    onChange={e => setMonthFilter(e.target.value || 'All')} 
                    className="px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#6366f1] min-w-[130px] placeholder:text-[#94a3b8] text-[#0b1c30] font-medium" 
                  />
                </div>
              </div>

              <div className="space-y-4">
                {isLoading ? (
                  <div className="text-center py-16 text-[#64748b] text-xs">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
                      <span>Đang tải danh sách cuộc họp...</span>
                    </div>
                  </div>
                ) : filteredMeetings.length === 0 ? (
                  <div className="text-center py-16 bg-white rounded-2xl border border-[#e2e8f0] border-dashed p-8 space-y-2">
                    <div className="w-12 h-12 bg-[#f5f3ff] text-[#6366f1] rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <Search size={24} />
                    </div>
                    <p className="text-[#0b1c30] font-bold text-sm">Không tìm thấy cuộc họp nào</p>
                    <p className="text-[#64748b] text-xs">Hãy thử thay đổi từ khóa tìm kiếm hoặc bấm "Tạo meeting" để thêm mới.</p>
                  </div>
                ) : (
                  paginatedMeetings.map(meeting => (
                    <MeetingCard 
                      key={meeting.id} 
                      meeting={meeting}
                      onEdit={canManage ? (m => { setEditingMeeting(m); setIsModalOpen(true); }) : undefined}
                      onDelete={canManage ? (id => setDeleteConfirmId(id)) : undefined}
                      onSummarize={canManage ? (m => { setSummarizingMeeting(m); setIsSummarizeOpen(true); }) : undefined}
                      onSync={canManage ? handleSync : undefined}
                      onOpenDetail={handleOpenDetail}
                    />
                  ))
                )}
              </div>

              {filteredMeetings.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 text-xs text-[#64748b] font-medium">
                  <div>
                    Hiển thị 1–{paginatedMeetings.length} của {filteredMeetings.length} cuộc họp
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-[#e2e8f0]">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-2.5 py-1 hover:bg-slate-100 disabled:opacity-40 rounded-lg transition-colors font-bold text-[#0b1c30]"
                      >
                        ‹
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${currentPage === page ? 'bg-[#f5f3ff] text-[#6366f1] border border-[#e0e7ff]' : 'hover:bg-slate-50 text-[#64748b]'}`}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-2.5 py-1 hover:bg-slate-100 disabled:opacity-40 rounded-lg transition-colors font-bold text-[#0b1c30]"
                      >
                        ›
                      </button>
                    </div>

                    <select className="px-3 py-1.5 bg-white border border-[#cbd5e1] rounded-xl text-xs font-semibold text-[#0b1c30]">
                      <option>10 / trang</option>
                      <option>20 / trang</option>
                      <option>50 / trang</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CALENDAR TEAM */}
          {activeTab === 'calendar' && (
            <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs p-6 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2">
                <div>
                  <h3 className="text-base font-extrabold text-[#0b1c30] tracking-tight">
                    {currentWeekInfo.weekTitle}
                  </h3>
                  <p className="text-xs text-[#64748b] mt-0.5">
                    Cuộc họp sẽ được ghi nhận và xử lý ngay khi kết thúc
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-[#f1f5f9] p-0.5 rounded-xl border border-[#cbd5e1]">
                    <button
                      type="button"
                      onClick={() => setWeekOffset(prev => prev - 1)}
                      className="px-3 py-1.5 text-xs font-bold text-[#475569] hover:bg-white rounded-lg transition-colors"
                    >
                      ‹ Tuần trước
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekOffset(0)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${weekOffset === 0 ? 'bg-white text-[#6366f1] shadow-2xs' : 'text-[#64748b] hover:bg-white'}`}
                    >
                      Hôm nay
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekOffset(prev => prev + 1)}
                      className="px-3 py-1.5 text-xs font-bold text-[#475569] hover:bg-white rounded-lg transition-colors"
                    >
                      Tuần sau ›
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => fetchMeetings()}
                    className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#0b1c30] text-xs font-bold rounded-xl transition-colors border border-[#cbd5e1] shadow-2xs flex items-center gap-1.5"
                  >
                    <span>↻</span>
                    <span>Đồng bộ lịch</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 pt-2">
                {currentWeekInfo.days.map((d, i) => {
                  const dayMeetings = meetings.filter(m => {
                    if (!m || !m.date) return false;
                    const dateStr = String(m.date).trim();
                    if (dateStr.startsWith(d.isoDate)) return true;
                    const fullFormattedDate = `${d.formattedDate}/${d.yearNum}`;
                    if (dateStr === fullFormattedDate || dateStr.startsWith(fullFormattedDate)) return true;
                    if (dateStr === d.formattedDate) return true;
                    return false;
                  });

                  return (
                    <div key={i} className={`border rounded-2xl p-3.5 min-h-[200px] ${d.isWeekend ? 'bg-slate-50/70 border-slate-200' : 'bg-white border-[#e2e8f0]'}`}>
                      <h4 className="text-[13px] font-extrabold text-[#0b1c30] mb-3">{d.label}</h4>
                      {dayMeetings.length > 0 ? (
                        dayMeetings.map(item => (
                          <div
                            key={item.id}
                            onClick={() => handleCalendarMeetingClick(item)}
                            className="bg-[#f5f3ff] border-l-4 border-l-[#6366f1] rounded-xl p-3 mb-3 cursor-pointer hover:shadow-md transition-all space-y-1"
                          >
                            <p className="text-xs font-bold text-[#0b1c30] leading-snug">
                              {item.time || '14:00'} {item.title}
                            </p>
                            <p className="text-[11px] text-[#64748b] font-medium flex items-center gap-1">
                              <Video size={12} className="text-[#6366f1]" />
                              <span>{item.platform || 'Google Meet'} · <b className="text-[#6366f1]">AI On</b></span>
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="border border-dashed border-[#e2e8f0] rounded-xl p-4 text-center text-[12px] text-[#94a3b8] mt-2">
                          Chưa có lịch họp
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Modals */}
      {canManage && <CreateMeetingModal isOpen={isModalOpen} onClose={handleCloseEditModal} onSave={handleSaveMeeting} initialData={editingMeeting} />}
      {canManage && <PromptSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />}
      {canManage && <SummarizeModal isOpen={isSummarizeOpen} onClose={() => { setIsSummarizeOpen(false); setSummarizingMeeting(null); }} meeting={summarizingMeeting} onSave={m => queryClient.setQueryData(['meetings'], (prev: any[] = []) => prev.map(x => x.id === m.id ? m : x))} />}
      <MeetingDetailModal 
        isOpen={isDetailOpen} 
        onClose={handleCloseDetail} 
        meeting={detailMeeting} 
        onEdit={canManage ? handleOpenEditFromDetail : undefined} 
        onSummarize={canManage ? (m => { setIsDetailOpen(false); setSummarizingMeeting(m); setIsSummarizeOpen(true); }) : undefined} 
      />

      {/* Delete Confirm Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center"><span className="material-symbols-outlined text-[20px]">delete</span></div>
              <h3 className="text-sm font-bold text-[#0b1c30]">Xóa cuộc họp</h3>
            </div>
            <p className="text-xs text-[#64748b]">Bạn có chắc chắn muốn xóa cuộc họp này? Hành động này không thể hoàn tác.</p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-xs font-bold text-[#64748b] bg-[#ffffff] border border-[#cbd5e1] hover:bg-slate-50 rounded-xl transition-colors">Hủy</button>
              <button onClick={executeDelete} className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm">Xác nhận xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-[#f8fafc] flex items-center justify-center text-xs font-semibold text-[#64748b]">
        Đang tải trang Meetings...
      </div>
    }>
      <MeetingsPageContent />
    </Suspense>
  );
}
