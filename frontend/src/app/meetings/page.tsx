'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Sparkles, Calendar as CalendarIcon, Video, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import CreateMeetingModal from '@/components/meetings/CreateMeetingModal';
import PromptSettingsModal from '@/components/meetings/PromptSettingsModal';
import SummarizeModal from '@/components/meetings/SummarizeModal';
import MeetingDetailModal from '@/components/meetings/MeetingDetailModal';
import ScoreModelExplainer from '@/components/meetings/ScoreModelExplainer';
import MeetingPlaybook from '@/components/meetings/MeetingPlaybook';
import KpiCard from '@/components/dashboard/KpiCard';
import BarChartCard from '@/components/dashboard/BarChartCard';
import ProgressBar from '@/components/dashboard/ProgressBar';
import { getMeetings, createMeeting, updateMeeting, deleteMeeting, syncMeeting, getGoogleStatus, getMeetingInsights, addMeetingMember, getMeeting } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

function MeetingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [canManage, setCanManage] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'calendar' | 'personal'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState('All');
  const [monthFilter, setMonthFilter] = useState('All');
  const [projectFilter, setProjectFilter] = useState('All');
  const [personFilter, setPersonFilter] = useState('All');
  const [quickFilter, setQuickFilter] = useState('');
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

  // Scroll-anchor refs for the secondary nav row (mirrors the prototype's
  // Tổng quan/Cuộc họp/Theo nhân sự/Theo dự án/Chất lượng họp tabs, which
  // scroll within the single list view rather than switching views).
  const overviewSectionRef = useRef<HTMLDivElement>(null);
  const tableSectionRef = useRef<HTMLDivElement>(null);
  const insightSectionRef = useRef<HTMLDivElement>(null);
  const qualitySectionRef = useRef<HTMLDivElement>(null);
  const scrollToSection = (ref: React.RefObject<HTMLDivElement>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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

  const handleTabSwitch = (tab: 'list' | 'calendar' | 'personal') => {
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

  const { data: myMeetingsData, isLoading: isMyMeetingsLoading, refetch: fetchMyMeetings } = useQuery({
    queryKey: ['meetings', 'mine'],
    queryFn: async () => {
      const data = await getMeetings({ mine: true });
      if (data && data.success && Array.isArray(data.data)) return data.data;
      if (Array.isArray(data)) return data;
      return [];
    },
    enabled: activeTab === 'personal',
    staleTime: 2 * 60_000,
  });
  const myMeetings: any[] = myMeetingsData || [];

  const { data: insightsData } = useQuery({
    queryKey: ['meeting-insights'],
    queryFn: async () => {
      const data = await getMeetingInsights();
      return data?.data || null;
    },
    staleTime: 2 * 60_000,
  });

  const overloadedNames = useMemo(() => {
    const names = new Set<string>();
    (insightsData?.top_people || []).forEach((p: any) => { if (p.hours > 8) names.add(p.name); });
    return names;
  }, [insightsData]);

  // Parse URL search params for tab and meeting ID deep linking
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'calendar' || tabParam === 'list' || tabParam === 'personal') {
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

  // 1 meeting giờ có thể gắn nhiều dự án (m.projects: [{id,name}]) — field cũ
  // m.project/m.project_name (số ít) vẫn được API trả về để tương thích, dùng
  // làm fallback cho dữ liệu cũ chưa qua bảng meeting_projects.
  const getMeetingProjectNames = (m: any): string[] => {
    if (Array.isArray(m.projects) && m.projects.length) {
      return m.projects.map((p: any) => p.name).filter(Boolean);
    }
    const single = typeof m.project === 'string' ? m.project : (m.project?.name || m.project_name || '');
    return single ? [single] : [];
  };

  const projectOptions = useMemo(() => {
    const names = new Set<string>();
    meetings.forEach(m => getMeetingProjectNames(m).forEach(p => names.add(p)));
    return Array.from(names).sort();
  }, [meetings]);

  const personOptions = useMemo(() => {
    const names = new Set<string>();
    meetings.forEach(m => (m.members || []).forEach((mm: any) => { if (mm.display_name) names.add(mm.display_name); }));
    return Array.from(names).sort();
  }, [meetings]);

  // Real signals only — no fabricated data. "Có task trễ" is intentionally
  // omitted here (would need per-meeting Task join not returned by the API).
  const meetingMatchesQuickFilter = (m: any, quick: string): boolean => {
    if (!quick) return true;
    const tasks: any[] = m.recommended_tasks || m.ai_summary?.recommended_tasks || [];
    switch (quick) {
      case 'noprep':
        return (m.score_prep ?? 0) < 20;
      case 'nosync':
        return tasks.length > 0 && tasks.some(t => !t.imported_task_id);
      case 'overload':
        return (m.members || []).some((mm: any) => overloadedNames.has(mm.display_name));
      case 'outside': {
        const hour = parseInt(String(m.start_time || m.time || '9:00').split(':')[0], 10);
        return hour < 8 || hour >= 18;
      }
      case 'low':
        return m.score_total !== null && m.score_total !== undefined && m.score_total < 70;
      default:
        return true;
    }
  };

  const filteredMeetings = useMemo(() => {
    return (meetings || []).filter(m => {
      if (!m) return false;
      const title = String(m.title || '');
      const projectNames = getMeetingProjectNames(m);
      const matchesSearch = title.toLowerCase().includes(searchTerm.toLowerCase()) || projectNames.some(p => p.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesPlatform = platformFilter === 'All' || m.platform === platformFilter;
      const matchesProject = projectFilter === 'All' || projectNames.includes(projectFilter);
      const matchesPerson = personFilter === 'All' || (m.members || []).some((mm: any) => mm.display_name === personFilter);
      let matchesMonth = true;
      if (monthFilter !== 'All' && monthFilter !== '') matchesMonth = Boolean(m.date && String(m.date).startsWith(monthFilter));
      return matchesSearch && matchesPlatform && matchesProject && matchesPerson && matchesMonth && meetingMatchesQuickFilter(m, quickFilter);
    });
  }, [meetings, searchTerm, platformFilter, projectFilter, personFilter, monthFilter, quickFilter, overloadedNames]);

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
      let savedObj: any = null;
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
          // Thành viên chọn lúc tạo được thêm bằng API riêng (endpoint tạo
          // meeting không nhận members) — xong thì lấy lại bản mới nhất để
          // có danh sách members thật thay vì chỉ có Host.
          const memberIds: number[] = Array.isArray(meetingData.member_ids) ? meetingData.member_ids : [];
          if (memberIds.length > 0) {
            await Promise.all(memberIds.map(mid => addMeetingMember(savedObj.id, mid).catch(() => {})));
            const refreshed = await getMeeting(savedObj.id).catch(() => null);
            if (refreshed?.success) savedObj = refreshed.data;
          }
          queryClient.setQueryData(['meetings'], (prev: any[] = []) => [savedObj, ...prev]);
          // Meeting mới luôn được chèn lên đầu mảng — nếu đang xem trang khác
          // trang 1 thì quay lại trang 1 để thấy ngay, tránh cảm giác "biến mất".
          setCurrentPage(1);
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

  const totalHours = meetings.reduce((sum, m) => sum + (typeof m.duration === 'number' ? m.duration / 60 : 1), 0);
  const uniquePeopleCount = new Set(meetings.flatMap(m => (m.members || []).map((mm: any) => mm.display_name))).size;
  const avgHoursPerPerson = uniquePeopleCount > 0 ? totalHours / uniquePeopleCount : 0;

  const allRecommendedTasks = meetings.flatMap(m => (m.recommended_tasks || m.ai_summary?.recommended_tasks || []) as any[]);
  const syncedTasksCount = allRecommendedTasks.filter(t => t.imported_task_id).length;
  const kpiTaskSyncPct = allRecommendedTasks.length > 0 ? Math.round((syncedTasksCount / allRecommendedTasks.length) * 100) : 100;

  const meetingsWithFollowthrough = meetings.filter(m => m.score_followthrough !== null && m.score_followthrough !== undefined);
  const avgFollowthroughPct = meetingsWithFollowthrough.length > 0
    ? Math.round((meetingsWithFollowthrough.reduce((s, m) => s + (m.score_followthrough || 0), 0) / (meetingsWithFollowthrough.length * 20)) * 100)
    : 0;

  const meetingsWithScore = meetings.filter(m => m.score_total !== null && m.score_total !== undefined);
  const overallQualityScore = meetingsWithScore.length > 0
    ? Math.round(meetingsWithScore.reduce((s, m) => s + m.score_total, 0) / meetingsWithScore.length)
    : 0;
  const pctPrepared = meetings.length > 0
    ? Math.round((meetings.filter(m => m.objective && m.agenda).length / meetings.length) * 100)
    : 0;
  const meetingsWithExecution = meetings.filter(m => m.score_execution !== null && m.score_execution !== undefined);
  const pctOnTime = meetingsWithExecution.length > 0
    ? Math.round((meetingsWithExecution.reduce((s, m) => s + m.score_execution, 0) / (meetingsWithExecution.length * 15)) * 100)
    : 0;
  const pctValidActions = allRecommendedTasks.length > 0
    ? Math.round((allRecommendedTasks.filter(t => t.assigned_name && t.deadline).length / allRecommendedTasks.length) * 100)
    : 0;

  const renderWeekGrid = (weekMeetings: any[], emptyText: string) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 pt-2">
      {currentWeekInfo.days.map((d, i) => {
        const dayMeetings = weekMeetings.filter(m => {
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
                {emptyText}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

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

      <div className="flex-1 min-w-0 pl-0 md:pl-[230px] pt-14 md:pt-0 flex flex-col h-screen overflow-hidden">

        {/* Top Header Bar */}
        <div className="min-h-[56px] bg-white border-b border-[#e2e8f0] flex flex-wrap items-center justify-between gap-2 px-4 md:px-8 py-2 md:py-0 shrink-0 z-30">
          <div className="flex items-center gap-3">
            <CalendarIcon className="text-[#6366f1]" size={20} />
            <h1 className="text-base font-extrabold text-[#0b1c30]">Quản lý Meetings</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-[#cbd5e1] text-[#475569] text-xs font-bold px-3.5 py-2 rounded-xl transition-colors shadow-2xs whitespace-nowrap"
            >
              <Sparkles size={15} className="text-[#6366f1]" />
              <span>Cấu hình AI & Google Admin</span>
            </button>
            <button
              onClick={() => { setEditingMeeting(null); setIsModalOpen(true); }}
              className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm whitespace-nowrap"
            >
              <span className="text-base font-normal leading-none">+</span>
              <span>Tạo meeting</span>
            </button>
          </div>
        </div>

        {/* Main Content Scroll Container */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 space-y-6">
          
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
            <button
              onClick={() => handleTabSwitch('personal')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'personal' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent text-[#64748b] hover:text-[#0b1c30]'}`}
            >
              Calendar cá nhân
            </button>
          </div>

          {/* Secondary scroll-nav (mirrors prototype's page-section tabs) */}
          {activeTab === 'list' && (
            <nav className="flex items-center gap-1 flex-wrap">
              {[
                { label: 'Tổng quan', ref: overviewSectionRef },
                { label: 'Cuộc họp', ref: tableSectionRef },
                { label: 'Theo nhân sự', ref: insightSectionRef },
                { label: 'Theo dự án', ref: insightSectionRef },
                { label: 'Chất lượng họp', ref: qualitySectionRef },
              ].map(t => (
                <button
                  key={t.label}
                  onClick={() => scrollToSection(t.ref)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-[#64748b] hover:bg-[#f5f3ff] hover:text-[#6366f1] transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </nav>
          )}

          {/* KPI Grid */}
          <div ref={overviewSectionRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard label="Tổng cuộc họp" value={totalMeetings} icon="chart" border="border-l-[#6366f1]" text="text-[#6366f1]" trend={`${totalTasksPushed} task đã push`} />
            <KpiCard label="Tổng giờ họp" value={`${totalHours.toFixed(1)}h`} icon="clock" border="border-l-amber-500" text="text-amber-600" trend={`${upcomingMeetings} lịch sắp tới`} />
            <KpiCard label="Bình quân / người" value={`${avgHoursPerPerson.toFixed(1)}h`} icon="user" border="border-l-[#5aa1ed]" text="text-[#2563eb]" trend={`${uniquePeopleCount} người tham gia`} />
            <KpiCard label="Task đã vào KPI dự án" value={`${kpiTaskSyncPct}%`} icon="check" border="border-l-emerald-500" text="text-emerald-600" trend={`${syncedTasksCount}/${allRecommendedTasks.length} task đã đồng bộ`} />
            <KpiCard label="Điểm Thực thi trung bình" value={`${avgFollowthroughPct}%`} icon="tasks" border="border-l-[#07966d]" text="text-[#07966d]" trend={`${doneMeetings} cuộc họp đã diễn ra`} />
          </div>

          {/* TAB 1: DANH SÁCH CUỘC HỌP */}
          {activeTab === 'list' && (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 bg-white p-3.5 rounded-2xl border border-[#e2e8f0] shadow-2xs">
                <div className="flex flex-col lg:flex-row gap-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3.5 top-3 text-[#94a3b8]" />
                    <input
                      type="text"
                      placeholder="Tìm cuộc họp, dự án, người tham gia..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#6366f1] transition-all text-[#0b1c30]"
                    />
                  </div>
                  <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#6366f1] min-w-[150px] text-[#0b1c30] font-medium">
                    <option value="All">Tất cả dự án</option>
                    {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={personFilter} onChange={e => setPersonFilter(e.target.value)} className="px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#6366f1] min-w-[150px] text-[#0b1c30] font-medium">
                    <option value="All">Tất cả nhân sự</option>
                    {personOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)} className="px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#6366f1] min-w-[130px] text-[#0b1c30] font-medium">
                    <option value="All">Tất cả nền tảng</option>
                    <option value="Google Meet">Google Meet</option>
                    <option value="Zoom">Zoom</option>
                  </select>
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

                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-[#f1f5f9]">
                  <span className="text-[11px] font-bold text-[#8492a6] mr-1">Lọc nhanh:</span>
                  {[
                    { key: 'noprep', label: 'Thiếu chuẩn bị' },
                    { key: 'nosync', label: 'Chưa vào KPI Tasks' },
                    { key: 'overload', label: 'Nhân sự quá tải' },
                    { key: 'outside', label: 'Họp ngoài giờ' },
                    { key: 'low', label: 'Hiệu quả thấp' },
                  ].map(chip => (
                    <button
                      key={chip.key}
                      onClick={() => setQuickFilter(prev => prev === chip.key ? '' : chip.key)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                        quickFilter === chip.key ? 'border-[#bbb6ff] bg-[#efedff] text-[#554bea]' : 'border-[#dfe5ed] bg-[#f8fafc] text-[#52627a] hover:border-[#bbb6ff]'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                  {(quickFilter || projectFilter !== 'All' || personFilter !== 'All' || platformFilter !== 'All' || monthFilter !== 'All' || searchTerm) && (
                    <button
                      onClick={() => { setQuickFilter(''); setProjectFilter('All'); setPersonFilter('All'); setPlatformFilter('All'); setMonthFilter('All'); setSearchTerm(''); }}
                      className="ml-auto text-[11px] font-bold text-[#6366f1] hover:underline"
                    >
                      Đặt lại bộ lọc
                    </button>
                  )}
                </div>
              </div>

              <ScoreModelExplainer />
              <MeetingPlaybook />

              {/* Chart + Alerts */}
              <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
                <BarChartCard
                  title="Xu hướng thời lượng họp theo dự án vs nội bộ (7 ngày)"
                  data={insightsData?.weekly_series || []}
                  bars={[{ key: 'project', name: 'Theo dự án', fill: '#7068f5' }, { key: 'internal', name: 'Nội bộ / vận hành', fill: '#c8c5ff' }]}
                  xKey="day"
                />
                <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs p-4">
                  <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-3">Cần chú ý</h3>
                  {(insightsData?.alerts || []).length === 0 ? (
                    <p className="text-[11px] text-[#94a3b8]">Không có cảnh báo trong 7 ngày qua.</p>
                  ) : (
                    <div className="space-y-2">
                      {(insightsData?.alerts || []).map((a: any, i: number) => (
                        <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-50 border border-slate-100">
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                            a.type === 'overload' ? 'bg-red-100 text-red-600' : a.type === 'outside' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'
                          }`}>{a.count}</div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-[#0b1c30] leading-tight">{a.title}</p>
                            <p className="text-[10px] text-[#7d8ba0] mt-0.5">{a.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div ref={tableSectionRef} className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs overflow-hidden">
                {isLoading ? (
                  <div className="text-center py-16 text-[#64748b] text-xs">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
                      <span>Đang tải danh sách cuộc họp...</span>
                    </div>
                  </div>
                ) : filteredMeetings.length === 0 ? (
                  <div className="text-center py-16 p-8 space-y-2">
                    <div className="w-12 h-12 bg-[#f5f3ff] text-[#6366f1] rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <Search size={24} />
                    </div>
                    <p className="text-[#0b1c30] font-bold text-sm">Không tìm thấy cuộc họp nào</p>
                    <p className="text-[#64748b] text-xs">Hãy thử bỏ bớt điều kiện lọc hoặc bấm "Tạo meeting" để thêm mới.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" style={{ minWidth: 1100 }}>
                      <thead>
                        <tr className="bg-[#f8fafc] border-b border-[#e2e8f0] text-left">
                          <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Cuộc họp</th>
                          <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Dự án</th>
                          <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Người tham gia</th>
                          <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Thời gian</th>
                          <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Chuẩn bị</th>
                          <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">KPI Tasks</th>
                          <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Trạng thái</th>
                          <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Điểm hiệu quả</th>
                          <th className="p-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedMeetings.map(m => {
                          const projectNames = getMeetingProjectNames(m);
                          const prep = m.score_prep;
                          const tasks: any[] = m.recommended_tasks || m.ai_summary?.recommended_tasks || [];
                          const syncedCount = tasks.filter(t => t.imported_task_id).length;
                          const statusUpper = String(m.status || '').toUpperCase();
                          const isScheduledOrCancelled = statusUpper === 'SẮP TỚI' || statusUpper === 'ĐÃ HỦY';
                          const score = m.score_total;
                          return (
                            <tr key={m.id} className="border-b border-[#edf1f6] hover:bg-[#fbfbff] transition-colors">
                              <td className="p-3">
                                <div className="flex items-center gap-2.5 min-w-[200px]">
                                  <div className="w-8 h-8 rounded-lg bg-[#efefff] text-[#5e57e7] flex items-center justify-center font-extrabold shrink-0">▣</div>
                                  <div className="min-w-0">
                                    <p className="font-bold text-[#0b1c30] truncate max-w-[220px]">{m.title}</p>
                                    <p className="text-[10px] text-[#8492a6]">{m.platform || 'Google Meet'}{m.duration ? ` · ${m.duration} phút` : ''}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="p-3">
                                <div className="flex flex-wrap gap-1 max-w-[180px]">
                                  {projectNames.length > 0 ? projectNames.map(name => (
                                    <span key={name} className="inline-flex items-center gap-1 bg-[#eef4ff] text-[#285dc4] border border-[#dbe8ff] rounded-md px-2 py-1 text-[10px] font-bold whitespace-nowrap">▣ {name}</span>
                                  )) : (
                                    <span className="inline-flex items-center gap-1 bg-[#f1f5f9] text-[#64748b] border border-[#e2e8f0] rounded-md px-2 py-1 text-[10px] font-bold whitespace-nowrap">Dự án chung</span>
                                  )}
                                </div>
                              </td>
                              <td className="p-3 text-[11px] text-[#52627a]">{(m.members || []).length} người</td>
                              <td className="p-3 whitespace-nowrap text-[11px]">{m.date} · {m.time}</td>
                              <td className="p-3">
                                {prep === null || prep === undefined ? (
                                  <span className="text-[#94a3b8]">—</span>
                                ) : (
                                  <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${prep >= 20 ? 'bg-emerald-50 text-emerald-700' : prep > 5 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                                    {prep >= 20 ? '✓' : prep > 5 ? '!' : '×'} {prep}/25
                                  </span>
                                )}
                              </td>
                              <td className="p-3">
                                {isScheduledOrCancelled || tasks.length === 0 ? (
                                  <span className="text-[#94a3b8]">—</span>
                                ) : (
                                  <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${syncedCount === tasks.length ? 'bg-emerald-50 text-emerald-700' : syncedCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                                    {syncedCount === tasks.length ? '✓' : syncedCount > 0 ? '!' : '×'} {Math.round((syncedCount / tasks.length) * 100)}% đã tạo
                                  </span>
                                )}
                              </td>
                              <td className="p-3">
                                <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${
                                  statusUpper.includes('DIỄN RA') || statusUpper === 'DONE' ? 'bg-[#e2f7ec] text-[#18724f]'
                                  : statusUpper === 'ĐÃ HỦY' || statusUpper === 'CANCELLED' ? 'bg-[#fff0f2] text-[#c73750]'
                                  : 'bg-[#eaf0ff] text-[#315dca]'
                                }`}>
                                  {m.status}
                                </span>
                              </td>
                              <td className="p-3">
                                {score === null || score === undefined ? <span className="text-[#94a3b8]">—</span> : (
                                  <span className={`font-extrabold ${score >= 75 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{score}/100</span>
                                )}
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {canManage && (
                                    <button
                                      onClick={() => setDeleteConfirmId(String(m.id))}
                                      title="Xóa cuộc họp"
                                      className="border border-[#d7dfeb] bg-white rounded-lg h-7 w-7 flex items-center justify-center text-[#94a3b8] hover:border-red-300 hover:text-red-600 transition-colors"
                                    >
                                      <span className="material-symbols-outlined text-[14px]">delete</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleOpenDetail(m)}
                                    className="border border-[#d7dfeb] bg-white rounded-lg h-7 px-2.5 text-[#506078] text-[10px] font-bold hover:border-[#6366f1] hover:text-[#6366f1] transition-colors whitespace-nowrap"
                                  >
                                    Chi tiết ›
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {filteredMeetings.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-1 text-xs text-[#64748b] font-medium">
                  <div>
                    Hiển thị 1–{paginatedMeetings.length} của {filteredMeetings.length} cuộc họp
                  </div>

                  <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-[#e2e8f0]">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-2.5 py-1 hover:bg-slate-100 disabled:opacity-40 rounded-lg transition-colors font-bold text-[#0b1c30]"
                    >
                      <ChevronLeft size={14} />
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
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}

              {/* Insight Grid */}
              <div ref={insightSectionRef} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs p-4">
                  <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-3">Tải họp theo dự án</h3>
                  {(insightsData?.project_load || []).length === 0 ? (
                    <p className="text-[11px] text-[#94a3b8]">Chưa có dữ liệu.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {(insightsData?.project_load || []).slice(0, 6).map((p: any) => {
                        const max = insightsData.project_load[0]?.hours || 1;
                        return (
                          <div key={p.name} className="grid grid-cols-[1fr_2fr_44px] items-center gap-2.5">
                            <span className="text-[11px] text-[#52627a] truncate">{p.name}</span>
                            <ProgressBar value={(p.hours / max) * 100} showLabel={false} color="bg-[#736cf3]" />
                            <span className="text-[11px] font-bold text-right">{p.hours}h</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs p-4">
                  <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-3">Top nhân sự theo giờ họp</h3>
                  {(insightsData?.top_people || []).length === 0 ? (
                    <p className="text-[11px] text-[#94a3b8]">Chưa có dữ liệu.</p>
                  ) : (
                    <div className="space-y-2">
                      {(insightsData?.top_people || []).slice(0, 5).map((p: any) => (
                        <div key={p.name} className="flex items-center justify-between py-1.5 border-b border-[#edf1f6] last:border-0">
                          <div>
                            <p className="text-[11px] font-bold text-[#0b1c30]">{p.name}</p>
                            <p className="text-[10px] text-[#8492a6]">{p.meetings} cuộc họp</p>
                          </div>
                          <span className={`text-xs font-extrabold ${p.hours > 8 ? 'text-red-600' : p.hours > 6 ? 'text-amber-600' : 'text-[#0b1c30]'}`}>{p.hours}h</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div ref={qualitySectionRef} className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs p-4">
                  <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-3">Chất lượng vận hành họp</h3>
                  <div className="flex items-center gap-3.5 mb-3">
                    <div
                      className="w-[62px] h-[62px] rounded-full grid place-items-center shrink-0 relative"
                      style={{ background: `conic-gradient(#07966d 0 ${overallQualityScore}%, #e8edf2 ${overallQualityScore}%)` }}
                    >
                      <div className="absolute inset-[5px] bg-white rounded-full grid place-items-center">
                        <strong className="text-base text-[#0b1c30]">{overallQualityScore}</strong>
                      </div>
                    </div>
                    <p className="text-[11px] text-[#68778b] leading-relaxed">
                      <b className="text-[#0b1c30]">{overallQualityScore >= 75 ? 'Khá tốt' : overallQualityScore >= 50 ? 'Cần cải thiện' : 'Chưa đạt'}</b><br />
                      Điểm trung bình hiệu quả trên {meetingsWithScore.length} cuộc họp đã tính điểm.
                    </p>
                  </div>
                  <div className="space-y-0">
                    {[
                      { label: 'Đủ mục tiêu + agenda trước họp', value: pctPrepared },
                      { label: 'Đúng giờ / đủ thành phần (Điều hành)', value: pctOnTime },
                      { label: 'Task đã tạo trong KPI dự án', value: kpiTaskSyncPct },
                      { label: 'Task đủ owner, deadline', value: pctValidActions },
                    ].map(q => (
                      <div key={q.label} className="flex items-center justify-between py-1.5 border-t border-[#edf1f6] text-[11px]">
                        <span className="text-[#6d7b8f]">{q.label}</span>
                        <b className={q.value >= 75 ? 'text-[#07966d]' : q.value >= 50 ? 'text-[#d97706]' : 'text-[#d92d4b]'}>{q.value}%</b>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
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

              {renderWeekGrid(meetings, 'Chưa có lịch họp')}
            </div>
          )}

          {/* TAB 3: CALENDAR CÁ NHÂN */}
          {activeTab === 'personal' && (
            <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs p-6 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2">
                <div>
                  <h3 className="text-base font-extrabold text-[#0b1c30] tracking-tight">
                    {currentWeekInfo.weekTitle}
                  </h3>
                  <p className="text-xs text-[#64748b] mt-0.5">
                    Chỉ hiển thị các cuộc họp bạn được thêm làm người tham gia
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
                    onClick={() => fetchMyMeetings()}
                    className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#0b1c30] text-xs font-bold rounded-xl transition-colors border border-[#cbd5e1] shadow-2xs flex items-center gap-1.5"
                  >
                    <span>↻</span>
                    <span>Đồng bộ lịch</span>
                  </button>
                </div>
              </div>

              {isMyMeetingsLoading ? (
                <div className="text-center py-16 text-[#64748b] text-xs">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
                    <span>Đang tải lịch cá nhân...</span>
                  </div>
                </div>
              ) : renderWeekGrid(myMeetings, 'Bạn chưa có lịch họp')}
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
        onSync={canManage ? handleSync : undefined}
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
