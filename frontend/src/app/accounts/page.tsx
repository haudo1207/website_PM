'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import MembersView from '@/components/MembersView';
import SearchableSelect from '@/components/common/SearchableSelect';
import { useRouter } from 'next/navigation';
import { isAdmin, isSuperAdmin, isLeader } from '@/lib/auth';
import { useSidebarCollapse, SIDEBAR_PAD_EXPANDED, SIDEBAR_PAD_COLLAPSED } from '@/lib/sidebarCollapse';
import {
  getAccounts,
  getAvailableMembers,
  createAccount,
  updateAccount,
  lockAccount,
  unlockAccount,
  deleteAccount,
  getWorkspaces,
  Workspace
} from '@/lib/api';
// (removed the useWorkspaceFilter binding for the Accounts page — see the
// filteredAccounts useMemo below for the rationale. The shared Navbar
// workspace switcher continues to drive Project / Members / Dashboard
// pages, but the Accounts authorization scope is backend-authoritative
// and must not be narrowed by the global switcher.)

interface MemberInfo {
  id: number;
  display_name: string;
  full_name: string;
  email?: string;
  team?: string;
  position?: string;
  department?: string;
  leader_name?: string;
  leader_email?: string;
}

interface Account {
  id: number;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  outlook_mail?: string | null;
  role: string;
  data_scope: string;
  workspace_ids?: string[];
  workspaces?: { id: number; code: string; name: string; is_primary: boolean }[];
  workspace_scope?: string;
  is_active: boolean;
  member_id: number | null;
  member: MemberInfo | null;
  created_at: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  leader: 'Team Leader',
  member: 'Member',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-700',
  leader: 'bg-amber-100 text-amber-700',
  member: 'bg-blue-100 text-blue-700',
  viewer: 'bg-slate-100 text-slate-600',
};

const LEADER_MANAGED_ROLES = new Set(['member', 'viewer']);
const ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin — Quản trị toàn hệ thống' },
  { value: 'leader', label: 'Team Leader — Quản lý dự án trong team' },
  { value: 'member', label: 'Member — Thành viên, quản lý task' },
  { value: 'viewer', label: 'Viewer — Chỉ xem, không thao tác' },
];

export default function AccountsPage() {
  const router = useRouter();
  const { collapsed: sidebarCollapsed } = useSidebarCollapse();
  const isLeaderUser = isLeader();
  const roleOptions = isLeaderUser ? ROLE_OPTIONS.filter(option => LEADER_MANAGED_ROLES.has(option.value)) : ROLE_OPTIONS;
  const canLeaderManageAccount = (account: Account) => !isLeaderUser || LEADER_MANAGED_ROLES.has(account.role);
  const [authorized, setAuthorized] = useState(false);
  const [saved, setSaved] = useState('');
  const [activeTab, setActiveTab] = useState<'accounts' | 'members'>('accounts');

  // filters
  const [searchName, setSearchName] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterScope, setFilterScope] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<{ email: string; role: string; data_scope: string; workspace_ids: string[]; full_name: string; member_id: number; outlook_mail: string }>({ email: '', role: 'member', data_scope: '', workspace_ids: [], full_name: '', member_id: 0, outlook_mail: '' });

  // Edit modal
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState<{ email: string; full_name: string; role: string; data_scope: string; workspace_ids: string[]; member_id: number; outlook_mail: string }>({ email: '', full_name: '', role: '', data_scope: '', workspace_ids: [], member_id: 0, outlook_mail: '' });

  // Reset password modal

  useEffect(() => {
    if (!isAdmin()) {
      router.push('/dashboard/overview');
    } else {
      setAuthorized(true);
    }
  }, [router]);

  // Shared ['workspaces'] react-query cache — same key/staleTime as Navbar/
  // Dashboard/ProjectListContent, so this doesn't fire a duplicate request.
  const { data: workspacesData } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => getWorkspaces(),
    staleTime: 5 * 60_000,
  });
  const workspaces: Workspace[] = workspacesData || [];

  const { data: accountsData, isLoading: loading, refetch: reload } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: async () => {
      const [accs, members] = await Promise.all([
        getAccounts(),
        getAvailableMembers(),
      ]);
      return { accounts: accs, availableMembers: members };
    },
    enabled: authorized,
    staleTime: 2 * 60_000,
  });
  const accounts: Account[] = accountsData?.accounts || [];
  const availableMembers: MemberInfo[] = accountsData?.availableMembers || [];

  // Default data_scope for the create/edit forms once workspaces load —
  // was previously set as a side effect inside reload() itself.
  useEffect(() => {
    if (workspaces.length === 0) return;
    setCreateForm(f => ({
      ...f,
      data_scope: f.data_scope || workspaces[0].code,
      workspace_ids: f.workspace_ids.length ? f.workspace_ids : [workspaces[0].code],
    }));
    setEditForm(f => ({
      ...f,
      data_scope: f.data_scope || workspaces[0].code,
      workspace_ids: f.workspace_ids.length ? f.workspace_ids : [workspaces[0].code],
    }));
  }, [workspaces]);

  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(''), 5000);
  };

  // Workspace Master → data scope labels ('all' stays a global option)
  const scopeLabels = useMemo(() => {
    const labels: Record<string, string> = { all: 'Tất cả dự án' };
    (workspaces || []).forEach(w => {
      labels[w.code] = `Dự án ${w.name}`;
    });
    return labels;
  }, [workspaces]);

  // Accounts page Data-Scope filter is intentionally NOT bound to the
  // shared Navbar `useWorkspaceFilter()` switcher. The Navbar switcher is a
  // per-User *view-narrowing* control (drives Dashboard charts, Project
  // list, Members list, etc.). Accounts management is *authorization-scoped*
  // — the backend already returns only the accounts the caller is allowed
  // to manage (`/api/accounts` filters by `user_allowed_scopes(caller)`),
  // so coupling this page's filter to the global switcher would silently
  // hide accounts the caller is authorized to see whenever the switcher
  // happened to be parked on a different Workspace (Bug B).
  // The Data Scope dropdown therefore defaults to "Tất cả" (no extra
  // filter) and the user may still narrow manually when desired.
  const filteredAccounts = useMemo(() => {
    const nameQuery = searchName.trim().toLowerCase();

    return accounts.filter(acc => {
      const nameMatch = !nameQuery || [
        acc.full_name,
        acc.member?.display_name,
        acc.member?.full_name,
        acc.email,
        acc.outlook_mail,
      ].some(value => (value || '').toLowerCase().includes(nameQuery));

      const roleMatch = !filterRole || acc.role === filterRole;
      // An "all"-scope account belongs to every Workspace. For multi-Workspace
      // accounts, the row matches the Workspace filter when *any* of its
      // granted Workspaces matches the filter (or its primary data_scope is
      // 'all'). Same escape-hatch semantics as the Projects/Members tabs.
      const accWs = (acc.workspace_ids && acc.workspace_ids.length) ? acc.workspace_ids : [acc.data_scope];
      const scopeMatch = !filterScope
        || acc.data_scope === 'all'
        || accWs.includes('all')
        || accWs.includes(filterScope);
      const statusMatch = !filterStatus || (filterStatus === 'active' ? acc.is_active : !acc.is_active);

      return nameMatch && roleMatch && scopeMatch && statusMatch;
    });
  }, [accounts, searchName, filterRole, filterScope, filterStatus]);

  const memberSelectOptions = useMemo(() => [
    { id: 0, name: '— Không liên kết thành viên —' },
    ...availableMembers.map(m => ({
      id: m.id,
      name: `${m.display_name} — ${m.full_name}${m.team ? ` (${m.team})` : ''}`
    }))
  ], [availableMembers]);

  const editMemberSelectOptions = useMemo(() => {
    const list: { id: number; name: string }[] = [
      { id: 0, name: '— Không liên kết thành viên —' }
    ];
    if (editAccount?.member) {
      list.push({
        id: editAccount.member.id,
        name: `${editAccount.member.display_name} — ${editAccount.member.full_name}${editAccount.member.team ? ` (${editAccount.member.team})` : ''}`
      });
    }
    availableMembers.forEach(m => {
      if (!editAccount?.member || m.id !== editAccount.member.id) {
        list.push({
          id: m.id,
          name: `${m.display_name} — ${m.full_name}${m.team ? ` (${m.team})` : ''}`
        });
      }
    });
    return list;
  }, [availableMembers, editAccount]);

  // Create
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    try {
      const payload: any = {
        email: createForm.email,
        role: createForm.role,
        full_name: createForm.full_name,
        member_id: createForm.member_id || undefined,
        outlook_mail: createForm.outlook_mail || undefined,
      };
      if (createForm.role === 'leader') {
        // Multi-Workspace leader — send the full list to the backend, which
        // will write one row per code into `user_workspace_access`. `data_scope`
        // is also accepted for backwards compatibility, but the backend now
        // derives it from the first code in `workspace_ids`.
        payload.workspace_ids = createForm.workspace_ids;
        payload.primary_workspace_code = createForm.data_scope;
      } else if (createForm.role === 'super_admin') {
        // No Workspace assignment needed for Super Admin — backend coerces
        // data_scope='all'. Don't send `workspace_ids` so the backend treats
        // it as the global-all scope rather than a literal Workspace list.
      } else if (createForm.role === 'member') {
        // Multi-Workspace Member (permission extension). Backend writes one
        // junction row per code; permission level (MEMBER) is unchanged.
        payload.workspace_ids = createForm.workspace_ids;
        payload.data_scope = createForm.data_scope;
        payload.primary_workspace_code = createForm.data_scope;
      } else {
        // Viewer — NO CHANGE. Exactly one Workspace; backend ignores
        // `workspace_ids` for Viewer and the single `data_scope` row
        // continues to drive scoping.
        payload.data_scope = createForm.data_scope;
      }
      await createAccount(payload);
      // Success: clear error state, close modal, reset form, refresh. Order
      // matters — clear the error BEFORE closing the modal so reopening the
      // modal (which unmounts the form) never re-surfaces the previous
      // failure message (Bug C).
      setCreateError(null);
      flash('Đã tạo tài khoản thành công');
      setShowCreate(false);
      setCreateForm({ email: '', role: 'member', data_scope: (workspaces?.[0]?.code || ''), workspace_ids: (workspaces?.[0]?.code ? [workspaces[0].code] : []), full_name: '', member_id: 0, outlook_mail: '' });
      reload();
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Lỗi tạo tài khoản';
      setCreateError(msg);
      flash(msg);
    }
  };

  // When member is selected in create form, auto-fill info
  const handleMemberSelect = (memberId: number) => {
    setCreateForm(prev => ({ ...prev, member_id: memberId }));
    if (memberId) {
      const m = availableMembers.find(mb => mb.id === memberId);
      if (m) {
        setCreateForm(prev => ({
          ...prev,
          member_id: memberId,
          full_name: m.full_name,
          email: m.email || prev.email,
        }));
      }
    }
  };

  // Edit
  const openEdit = (acc: Account) => {
    if (!canLeaderManageAccount(acc)) return;
    setEditAccount(acc);
    setEditError(null);
    // Recover the full grant set for the Edit form:
    //   1. Prefer the explicit `workspace_ids` list (filters the Super-Admin
    //      `all` sentinel).
    //   2. Defensive fallback: if the response still collapses to ['all']
    //      (legacy / migration data), use the `workspaces` array (which
    //      always carries the full code list per `account_to_dict`).
    //   3. Final fallback: legacy single `data_scope`, then first master
    //      workspace — never silently drop the entire grant set.
    let initialWorkspaces: string[] = [];
    const realIds = (acc.workspace_ids || []).filter(code => code !== 'all');
    if (realIds.length > 0) {
      initialWorkspaces = realIds;
    } else if (acc.workspaces && acc.workspaces.length > 0) {
      initialWorkspaces = acc.workspaces.map(w => w.code);
    } else if (acc.data_scope && acc.data_scope !== 'all') {
      initialWorkspaces = [acc.data_scope];
    } else if (workspaces?.[0]?.code) {
      initialWorkspaces = [workspaces[0].code];
    }
    setEditForm({
      email: acc.email,
      full_name: acc.full_name || '',
      role: acc.role,
      data_scope: acc.data_scope || (workspaces?.[0]?.code || ''),
      workspace_ids: initialWorkspaces,
      member_id: acc.member_id || 0,
      outlook_mail: acc.outlook_mail || '',
    });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAccount) return;
    setEditError(null);
    if ((editForm.role === 'leader' || editForm.role === 'member') && editForm.workspace_ids.length > 1 && !editForm.data_scope) {
      setEditError('Chưa chọn Workspace chính — bấm vào 1 trong các Workspace bên dưới để đặt làm chính.');
      return;
    }
    try {
      const payload: any = {
        email: editForm.email,
        full_name: editForm.full_name,
        role: editForm.role,
        member_id: editForm.member_id || null,
        outlook_mail: editForm.outlook_mail || null,
      };
      if (editForm.role === 'leader') {
        payload.workspace_ids = editForm.workspace_ids;
        // Which granted Workspace is "Chính" (home) — defaults to the first
        // code when unset, but the Chính/Phụ picker below lets the admin
        // explicitly override that.
        payload.primary_workspace_code = editForm.data_scope;
      } else if (editForm.role === 'super_admin') {
        // No Workspace selector — backend handles 'all' globally.
      } else if (editForm.role === 'member') {
        // Multi-Workspace Member — backend writes one junction row per code.
        payload.workspace_ids = editForm.workspace_ids;
        payload.data_scope = editForm.data_scope;
        payload.primary_workspace_code = editForm.data_scope;
      } else {
        // Viewer — existing single-Workspace behavior, NO CHANGE.
        payload.data_scope = editForm.data_scope;
      }
      await updateAccount(editAccount.id, payload);
      // Success: clear error state, close modal, refresh. Mirrors
      // handleCreate's success path so the previous error message never
      // re-surfaces on the next modal open (Bug C).
      setEditError(null);
      flash('Đã cập nhận tài khoản');
      setEditAccount(null);
      reload();
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Lỗi cập nhật tài khoản';
      setEditError(msg);
      flash(msg);
    }
  };

  // Lock / Unlock
  const handleToggleLock = async (acc: Account) => {
    try {
      if (acc.is_active) {
        await lockAccount(acc.id);
        flash('Đã khóa tài khoản');
      } else {
        await unlockAccount(acc.id);
        flash('Đã mở khóa tài khoản');
      }
      reload();
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi thay đổi trạng thái');
    }
  };

  // Delete
  const handleDelete = async (acc: Account) => {
    if (!confirm(`Bạn có chắc muốn xóa tài khoản "${acc.email}"?\nThành viên liên kết sẽ KHÔNG bị ảnh hưởng.`)) return;
    try {
      await deleteAccount(acc.id);
      flash('Đã xóa tài khoản (thành viên vẫn được giữ nguyên)');
      reload();
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi xóa tài khoản');
    }
  };

  if (!authorized) return null;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] flex" style={{ fontFamily: "'Inter', sans-serif" }}>
      <Navbar />
      <div className={`flex-1 min-w-0 pl-0 ${sidebarCollapsed ? SIDEBAR_PAD_COLLAPSED : SIDEBAR_PAD_EXPANDED} flex flex-col min-h-screen pt-[168px] md:pt-[112px] transition-[padding] duration-200`}>
        {/* Header */}
        <div className="fixed left-0 md:left-[230px] right-0 top-14 md:top-0 z-30 h-[56px] bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shadow-sm">
          <h2 className="text-sm font-bold tracking-wider text-[#0f172a] uppercase">Quản lý tài khoản</h2>
          {activeTab === 'accounts' && (
            <button
              onClick={() => { setCreateError(null); setShowCreate(true); }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Tạo tài khoản
            </button>
          )}
        </div>

        {/* Tabbar Navigation */}
        <div className="fixed left-0 md:left-[230px] right-0 top-[112px] md:top-[56px] z-20 h-[56px] bg-white border-b border-slate-200 px-4 md:px-8 flex gap-4 md:gap-6 overflow-x-auto shadow-sm">
          <button
            onClick={() => setActiveTab('accounts')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${activeTab === 'accounts'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            Quản lý tài khoản
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${activeTab === 'members'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            Quản lý thành viên
          </button>
        </div>

        {/* Content */}
        <div className="p-4 md:p-8 max-w-7xl w-full mx-auto space-y-6 min-w-0">
          {saved && (
            // Toast positioned above the modal backdrop (modal is z-50, so
            // this sits at z-[60]) — ensures the user sees the success/error
            // feedback even when the modal is open. The in-modal error
            // banner above still keeps the form open and visible.
            <div className="fixed top-[120px] left-1/2 -translate-x-1/2 z-[60] bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-xs flex items-center gap-2 font-semibold shadow-lg max-w-md">
              <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span className="flex-1">{saved}</span>
            </div>
          )}

          {activeTab === 'accounts' && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tổng tài khoản</div>
              <div className="text-2xl font-bold text-[#0f172a] mt-1">{filteredAccounts.length}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Đang hoạt động</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{filteredAccounts.filter(a => a.is_active).length}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Đã khóa</div>
              <div className="text-2xl font-bold text-red-500 mt-1">{filteredAccounts.filter(a => !a.is_active).length}</div>
            </div>
          </div>
              <div className="sticky top-[160px] md:top-[104px] z-[50] bg-[#f8fafc]/95 backdrop-blur-sm">
              {/* Search & Filters */}
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm flex flex-wrap items-center gap-3 relative z-[100]">
                <div className="relative flex-1 min-w-[200px]">
                  <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Tìm kiếm theo tên..."
                    value={searchName}
                    onChange={e => setSearchName(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-[#0f172a] outline-none focus:border-blue-500 placeholder-slate-400"
                  />
                </div>

                <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-[#0f172a] outline-none focus:border-blue-500 bg-white">
                  <option value="">Tất cả Role</option>
                  <option value="super_admin">Super Admin</option>
                  <option value="leader">Team Leader</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>

                <select value={filterScope} onChange={e => setFilterScope(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-[#0f172a] outline-none focus:border-blue-500 bg-white">
                  <option value="">Tất cả Data Scope</option>
                  {Object.entries(scopeLabels).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>

                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-[#0f172a] outline-none focus:border-blue-500 bg-white">
                  <option value="">Tất cả Status</option>
                  <option value="active">Active</option>
                  <option value="locked">Locked</option>
                </select>

                {(searchName || filterRole || filterScope || filterStatus) && (
                  <button onClick={() => { setSearchName(''); setFilterRole(''); setFilterScope(''); setFilterStatus(''); }}
                    className="text-xs text-slate-500 hover:text-red-600 font-medium transition-colors">
                    Xóa lọc
                  </button>
                )}

                <span className="ml-auto text-[11px] text-slate-400 font-medium">{filteredAccounts.length} tài khoản</span>
              </div>
              </div>

              {/* Table */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-auto relative z-[1]" style={{ maxHeight: 'calc(100vh - 340px)' }}>
                <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="sticky top-0 z-10 bg-slate-50 text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">ID</th>
                        <th className="sticky top-0 z-10 bg-slate-50 text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Email</th>
                        <th className="sticky top-0 z-10 bg-slate-50 text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Microsoft Mail</th>
                        <th className="sticky top-0 z-10 bg-slate-50 text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Họ tên</th>
                        <th className="sticky top-0 z-10 bg-slate-50 text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Role</th>
                        <th className="sticky top-0 z-10 bg-slate-50 text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Workspace</th>
                        <th className="sticky top-0 z-10 bg-slate-50 text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Thành viên</th>
                        <th className="sticky top-0 z-10 bg-slate-50 text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Trạng thái</th>
                        <th className="sticky top-0 z-10 bg-slate-50 text-right px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400 italic">Đang tải...</td></tr>
                  ) : filteredAccounts.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400 italic">Chưa có tài khoản nào</td></tr>
                  ) : (
                    filteredAccounts.map(acc => (
                      <tr key={acc.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-400">{acc.id}</td>
                        <td className="px-4 py-3 font-semibold text-[#0f172a]">
                          <div className="flex items-center gap-2">
                            {acc.avatar_url ? (
                              <img src={acc.avatar_url} alt={`${acc.full_name || acc.email} avatar`} referrerPolicy="no-referrer" className="w-7 h-7 rounded-full object-cover border border-slate-200" />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px] font-bold uppercase">
                                {(acc.full_name || acc.email).substring(0, 2)}
                              </div>
                            )}
                            <span>{acc.email}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{acc.outlook_mail || <span className="text-slate-300">–</span>}</td>
                        <td className="px-4 py-3 text-slate-600">{acc.full_name || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${ROLE_COLORS[acc.role] || 'bg-slate-100 text-slate-600'}`}>
                            {ROLE_LABELS[acc.role] || acc.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {acc.role === 'super_admin' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wider">
                              ALL Workspaces
                            </span>
                          ) : (() => {
                            // ALL WORKSPACES — every Workspace in the master
                            // is granted. Driven entirely by the master data
                            // (no hard-coded Workspace names). The Edit form
                            // must keep every individual code so the user
                            // can re-save without losing any grant.
                            const allCodes = new Set(workspaces.map(w => w.code));
                            const grantedReal = (acc.workspace_ids || []).filter(c => c !== 'all');
                            const isAll = allCodes.size > 0 && grantedReal.length >= allCodes.size
                              && allCodes.size === grantedReal.length;
                            if (isAll) {
                              return (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wider">
                                  ALL Workspaces
                                </span>
                              );
                            }
                            if (acc.workspace_ids && acc.workspace_ids.length > 1) {
                              // List stays clean — only the Chính (home)
                              // Workspace shows here as a badge, with a small
                              // "+N phụ" hint. Full Chính/Phụ management
                              // (viewing/switching which one is primary)
                              // lives in the Edit panel, not cluttering the
                              // list row with every granted Workspace.
                              const primaryEntry = acc.workspaces?.find(w => w.is_primary);
                              const primaryCode = primaryEntry?.code || acc.workspace_ids[0];
                              const secondaryCount = acc.workspace_ids.filter(c => c !== 'all').length - 1;
                              return (
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider">
                                    🏠 {scopeLabels[primaryCode] || primaryCode}
                                  </span>
                                  {secondaryCount > 0 && (
                                    <span className="text-[10px] text-amber-600 font-semibold">+{secondaryCount} phụ</span>
                                  )}
                                </span>
                              );
                            }
                            return <span>{scopeLabels[acc.data_scope] || acc.data_scope}</span>;
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          {acc.member ? (
                            <div>
                              <span className="font-semibold text-[#0f172a]">{acc.member.display_name}</span>
                              {acc.member.team && <span className="text-slate-400 ml-1.5">· {acc.member.team}</span>}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">Chưa liên kết</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${acc.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                            {acc.is_active ? 'Active' : 'Locked'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {(() => {
                              const canManageAccount = canLeaderManageAccount(acc);
                              return (
                                <>
                                  <button onClick={() => openEdit(acc)} disabled={!canManageAccount} className={`font-medium ${!canManageAccount ? 'text-slate-300 cursor-not-allowed' : 'text-blue-600 hover:underline'}`} title="Sửa">Sửa</button>
                                  <span className="text-slate-200">|</span>
                                  <button onClick={() => handleToggleLock(acc)} disabled={!canManageAccount} className={`font-medium ${!canManageAccount ? 'text-slate-300 cursor-not-allowed' : acc.is_active ? 'text-orange-600 hover:underline' : 'text-emerald-600 hover:underline'}`}>
                                    {acc.is_active ? 'Khóa' : 'Mở khóa'}
                                  </button>
                                  <span className="text-slate-200">|</span>
                                  <button onClick={() => handleDelete(acc)} disabled={!canManageAccount} className={`font-medium ${!canManageAccount ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:underline'}`} title="Xóa">Xóa</button>
                                </>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                    </tbody>
                </table>
              </div>
            </>
          )}

          {activeTab === 'members' && (
            <MembersView onFlash={flash} onAccountCreated={() => reload()} />
          )}
        </div>
      </div>

      {/* ═══ CREATE MODAL ═══ */}
      {showCreate && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 w-full max-w-lg rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider">Tạo tài khoản mới</h3>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4 overflow-y-auto flex-1">
              {createError && (
                // Error banner — visible INSIDE the modal so the user does
                // not have to close the form to read it. Stays open so the
                // user can correct the data and resubmit.
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-xs flex items-start gap-2 font-semibold shadow-sm">
                  <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                  </svg>
                  <span className="flex-1">{createError}</span>
                  <button type="button" onClick={() => setCreateError(null)} className="text-red-400 hover:text-red-700 transition-colors" title="Đóng thông báo">✕</button>
                </div>
              )}
              {/* Member Selection */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Liên kết thành viên (tùy chọn)</label>
                <SearchableSelect
                  label="thành viên"
                  icon="👤"
                  options={memberSelectOptions}
                  value={createForm.member_id || 0}
                  onChange={val => handleMemberSelect(Number(val) || 0)}
                  placeholder="Tìm thành viên để liên kết..."
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Email <span className="text-red-500">*</span></label>
                  <input
                    required type="email"
                    value={createForm.email}
                    onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                    placeholder="user@company.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Microsoft Mail</label>
                  <input
                    type="email"
                    value={createForm.outlook_mail}
                    onChange={e => setCreateForm(f => ({ ...f, outlook_mail: e.target.value }))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                    placeholder="user@outlook.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Họ tên</label>
                  <input
                    value={createForm.full_name}
                    onChange={e => setCreateForm(f => ({ ...f, full_name: e.target.value }))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                    placeholder="Nguyễn Văn A"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vai trò <span className="text-red-500">*</span></label>
                  <select
                    value={createForm.role}
                    onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  >
                    {roleOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Phạm vi dự án</label>
                {createForm.role === 'super_admin' ? (
                  <div className="w-full bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700 font-bold flex items-center gap-2">
                    <span className="text-base">∞</span>
                    ALL Workspaces — Quản trị viên toàn hệ thống
                  </div>
                ) : createForm.role === 'leader' ? (
                  <SearchableSelect
                    label="Workspace"
                    icon="🗂️"
                    options={workspaces.map(ws => ({ id: ws.code, name: `${ws.name} — Dự án của team ${ws.name}` }))}
                    value={createForm.workspace_ids}
                    onChange={(vals: string[]) => setCreateForm(f => ({
                      ...f,
                      workspace_ids: Array.isArray(vals) ? vals.filter(Boolean) : [String(vals || '')].filter(Boolean),
                      data_scope: (Array.isArray(vals) ? vals[0] : vals) || f.data_scope,
                    }))}
                    isMulti={true}
                    placeholder="Chọn Workspace cho Team Leader..."
                    className="w-full"
                  />
                ) : createForm.role === 'member' ? (
                  // Multi-Workspace Member — same multi-select UX as Leader,
                  // but the backend enforces Member permission level (no
                  // Leader/Admin capability).
                  <SearchableSelect
                    label="Workspace"
                    icon="🗂️"
                    options={workspaces.map(ws => ({ id: ws.code, name: `${ws.name} — Dự án của team ${ws.name}` }))}
                    value={createForm.workspace_ids}
                    onChange={(vals: string[]) => setCreateForm(f => ({
                      ...f,
                      workspace_ids: Array.isArray(vals) ? vals.filter(Boolean) : [String(vals || '')].filter(Boolean),
                      data_scope: (Array.isArray(vals) ? vals[0] : vals) || f.data_scope,
                    }))}
                    isMulti={true}
                    placeholder="Chọn một hoặc nhiều Workspace cho Member..."
                    className="w-full"
                  />
                ) : (
                  // Viewer — single-Workspace dropdown (NO CHANGE per spec).
                  <select
                    value={createForm.data_scope}
                    onChange={e => setCreateForm(f => ({ ...f, data_scope: e.target.value }))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  >
                    {workspaces.map(ws => (
                      <option key={ws.code} value={ws.code}>{ws.name} — Chỉ dự án của team {ws.name}</option>
                    ))}
                  </select>
                )}
                {(createForm.role === 'leader' || createForm.role === 'member') && createForm.workspace_ids.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-1">Workspace chính:</span>
                    {createForm.workspace_ids.map(code => {
                      const ws = workspaces.find(w => w.code === code);
                      const isPrimary = createForm.data_scope === code;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setCreateForm(f => ({ ...f, data_scope: code }))}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10.5px] font-bold transition-colors ${
                            isPrimary ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:border-indigo-300'
                          }`}
                          title={isPrimary ? `${ws?.name || code} đang là Workspace chính` : `Đặt ${ws?.name || code} làm Workspace chính`}
                        >
                          {isPrimary && '🏠 '}{ws?.name || code}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] text-slate-400 italic">
                  {createForm.role === 'super_admin'
                    ? 'Super Admin truy cập tất cả Workspace — không cần chọn.'
                    : createForm.role === 'leader'
                      ? 'Chọn một hoặc nhiều Workspace. Chỉ Super Admin mới có thể thay đổi phạm vi này sau khi tạo.'
                      : createForm.role === 'member'
                        ? 'Member có thể thuộc nhiều Workspace — quyền MEMBER vẫn được giữ nguyên.'
                        : 'Viewer chỉ thuộc một Workspace duy nhất.'}
                </p>
              </div>

              {/* Member preview */}
              {createForm.member_id > 0 && (() => {
                const m = availableMembers.find(mb => mb.id === createForm.member_id);
                if (!m) return null;
                return (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
                    <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Thông tin thành viên liên kết</div>
                    <div className="text-xs text-slate-700 space-y-0.5">
                      <div><span className="font-semibold">Tên hiển thị:</span> {m.display_name}</div>
                      <div><span className="font-semibold">Họ tên:</span> {m.full_name}</div>
                      {m.team && <div><span className="font-semibold">Nhóm:</span> {m.team}</div>}
                      {m.position && <div><span className="font-semibold">Chức vụ:</span> {m.position}</div>}
                      {m.department && <div><span className="font-semibold">Phòng ban:</span> {m.department}</div>}
                    </div>
                  </div>
                );
              })()}
            </form>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 shrink-0">
              <button onClick={() => setShowCreate(false)} className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-xs font-bold transition-all">Hủy</button>
              <button onClick={handleCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm">Tạo tài khoản</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ EDIT MODAL ═══ */}
      {editAccount && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 w-full max-w-lg rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider">Chỉnh sửa tài khoản</h3>
              <button onClick={() => setEditAccount(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4 overflow-y-auto flex-1">
              {editError && (
                // Error banner — visible INSIDE the modal so the user does
                // not have to close the form to read it. Stays open so the
                // user can correct the data and resubmit.
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-xs flex items-start gap-2 font-semibold shadow-sm">
                  <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                  </svg>
                  <span className="flex-1">{editError}</span>
                  <button type="button" onClick={() => setEditError(null)} className="text-red-400 hover:text-red-700 transition-colors" title="Đóng thông báo">✕</button>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Email</label>
                <input
                  required type="email"
                  value={editForm.email}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Microsoft Mail</label>
                <input
                  type="email"
                  value={editForm.outlook_mail}
                  onChange={e => setEditForm(f => ({ ...f, outlook_mail: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  placeholder="user@outlook.com"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Họ tên</label>
                <input
                  value={editForm.full_name}
                  onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Liên kết thành viên</label>
                <SearchableSelect
                  label="thành viên"
                  icon="👤"
                  options={editMemberSelectOptions}
                  value={editForm.member_id || 0}
                  onChange={val => setEditForm(f => ({ ...f, member_id: Number(val) || 0 }))}
                  placeholder="Tìm thành viên để liên kết..."
                  className="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vai trò</label>
                <select
                  value={editForm.role}
                  onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                >
                  {roleOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Workspace</label>
                {editForm.role === 'super_admin' ? (
                  <div className="w-full bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700 font-bold flex items-center gap-2">
                    <span className="text-base">∞</span>
                    ALL Workspaces — Quản trị viên toàn hệ thống
                  </div>
                ) : editForm.role === 'leader' ? (
                  <SearchableSelect
                    label="Workspace"
                    icon="🗂️"
                    options={workspaces.map(ws => ({ id: ws.code, name: `${ws.name} — Dự án của team ${ws.name}` }))}
                    value={editForm.workspace_ids}
                    onChange={(vals: string[]) => setEditForm(f => {
                      const ids = Array.isArray(vals) ? vals.filter(Boolean) : [String(vals || '')].filter(Boolean);
                      // Adding/removing a Workspace never silently reassigns
                      // Chính — new ones just join as Phụ. Only fall back to
                      // the first code when there was no Chính chosen yet, or
                      // the previous Chính got removed from the list.
                      const dataScope = (f.data_scope && ids.includes(f.data_scope)) ? f.data_scope : (ids[0] || '');
                      return { ...f, workspace_ids: ids, data_scope: dataScope };
                    })}
                    isMulti={true}
                    placeholder="Chọn Workspace cho Team Leader..."
                    className="w-full"
                  />
                ) : editForm.role === 'member' ? (
                  // Multi-Workspace Member — same multi-select UX as Leader.
                  <SearchableSelect
                    label="Workspace"
                    icon="🗂️"
                    options={workspaces.map(ws => ({ id: ws.code, name: `${ws.name} — Dự án của team ${ws.name}` }))}
                    value={editForm.workspace_ids}
                    onChange={(vals: string[]) => setEditForm(f => {
                      const ids = Array.isArray(vals) ? vals.filter(Boolean) : [String(vals || '')].filter(Boolean);
                      // Adding/removing a Workspace never silently reassigns
                      // Chính — new ones just join as Phụ. Only fall back to
                      // the first code when there was no Chính chosen yet, or
                      // the previous Chính got removed from the list.
                      const dataScope = (f.data_scope && ids.includes(f.data_scope)) ? f.data_scope : (ids[0] || '');
                      return { ...f, workspace_ids: ids, data_scope: dataScope };
                    })}
                    isMulti={true}
                    placeholder="Chọn một hoặc nhiều Workspace cho Member..."
                    className="w-full"
                  />
                ) : (
                  // Viewer — single-Workspace dropdown (NO CHANGE per spec).
                  <select
                    value={editForm.data_scope}
                    onChange={e => setEditForm(f => ({ ...f, data_scope: e.target.value }))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  >
                    {workspaces.map(ws => (
                      <option key={ws.code} value={ws.code}>{ws.name} — Chỉ dự án của team {ws.name}</option>
                    ))}
                  </select>
                )}
                {(editForm.role === 'leader' || editForm.role === 'member') && editForm.workspace_ids.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-1">Workspace chính:</span>
                    {editForm.workspace_ids.map(code => {
                      const ws = workspaces.find(w => w.code === code);
                      const isPrimary = editForm.data_scope === code;
                      const primaryIsCleared = !editForm.data_scope;
                      if (isPrimary) {
                        // Currently Chính — click removes it (must be cleared
                        // before another Workspace can be picked, so this is
                        // never an accidental one-click reassignment).
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => setEditForm(f => ({ ...f, data_scope: '' }))}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10.5px] font-bold bg-indigo-600 text-white transition-colors"
                            title={`Bỏ ${ws?.name || code} khỏi vị trí Workspace chính`}
                          >
                            🏠 {ws?.name || code} · ✕ Bỏ chính
                          </button>
                        );
                      }
                      return (
                        <button
                          key={code}
                          type="button"
                          disabled={!primaryIsCleared}
                          onClick={() => setEditForm(f => ({ ...f, data_scope: code }))}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10.5px] font-bold transition-colors ${
                            primaryIsCleared
                              ? 'bg-white border border-indigo-300 text-indigo-600 hover:bg-indigo-50'
                              : 'bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed'
                          }`}
                          title={primaryIsCleared ? `Đặt ${ws?.name || code} làm Workspace chính` : 'Bỏ Workspace chính hiện tại trước'}
                        >
                          {ws?.name || code}
                        </button>
                      );
                    })}
                    {!editForm.data_scope && (
                      <span className="text-[10px] text-amber-600 font-semibold">← chọn 1 cái để làm Chính</span>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-slate-400 italic">
                  {editForm.role === 'super_admin'
                    ? 'Super Admin truy cập tất cả Workspace — không cần chọn.'
                    : editForm.role === 'leader'
                      ? 'Chỉ Super Admin mới có thể thay đổi phạm vi Workspace của Leader.'
                      : editForm.role === 'member'
                        ? 'Member có thể thuộc nhiều Workspace — quyền MEMBER vẫn được giữ nguyên.'
                        : 'Viewer chỉ thuộc một Workspace duy nhất.'}
                </p>
              </div>
            </form>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setEditAccount(null)} className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-xs font-bold transition-all">Hủy</button>
              <button onClick={handleEdit} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm">Lưu thay đổi</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
