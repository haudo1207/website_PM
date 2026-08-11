'use client';

import { useEffect, useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';
import { getMe, getWorkspaces, getMyLoginHistory, MeProfile, Workspace, LoginHistoryItem } from '@/lib/api';

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

function InfoField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-sm text-[#0b1c30]">{value || '—'}</div>
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const cls =
    action === 'FAILED_LOGIN' ? 'bg-rose-100 text-rose-700' :
    action === 'LOGOUT' ? 'bg-slate-100 text-slate-600' :
    'bg-blue-50 text-[#0058be]';
  const label = action === 'FAILED_LOGIN' ? 'Đăng nhập thất bại' : action === 'LOGOUT' ? 'Đăng xuất' : 'Đăng nhập';
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{label}</span>;
}

function formatDateTime(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('vi-VN');
}

function ProfileSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-36 rounded-2xl bg-white border border-[#c2c6d6]/50" />
      <div className="h-40 rounded-2xl bg-white border border-[#c2c6d6]/50" />
      <div className="h-24 rounded-2xl bg-white border border-[#c2c6d6]/50" />
      <div className="h-32 rounded-2xl bg-white border border-[#c2c6d6]/50" />
      <div className="h-40 rounded-2xl bg-white border border-[#c2c6d6]/50" />
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [lastLogin, setLastLogin] = useState<LoginHistoryItem | null>(null);
  const [loading, setLoading] = useState(true);

  const [history, setHistory] = useState<LoginHistoryItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    Promise.all([getMe(), getWorkspaces().catch(() => []), getMyLoginHistory(1).catch(() => [])])
      .then(([me, ws, last]) => {
        setProfile(me);
        setWorkspaces(ws || []);
        setLastLogin(last?.[0] || null);
      })
      .finally(() => setLoading(false));
  }, []);

  const scopeLabel = useMemo(() => {
    if (!profile) return '';
    if (profile.data_scope === 'all') return 'Tất cả dự án';
    const ws = workspaces.find(w => w.code === profile.data_scope);
    return ws ? `Dự án ${ws.name}` : profile.data_scope;
  }, [profile, workspaces]);

  const toggleHistory = () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (history !== null) return;
    setHistoryLoading(true);
    getMyLoginHistory(20)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  };

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#0b1c30]" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <Navbar />
      <main className="md:ml-[230px] px-4 py-6 md:px-6 lg:px-8 pt-16 md:pt-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <div>
            <h1 className="text-xl font-bold text-[#0b1c30]">Hồ sơ cá nhân</h1>
            <p className="text-sm text-[#565e74] mt-0.5">Thông tin tài khoản và công việc của bạn</p>
          </div>

          {loading ? (
            <ProfileSkeleton />
          ) : !profile ? (
            <div className="rounded-2xl border border-[#c2c6d6]/50 bg-white p-6 text-sm text-[#565e74]">
              Không tải được thông tin hồ sơ. Vui lòng thử lại.
            </div>
          ) : (
            <>
              {/* Identity header card */}
              <div className="rounded-2xl border border-[#c2c6d6]/50 bg-white shadow-sm overflow-hidden">
                <div className="h-16 bg-gradient-to-r from-[#0058be] to-[#3b82f6]" />
                <div className="px-4 sm:px-6 pb-6 -mt-8">
                  <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={profile.full_name || 'User'}
                        referrerPolicy="no-referrer"
                        className="w-20 h-20 rounded-full object-cover border-4 border-white shadow-sm"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-[#0058be] border-4 border-white shadow-sm flex items-center justify-center text-xl font-bold text-white uppercase">
                        {profile.full_name ? profile.full_name.substring(0, 2) : 'US'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0 pb-1">
                      <h2 className="text-lg font-bold text-[#0b1c30] truncate">{profile.full_name || 'Chưa đặt tên'}</h2>
                      <p className="text-sm text-[#565e74] truncate">{profile.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 pb-1">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${ROLE_COLORS[profile.role] || 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABELS[profile.role] || profile.role}
                      </span>
                      {scopeLabel && (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                          {scopeLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-4 text-xs text-[#565e74]">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${profile.is_active ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      {profile.is_active ? 'Đang hoạt động' : 'Đã bị khóa'}
                    </span>
                    <span>·</span>
                    <span>{profile.login_method}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <div className="space-y-4">
                  {/* Work info card */}
                  <div className="rounded-2xl border border-[#c2c6d6]/50 bg-white shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-bold text-[#0b1c30] uppercase tracking-wide mb-4">Thông tin công việc</h3>
                    {!profile.member && !profile.department && !profile.position ? (
                      <p className="text-sm text-[#565e74]">Tài khoản chưa liên kết hồ sơ nhân sự.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                        <InfoField label="Phòng ban" value={profile.department} />
                        <InfoField label="Chức vụ" value={profile.position} />
                        <InfoField label="Nhóm" value={profile.member?.team} />
                        <InfoField label="Quản lý trực tiếp" value={profile.member?.leader_name} />
                        <InfoField label="Số điện thoại" value={profile.member?.phone} />
                        <InfoField
                          label="Kinh nghiệm"
                          value={profile.member?.experience_year != null ? `${profile.member.experience_year} năm` : undefined}
                        />
                      </div>
                    )}
                  </div>

                  {/* Skills card */}
                  <div className="rounded-2xl border border-[#c2c6d6]/50 bg-white shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-bold text-[#0b1c30] uppercase tracking-wide mb-4">Kỹ năng</h3>
                    {profile.skills.length === 0 ? (
                      <p className="text-sm text-[#565e74]">Chưa có kỹ năng nào được gán.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {profile.skills.map(s => (
                          <span key={s} className="bg-blue-50 text-blue-700 text-[11px] px-2.5 py-1 rounded-full font-semibold">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Account & Security card */}
                <div className="rounded-2xl border border-[#c2c6d6]/50 bg-white shadow-sm p-4 sm:p-6 space-y-4">
                  <h3 className="text-sm font-bold text-[#0b1c30] uppercase tracking-wide">Tài khoản & bảo mật</h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <InfoField label="Google Account" value={profile.email} />
                    <InfoField label="Phương thức đăng nhập" value={profile.login_method} />
                    <InfoField label="Trạng thái" value={profile.is_active ? 'Đang hoạt động' : 'Đã bị khóa'} />
                    <InfoField
                      label="Đăng nhập gần nhất"
                      value={
                        lastLogin
                          ? `${formatDateTime(lastLogin.created_at)}${[lastLogin.browser, lastLogin.os].filter(Boolean).length ? ' · ' + [lastLogin.browser, lastLogin.os].filter(Boolean).join(' · ') : ''}`
                          : undefined
                      }
                    />
                  </div>
                  <p className="text-xs text-[#565e74] border-t border-[#c2c6d6]/50 pt-3">
                    Tên và ảnh đại diện được đồng bộ tự động từ tài khoản Google mỗi lần đăng nhập, không thể chỉnh sửa trực tiếp tại đây. Mật khẩu được quản lý bởi Google.
                  </p>
                  <button
                    onClick={toggleHistory}
                    className="text-sm font-semibold text-[#0058be] hover:underline"
                  >
                    {historyOpen ? 'Ẩn lịch sử đăng nhập' : 'Xem lịch sử đăng nhập'}
                  </button>

                  {historyOpen && (
                    <div className="border-t border-[#c2c6d6]/50 pt-3 space-y-1">
                      {historyLoading ? (
                        <div className="text-sm text-[#565e74] py-2">Đang tải...</div>
                      ) : !history || history.length === 0 ? (
                        <div className="text-sm text-[#565e74] py-2">Chưa có lịch sử đăng nhập.</div>
                      ) : (
                        history.map(h => (
                          <div
                            key={h.id}
                            className="flex flex-col gap-1 py-2.5 border-b border-[#c2c6d6]/30 last:border-0"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <ActionBadge action={h.action} />
                              <span className="text-sm text-[#0b1c30]">{formatDateTime(h.created_at)}</span>
                              {h.is_new_device && (
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Thiết bị mới</span>
                              )}
                              {h.is_new_ip && (
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">IP mới</span>
                              )}
                            </div>
                            <div className="text-xs text-[#565e74]">
                              {[h.browser, h.os].filter(Boolean).join(' · ')}
                              {h.ip_address ? ` · ${h.ip_address}` : ''}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
