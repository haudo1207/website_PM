'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import SearchableSelect from '@/components/common/SearchableSelect';
import ZaloConversationPane from '@/components/zalo/ZaloConversationPane';
import { isMemberOrAbove } from '@/lib/auth';
import {
  getZaloStatus,
  importZaloSession,
  disconnectZalo,
  getZaloConversations,
  getZaloAvailableGroups,
  trackZaloGroup,
  sendZaloMessageToThread,
  refreshZaloConversationNames,
  linkZaloConversationToProject,
  getProjects,
  ZaloConversation,
  ZaloAvailableGroup,
} from '@/lib/api';
import { requestZaloSessionCookies, isZaloExtensionInstalled, ZaloExtensionError } from '@/lib/zaloExtension';

const initialsOf = (name: string) =>
  (name || '?').trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

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

  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);

  const { data: conversations = [], refetch: refetchConversations } = useQuery({
    queryKey: ['zalo-conversations'],
    queryFn: getZaloConversations,
    enabled: authorized && !!status?.connected,
    refetchInterval: 5000,
  });

  const { data: availableGroups = [], refetch: refetchAvailableGroups } = useQuery({
    queryKey: ['zalo-available-groups'],
    queryFn: getZaloAvailableGroups,
    enabled: authorized && !!status?.connected,
  });

  // Explicit "pick the real group, start tracking it right now" — instead
  // of only ever discovering a conversation reactively (whenever a message
  // happens to arrive through it), which left the user with no way to know
  // which of the auto-populated "Hội thoại nhóm" entries was the one they
  // actually cared about testing/using.
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const handleTrackGroup = async (threadId: string, name: string) => {
    setTrackingId(threadId);
    try {
      const result = await trackZaloGroup(threadId, name);
      await Promise.all([refetchAvailableGroups(), refetchConversations()]);
      setSelectedConversationId(result.conversation_id);
    } catch (err: any) {
      alert('Lỗi theo dõi nhóm: ' + (err.response?.data?.detail || err.message));
    } finally {
      setTrackingId(null);
    }
  };

  const [refreshingNames, setRefreshingNames] = useState(false);
  const handleRefreshNames = async () => {
    setRefreshingNames(true);
    try {
      await refreshZaloConversationNames();
      await refetchConversations();
    } finally {
      setRefreshingNames(false);
    }
  };

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-for-zalo-link'],
    queryFn: () => getProjects(),
    enabled: authorized,
  });

  const handleLinkProject = async (conversationId: number, projectId: string) => {
    await linkZaloConversationToProject(conversationId, projectId ? Number(projectId) : null);
    await refetchConversations();
  };


  // Phase-1 helper: there is no reliable "browse all Zalo conversations" API
  // (see plan doc), so the first message to a brand-new thread is sent by
  // pasting its Zalo thread/user id by hand.
  const [newThreadId, setNewThreadId] = useState('');
  const [newThreadIsGroup, setNewThreadIsGroup] = useState(false);
  const [newThreadText, setNewThreadText] = useState('');
  const [sendingNewThread, setSendingNewThread] = useState(false);
  const [newThreadError, setNewThreadError] = useState('');

  const handleSendToNewThread = async () => {
    if (!newThreadId.trim() || !newThreadText.trim()) return;
    setSendingNewThread(true);
    setNewThreadError('');
    try {
      const result = await sendZaloMessageToThread({
        thread_id: newThreadId.trim(),
        text: newThreadText.trim(),
        is_group: newThreadIsGroup,
      });
      setNewThreadText('');
      setSelectedConversationId(result.conversation_id);
    } catch (err: any) {
      setNewThreadError(err?.response?.data?.detail || 'Gửi thất bại.');
    } finally {
      setSendingNewThread(false);
    }
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

          {/* Explicit group picker — pick the correct real group from Zalo
              (same source-of-truth as the "gửi tin nhắn thử" picker below)
              and start tracking it immediately, instead of waiting for a
              message to reactively create it and hoping it's the right one. */}
          {status?.connected && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-sm font-bold text-slate-700">👥 Chọn nhóm Zalo để theo dõi</span>
                <button onClick={() => refetchAvailableGroups()} className="text-xs font-bold text-slate-500 hover:text-[#0058be]">↻ Tải lại danh sách</button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Đây là danh sách nhóm THẬT lấy trực tiếp từ tài khoản Zalo đang kết nối. Chọn đúng nhóm bạn muốn —
                hệ thống sẽ bắt đầu theo dõi và nhận tin nhắn của nhóm đó ngay, không cần đợi có tin nhắn mới rồi mới tự hiện.
              </p>
              {availableGroups.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Chưa tải được nhóm nào — đợi vài giây sau khi kết nối rồi bấm "Tải lại danh sách".</p>
              ) : (
                <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto border border-slate-100 rounded-xl">
                  {availableGroups.map(g => (
                    <div key={g.thread_id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-sm font-semibold text-slate-800 truncate">{g.name}</span>
                      {g.already_tracked ? (
                        <span className="shrink-0 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">✓ Đang theo dõi</span>
                      ) : (
                        <button
                          onClick={() => handleTrackGroup(g.thread_id, g.name)}
                          disabled={trackingId === g.thread_id}
                          className="shrink-0 text-[11px] font-bold text-white bg-[#0058be] hover:bg-[#00499e] px-2.5 py-1 rounded-lg disabled:opacity-60"
                        >
                          {trackingId === g.thread_id ? 'Đang thêm…' : '+ Theo dõi'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Manual send-to-new-thread — tucked away, only needed once per brand-new thread */}
          <details className="group bg-white border border-slate-200 rounded-2xl shadow-sm">
            <summary className="cursor-pointer select-none list-none px-5 py-3.5 flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-bold text-slate-700">⚙️ Gửi tin nhắn thử tới 1 hội thoại mới</span>
              <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-5 pb-5">
              <p className="text-xs text-slate-500 mb-3">
                Chưa có danh sách hội thoại đầy đủ (Zalo không cung cấp API duyệt hết hội thoại) — chọn nhanh 1 group bên
                dưới (lấy từ cache của zalo-worker, không cần mở lại chat.zalo.me), hoặc tự nhập Zalo user/group id.
              </p>
              {availableGroups.length > 0 && (
                <div className="mb-2">
                  <SearchableSelect
                    label="group"
                    icon="👥"
                    className="w-full"
                    options={availableGroups.map(g => ({
                      id: g.thread_id,
                      name: g.name,
                      badge: g.already_tracked ? 'Đã có' : undefined,
                    }))}
                    value=""
                    onChange={(id: string) => {
                      const g = availableGroups.find(g => g.thread_id === id);
                      if (g) { setNewThreadId(g.thread_id); setNewThreadIsGroup(true); }
                    }}
                    placeholder="Gõ tên group để tìm nhanh…"
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2 items-center">
                <input value={newThreadId} onChange={e => setNewThreadId(e.target.value)} placeholder="Zalo user/group id"
                  className="px-3 py-2 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal border-2 border-slate-300 rounded-lg w-56 focus:border-[#0058be] focus:outline-none" />
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <input type="checkbox" checked={newThreadIsGroup} onChange={e => setNewThreadIsGroup(e.target.checked)} />
                  Là nhóm
                </label>
                <input value={newThreadText} onChange={e => setNewThreadText(e.target.value)} placeholder="Nội dung tin nhắn"
                  className="px-3 py-2 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal border-2 border-slate-300 rounded-lg flex-1 min-w-[200px] focus:border-[#0058be] focus:outline-none" />
                <button onClick={handleSendToNewThread} disabled={sendingNewThread || !status?.connected}
                  className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-60">
                  {sendingNewThread ? 'Đang gửi…' : 'Gửi'}
                </button>
              </div>
              {newThreadError && <p className="text-xs text-red-600 mt-2">{newThreadError}</p>}
            </div>
          </details>

          {/* Conversation list + thread */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm grid grid-cols-1 md:grid-cols-[380px_1fr] h-[78vh] min-h-[560px] max-h-[860px] overflow-hidden">
            <div className="border-r border-slate-200 flex flex-col min-h-0">
              <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70 shrink-0">
                <span className="text-sm font-bold text-slate-800">Hội thoại nhóm ({conversations.length})</span>
                <button onClick={handleRefreshNames} disabled={refreshingNames}
                  title="Cập nhật lại tên hội thoại từ Zalo (cho các hội thoại cũ)"
                  className="text-xs font-bold text-slate-500 hover:text-[#0058be] disabled:opacity-50">
                  {refreshingNames ? '…' : '↻ Cập nhật tên'}
                </button>
              </div>
              <div className="divide-y divide-slate-100 overflow-y-auto flex-1 min-h-0">
                {conversations.map((c: ZaloConversation) => (
                  <div key={c.id}
                    className={`w-full text-left px-3.5 py-3 cursor-pointer border-l-4 transition-colors ${selectedConversationId === c.id ? 'bg-blue-50 border-l-[#0058be]' : 'border-l-transparent hover:bg-slate-50'}`}
                    onClick={() => setSelectedConversationId(c.id)}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#0058be] to-indigo-500 text-white flex items-center justify-center text-[11px] font-extrabold shrink-0">
                        {initialsOf(c.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-800 truncate">{c.name}</div>
                        <div className="text-xs text-slate-500 truncate">{c.last_message_preview || 'Chưa có tin nhắn'}</div>
                      </div>
                    </div>
                    <select
                      value={c.project_id ?? ''}
                      onClick={e => e.stopPropagation()}
                      onChange={e => handleLinkProject(c.id, e.target.value)}
                      className={`mt-2 w-full text-xs font-semibold rounded-lg px-2 py-1.5 border-2 ${c.project_id ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600'}`}
                      title="Gán hội thoại này vào 1 dự án để giao task/yêu cầu demo qua Zalo">
                      <option value="">— Chưa gán dự án —</option>
                      {projects.map((p: { id: number; name: string }) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {conversations.length === 0 && (
                  <div className="px-4 py-8 text-sm text-slate-400 text-center">Chưa có hội thoại nhóm nào.</div>
                )}
              </div>
            </div>
            <div className="flex flex-col min-h-0">
              {selectedConversationId === null ? (
                <div className="flex-1 flex flex-col items-center justify-center text-sm text-slate-400 gap-2">
                  <span className="text-4xl">👈</span>
                  Chọn 1 hội thoại nhóm để xem tin nhắn.
                </div>
              ) : (
                <ZaloConversationPane conversationId={selectedConversationId} />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
