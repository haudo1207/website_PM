'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { isMemberOrAbove } from '@/lib/auth';
import { getZaloStatus, importZaloSession, disconnectZalo } from '@/lib/api';
import { requestZaloSessionCookies, isZaloExtensionInstalled, ZaloExtensionError } from '@/lib/zaloExtension';

export default function ZaloAccountPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (!isMemberOrAbove()) {
      router.push('/dashboard/overview');
    } else {
      setAuthorized(true);
    }
  }, [router]);

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [extensionMissing, setExtensionMissing] = useState(false);

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['zalo-status'],
    queryFn: getZaloStatus,
    enabled: authorized,
    refetchInterval: 8000,
  });

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError('');
    setExtensionMissing(false);
    try {
      const installed = await isZaloExtensionInstalled();
      if (!installed) {
        setExtensionMissing(true);
        return;
      }
      const session = await requestZaloSessionCookies();
      await importZaloSession(session);
      await refetchStatus();
    } catch (err) {
      setConnectError(err instanceof ZaloExtensionError ? err.message : (err as any)?.response?.data?.detail || 'Kết nối thất bại.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Ngắt kết nối tài khoản Zalo?')) return;
    await disconnectZalo();
    await refetchStatus();
  };

  if (!authorized) return null;

  return (
    <div className="flex min-h-screen bg-[#F4F6FB]">
      <Navbar />
      <main className="flex-1 md:ml-64 pt-14 md:pt-0 p-4 md:p-8">
        <div className="max-w-[1400px] mx-auto space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#0058be]/10 flex items-center justify-center text-2xl shrink-0">💬</div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">Tài khoản Zalo giao task</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Kết nối tài khoản Zalo của riêng bạn, gán hội thoại vào dự án, giao task và yêu cầu xem demo trực tiếp từ Zalo.
              </p>
            </div>
          </div>

          {/* Connection status card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full shrink-0 ${status?.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <div>
                  <div className="font-bold text-slate-800 text-[15px]">
                    {status?.connected ? `Đã kết nối — ${status.account?.label}` : 'Chưa kết nối'}
                  </div>
                  {status?.connected && status.account?.last_login_at && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Đăng nhập lần cuối: {new Date(status.account.last_login_at).toLocaleString('vi-VN')}
                    </p>
                  )}
                  {status && !status.worker.configured && (
                    <p className="text-xs text-red-600 font-semibold mt-0.5">Zalo worker chưa được cấu hình (ZALO_WORKER_URL).</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <a href="/zalo-login-extension.zip" download
                  className="px-4 py-2 text-sm font-bold rounded-lg border-2 border-slate-300 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 3v12m0 0l-4-4m4 4l4-4" />
                  </svg>
                  Tải extension
                </a>
                {status?.connected ? (
                  <button onClick={handleDisconnect} className="px-4 py-2 text-sm font-bold rounded-lg border-2 border-red-300 text-red-600 hover:bg-red-50">
                    Ngắt kết nối
                  </button>
                ) : (
                  <button onClick={handleConnect} disabled={connecting} className="px-4 py-2 text-sm font-bold rounded-lg bg-[#0058be] text-white hover:bg-[#00499e] disabled:opacity-60">
                    {connecting ? 'Đang kết nối…' : 'Kết nối'}
                  </button>
                )}
              </div>
            </div>
            {extensionMissing && (
              <div className="mt-3 text-sm text-amber-800 bg-amber-50 border-2 border-amber-200 rounded-lg p-3">
                Chưa cài extension "KPI Portal Zalo Login". Bấm <strong>Tải extension</strong> ở trên, giải nén file zip
                ra 1 thư mục, vào <code>chrome://extensions</code> → bật Developer mode → Load unpacked → chọn thư mục
                vừa giải nén, rồi bấm Kết nối lại.
              </div>
            )}
            {connectError && (
              <div className="mt-3 text-sm text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-3">{connectError}</div>
            )}
          </div>

          {status?.connected && (
            <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-5 text-sm text-emerald-800">
              Đã kết nối — vào tab <b>Chats</b> của từng dự án để chọn nhóm Zalo, xem log chat, giao task và tóm tắt.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
