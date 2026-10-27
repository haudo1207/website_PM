'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, Sparkles, Calendar as CalendarIcon, CheckCircle2, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import Navbar from '@/components/Navbar';
import CreateMeetingModal from '@/components/meetings/CreateMeetingModal';
import PromptSettingsModal from '@/components/meetings/PromptSettingsModal';
import MeetingDetailModal from '@/components/meetings/MeetingDetailModal';
import ScoreModelExplainer from '@/components/meetings/ScoreModelExplainer';
import MeetingPlaybook from '@/components/meetings/MeetingPlaybook';
import MeetingGuideModal from '@/components/meetings/MeetingGuideModal';
import KpiCard from '@/components/dashboard/KpiCard';
import BarChartCard from '@/components/dashboard/BarChartCard';
import ProgressBar from '@/components/dashboard/ProgressBar';
import { getMeetings, createMeeting, updateMeeting, deleteMeeting, getGoogleStatus, getMeetingInsights, addMeetingMember, getMeeting, getMeetingAttendanceSummary } from '@/lib/api';
import MemberAttendanceDrawer from '@/components/meetings/MemberAttendanceDrawer';
import { isAdmin, getRole } from '@/lib/auth';
import { useSidebarCollapse, SIDEBAR_PAD_EXPANDED, SIDEBAR_PAD_COLLAPSED } from '@/lib/sidebarCollapse';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';
// Global Time Filter (Meeting Management chốt, 2026-09-20) reuses the exact
// same dual-track date logic dashboard/report/page.tsx's own Bộ lọc thời
// gian uses (see its applyQuickFilter/checkTaskInPeriod) — not a look-alike
// reimplementation:
//   - Tuần trước/này/tới → REAL calendar week relative to today's actual
//     date (getPrevWeekRange/getMondayToSundayRange/getNextWeekRange).
//   - Tháng trước/này/tới → the WHOLE calendar month relative to today
//     (report's own checkTaskInPeriod does this by leaving selectedWeek
//     'all' and matching taskDate's month number — no week narrowing).
//   - Manual Năm/Tháng/Tuần dropdown pick → the fiscal "week N of month M"
//     bucket (getWeekDateRange), same as report's manual-pick path.
import { getWeekOfMonth, getWeekDateRange, getMondayToSundayRange, getPrevWeekRange, getNextWeekRange, MONTH_WEEKS_COUNT } from '@/app/dashboard/constants';
import { toApiDate } from '@/components/calendar/dateUtils';

// Deterministic color per project (no color field on Project yet — same
// project.id/name always hashes to the same palette entry, so week-grid
// event cards stay visually consistent across renders/sessions).
const PROJECT_COLOR_PALETTE = [
  { barBorder: 'border-l-blue-500', bg: 'bg-blue-50', badgeBg: 'bg-blue-100', badgeText: 'text-blue-700', dot: 'bg-blue-500' },
  { barBorder: 'border-l-emerald-500', bg: 'bg-emerald-50', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-700', dot: 'bg-emerald-500' },
  { barBorder: 'border-l-purple-500', bg: 'bg-purple-50', badgeBg: 'bg-purple-100', badgeText: 'text-purple-700', dot: 'bg-purple-500' },
  { barBorder: 'border-l-pink-500', bg: 'bg-pink-50', badgeBg: 'bg-pink-100', badgeText: 'text-pink-700', dot: 'bg-pink-500' },
  { barBorder: 'border-l-amber-500', bg: 'bg-amber-50', badgeBg: 'bg-amber-100', badgeText: 'text-amber-700', dot: 'bg-amber-500' },
  { barBorder: 'border-l-rose-500', bg: 'bg-rose-50', badgeBg: 'bg-rose-100', badgeText: 'text-rose-700', dot: 'bg-rose-500' },
  { barBorder: 'border-l-teal-500', bg: 'bg-teal-50', badgeBg: 'bg-teal-100', badgeText: 'text-teal-700', dot: 'bg-teal-500' },
  { barBorder: 'border-l-sky-500', bg: 'bg-sky-50', badgeBg: 'bg-sky-100', badgeText: 'text-sky-700', dot: 'bg-sky-500' },
];
// Neutral fallback (chốt §12 — no id/name means "not a real project", so it
// shouldn't inherit the palette's brand-indigo slot as if it were a default).
const DEFAULT_PROJECT_COLOR = { barBorder: 'border-l-slate-400', bg: 'bg-slate-50', badgeBg: 'bg-slate-100', badgeText: 'text-slate-600', dot: 'bg-slate-400' };

// Delete rule (chốt 2026-09-13, soft-delete design): ONGOING is the ONLY
// status that blocks Delete — UPCOMING/DONE/CANCELLED are all soft-deletable
// (meeting_id/transcript/ai_summary/n8n state are preserved server-side, just
// hidden from the UI). Backend (`DELETE /api/meetings/{id}`) enforces this
// same rule via compute_display_status(); this is only the display-side
// gating so the UI doesn't offer an action that would 400 right after.
const isMeetingDeletable = (status?: string | null): boolean => {
  const s = String(status || '').toUpperCase();
  return !s.includes('DIỄN RA');
};

const hashStringToIndex = (str: string, mod: number): number => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % mod;
};

const getProjectColor = (projectId?: number | string, projectName?: string) => {
  const key = projectId !== undefined && projectId !== null && projectId !== '' ? String(projectId) : (projectName || '');
  if (!key) return DEFAULT_PROJECT_COLOR;
  return PROJECT_COLOR_PALETTE[hashStringToIndex(key, PROJECT_COLOR_PALETTE.length)];
};

const getInitials = (name: string): string => {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(n => n[0]).join('').substring(0, 2).toUpperCase();
};

const parseTimeToMinutes = (t?: string): number => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim());
  if (!match) return 9 * 60;
  const h = Math.min(23, parseInt(match[1], 10));
  const m = Math.min(59, parseInt(match[2], 10));
  return h * 60 + m;
};

function MeetingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { collapsed: sidebarCollapsed } = useSidebarCollapse();
  // Navbar's Workspace switcher (shared with Dashboard/KPI/Project Hub) — a
  // super_admin browsing "one company at a time" narrows Meetings the same
  // way. Leader/Member/Viewer are already pinned server-side to their own
  // Workspace, so this stays a no-op for them.
  const { workspaceCode } = useWorkspaceFilter();

  const [canManage, setCanManage] = useState(false);
  // Members may create meetings for projects they belong to (backend enforces
  // the project-membership check) — but editing/deleting/syncing stays
  // admin-only (canManage), matching the current UI's scope.
  const [canCreate, setCanCreate] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'calendar' | 'personal'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState('All');
  const [projectFilter, setProjectFilter] = useState('All');
  const [personFilter, setPersonFilter] = useState('All');
  const [quickFilter, setQuickFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<any>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailMeeting, setDetailMeeting] = useState<any>(null);
  const [lastHandledId, setLastHandledId] = useState<string | null>(null);
  const [cameFromDetail, setCameFromDetail] = useState<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // In-flight guard for executeDelete — without it, a double-click on
  // "Xác nhận xóa" fires two DELETE requests for the same meeting.
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [googleCallbackError, setGoogleCallbackError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [showAllPeople, setShowAllPeople] = useState(false);

  // Global Time Filter — single dateRange source of truth for the whole
  // "Danh sách cuộc họp" view (Tổng quan/Cuộc họp/Theo nhân sự/Theo dự án/
  // Chất lượng họp are all sections of this ONE view, not separate tabs —
  // see the scrollToSection refs below — so wiring this into the queries
  // that feed that view covers every section at once). Deliberately
  // independent of weekOffset (Calendar Team/Calendar cá nhân, untouched).
  // The table's old local "Tháng/Năm" input (monthFilter) was removed
  // (chốt §12, 2026-09-20) — audited first: it only ever did client-side
  // time filtering (matchesMonth) and had no other dependency, so it's
  // fully superseded by this global filter, not left coexisting redundantly.
  const [mtYear, setMtYear] = useState(() => new Date().getFullYear());
  const [mtMonth, setMtMonth] = useState(() => new Date().getMonth() + 1);
  // 'all' = "cả tháng", same meaning as report's own selectedWeek === 'all'
  // (set by a Tháng trước/này/tới click, or manually — no week narrowing).
  const [mtWeek, setMtWeek] = useState<number | 'all'>(() => getWeekOfMonth(new Date()));
  const [isRefreshingMeetingRange, setIsRefreshingMeetingRange] = useState(false);
  // Which ONE of the 6 shortcut buttons is highlighted — same mutually-
  // exclusive single-string model as dashboard/report/page.tsx's own
  // activeQuickFilter. null after a manual dropdown edit (no shortcut
  // matches anymore).
  const [activeMeetingQuickFilter, setActiveMeetingQuickFilter] = useState<string | null>('Tuần này');

  // Clamp week when a Year/Month change makes the previously-selected week
  // number invalid for the new month (e.g. week 5 while switching from a
  // 5-week month to a 4-week one) — TEST 10 (date boundary) safety net.
  useEffect(() => {
    if (mtWeek === 'all') return;
    const maxWeek = MONTH_WEEKS_COUNT[mtMonth] || 5;
    if (mtWeek > maxWeek) setMtWeek(maxWeek);
  }, [mtMonth, mtWeek]);

  // Same dual-track resolution as dashboard/report/page.tsx's own
  // checkTaskInPeriod: an active Tuần shortcut always means the REAL
  // calendar week around today (not the fiscal week-of-month bucket a
  // manual pick would resolve to); an active Tháng shortcut (or a manual
  // "Cả tháng") means the whole calendar month, no week narrowing at all;
  // anything else (a manual Year/Month/Week pick) uses the fiscal bucket.
  const meetingDateRange = useMemo(() => {
    const now = new Date();
    let range: { monday: Date; sunday: Date } | null = null;
    if (activeMeetingQuickFilter === 'Tuần này') range = getMondayToSundayRange(now);
    else if (activeMeetingQuickFilter === 'Tuần trước') range = getPrevWeekRange(now);
    else if (activeMeetingQuickFilter === 'Tuần tới') range = getNextWeekRange(now);
    else if (mtWeek !== 'all') range = getWeekDateRange(mtWeek, mtMonth, mtYear);

    if (range) return { from: toApiDate(range.monday), to: toApiDate(range.sunday) };

    // Whole month — Tháng trước/này/tới, or "Cả tháng" picked manually.
    const firstDay = new Date(mtYear, mtMonth - 1, 1);
    const lastDay = new Date(mtYear, mtMonth, 0);
    return { from: toApiDate(firstDay), to: toApiDate(lastDay) };
  }, [activeMeetingQuickFilter, mtWeek, mtMonth, mtYear]);

  // Exact same structure as dashboard/report/page.tsx's own
  // applyQuickFilter(type) — each shortcut jumps to a FIXED period relative
  // to today's real date (not a stateful pager off the currently-displayed
  // period), matching report's actual behavior 1:1. Year/Month/Week are set
  // here purely for the dropdowns' display; the real filtering for an
  // active Tuần shortcut bypasses them (see meetingDateRange above).
  const applyMeetingQuickFilter = (type: 'Tuần trước' | 'Tuần này' | 'Tuần tới' | 'Tháng trước' | 'Tháng này' | 'Tháng tới') => {
    setActiveMeetingQuickFilter(type);
    const now = new Date();
    if (type === 'Tuần trước') {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setMtYear(d.getFullYear()); setMtMonth(d.getMonth() + 1); setMtWeek(getWeekOfMonth(d));
    } else if (type === 'Tuần này') {
      setMtYear(now.getFullYear()); setMtMonth(now.getMonth() + 1); setMtWeek(getWeekOfMonth(now));
    } else if (type === 'Tuần tới') {
      const d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      setMtYear(d.getFullYear()); setMtMonth(d.getMonth() + 1); setMtWeek(getWeekOfMonth(d));
    } else if (type === 'Tháng trước') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      setMtYear(d.getFullYear()); setMtMonth(d.getMonth() + 1); setMtWeek('all');
    } else if (type === 'Tháng này') {
      setMtYear(now.getFullYear()); setMtMonth(now.getMonth() + 1); setMtWeek('all');
    } else if (type === 'Tháng tới') {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      setMtYear(d.getFullYear()); setMtMonth(d.getMonth() + 1); setMtWeek('all');
    }
  };

  // Pagination resets to page 1 whenever the range actually changes (chốt
  // §5/TEST 6) — mirrors the existing "new meeting created" reset already
  // done elsewhere in this file (setCurrentPage(1) after create).
  useEffect(() => {
    setCurrentPage(1);
  }, [meetingDateRange.from, meetingDateRange.to]);

  // Same reset, for the local table filters (search/project/person/platform/
  // quick-filter) — without it, changing a filter while on page 2+ could
  // leave currentPage pointing past the end of the newly-filtered result set,
  // or just silently showing a slice of the wrong page instead of page 1.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, projectFilter, personFilter, platformFilter, quickFilter]);

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
    setCanCreate(isAdmin() || getRole() === 'member');
  }, []);

  const { data: meetingsData, isLoading, refetch: fetchMeetings } = useQuery({
    queryKey: ['meetings', workspaceCode],
    queryFn: async () => {
      const data = await getMeetings({ workspace: workspaceCode || undefined });
      if (data && data.success && Array.isArray(data.data)) return data.data;
      if (Array.isArray(data)) return data;
      return [];
    },
    staleTime: 2 * 60_000,
  });
  const meetings: any[] = meetingsData || [];

  // "Danh sách cuộc họp" view's own dataset, scoped to the Global Time
  // Filter's dateRange (chốt 2026-09-20) — deliberately a SEPARATE query
  // from `meetings` above rather than adding from_date/to_date onto it:
  // `meetings` (unrestricted) still backs Calendar Team's week grid (its own
  // weekOffset can browse ANY week, not just the one selected here) and the
  // URL "?id=" deep-link lookup further down, and must keep seeing every
  // meeting regardless of this filter — untouched business logic (chốt §13).
  const { data: listMeetingsData, isLoading: isListMeetingsLoading, refetch: fetchListMeetings } = useQuery({
    queryKey: ['meetings', workspaceCode, 'range', meetingDateRange.from, meetingDateRange.to],
    queryFn: async () => {
      const data = await getMeetings({ workspace: workspaceCode || undefined, from_date: meetingDateRange.from, to_date: meetingDateRange.to });
      if (data && data.success && Array.isArray(data.data)) return data.data;
      if (Array.isArray(data)) return data;
      return [];
    },
    enabled: activeTab === 'list',
    staleTime: 2 * 60_000,
  });
  const listMeetings: any[] = listMeetingsData || [];

  const { data: myMeetingsData, isLoading: isMyMeetingsLoading, refetch: fetchMyMeetings } = useQuery({
    queryKey: ['meetings', 'mine', workspaceCode],
    queryFn: async () => {
      const data = await getMeetings({ mine: true, workspace: workspaceCode || undefined });
      if (data && data.success && Array.isArray(data.data)) return data.data;
      if (Array.isArray(data)) return data;
      return [];
    },
    enabled: activeTab === 'personal',
    staleTime: 2 * 60_000,
  });
  const myMeetings: any[] = myMeetingsData || [];

  const { data: insightsData, refetch: refetchMeetingInsights } = useQuery({
    queryKey: ['meeting-insights', workspaceCode, meetingDateRange.from, meetingDateRange.to],
    queryFn: async () => {
      const data = await getMeetingInsights({ workspace: workspaceCode || undefined, from_date: meetingDateRange.from, to_date: meetingDateRange.to });
      return data?.data || null;
    },
    enabled: activeTab === 'list',
    staleTime: 2 * 60_000,
  });

  const overloadedNames = useMemo(() => {
    const names = new Set<string>();
    (insightsData?.top_people || []).forEach((p: any) => { if (p.hours > 8) names.add(p.name); });
    return names;
  }, [insightsData]);

  const { data: attendanceSummaryData, refetch: refetchAttendanceSummary } = useQuery({
    queryKey: ['meeting-attendance-summary', workspaceCode, projectFilter, meetingDateRange.from, meetingDateRange.to],
    queryFn: async () => {
      const data = await getMeetingAttendanceSummary({
        workspace: workspaceCode || undefined,
        project: projectFilter !== 'All' ? projectFilter : undefined,
        from_date: meetingDateRange.from,
        to_date: meetingDateRange.to,
      });
      return Array.isArray(data?.data) ? data.data : [];
    },
    staleTime: 2 * 60_000,
  });
  const attendanceByMemberId = useMemo(() => {
    const map = new Map<number, any>();
    (attendanceSummaryData || []).forEach((s: any) => map.set(s.member_id, s));
    return map;
  }, [attendanceSummaryData]);

  const [attendanceDrawerMember, setAttendanceDrawerMember] = useState<any>(null);

  // Global Time Filter's ↻ — refetches exactly the 3 queries this view's
  // data depends on, current dateRange unchanged (chốt §8: never resets
  // filter, tab, search, or the other local filters).
  const handleRefreshMeetingRange = async () => {
    setIsRefreshingMeetingRange(true);
    try {
      await Promise.all([fetchListMeetings(), refetchMeetingInsights(), refetchAttendanceSummary()]);
    } finally {
      setIsRefreshingMeetingRange(false);
    }
  };

  // Switching Workspace changes which projects/people/platforms even exist in
  // `meetings` — a project/person/platform filter picked under the old
  // Workspace almost never matches anything in the new one, which used to
  // just silently show an empty table with no clue why. Reset those (and the
  // page) back to "All" whenever the Workspace changes; free-text search and
  // month aren't tied to a specific Workspace's option list, so they're left
  // alone.
  const isFirstWorkspaceRender = useRef(true);
  useEffect(() => {
    if (isFirstWorkspaceRender.current) {
      isFirstWorkspaceRender.current = false;
      return;
    }
    setProjectFilter('All');
    setPersonFilter('All');
    setPlatformFilter('All');
    setCurrentPage(1);
  }, [workspaceCode]);

  // Google OAuth callback lands here with google_connected=true|false (+
  // google_error=invalid_state when the one-time state was missing/expired/
  // reused or the user isn't Super Admin). Show the outcome once, then strip
  // those params so a reload doesn't re-trigger it.
  useEffect(() => {
    const connected = searchParams.get('google_connected');
    if (connected === null) return;
    const googleError = searchParams.get('google_error');
    if (connected === 'true') {
      setToastMessage('Đã kết nối tài khoản Google thành công.');
      setTimeout(() => setToastMessage(null), 4000);
    } else {
      setGoogleCallbackError(
        googleError === 'invalid_state'
          ? 'Kết nối Google thất bại: phiên kết nối không hợp lệ hoặc đã hết hạn. Vui lòng thử lại từ Cấu hình AI & Google.'
          : `Kết nối Google thất bại${googleError ? ` (${googleError})` : ''}. Vui lòng thử lại từ Cấu hình AI & Google.`
      );
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete('google_connected');
    params.delete('google_error');
    const qs = params.toString();
    router.replace(`/meetings${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [searchParams, router]);

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
  const getMeetingProjects = (m: any): { id?: number; name: string }[] => {
    if (Array.isArray(m.projects) && m.projects.length) {
      return m.projects.map((p: any) => ({ id: p.id, name: p.name })).filter((p: any) => p.name);
    }
    const single = typeof m.project === 'string' ? m.project : (m.project?.name || m.project_name || '');
    return single ? [{ id: m.project_id, name: single }] : [];
  };
  const getMeetingProjectNames = (m: any): string[] => getMeetingProjects(m).map(p => p.name);

  const getMeetingParticipants = (m: any): { key: string; name: string }[] => {
    const list = Array.isArray(m.members) ? m.members : [];
    return list
      .map((mm: any, idx: number) => ({
        key: String(mm.member_id ?? mm.id ?? `${mm.display_name || 'nv'}-${idx}`),
        name: mm.display_name || mm.full_name || '',
      }))
      .filter((p: any) => p.name);
  };

  // Sourced from listMeetings (the range-scoped dataset), not the
  // unrestricted `meetings` — a Project/Person/Platform with zero meetings
  // in the selected week shouldn't appear as a filter option (chốt §5,
  // "Theo nhân sự"/"Theo dự án" must recompute from the same dateRange).
  const projectOptions = useMemo(() => {
    const names = new Set<string>();
    listMeetings.forEach(m => getMeetingProjectNames(m).forEach(p => names.add(p)));
    return Array.from(names).sort();
  }, [listMeetings]);

  const personOptions = useMemo(() => {
    const names = new Set<string>();
    listMeetings.forEach(m => (m.members || []).forEach((mm: any) => { if (mm.display_name) names.add(mm.display_name); }));
    return Array.from(names).sort();
  }, [listMeetings]);

  const platformOptions = useMemo(() => {
    const names = new Set<string>();
    listMeetings.forEach(m => { if (m.platform) names.add(m.platform); });
    return Array.from(names).sort();
  }, [listMeetings]);

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

  // Local filters (search/project/person/platform/quick) run ON TOP of
  // listMeetings, which is already restricted to the Global Time Filter's
  // dateRange — matching chốt §9/§11's required flow (global range →
  // dataset → local filters → result), never the other way around.
  const filteredMeetings = useMemo(() => {
    return (listMeetings || []).filter(m => {
      if (!m) return false;
      const title = String(m.title || '');
      const projectNames = getMeetingProjectNames(m);
      const matchesSearch = title.toLowerCase().includes(searchTerm.toLowerCase()) || projectNames.some(p => p.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesPlatform = platformFilter === 'All' || m.platform === platformFilter;
      const matchesProject = projectFilter === 'All' || projectNames.includes(projectFilter);
      const matchesPerson = personFilter === 'All' || (m.members || []).some((mm: any) => mm.display_name === personFilter);
      return matchesSearch && matchesPlatform && matchesProject && matchesPerson && meetingMatchesQuickFilter(m, quickFilter);
    });
  }, [listMeetings, searchTerm, platformFilter, projectFilter, personFilter, quickFilter, overloadedNames]);

  const totalPages = Math.ceil(filteredMeetings.length / pageSize) || 1;
  // Belt-and-suspenders beyond the filter-change reset above — covers any
  // other way the result set can shrink out from under the current page
  // (e.g. a meeting getting deleted/refetched away) without currentPage
  // itself changing.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);
  const paginatedMeetings = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMeetings.slice(start, start + pageSize);
  }, [filteredMeetings, currentPage, pageSize]);

  // "Tải họp theo dự án" / "Nhân sự theo giờ họp" must track the currently
  // applied search/project/person/platform/month/quick filters — insightsData
  // comes from a separate backend aggregate over ALL of the caller's meetings
  // (date-range only) and doesn't know about these table filters, so it was
  // showing company-wide numbers no matter what the table below was filtered
  // to. Recomputed here from filteredMeetings instead so both stay in sync.
  // (overloadedNames intentionally keeps using the unfiltered insightsData —
  // "quá tải" is a real, absolute signal about a person's total load, not
  // something that should change depending on today's search text.)
  const filteredProjectLoad = useMemo(() => {
    const hoursByProject = new Map<string, number>();
    filteredMeetings.forEach(m => {
      const h = typeof m.duration === 'number' ? m.duration / 60 : 1;
      Array.from(new Set(getMeetingProjectNames(m))).forEach(name => {
        hoursByProject.set(name, (hoursByProject.get(name) || 0) + h);
      });
    });
    return Array.from(hoursByProject.entries())
      .map(([name, hours]) => ({ name, hours: Math.round(hours * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours);
  }, [filteredMeetings]);

  const filteredTopPeople = useMemo(() => {
    const hoursByName = new Map<string, number>();
    const meetingsByName = new Map<string, number>();
    // member_id per name (chốt 2026-09-15, attendance join) — a free-text
    // custom_members guest has no real member_id, so this stays undefined
    // for them and the attendance lookup below just finds nothing, same as
    // a real member with zero recorded attendance.
    const memberIdByName = new Map<string, number | undefined>();
    filteredMeetings.forEach(m => {
      const h = typeof m.duration === 'number' ? m.duration / 60 : 1;
      getMeetingParticipants(m).forEach(p => {
        hoursByName.set(p.name, (hoursByName.get(p.name) || 0) + h);
        meetingsByName.set(p.name, (meetingsByName.get(p.name) || 0) + 1);
        if (!memberIdByName.has(p.name) && /^\d+$/.test(p.key)) memberIdByName.set(p.name, Number(p.key));
      });
    });
    return Array.from(hoursByName.entries())
      .map(([name, hours]) => ({ name, hours: Math.round(hours * 10) / 10, meetings: meetingsByName.get(name) || 0, memberId: memberIdByName.get(name) }))
      .sort((a, b) => b.hours - a.hours);
  }, [filteredMeetings]);

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
        // An explicit success: false must reach CreateMeetingModal's own
        // catch (it shows the error and keeps the modal open) instead of
        // falling through here as if the save had gone through.
        if (!data.success) {
          throw new Error(data?.message || data?.detail || 'Lỗi khi cập nhật cuộc họp');
        }
        savedObj = data.data;
      } else {
        const data = await createMeeting(meetingData);
        if (!data.success) {
          throw new Error(data?.message || data?.detail || 'Lỗi khi tạo cuộc họp');
        }
        savedObj = data.data;
        // Thành viên chọn lúc tạo được thêm bằng API riêng (endpoint tạo
        // meeting không nhận members) — xong thì lấy lại bản mới nhất để
        // có danh sách members thật thay vì chỉ có Host.
        const memberIds: number[] = Array.isArray(meetingData.member_ids) ? meetingData.member_ids : [];
        if (memberIds.length > 0) {
          // Sequential, not Promise.all — these all hit the same meeting's
          // Calendar-attendee sync server-side, and firing them in parallel
          // lets that sync race on a partial member set. Failures are
          // collected (by ID) and reported instead of being swallowed.
          const failedIds: number[] = [];
          for (const mid of memberIds) {
            try {
              await addMeetingMember(savedObj.id, mid);
            } catch {
              failedIds.push(mid);
            }
          }
          const refreshed = await getMeeting(savedObj.id).catch(() => null);
          if (refreshed?.success) savedObj = refreshed.data;
          if (failedIds.length > 0) {
            // meetingData only carries member IDs here (no names) — report by
            // ID rather than silently dropping the failure like before.
            setToastMessage(`⚠ Cuộc họp đã tạo, nhưng không thể thêm ${failedIds.length} thành viên (ID: ${failedIds.join(', ')}).`);
            setTimeout(() => setToastMessage(null), 6000);
          }
        }
        // Meeting mới luôn được chèn lên đầu mảng — nếu đang xem trang khác
        // trang 1 thì quay lại trang 1 để thấy ngay, tránh cảm giác "biến mất".
        setCurrentPage(1);
      }
      // Refetch instead of queryClient.setQueryData(['meetings'], ...) — the
      // real query key is ['meetings', workspaceCode] (and ['meetings',
      // 'mine', workspaceCode] for the personal tab), so patching the bare
      // ['meetings'] key was writing to a cache entry nothing reads from;
      // the visible list never updated until a full page reload re-fetched
      // under the correct key.
      if (savedObj) {
        await Promise.all([fetchMeetings(), fetchMyMeetings()]);
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
    if (!deleteConfirmId || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteMeeting(parseInt(deleteConfirmId));
      await Promise.all([fetchMeetings(), fetchMyMeetings()]);
      setDeleteConfirmId(null);
      setToastMessage('✓ Đã xóa cuộc họp thành công!');
      setTimeout(() => setToastMessage(null), 3000);
    } catch (error: any) {
      console.error("Failed to delete meeting", error);
      alert(error.response?.data?.detail || "Có lỗi xảy ra khi xóa cuộc họp");
    } finally {
      setIsDeleting(false);
    }
  };

  // Stats — scoped to the meetings actually visible on the active tab: the
  // search/project/person/platform/month/quick filters on Danh sách cuộc họp,
  // "my meetings" on Calendar cá nhân, and the full team list on Calendar
  // Team (which has no filter UI of its own).
  const statsMeetings = activeTab === 'personal' ? myMeetings : activeTab === 'list' ? filteredMeetings : meetings;
  const totalMeetings = statsMeetings.length;
  const doneMeetings = statsMeetings.filter(m => String(m.status || '').toUpperCase() === 'ĐÃ KẾT THÚC' || String(m.status || '').toUpperCase() === 'ĐÃ DIỄN RA' || String(m.status || '').toUpperCase() === 'DONE' || String(m.status || '').toUpperCase() === 'COMPLETED' || Boolean(m.executive_summary)).length;
  const upcomingMeetings = statsMeetings.filter(m => String(m.status || '').toUpperCase() === 'UPCOMING' || String(m.status || '').toUpperCase() === 'SẮP TỚI').length;
  const totalTasksPushed = statsMeetings.reduce((acc, m) => acc + (Array.isArray(m.recommended_tasks) ? m.recommended_tasks.length : (m.ai_summary ? 3 : 0)), 0);

  const totalHours = statsMeetings.reduce((sum, m) => sum + (typeof m.duration === 'number' ? m.duration / 60 : 1), 0);
  const uniquePeopleCount = new Set(statsMeetings.flatMap(m => (m.members || []).map((mm: any) => mm.display_name))).size;
  const avgHoursPerPerson = uniquePeopleCount > 0 ? totalHours / uniquePeopleCount : 0;

  const allRecommendedTasks = statsMeetings.flatMap(m => (m.recommended_tasks || m.ai_summary?.recommended_tasks || []) as any[]);
  const syncedTasksCount = allRecommendedTasks.filter(t => t.imported_task_id).length;
  const kpiTaskSyncPct = allRecommendedTasks.length > 0 ? Math.round((syncedTasksCount / allRecommendedTasks.length) * 100) : 100;

  const meetingsWithFollowthrough = statsMeetings.filter(m => m.score_followthrough !== null && m.score_followthrough !== undefined);
  const avgFollowthroughPct = meetingsWithFollowthrough.length > 0
    ? Math.round((meetingsWithFollowthrough.reduce((s, m) => s + (m.score_followthrough || 0), 0) / (meetingsWithFollowthrough.length * 20)) * 100)
    : 0;

  const meetingsWithScore = statsMeetings.filter(m => m.score_total !== null && m.score_total !== undefined);
  const overallQualityScore = meetingsWithScore.length > 0
    ? Math.round(meetingsWithScore.reduce((s, m) => s + m.score_total, 0) / meetingsWithScore.length)
    : 0;
  const pctPrepared = statsMeetings.length > 0
    ? Math.round((statsMeetings.filter(m => m.objective && m.agenda).length / statsMeetings.length) * 100)
    : 0;
  const meetingsWithExecution = statsMeetings.filter(m => m.score_execution !== null && m.score_execution !== undefined);
  const pctOnTime = meetingsWithExecution.length > 0
    ? Math.round((meetingsWithExecution.reduce((s, m) => s + m.score_execution, 0) / (meetingsWithExecution.length * 15)) * 100)
    : 0;
  const pctValidActions = allRecommendedTasks.length > 0
    ? Math.round((allRecommendedTasks.filter(t => t.assigned_name && t.deadline).length / allRecommendedTasks.length) * 100)
    : 0;

  const matchesDay = (m: any, d: { isoDate: string; formattedDate: string; yearNum: number }) => {
    if (!m || !m.date) return false;
    const dateStr = String(m.date).trim();
    if (dateStr.startsWith(d.isoDate)) return true;
    const fullFormattedDate = `${d.formattedDate}/${d.yearNum}`;
    if (dateStr === fullFormattedDate || dateStr.startsWith(fullFormattedDate)) return true;
    if (dateStr === d.formattedDate) return true;
    return false;
  };

  // Per-day card list — every card always shows all 3 required fields (tên
  // cuộc họp + dự án + người tham gia) regardless of how many meetings land
  // on the same day/time, unlike a fixed-height hour-grid which has to hide
  // fields on short/crowded slots.
  const renderWeekGrid = (weekMeetings: any[], emptyText: string) => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 pt-2">
        {currentWeekInfo.days.map(d => {
          const dayMeetings = weekMeetings
            .filter(m => matchesDay(m, d))
            .sort((a, b) => parseTimeToMinutes(a.time || a.start_time) - parseTimeToMinutes(b.time || b.start_time));

          return (
            <div key={d.isoDate} className={`border rounded-2xl p-3.5 min-h-[200px] ${d.isWeekend ? 'bg-slate-50/70 border-slate-200' : 'bg-white border-[#e2e8f0]'}`}>
              <h4 className="text-[13px] font-extrabold text-[#0b1c30] mb-3">{d.label}</h4>
              {dayMeetings.length > 0 ? (
                dayMeetings.map(item => {
                  const projects = getMeetingProjects(item);
                  const participants = getMeetingParticipants(item);
                  const color = getProjectColor(projects[0]?.id, projects[0]?.name);

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleCalendarMeetingClick(item)}
                      className={`${color.bg} border-l-4 ${color.barBorder} rounded-xl p-3 mb-3 cursor-pointer hover:shadow-md transition-all space-y-1.5`}
                    >
                      <p className="text-xs font-bold text-[#0b1c30] leading-snug">
                        {item.time || item.start_time || '--:--'} {item.title}
                      </p>

                      {projects.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {projects.map((p, idx) => {
                            const pc = getProjectColor(p.id, p.name);
                            return (
                              <span key={idx} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pc.badgeBg} ${pc.badgeText}`}>
                                {p.name}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {participants.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <div className="flex -space-x-1.5">
                            {participants.slice(0, 4).map(p => (
                              <div key={p.key} className="h-5 w-5 rounded-full ring-2 ring-white bg-[#0058be] flex items-center justify-center text-[8px] font-bold text-white" title={p.name}>
                                {getInitials(p.name)}
                              </div>
                            ))}
                            {participants.length > 4 && (
                              <div className="h-5 w-5 rounded-full ring-2 ring-white bg-slate-300 flex items-center justify-center text-[8px] font-bold text-slate-700">
                                +{participants.length - 4}
                              </div>
                            )}
                          </div>
                          <span className="text-[10px] text-[#64748b] font-medium truncate">
                            {participants.length === 1 ? participants[0].name : `${participants.length} người tham gia`}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="border border-dashed border-[#e2e8f0] rounded-xl p-4 text-center text-[12px] text-[#94a3b8] mt-2">
                  {emptyText}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Project color legend */}
      {(() => {
        const legend = new Map<string, { name: string; dot: string }>();
        weekMeetings.forEach(m => getMeetingProjects(m).forEach(p => {
          const k = String(p.id ?? p.name);
          if (!legend.has(k)) legend.set(k, { name: p.name, dot: getProjectColor(p.id, p.name).dot });
        }));
        if (legend.size === 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
            {Array.from(legend.values()).map(l => (
              <span key={l.name} className="flex items-center gap-1.5 text-[11px] font-semibold text-[#64748b]">
                <span className={`w-2 h-2 rounded-full ${l.dot}`} />
                {l.name}
              </span>
            ))}
          </div>
        );
      })()}
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

      {/* Google OAuth callback failure (google_connected=false) */}
      {googleCallbackError && (
        <div role="alert" className="fixed top-5 right-5 z-[100] max-w-md bg-red-50 text-red-700 px-4 py-3 rounded-2xl shadow-2xl flex items-start gap-2 text-xs font-bold border border-red-200 animate-in fade-in slide-in-from-top-3 duration-200">
          <Info size={18} className="text-red-500 shrink-0 mt-0.5" />
          <span className="flex-1">{googleCallbackError}</span>
          <button type="button" onClick={() => setGoogleCallbackError(null)} aria-label="Đóng" className="text-red-400 hover:text-red-600 shrink-0">✕</button>
        </div>
      )}

      <div className={`flex-1 min-w-0 pl-0 ${sidebarCollapsed ? SIDEBAR_PAD_COLLAPSED : SIDEBAR_PAD_EXPANDED} pt-14 md:pt-0 flex flex-col h-screen overflow-hidden transition-[padding] duration-200`}>

        {/* Top Header Bar */}
        <div className="min-h-[56px] bg-white border-b border-[#e2e8f0] flex flex-wrap items-center justify-between gap-2 px-4 md:px-8 py-2 md:py-0 shrink-0 z-30">
          <div className="flex items-center gap-3">
            <CalendarIcon className="text-[#0058be]" size={20} />
            <h1 className="text-base font-extrabold text-[#0b1c30]">Quản lý Meetings</h1>
            <button
              type="button"
              onClick={() => setIsGuideOpen(true)}
              className="flex items-center gap-1 text-[11px] font-bold text-[#64748b] hover:text-[#0058be] transition-colors"
            >
              <Info size={13} />
              <span>Hướng dẫn sử dụng</span>
            </button>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {canManage && (
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-[#cbd5e1] text-[#475569] text-xs font-bold px-3.5 py-2 rounded-xl transition-colors shadow-2xs whitespace-nowrap"
              >
                <Sparkles size={15} className="text-[#0058be]" />
                <span>Cấu hình AI & Google Admin</span>
              </button>
            )}
            {canCreate && (
              <button
                onClick={() => { setEditingMeeting(null); setIsModalOpen(true); }}
                className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm whitespace-nowrap"
              >
                <span className="text-base font-normal leading-none">+</span>
                <span>Tạo meeting</span>
              </button>
            )}
          </div>
        </div>

        {/* Main Content Scroll Container */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 space-y-6">
          
          {/* Navigation Tabs Bar (Danh sách cuộc họp | Calendar Team) */}
          <div className="flex items-center gap-8 border-b border-[#e2e8f0] pb-2 text-xs font-bold">
            <button
              onClick={() => handleTabSwitch('list')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'list' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#64748b] hover:text-[#0b1c30]'}`}
            >
              Danh sách cuộc họp
            </button>
            <button
              onClick={() => handleTabSwitch('calendar')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'calendar' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#64748b] hover:text-[#0b1c30]'}`}
            >
              Calendar Team
            </button>
            <button
              onClick={() => handleTabSwitch('personal')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'personal' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#64748b] hover:text-[#0b1c30]'}`}
            >
              Calendar cá nhân
            </button>
          </div>

          {/* Secondary scroll-nav + Global Time Filter, one toolbar (chốt
              2026-09-20 §1): nav stays a single line (shrink-0, no internal
              wrap) and the filter is what drops to its own row on a narrow
              viewport, never the other way around. */}
          {activeTab === 'list' && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <nav className="flex items-center gap-1 shrink-0">
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
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-[#64748b] hover:bg-[#eff4ff] hover:text-[#0058be] transition-colors whitespace-nowrap"
                  >
                    {t.label}
                  </button>
                ))}
              </nav>

              {/* Global Time Filter — single dateRange source of truth for
                  every section above (chốt §1-§5). No label on desktop, no
                  separate card — just another control group in this toolbar. */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="flex items-center gap-1.5 h-9 bg-white border border-slate-200 rounded-lg px-2 shadow-2xs text-[11px] font-bold">
                  <select
                    value={mtYear}
                    onChange={e => { setMtYear(Number(e.target.value)); setActiveMeetingQuickFilter(null); }}
                    className="bg-transparent border-none text-[#0058be] font-bold focus:outline-none cursor-pointer"
                  >
                    {[...Array(5)].map((_, i) => {
                      const y = new Date().getFullYear() - 2 + i;
                      return <option key={y} value={y}>{y}</option>;
                    })}
                  </select>
                  <span className="w-px h-4 bg-slate-200" />
                  <select
                    value={mtMonth}
                    onChange={e => { setMtMonth(Number(e.target.value)); setActiveMeetingQuickFilter(null); }}
                    className="bg-transparent border-none text-[#0058be] font-bold focus:outline-none cursor-pointer"
                  >
                    {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>Th.{i + 1}</option>)}
                  </select>
                  <span className="w-px h-4 bg-slate-200" />
                  <select
                    value={mtWeek}
                    onChange={e => { const v = e.target.value; setMtWeek(v === 'all' ? 'all' : Number(v)); setActiveMeetingQuickFilter(null); }}
                    className="bg-transparent border-none text-[#0058be] font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="all">Cả tháng</option>
                    {[...Array(MONTH_WEEKS_COUNT[mtMonth] || 5)].map((_, i) => <option key={i + 1} value={i + 1}>Tuần {i + 1}</option>)}
                  </select>
                </div>

                {/* Tuần trước/này/tới + Tháng trước/này/tới — same
                    applyQuickFilter(type) structure dashboard/report/page.tsx
                    uses: each jumps to a FIXED period relative to today's
                    real date (real calendar week for Tuần*, whole calendar
                    month for Tháng*), not a stateful pager. */}
                <div className="flex items-center gap-1 flex-wrap">
                  {(['Tuần trước', 'Tuần này', 'Tuần tới', 'Tháng trước', 'Tháng này', 'Tháng tới'] as const).map(label => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => applyMeetingQuickFilter(label)}
                      className={`px-2.5 py-1.5 h-9 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap border ${
                        activeMeetingQuickFilter === label
                          ? 'bg-[#0058be] text-white border-[#0058be] shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-[#eff4ff] hover:text-[#0058be] hover:border-[#bcd6f5]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleRefreshMeetingRange}
                  className="flex items-center gap-1.5 h-9 px-3 bg-white border border-slate-200 rounded-lg shadow-2xs text-slate-600 text-[11px] font-bold hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  <span className={isRefreshingMeetingRange ? 'inline-block animate-spin text-[#0058be]' : ''}>↻</span>
                  <span>Làm mới</span>
                </button>
              </div>
            </div>
          )}

          {/* KPI Grid */}
          <div ref={overviewSectionRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard label="Tổng cuộc họp" value={totalMeetings} icon="chart" border="border-l-[#0058be]" text="text-[#0058be]" trend={`${totalTasksPushed} task đã push`} />
            <KpiCard label="Tổng giờ họp" value={`${totalHours.toFixed(1)}h`} icon="clock" border="border-l-amber-500" text="text-amber-600" trend={`${upcomingMeetings} lịch sắp tới`} />
            <KpiCard label="Bình quân / người" value={`${avgHoursPerPerson.toFixed(1)}h`} icon="user" border="border-l-[#5aa1ed]" text="text-[#2563eb]" trend={`${uniquePeopleCount} người tham gia`} />
            <KpiCard label="Task đã vào KPI dự án" value={`${kpiTaskSyncPct}%`} icon="check" border="border-l-emerald-500" text="text-emerald-600" trend={`${syncedTasksCount}/${allRecommendedTasks.length} task đã đồng bộ`} />
            <KpiCard label="Điểm Thực thi trung bình" value={`${avgFollowthroughPct}%`} icon="tasks" border="border-l-[#07966d]" text="text-[#07966d]" trend={`${doneMeetings} cuộc họp đã diễn ra`} />
          </div>

          {/* TAB 1: DANH SÁCH CUỘC HỌP */}
          {activeTab === 'list' && (
            <div className="space-y-5">
              <ScoreModelExplainer />
              <MeetingPlaybook />

              {/* Chart + Alerts */}
              <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
                <BarChartCard
                  title="Xu hướng thời lượng họp theo dự án vs nội bộ (7 ngày)"
                  data={insightsData?.weekly_series || []}
                  bars={[{ key: 'project', name: 'Theo dự án', fill: '#0058be' }, { key: 'internal', name: 'Nội bộ / vận hành', fill: '#c7d2e0' }]}
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

              <div className="flex flex-col gap-3 bg-white p-3.5 rounded-2xl border border-[#e2e8f0] shadow-2xs">
                <div className="flex flex-col lg:flex-row gap-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3.5 top-3 text-[#94a3b8]" />
                    <input
                      type="text"
                      placeholder="Tìm cuộc họp, dự án, người tham gia..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#0058be] transition-all text-[#0b1c30]"
                    />
                  </div>
                  <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#0058be] min-w-[150px] text-[#0b1c30] font-medium">
                    <option value="All">Tất cả dự án</option>
                    {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={personFilter} onChange={e => setPersonFilter(e.target.value)} className="px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#0058be] min-w-[150px] text-[#0b1c30] font-medium">
                    <option value="All">Tất cả nhân sự</option>
                    {personOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)} className="px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs focus:outline-none focus:border-[#0058be] min-w-[130px] text-[#0b1c30] font-medium">
                    <option value="All">Tất cả nền tảng</option>
                    {platformOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
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
                        quickFilter === chip.key ? 'border-[#bcd6f5] bg-[#eff4ff] text-[#0058be]' : 'border-[#dfe5ed] bg-[#f8fafc] text-[#52627a] hover:border-[#bcd6f5]'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                  {(quickFilter || projectFilter !== 'All' || personFilter !== 'All' || platformFilter !== 'All' || searchTerm) && (
                    <button
                      onClick={() => { setQuickFilter(''); setProjectFilter('All'); setPersonFilter('All'); setPlatformFilter('All'); setSearchTerm(''); }}
                      className="ml-auto text-[11px] font-bold text-[#0058be] hover:underline"
                    >
                      Đặt lại bộ lọc
                    </button>
                  )}
                </div>
              </div>

              <div ref={tableSectionRef} className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs overflow-hidden">
                {isListMeetingsLoading ? (
                  <div className="text-center py-16 text-[#64748b] text-xs">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" />
                      <span>Đang tải danh sách cuộc họp...</span>
                    </div>
                  </div>
                ) : filteredMeetings.length === 0 ? (
                  <div className="text-center py-16 p-8 space-y-2">
                    <div className="w-12 h-12 bg-[#eff4ff] text-[#0058be] rounded-2xl flex items-center justify-center mx-auto mb-3">
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
                                  <div className="w-8 h-8 rounded-lg bg-[#eff4ff] text-[#0058be] flex items-center justify-center font-extrabold shrink-0">▣</div>
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
                                  statusUpper.includes('DIỄN RA') || statusUpper === 'ĐÃ KẾT THÚC' || statusUpper === 'DONE' ? 'bg-[#e2f7ec] text-[#18724f]'
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
                                  {m.can_manage && isMeetingDeletable(statusUpper) && (
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
                                    className="border border-[#d7dfeb] bg-white rounded-lg h-7 px-2.5 text-[#506078] text-[10px] font-bold hover:border-[#0058be] hover:text-[#0058be] transition-colors whitespace-nowrap"
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
                    Hiển thị {filteredMeetings.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{(currentPage - 1) * pageSize + paginatedMeetings.length} của {filteredMeetings.length} cuộc họp
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
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${currentPage === page ? 'bg-[#eff4ff] text-[#0058be] border border-[#bcd6f5]' : 'hover:bg-slate-50 text-[#64748b]'}`}
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
                  {filteredProjectLoad.length === 0 ? (
                    <p className="text-[11px] text-[#94a3b8]">Chưa có dữ liệu.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredProjectLoad.slice(0, 6).map((p: any) => {
                        const max = filteredProjectLoad[0]?.hours || 1;
                        return (
                          <div key={p.name} className="grid grid-cols-[1fr_2fr_44px] items-center gap-2.5">
                            <span className="text-[11px] text-[#52627a] truncate">{p.name}</span>
                            <ProgressBar value={(p.hours / max) * 100} showLabel={false} color="bg-[#0058be]" />
                            <span className="text-[11px] font-bold text-right">{p.hours}h</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs p-4">
                  <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-3">Nhân sự &amp; Tham gia</h3>
                  {filteredTopPeople.length === 0 ? (
                    <p className="text-[11px] text-[#94a3b8]">Chưa có dữ liệu.</p>
                  ) : (
                    <>
                      <div className={`space-y-2 ${showAllPeople ? 'max-h-[320px] overflow-y-auto pr-1 custom-scrollbar' : ''}`}>
                        {filteredTopPeople.slice(0, showAllPeople ? undefined : 5).map((p: any) => {
                          // Attendance is supplementary info, not the card's
                          // sort criterion (chốt 2026-09-15) — hours/meetings
                          // above are unchanged; undefined (no summary entry
                          // at all) means never recorded, which must read
                          // differently from a real recorded zero.
                          const att = p.memberId != null ? attendanceByMemberId.get(p.memberId) : undefined;
                          return (
                            <div key={p.name} className="py-1.5 border-b border-[#edf1f6] last:border-0">
                              <div className="flex items-center justify-between">
                                <button
                                  type="button"
                                  onClick={() => p.memberId != null && setAttendanceDrawerMember({ member_id: p.memberId, display_name: p.name, hours: p.hours, meetings: p.meetings })}
                                  disabled={p.memberId == null}
                                  className={`text-[11px] font-bold text-left ${p.memberId != null ? 'text-[#0b1c30] hover:text-[#0058be] hover:underline' : 'text-[#0b1c30] cursor-default'}`}
                                >
                                  {p.name}
                                </button>
                                <span className={`text-xs font-extrabold ${p.hours > 8 ? 'text-red-600' : p.hours > 6 ? 'text-amber-600' : 'text-[#0b1c30]'}`}>{p.hours}h</span>
                              </div>
                              <p className="text-[10px] text-[#8492a6]">{p.meetings} cuộc họp</p>
                              {att ? (
                                <p className="text-[10px] mt-0.5 flex items-center gap-2.5">
                                  <span className="text-amber-600 font-semibold">🟠 Trễ {att.late_count} cuộc · {att.late_minutes_total} phút</span>
                                  <span className="text-red-600 font-semibold">🔴 Vắng {att.no_show_count} cuộc</span>
                                </p>
                              ) : (
                                <p className="text-[10px] mt-0.5 text-[#c2c9d6] italic">Chưa có dữ liệu tham gia</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {filteredTopPeople.length > 5 && (
                        <button
                          type="button"
                          onClick={() => setShowAllPeople(v => !v)}
                          className="mt-2.5 text-[11px] font-bold text-[#0058be] hover:underline"
                        >
                          {showAllPeople ? 'Thu gọn' : `Xem tất cả (${filteredTopPeople.length})`}
                        </button>
                      )}
                    </>
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
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${weekOffset === 0 ? 'bg-white text-[#0058be] shadow-2xs' : 'text-[#64748b] hover:bg-white'}`}
                    >
                      Tuần này
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
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${weekOffset === 0 ? 'bg-white text-[#0058be] shadow-2xs' : 'text-[#64748b] hover:bg-white'}`}
                    >
                      Tuần này
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
                    <div className="w-4 h-4 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" />
                    <span>Đang tải lịch cá nhân...</span>
                  </div>
                </div>
              ) : renderWeekGrid(myMeetings, 'Bạn chưa có lịch họp')}
            </div>
          )}

        </div>
      </div>

      {/* Modals */}
      {canCreate && <CreateMeetingModal isOpen={isModalOpen} onClose={handleCloseEditModal} onSave={handleSaveMeeting} initialData={editingMeeting} workspaceCode={workspaceCode} />}
      {canManage && <PromptSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />}
      <MeetingGuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
      <MeetingDetailModal
        isOpen={isDetailOpen}
        onClose={handleCloseDetail}
        meeting={detailMeeting}
        onEdit={detailMeeting?.can_manage ? handleOpenEditFromDetail : undefined}
        onDelete={detailMeeting?.can_manage && isMeetingDeletable(detailMeeting?.status) ? (m => { handleCloseDetail(); setDeleteConfirmId(String(m.id)); }) : undefined}
      />

      {/* "Nhân sự & Tham gia" detail drawer (chốt 2026-09-15) */}
      <MemberAttendanceDrawer
        isOpen={!!attendanceDrawerMember}
        onClose={() => setAttendanceDrawerMember(null)}
        member={attendanceDrawerMember}
        summary={attendanceDrawerMember?.member_id != null ? attendanceByMemberId.get(attendanceDrawerMember.member_id) : undefined}
      />

      {/* Delete Confirm Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center"><span className="material-symbols-outlined text-[20px]">delete</span></div>
              <h3 className="text-sm font-bold text-[#0b1c30]">Xóa cuộc họp</h3>
            </div>
            <p className="text-xs text-[#64748b]">Bạn có chắc chắn muốn xóa cuộc họp này? Hành động này không thể hoàn tác.</p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setDeleteConfirmId(null)} disabled={isDeleting} className="px-4 py-2 text-xs font-bold text-[#64748b] bg-[#ffffff] border border-[#cbd5e1] hover:bg-slate-50 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Hủy</button>
              <button onClick={executeDelete} disabled={isDeleting} className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{isDeleting ? 'Đang xóa...' : 'Xác nhận xóa'}</button>
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
