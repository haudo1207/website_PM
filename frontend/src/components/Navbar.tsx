'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getAvatar, getName, logout, getRole, isAdmin, isSuperAdmin, isMemberOrAbove } from '@/lib/auth';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkspaces, getMe, getInboxNotifications, markNotificationRead, requestZaloDemo, InboxNotificationItem } from '@/lib/api';
import { brand } from '@/lib/brand';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';
import { useSidebarCollapse } from '@/lib/sidebarCollapse';

// Rendered once for the desktop sidebar and once for the mobile drawer —
// both exist in the DOM simultaneously (CSS just hides one via
// `hidden md:flex` / `md:hidden`), so this needs its own open-state and ref
// per mount. Sharing a single ref/state between the two instances (as a
// plain helper function on the parent would) breaks the outside-click check:
// it ends up pointing at whichever instance mounted last, so a click inside
// the *other* instance's dropdown reads as "outside" and closes the menu
// before the Link's navigation can fire.
function WorkspaceSwitcher({ workspaces, currentWsCode, onNavigate, fixedWsCode, fixedWsSecondaryCount, onProjectHub }: { workspaces: any[]; currentWsCode: string | null; onNavigate?: () => void; fixedWsCode?: string | null; fixedWsSecondaryCount?: number; onProjectHub: boolean }) {
  const { setWorkspaceCode } = useWorkspaceFilter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentWs = workspaces.find((w: any) => w.code === currentWsCode);
  // Leader/Member/Viewer: the assigned Workspace is authoritative and fixed —
  // the switcher becomes a static label (no dropdown, no way to switch).
  const fixedWs = fixedWsCode ? (workspaces.find((w: any) => w.code === fixedWsCode) || { name: fixedWsCode }) : null;

  // Picking a Workspace from any OTHER page (Dashboard/KPI/Accounts/...)
  // must just update the shared filter and stay put — only on Project Hub
  // itself (where the URL segment is authoritative) does it navigate.
  const handlePick = (code: string | null) => {
    setWorkspaceCode(code);
    if (typeof window !== 'undefined') {
      localStorage.setItem('active_workspace_code', code || '');
      window.dispatchEvent(new CustomEvent('workspace-changed', { detail: code || '' }));
    }
    setOpen(false);
    onNavigate?.();
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (fixedWs) {
    // Leader/Member/Viewer: never switchable — the label shows only their
    // Chính (primary) Workspace. A Phụ Workspace never joins this label
    // (that used to read as "pick any of these", which they can't); it's
    // surfaced instead as a small "+N phụ" hint and via badges elsewhere
    // (Dashboard Team cards, Accounts list).
    return (
      <div className="relative mb-2" ref={ref}>
        <div
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-slate-800/70 border border-slate-700/60"
          title={fixedWsSecondaryCount ? `Workspace chính: ${fixedWs.name} (+${fixedWsSecondaryCount} phụ)` : `Workspace: ${fixedWs.name}`}
        >
          <span className="w-7 h-7 rounded-md bg-gradient-to-br from-[#0058be] to-indigo-500 flex items-center justify-center text-xs shrink-0">🏠</span>
          <span className="flex-1 min-w-0 text-left">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">Workspace chính</span>
            <span className="flex items-center gap-1.5">
              <span className="text-[12.5px] font-bold text-white truncate">{fixedWs.name}</span>
              {!!fixedWsSecondaryCount && (
                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  +{fixedWsSecondaryCount} phụ
                </span>
              )}
            </span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mb-2" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-slate-800/70 border border-slate-700/60 hover:bg-slate-800 transition-all cursor-pointer"
      >
        <span className="w-7 h-7 rounded-md bg-gradient-to-br from-[#0058be] to-indigo-500 flex items-center justify-center text-xs shrink-0">🗂️</span>
        <span className="flex-1 min-w-0 text-left">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">Workspace</span>
          <span className="block text-[12.5px] font-bold text-white truncate">{currentWs ? currentWs.name : 'Tất cả'}</span>
        </span>
        <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-20 py-1">
          {onProjectHub ? (
            <Link href="/project-hub" onClick={() => handlePick(null)}
              className={`block px-3 py-2 text-xs font-semibold transition-colors ${
                !currentWsCode ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}>
              Tất cả Workspace
            </Link>
          ) : (
            <div role="button" tabIndex={0} onClick={() => handlePick(null)}
              className={`block px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                !currentWsCode ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}>
              Tất cả Workspace
            </div>
          )}
          {workspaces.map((ws: any) => (
            onProjectHub ? (
              <Link key={ws.code} href={`/project-hub/${ws.code}`} onClick={() => handlePick(ws.code)}
                className={`block px-3 py-2 text-xs font-semibold truncate transition-colors ${
                  ws.code === currentWsCode ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}>
                {ws.name}
              </Link>
            ) : (
              <div key={ws.code} role="button" tabIndex={0} onClick={() => handlePick(ws.code)}
                className={`block px-3 py-2 text-xs font-semibold truncate transition-colors cursor-pointer ${
                  ws.code === currentWsCode ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}>
                {ws.name}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

// Bell icon + dropdown for the notification inbox — mounted once in the
// desktop sidebar header and once in the mobile top bar (same reason
// WorkspaceSwitcher needs its own ref/state per mount: both live in the DOM
// at once, CSS just hides one of them, so a shared ref would only ever
// attach to whichever instance rendered last). Both instances share the
// same react-query cache key, so react-query dedupes the actual polling to
// a single request/interval and a read-mark in one instance is reflected in
// the other immediately via the shared cache.
function NotificationBell({ variant }: { variant: 'sidebar' | 'mobile' }) {
  const [open, setOpen] = useState(false);
  const [demoNotifId, setDemoNotifId] = useState<number | null>(null);
  const [demoDate, setDemoDate] = useState('');
  const [demoTime, setDemoTime] = useState('');
  const [sendingDemo, setSendingDemo] = useState(false);
  const [demoError, setDemoError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['inbox-notifications'],
    queryFn: () => getInboxNotifications(),
    refetchInterval: 20000,
  });
  const items = data?.items || [];
  const unread = data?.unread_count || 0;
  const demoNotif = demoNotifId !== null ? items.find(x => x.id === demoNotifId) || null : null;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markRead = async (id: number) => {
    await markNotificationRead(id).catch(() => {});
    queryClient.setQueryData(['inbox-notifications'], (prev: any) => {
      if (!prev) return prev;
      const target = prev.items.find((x: InboxNotificationItem) => x.id === id);
      if (!target || target.is_read) return prev;
      return {
        unread_count: Math.max(0, prev.unread_count - 1),
        items: prev.items.map((x: InboxNotificationItem) => (x.id === id ? { ...x, is_read: true } : x)),
      };
    });
  };

  const openDemoModal = (n: InboxNotificationItem) => {
    setDemoNotifId(n.id);
    setDemoDate('');
    setDemoTime('');
    setDemoError('');
    if (!n.is_read) markRead(n.id);
  };

  const handleItemClick = (n: InboxNotificationItem) => {
    if (n.notification_type === 'zalo_demo_ready' && n.zalo_conversation_id && n.task_id) {
      openDemoModal(n);
      return;
    }
    if (!n.is_read) markRead(n.id);
    setOpen(false);
    if (n.project_id) {
      window.location.href = `/project/detail/tasks?id=${n.project_id}${n.task_group_id ? `&groupId=${n.task_group_id}` : ''}`;
    }
  };

  const handleSendDemo = async () => {
    if (!demoNotif || !demoNotif.zalo_conversation_id || !demoNotif.task_id) return;
    if (!demoDate || !demoTime) { setDemoError('Chọn cả ngày và giờ demo.'); return; }
    setSendingDemo(true);
    setDemoError('');
    try {
      await requestZaloDemo(demoNotif.zalo_conversation_id, { task_id: demoNotif.task_id, demo_at: `${demoDate}T${demoTime}` });
      setDemoNotifId(null);
      setOpen(false);
    } catch (err: any) {
      setDemoError(err?.response?.data?.detail || 'Gửi yêu cầu demo thất bại.');
    } finally {
      setSendingDemo(false);
    }
  };

  const bellIcon = (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );

  return (
    <div ref={ref} className="relative">
      {variant === 'sidebar' ? (
        <button
          onClick={() => setOpen(o => !o)}
          title="Thông báo"
          className="relative flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors shrink-0"
        >
          {bellIcon}
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      ) : (
        <button
          onClick={() => setOpen(o => !o)}
          title="Thông báo"
          className="relative p-2 text-slate-400 hover:text-white"
        >
          {bellIcon}
          {unread > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          className={`fixed z-[300] w-[92vw] max-w-[380px] max-h-[70vh] overflow-y-auto bg-white border border-slate-300 rounded-2xl shadow-2xl flex flex-col ${
            variant === 'sidebar' ? 'left-[240px] top-4' : 'right-3 top-14'
          }`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 sticky top-0 bg-white z-10">
            <div className="flex items-center gap-2">
              <span className="text-base">🔔</span>
              <h4 className="text-sm font-extrabold text-[#0b1c30]">Thông báo</h4>
              {unread > 0 && (
                <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[11px] font-bold rounded-full">{unread} chưa đọc</span>
              )}
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-700 text-base cursor-pointer">✕</button>
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <span className="text-4xl mb-2">📭</span>
              <p className="text-[13px]">Chưa có thông báo nào</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {items.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${n.is_read ? 'opacity-70' : 'bg-indigo-50/60'}`}
                >
                  <span className="text-xl mt-0.5 shrink-0">
                    {n.notification_type === 'zalo_demo_ready' ? '🎥' : n.notification_type === 'group_approval_request' ? '🔔' : '⚠️'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] leading-snug ${n.is_read ? 'text-slate-600' : 'text-[#0b1c30] font-semibold'}`}>
                      {n.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {n.project_name && (
                        <span className="text-[11px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">{n.project_name}</span>
                      )}
                      {n.zalo_conversation_name && (
                        <span className="text-[11px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">💬 {n.zalo_conversation_name}</span>
                      )}
                    </div>
                    {n.notification_type === 'zalo_demo_ready' && n.zalo_conversation_id && n.task_id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openDemoModal(n); }}
                        className="mt-2 px-3 py-1.5 text-[12px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        🎥 Yêu cầu xem demo
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {demoNotif && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[400] p-4"
          onClick={() => !sendingDemo && setDemoNotifId(null)}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900 mb-1">Yêu cầu xem demo</h3>
            <p className="text-[13px] text-slate-600 mb-4">{demoNotif.message}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày</label>
                <input
                  type="date"
                  value={demoDate}
                  onChange={e => setDemoDate(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm font-semibold text-slate-900 bg-slate-50 border-2 border-slate-400 rounded-lg focus:border-[#0058be] focus:bg-white focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Giờ</label>
                <input
                  type="time"
                  value={demoTime}
                  onChange={e => setDemoTime(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm font-semibold text-slate-900 bg-slate-50 border-2 border-slate-400 rounded-lg focus:border-[#0058be] focus:bg-white focus:outline-none"
                />
              </div>
            </div>
            {demoError && <p className="text-xs text-red-600 mt-2">{demoError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setDemoNotifId(null)}
                disabled={sendingDemo}
                className="px-4 py-2 text-sm font-semibold rounded-lg border-2 border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Huỷ
              </button>
              <button
                onClick={handleSendDemo}
                disabled={sendingDemo}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {sendingDemo ? 'Đang gửi…' : 'Gửi yêu cầu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavbarContent() {
  const path = usePathname();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [role, setRole] = useState('');

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Chỉ thu gọn sidebar DESKTOP - mobile drawer luôn full (nó là overlay, không
  // chiếm chỗ layout thường trực nên không cần thu gọn).
  const { collapsed, toggle: toggleCollapsed } = useSidebarCollapse();

  // Shared cache key with Project Hub pages / CustomersProjectsView — the
  // Workspace list is near-static, so navigating between pages (Navbar
  // remounts on every route) reuses the cached result instead of refetching.
  const { data: workspacesData } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => getWorkspaces(),
    staleTime: 5 * 60_000,
  });
  const workspaces = workspacesData || [];

  // The authoritative Workspace assignment comes from the backend
  // (GET /users/me → data_scope for legacy single-Workspace, workspace_ids[]
  // for the new multi-Workspace Leader grant). Leader/Member/Viewer have
  // their Workspace(s) fixed to that assignment; only Super Admin keeps
  // the selectable dropdown.
  const { data: meData } = useQuery({
    queryKey: ['me-profile'],
    queryFn: () => getMe(),
    staleTime: 5 * 60_000,
  });
  const effectiveRole = meData?.role || getRole() || '';
  const isFullAccessUser = effectiveRole === 'super_admin';
  // Multi-Workspace aware — `workspace_ids` comes back Chính-first (see
  // GET /api/users/me), so [0] is always the "home" Workspace. A Leader/
  // Member with extra (Phụ) Workspaces never gets to switch — the label
  // shows only their Chính Workspace plus a small "+N phụ" count, not a
  // joined list of every Workspace they hold (that used to read as if they
  // could pick any of them, which they can't).
  const myWorkspaceIds: string[] = (() => {
    if (!meData) return [];
    if (isFullAccessUser || (meData.data_scope || '').toLowerCase() === 'all') return [];
    const ids = (meData.workspace_ids || []).filter(code => code && code !== 'all');
    if (ids.length) return ids;
    return meData.data_scope ? [meData.data_scope] : [];
  })();
  const fixedWsCode = !isFullAccessUser && myWorkspaceIds.length >= 1 ? myWorkspaceIds[0] : null;
  const fixedWsSecondaryCount = !isFullAccessUser && myWorkspaceIds.length > 1 ? myWorkspaceIds.length - 1 : 0;

  useEffect(() => {
    setName(getName() ?? '');
    setAvatar(getAvatar() ?? '');
    setRole(getRole() ?? '');
  }, []);

  const projectHubIcon = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );

  // Company selection is shared across the whole app (Dashboard, KPI, ...) via
  // WorkspaceFilterProvider — the URL-derived code below (from /project-hub/{code})
  // is authoritative while browsing Project Hub itself, and syncs INTO the shared
  // context so other pages pick it up; elsewhere the shared context drives the
  // Switcher's highlighted item. Only applies to non-fixed (super_admin) users —
  // Leader/Member/Viewer keep their fixedWsCode regardless.
  const { workspaceCode: ctxWorkspaceCode, setWorkspaceCode } = useWorkspaceFilter();
  const urlWsCode = path.startsWith('/project-hub/') ? path.split('/')[2] : null;
  const currentWsCode = fixedWsCode || urlWsCode || ctxWorkspaceCode;
  // Only Project Hub encodes the Workspace in its URL — the switcher should
  // navigate there; everywhere else it must just update the shared filter
  // and stay on the current page (was wrongly bouncing to Project Hub).
  const isOnProjectHub = path.startsWith('/project-hub');

  useEffect(() => {
    if (!fixedWsCode && urlWsCode && urlWsCode !== ctxWorkspaceCode) setWorkspaceCode(urlWsCode);
  }, [fixedWsCode, urlWsCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderProjectsLink = (onNavigate?: () => void, compact = false) => (
    <Link href="/project-hub" onClick={onNavigate} title={compact ? 'Projects' : undefined}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${compact ? 'justify-center' : ''} ${
        path.startsWith('/project-hub') ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      }`}>
      {projectHubIcon}
      {!compact && 'Projects'}
    </Link>
  );

  const renderDashboardLink = (onNavigate?: () => void, compact = false) => (
    <Link href="/dashboard/overview" onClick={onNavigate} title={compact ? 'Dashboard' : undefined}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${compact ? 'justify-center' : ''} ${
        path.startsWith('/dashboard') ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      }`}>
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
      {!compact && 'Dashboard'}
    </Link>
  );

  const nav = [
    { href: '/kpi', label: 'KPI', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ) },
    { href: '/meetings', label: 'Meetings', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    )},
    { href: '/leave-request', label: 'Leave Request', icon: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 2h6a1 1 0 011 1v1h2a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2V3a1 1 0 011-1zm0 2v1h6V4H9zm1.5 9l2 2 4-4"/>
    </svg>
    )},
    { href: '/accounts', label: 'Accounts', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    ), show: isAdmin() },
    { href: '/zalo-account', label: 'Tài khoản Zalo giao task', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ), show: isMemberOrAbove() },
  ].filter(n => n.show !== false);

  return (
    <>
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-[#0F172A] border-b border-slate-800 flex items-center justify-between px-4 z-[200]">
        <div className="flex items-center gap-2">
          <img src={brand.logo} alt={`${brand.name} logo`} className="w-6 h-6 rounded-lg flex-shrink-0 object-cover" />
          <span className="text-sm font-bold text-white">{brand.productName}</span>
        </div>
        <div className="flex items-center gap-1">
          {isAdmin() && <NotificationBell variant="mobile" />}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-slate-400 hover:text-white"
          >
            {mobileMenuOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[190] bg-black/50" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Sidebar - Hidden on mobile, visible on md+ */}
      <aside className={`
        ${collapsed ? 'w-16' : 'w-[230px]'} flex-shrink-0 bg-[#0F172A] border-r border-slate-800 flex flex-col fixed top-0 bottom-0 left-0 z-50 overflow-y-auto overflow-x-hidden transition-[width] duration-200
        hidden md:flex
      `}>

        {/* Logo - khi collapsed, đây là nút DUY NHẤT còn thấy trong khu vực này
            và bấm vào logo sẽ mở lại sidebar (thay vì 1 nút mũi tên riêng
            đứng cạnh logo trông rối/xấu ở trạng thái thu gọn). */}
        <div className="p-5 border-b border-slate-800">
          <div className={`flex items-center gap-2 ${collapsed ? 'justify-center' : 'justify-between'}`}>
            <div
              className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'cursor-pointer' : ''}`}
              onClick={collapsed ? toggleCollapsed : undefined}
              title={collapsed ? 'Mở rộng sidebar' : undefined}
            >
              <img src={brand.logo} alt={`${brand.name} logo`} className="w-8 h-8 rounded-lg flex-shrink-0 object-cover" />
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-white tracking-tight leading-none truncate">{brand.productName}</div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-0.5 truncate">{brand.subtitle}</div>
                </div>
              )}
            </div>
            {!collapsed && (
              <div className="flex items-center gap-1 shrink-0">
                {isAdmin() && <NotificationBell variant="sidebar" />}
                <button
                  onClick={toggleCollapsed}
                  title="Thu gọn sidebar"
                  className="w-7 h-7 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Nav Links */}
        <nav className="px-3 py-4 space-y-1 shrink-0">

          {!collapsed && (
            <WorkspaceSwitcher workspaces={workspaces} currentWsCode={currentWsCode} fixedWsCode={fixedWsCode} fixedWsSecondaryCount={fixedWsSecondaryCount} onProjectHub={isOnProjectHub} />
          )}

          {renderDashboardLink(undefined, collapsed)}

          {renderProjectsLink(undefined, collapsed)}

          {nav.map(n => {
            const active = path === n.href || (n.href === '/leave-request' && path.startsWith('/leave-request'));
            return (
              <Link key={n.href} href={n.href} title={collapsed ? n.label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${collapsed ? 'justify-center' : ''} ${
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                {n.icon}
                {!collapsed && n.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-grow" />

        {/* User Profile Footer Section */}
        <div className="p-3 border-t border-slate-800 space-y-2.5">
          <Link
            href="/profile"
            title={collapsed ? (name || 'User') : undefined}
            className={`flex items-center gap-2.5 -mx-1 px-1 py-1 rounded-lg transition-colors ${collapsed ? 'justify-center' : ''} ${
              path === '/profile' ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            {avatar ? (
              <img src={avatar} alt={`${name || 'User'} avatar`} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover border border-white/10 shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/10 border border-white/5 flex items-center justify-center text-xs font-bold text-white uppercase shrink-0">
                {name ? name.substring(0, 2) : 'US'}
              </div>
            )}
            {!collapsed && (
              <div className="truncate flex-grow">
                <div className="text-[11px] font-bold text-white truncate">{name || 'User'}</div>
                <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">{
                  role === 'super_admin' ? 'Super Admin' :
                  role === 'leader' ? 'Team Leader' :
                  role === 'viewer' ? 'Viewer' :
                  role || 'Member'
                }</div>
              </div>
            )}
          </Link>

          {/* Settings — Super Admin only (matches the page's own guard;
              isAdmin() also returns true for Leader, which would show this
              button then bounce them straight back out). */}
          {isSuperAdmin() && (
            <Link
              href="/settings"
              title={collapsed ? 'Settings' : undefined}
              className={`flex items-center justify-center gap-2 w-full py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                path.startsWith('/settings')
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/60'
              }`}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {!collapsed && <span>Settings</span>}
            </Link>
          )}

          <a
            href="/api/extension/ai-tracker"
            download
            title={collapsed ? 'Tải KPI Prototype' : undefined}
            className="flex items-center justify-center gap-2 w-full py-1.5 rounded-lg text-xs font-semibold transition-all border bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/60"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 3v12m0 0l-4-4m4 4l4-4" />
            </svg>
            {!collapsed && <span>Tải KPI Prototype</span>}
          </a>

          <button onClick={logout} title={collapsed ? 'Sign out' : undefined}
            className="w-full text-center py-1.5 rounded-lg bg-slate-800 hover:bg-red-950/40 text-xs font-semibold text-slate-300 hover:text-red-400 transition-colors border border-slate-700/60">
            {collapsed ? '⏻' : 'Sign out'}
          </button>
          {!collapsed && <div className="text-[9px] text-slate-600 text-center">{brand.footer}</div>}
        </div>
      </aside>

      {/* Mobile Menu Drawer */}
      <aside className={`
        md:hidden fixed top-0 left-0 bottom-0 w-[260px] bg-[#0F172A] z-[200] transform transition-transform duration-300 ease-in-out
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Mobile Logo */}
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <img src={brand.logo} alt={`${brand.name} logo`} className="w-8 h-8 rounded-lg flex-shrink-0 object-cover" />
            <div>
              <div className="text-sm font-extrabold text-white tracking-tight leading-none">{brand.productName}</div>
              <div className="text-[10px] text-slate-400 font-semibold mt-0.5">{brand.subtitle}</div>
            </div>
          </div>
        </div>

        {/* Mobile Nav Links */}
        <nav className="px-3 py-4 space-y-1 shrink-0">
          <WorkspaceSwitcher workspaces={workspaces} currentWsCode={currentWsCode} fixedWsCode={fixedWsCode} fixedWsSecondaryCount={fixedWsSecondaryCount} onProjectHub={isOnProjectHub} onNavigate={() => setMobileMenuOpen(false)} />

          {renderDashboardLink(() => setMobileMenuOpen(false))}

          {renderProjectsLink(() => setMobileMenuOpen(false))}

          {nav.map(n => {
            const active = path === n.href || (n.href === '/leave-request' && path.startsWith('/leave-request'));
            return (
              <Link key={n.href} href={n.href} onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                {n.icon}
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-grow" />

        {/* Mobile User */}
        <div className="p-3 border-t border-slate-800 space-y-2.5">
          <Link
            href="/profile"
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center gap-2.5 -mx-1 px-1 py-1 rounded-lg transition-colors ${
              path === '/profile' ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            {avatar ? (
              <img src={avatar} alt={`${name || 'User'} avatar`} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover border border-white/10" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/10 border border-white/5 flex items-center justify-center text-xs font-bold text-white uppercase">
                {name ? name.substring(0, 2) : 'US'}
              </div>
            )}
            <div className="truncate flex-grow">
              <div className="text-[11px] font-bold text-white truncate">{name || 'User'}</div>
              <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">{
                role === 'super_admin' ? 'Super Admin' :
                role === 'leader' ? 'Team Leader' :
                role === 'viewer' ? 'Viewer' :
                role || 'Member'
              }</div>
            </div>
          </Link>

          {/* Settings — Super Admin only (matches the page's own guard;
              isAdmin() also returns true for Leader, which would show this
              button then bounce them straight back out). */}
          {isSuperAdmin() && (
            <Link
              href="/settings"
              onClick={() => setMobileMenuOpen(false)}
              className={`flex items-center justify-center gap-2 w-full py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                path.startsWith('/settings')
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/60'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Settings</span>
            </Link>
          )}

          <a
            href="/api/extension/ai-tracker"
            download
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center justify-center gap-2 w-full py-1.5 rounded-lg text-xs font-semibold transition-all border bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/60"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 3v12m0 0l-4-4m4 4l4-4" />
            </svg>
            <span>Tải KPI Prototype</span>
          </a>

          <button onClick={logout}
            className="w-full text-center py-1.5 rounded-lg bg-slate-800 hover:bg-red-950/40 text-xs font-semibold text-slate-300 hover:text-red-400 transition-colors border border-slate-700/60">
            Sign out
          </button>
          <div className="text-[9px] text-slate-600 text-center">{brand.footer}</div>
        </div>
      </aside>
    </>
  );
}

export default function Navbar() {
  return (
    <Suspense fallback={<aside className="w-[230px] shrink-0 bg-[#0F172A] border-r border-slate-800 hidden md:flex" />}>
      <NavbarContent />
    </Suspense>
  );
}
