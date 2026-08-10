'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';
import MembersView from '@/components/MembersView';
import { useRouter } from 'next/navigation';
import { isAdmin, isSuperAdmin, isLeader } from '@/lib/auth';
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
  role: string;
  data_scope: string;
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
  const isLeaderUser = isLeader();
  const roleOptions = isLeaderUser ? ROLE_OPTIONS.filter(option => LEADER_MANAGED_ROLES.has(option.value)) : ROLE_OPTIONS;
  const canLeaderManageAccount = (account: Account) => !isLeaderUser || LEADER_MANAGED_ROLES.has(account.role);
  const [authorized, setAuthorized] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [availableMembers, setAvailableMembers] = useState<MemberInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'accounts' | 'members'>('accounts');

  // filters
  const [searchName, setSearchName] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterScope, setFilterScope] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', role: 'member', data_scope: '', full_name: '', member_id: 0 });

  // Edit modal
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState({ email: '', full_name: '', role: '', data_scope: '', member_id: 0 });

  // Reset password modal

  useEffect(() => {
    if (!isAdmin()) {
      router.push('/dashboard');
    } else {
      setAuthorized(true);
      reload();
    }
  }, [router]);

  const reload = async () => {
    setLoading(true);
    try {
      const [accs, members, wss] = await Promise.all([
        getAccounts(),
        getAvailableMembers(),
        getWorkspaces().catch(() => [])
      ]);
      setAccounts(accs);
      setAvailableMembers(members);
      setWorkspaces(wss || []);
      setCreateForm(f => ({ ...f, data_scope: f.data_scope || (wss?.[0]?.code || '') }));
      setEditForm(f => ({ ...f, data_scope: f.data_scope || (wss?.[0]?.code || '') }));
    } catch {
      flash('Lỗi tải dữ liệu');
    } finally {
      setLoading(false);
    }
  };

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

  const filteredAccounts = useMemo(() => {
    const nameQuery = searchName.trim().toLowerCase();

    return accounts.filter(acc => {
      const nameMatch = !nameQuery || [
        acc.full_name,
        acc.member?.display_name,
        acc.member?.full_name,
      ].some(value => (value || '').toLowerCase().includes(nameQuery));

      const roleMatch = !filterRole || acc.role === filterRole;
      const scopeMatch = !filterScope || acc.data_scope === filterScope;
      const statusMatch = !filterStatus || (filterStatus === 'active' ? acc.is_active : !acc.is_active);

      return nameMatch && roleMatch && scopeMatch && statusMatch;
    });
  }, [accounts, searchName, filterRole, filterScope, filterStatus]);

  // Create
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAccount({
        email: createForm.email,
        role: createForm.role,
        data_scope: createForm.data_scope,
        full_name: createForm.full_name,
        member_id: createForm.member_id || undefined,
      });
      flash('Đã tạo tài khoản thành công');
      setShowCreate(false);
      setCreateForm({ email: '', role: 'member', data_scope: (workspaces?.[0]?.code || ''), full_name: '', member_id: 0 });
      reload();
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi tạo tài khoản');
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
    setEditForm({ email: acc.email, full_name: acc.full_name || '', role: acc.role, data_scope: acc.data_scope || (workspaces?.[0]?.code || ''), member_id: acc.member_id || 0 });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAccount) return;
    try {
      await updateAccount(editAccount.id, editForm);
      flash('Đã cập nhật tài khoản');
      setEditAccount(null);
      reload();
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi cập nhật tài khoản');
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
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen pt-[112px]">
        {/* Header */}
        <div className="fixed left-[230px] right-0 top-0 z-40 h-[56px] bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm">
          <h2 className="text-sm font-bold tracking-wider text-[#0f172a] uppercase">Quản lý tài khoản</h2>
          {activeTab === 'accounts' && (
            <button
              onClick={() => setShowCreate(true)}
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
        <div className="fixed left-[230px] right-0 top-[56px] z-30 h-[56px] bg-white border-b border-slate-200 px-8 flex gap-6 shadow-sm">
          <button
            onClick={() => setActiveTab('accounts')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'accounts'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            Quản lý tài khoản
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'members'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            Quản lý thành viên
          </button>
        </div>

        {/* Content */}
        <div className="p-8 max-w-7xl w-full mx-auto space-y-6">
          {saved && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-xs flex items-center gap-2 font-semibold shadow-sm">
              <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              {saved}
            </div>
          )}

          {activeTab === 'accounts' && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tổng tài khoản</div>
              <div className="text-2xl font-bold text-[#0f172a] mt-1">{accounts.length}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Đang hoạt động</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{accounts.filter(a => a.is_active).length}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Đã khóa</div>
              <div className="text-2xl font-bold text-red-500 mt-1">{accounts.filter(a => !a.is_active).length}</div>
            </div>
          </div>
              <div className="sticky top-[104px] z-30 bg-[#f8fafc]/95 backdrop-blur-sm">
              {/* Search & Filters */}
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm flex flex-wrap items-center gap-3">
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
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
                <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="sticky top-0 z-10 bg-slate-50 text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">ID</th>
                        <th className="sticky top-0 z-10 bg-slate-50 text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Email</th>
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
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 italic">Đang tải...</td></tr>
                  ) : filteredAccounts.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 italic">Chưa có tài khoản nào</td></tr>
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
                        <td className="px-4 py-3 text-slate-600">{acc.full_name || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${ROLE_COLORS[acc.role] || 'bg-slate-100 text-slate-600'}`}>
                            {ROLE_LABELS[acc.role] || acc.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {scopeLabels[acc.data_scope] || acc.data_scope}
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
            <MembersView onFlash={flash} />
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
              {/* Member Selection */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Liên kết thành viên (tùy chọn)</label>
                <select
                  value={createForm.member_id}
                  onChange={e => handleMemberSelect(Number(e.target.value))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                >
                  <option value={0}>— Không liên kết thành viên —</option>
                  {availableMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.display_name} — {m.full_name}{m.team ? ` (${m.team})` : ''}</option>
                  ))}
                </select>
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
                <select
                  value={createForm.data_scope}
                  onChange={e => setCreateForm(f => ({ ...f, data_scope: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                >
                  {workspaces.map(ws => (
                    <option key={ws.code} value={ws.code}>{ws.name} — Chỉ dự án của team {ws.name}</option>
                  ))}
                  <option value="all">All — Tất cả dự án</option>
                </select>
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
          <div className="bg-white border border-slate-200 w-full max-w-lg rounded-xl shadow-xl overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider">Chỉnh sửa tài khoản</h3>
              <button onClick={() => setEditAccount(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
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
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Họ tên</label>
                <input
                  value={editForm.full_name}
                  onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Liên kết thành viên</label>
                <select
                  value={editForm.member_id}
                  onChange={e => setEditForm(f => ({ ...f, member_id: Number(e.target.value) }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                >
                  <option value={0}>— Không liên kết thành viên —</option>
                  {editAccount.member && (
                    <option value={editAccount.member.id}>
                      {editAccount.member.display_name} — {editAccount.member.full_name}{editAccount.member.team ? ` (${editAccount.member.team})` : ''}
                    </option>
                  )}
                  {availableMembers
                    .filter(m => m.id !== editAccount.member?.id)
                    .map(m => (
                      <option key={m.id} value={m.id}>{m.display_name} — {m.full_name}{m.team ? ` (${m.team})` : ''}</option>
                    ))}
                </select>
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
                <select
                  value={editForm.data_scope}
                  onChange={e => setEditForm(f => ({ ...f, data_scope: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                >
                  {workspaces.map(ws => (
                    <option key={ws.code} value={ws.code}>{ws.name} — Chỉ dự án của team {ws.name}</option>
                  ))}
                  <option value="all">All — Tất cả dự án</option>
                </select>
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
