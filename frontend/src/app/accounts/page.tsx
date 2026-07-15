'use client';
import React, { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { useRouter } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import {
  getAccounts,
  getAvailableMembers,
  createAccount,
  updateAccount,
  resetAccountPassword,
  lockAccount,
  unlockAccount,
  deleteAccount,
} from '@/lib/api';

interface MemberInfo {
  id: number;
  display_name: string;
  full_name: string;
  email?: string;
  team?: string;
  position?: string;
  department?: string;
}

interface Account {
  id: number;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  member_id: number | null;
  member: MemberInfo | null;
  created_at: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  group_a: 'Group A',
  group_b: 'Group B',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  group_a: 'bg-blue-100 text-blue-700',
  group_b: 'bg-emerald-100 text-emerald-700',
};

export default function AccountsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [availableMembers, setAvailableMembers] = useState<MemberInfo[]>([]);
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', password: '', role: 'group_a', full_name: '', member_id: 0 });

  // Edit modal
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState({ email: '', full_name: '', role: '' });

  // Reset password modal
  const [resetAccount, setResetAccount] = useState<Account | null>(null);
  const [resetPw, setResetPw] = useState('');

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
      const [accs, members] = await Promise.all([getAccounts(), getAvailableMembers()]);
      setAccounts(accs);
      setAvailableMembers(members);
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

  // Create
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAccount({
        email: createForm.email,
        password: createForm.password,
        role: createForm.role,
        full_name: createForm.full_name,
        member_id: createForm.member_id || undefined,
      });
      flash('Đã tạo tài khoản thành công');
      setShowCreate(false);
      setCreateForm({ email: '', password: '', role: 'group_a', full_name: '', member_id: 0 });
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
    setEditAccount(acc);
    setEditForm({ email: acc.email, full_name: acc.full_name || '', role: acc.role });
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

  // Reset password
  const handleResetPw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetAccount) return;
    try {
      await resetAccountPassword(resetAccount.id, resetPw);
      flash('Đã đặt lại mật khẩu thành công');
      setResetAccount(null);
      setResetPw('');
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi đặt lại mật khẩu');
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
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
        {/* Header */}
        <div className="h-[56px] bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-40 shadow-sm">
          <h2 className="text-sm font-bold tracking-wider text-[#0f172a] uppercase">Quản lý tài khoản</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Tạo tài khoản
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

          {/* Table */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">ID</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Email</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Họ tên</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Role</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Thành viên</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Trạng thái</th>
                    <th className="text-right px-4 py-3 font-bold text-slate-500 uppercase tracking-wider">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 italic">Đang tải...</td></tr>
                  ) : accounts.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 italic">Chưa có tài khoản nào</td></tr>
                  ) : (
                    accounts.map(acc => (
                      <tr key={acc.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-400">{acc.id}</td>
                        <td className="px-4 py-3 font-semibold text-[#0f172a]">{acc.email}</td>
                        <td className="px-4 py-3 text-slate-600">{acc.full_name || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${ROLE_COLORS[acc.role] || 'bg-slate-100 text-slate-600'}`}>
                            {ROLE_LABELS[acc.role] || acc.role}
                          </span>
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
                            <button onClick={() => openEdit(acc)} className="text-blue-600 hover:underline font-medium" title="Sửa">Sửa</button>
                            <span className="text-slate-200">|</span>
                            <button onClick={() => { setResetAccount(acc); setResetPw(''); }} className="text-amber-600 hover:underline font-medium" title="Đặt lại mật khẩu">Mật khẩu</button>
                            <span className="text-slate-200">|</span>
                            <button onClick={() => handleToggleLock(acc)} className={`hover:underline font-medium ${acc.is_active ? 'text-orange-600' : 'text-emerald-600'}`}>
                              {acc.is_active ? 'Khóa' : 'Mở khóa'}
                            </button>
                            <span className="text-slate-200">|</span>
                            <button onClick={() => handleDelete(acc)} className="text-red-600 hover:underline font-medium" title="Xóa">Xóa</button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mật khẩu <span className="text-red-500">*</span></label>
                  <input
                    required type="password"
                    value={createForm.password}
                    onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                    placeholder="••••••••"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vai trò <span className="text-red-500">*</span></label>
                  <select
                    value={createForm.role}
                    onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  >
                    <option value="admin">Admin — Toàn quyền</option>
                    <option value="group_b">Group B — Xem tất cả dự án</option>
                    <option value="group_a">Group A — Chỉ xem dự án tham gia</option>
                  </select>
                </div>
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
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vai trò</label>
                <select
                  value={editForm.role}
                  onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                >
                  <option value="admin">Admin — Toàn quyền</option>
                  <option value="group_b">Group B — Xem tất cả dự án</option>
                  <option value="group_a">Group A — Chỉ xem dự án tham gia</option>
                </select>
              </div>
              {editAccount.member && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Thành viên liên kết</div>
                  <div className="text-xs text-slate-600">
                    <span className="font-semibold">{editAccount.member.display_name}</span> — {editAccount.member.full_name}
                    {editAccount.member.team && <span className="text-slate-400"> · {editAccount.member.team}</span>}
                  </div>
                </div>
              )}
            </form>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setEditAccount(null)} className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-xs font-bold transition-all">Hủy</button>
              <button onClick={handleEdit} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm">Lưu thay đổi</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ RESET PASSWORD MODAL ═══ */}
      {resetAccount && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 w-full max-w-md rounded-xl shadow-xl overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider">Đặt lại mật khẩu</h3>
                <p className="text-xs text-slate-400 mt-0.5">{resetAccount.email}</p>
              </div>
              <button onClick={() => setResetAccount(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleResetPw} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mật khẩu mới <span className="text-red-500">*</span></label>
                <input
                  required type="password"
                  value={resetPw}
                  onChange={e => setResetPw(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  placeholder="Nhập mật khẩu mới"
                />
              </div>
            </form>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setResetAccount(null)} className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-xs font-bold transition-all">Hủy</button>
              <button onClick={handleResetPw} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm">Đặt lại mật khẩu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
