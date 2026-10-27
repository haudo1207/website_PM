'use client';
import React, { useState, useEffect } from 'react';
import { X, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { getGoogleStatus, getGoogleAuthUrl, getAiSettings, saveAiSettings, getWorkspaces, Workspace } from '@/lib/api';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';
import { isSuperAdmin } from '@/lib/auth';

interface Props { isOpen: boolean; onClose: () => void; }

// One workspace's Google connect card: every workspace now has its own
// dedicated Google account (no more single shared fallback account shown in
// this UI), so this is reused both for the single card shown when a specific
// workspace is filtered and for the full list shown when filter = "All".
function WorkspaceGoogleCard({ code, label }: { code: string; label: string }) {
  const [isConnected, setIsConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [expectedEmail, setExpectedEmail] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  // GET /meetings/google/auth is Super Admin only (403 otherwise) — hide the
  // connect action for everyone else rather than letting it fail.
  const canConnect = isSuperAdmin();

  const check = async () => {
    setIsChecking(true);
    try {
      const data = await getGoogleStatus(code);
      setIsConnected(!!data.connected);
      setEmail(data.google_email || null);
      setExpectedEmail(data.expected_google_email || null);
    } catch (err) {
      console.error(`Failed to check Google status for workspace ${code}`, err);
    } finally {
      setIsChecking(false);
    }
  };

  // Email actually connected takes priority once it exists; before that,
  // show the admin-set hint (Workspace.expected_google_email) so whoever
  // clicks Connect knows which mailbox to log in with.
  const displayEmail = email || expectedEmail;

  // Re-check whenever the workspace this card represents changes (the single-card
  // case reuses one <WorkspaceGoogleCard> across re-renders as workspaceCode
  // switches, so `code` itself is the dependency, not just mount).
  useEffect(() => { check(); }, [code]);

  const handleConnect = async () => {
    if (!canConnect) return;
    setConnectError(null);
    setIsConnecting(true);
    try {
      const data = await getGoogleAuthUrl(code);
      if (data?.auth_url) {
        const win = window.open(data.auth_url, '_blank');
        if (!win) setConnectError('Trình duyệt đã chặn cửa sổ đăng nhập Google — hãy cho phép pop-up rồi thử lại.');
      } else {
        setConnectError(`Không thể lấy liên kết xác thực Google cho workspace ${label}.`);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      setConnectError(
        status === 403
          ? 'Chỉ Super Admin được kết nối tài khoản Google.'
          : `Lỗi kết nối API Google Auth (${label}): ${typeof detail === 'string' ? detail : (err?.message || 'Không xác định')}`
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="p-4 bg-sky-50/50 border border-sky-200/80 rounded-xl space-y-3 flex-shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-[#0b1c30]">Tài khoản Google {label}{displayEmail ? ` (${displayEmail})` : ''}</h3>
          <p className="text-[11px] text-[#565e74] mt-0.5">Tài khoản Google riêng cho workspace {label} — dùng để tạo link Google Meet & đồng bộ biên bản cho các cuộc họp thuộc workspace này.</p>
        </div>
        {isChecking ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 flex-shrink-0">
            <RefreshCw size={10} className="animate-spin" />
            ĐANG KIỂM TRA...
          </span>
        ) : isConnected ? (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            ĐÃ KẾT NỐI
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">
            CHƯA KẾT NỐI
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {canConnect ? (
          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting}
            className="bg-white hover:bg-slate-50 text-[#0058be] border border-[#0058be] text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-2xs disabled:opacity-60"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-3.5 h-3.5" />
            <span>{isConnecting ? 'Đang lấy liên kết...' : isConnected ? `🔄 Ủy quyền lại tài khoản ${label}` : `🔗 Kết nối tài khoản Google ${label}`}</span>
          </button>
        ) : (
          <span className="text-[11px] text-[#565e74] italic">Chỉ Super Admin được kết nối tài khoản Google.</span>
        )}

        <button
          type="button"
          onClick={check}
          disabled={isChecking}
          className="p-1.5 text-[#565e74] hover:text-[#0b1c30] rounded-lg hover:bg-slate-200/60 transition-colors inline-flex items-center justify-center gap-1.5 text-xs font-semibold"
          title="Làm mới trạng thái kết nối"
        >
          <RefreshCw size={14} className={isChecking ? 'animate-spin' : ''} />
          {isChecking ? 'Đang kiểm tra...' : 'Kiểm tra lại kết nối'}
        </button>
      </div>
      {connectError && (
        <div className="p-2.5 bg-red-50 text-red-600 text-[11px] rounded-lg flex items-start gap-2 font-semibold border border-red-200">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{connectError}</span>
        </div>
      )}
    </div>
  );
}

export default function PromptSettingsModal({ isOpen, onClose }: Props) {
  const { workspaceCode } = useWorkspaceFilter();
  // A specific workspace filtered → show only that workspace's card.
  // Filter = "All" (or nothing picked) → show every workspace's card, since
  // there's no more single "shared account" fallback surfaced in this UI.
  const hasWorkspace = !!workspaceCode && workspaceCode.toLowerCase() !== 'all';

  const [promptTemplate, setPromptTemplate] = useState('');
  const [hasApiKey, setHasApiKey] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    fetchSettings();
    if (!hasWorkspace) {
      getWorkspaces().then(setAllWorkspaces).catch(err => console.error('Failed to load workspaces', err));
    }
  }, [isOpen, workspaceCode]);

  const fetchSettings = async () => {
    setIsLoading(true); setError(''); setSuccess(false);
    try {
      const data = await getAiSettings();
      if (data.success) { setPromptTemplate(data.promptTemplate); setHasApiKey(data.hasApiKey); }
      else setError(data.error || 'Không thể tải cấu hình AI.');
    } catch (err: any) { setError(err.response?.data?.error || err.message || 'Lỗi kết nối.'); }
    finally { setIsLoading(false); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSaving(true); setError(''); setSuccess(false);
    try {
      const data = await saveAiSettings(promptTemplate);
      if (data.success) { setSuccess(true); setTimeout(onClose, 1000); }
      else setError(data.error || 'Lỗi khi lưu.');
    } catch (err: any) { setError(err.response?.data?.error || err.message || 'Lỗi kết nối.'); }
    finally { setIsSaving(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col my-auto">
        <div className="px-6 py-4 border-b border-[#c2c6d6]/40 flex items-center justify-between bg-[#f8f9fe] flex-shrink-0">
          <div className="flex items-center gap-2 text-[#0058be]"><Sparkles size={18} /><h2 className="text-[14px] font-bold text-[#0b1c30]">Cấu hình AI Prompt Template</h2></div>
          <button onClick={onClose} className="p-1.5 text-[#565e74] hover:text-[#0b1c30] rounded-lg hover:bg-[#eff4ff] transition-colors"><X size={18} /></button>
        </div>
        <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="p-6 space-y-4 flex-1 overflow-y-auto min-h-0">
            {error && <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg flex items-start gap-2 font-semibold border border-red-200"><AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>}
            {success && <div className="p-3 bg-emerald-50 text-emerald-700 text-xs rounded-lg font-semibold border border-emerald-200">✓ Đã lưu cấu hình Prompt AI thành công!</div>}
            {!hasApiKey && <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg flex items-start gap-2"><AlertTriangle size={18} className="mt-0.5 text-amber-600 flex-shrink-0" /><div><span className="font-bold">Cảnh báo:</span> Chưa tìm thấy GEMINI_API_KEY trong file .env.</div></div>}

            {/* Google Calendar & Drive Connection — 1 card khi đang lọc theo 1
                workspace cụ thể, hoặc đủ danh sách khi đang xem "Tất cả". */}
            {hasWorkspace ? (
              <WorkspaceGoogleCard code={workspaceCode!} label={workspaceCode!.toUpperCase()} />
            ) : (
              allWorkspaces.map(w => (
                <WorkspaceGoogleCard key={w.code} code={w.code} label={w.name || w.code.toUpperCase()} />
              ))
            )}

            <div>
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1">Prompt mẫu để tóm tắt cuộc họp:</label>
              <p className="text-[11px] text-[#727785] mb-2">Prompt này chỉ định cách AI (Gemini) phân tích biên bản cuộc họp.</p>
              {isLoading ? (
                <div className="w-full h-48 border border-[#c2c6d6] rounded-lg bg-[#f0f2f5] flex items-center justify-center text-[#565e74] text-xs"><div className="w-3 h-3 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin mr-2" />Đang tải...</div>
              ) : (
                <textarea value={promptTemplate} onChange={e => setPromptTemplate(e.target.value)} className="w-full min-h-[140px] h-48 px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-[12px] font-mono focus:outline-none focus:border-[#0058be] transition-all leading-relaxed text-[#0b1c30] resize-y" placeholder="Nhập Prompt tóm tắt hệ thống ở đây..." required />
              )}
            </div>
          </div>
          <div className="px-6 py-4 bg-[#f8f9fe] border-t border-[#c2c6d6]/40 flex items-center justify-end gap-3 flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-[#565e74] bg-white border border-[#c2c6d6] rounded-lg hover:bg-[#f0f2f5] transition-colors">Hủy</button>
            <button type="submit" disabled={isSaving || isLoading} className="px-4 py-2 text-xs font-bold text-white bg-[#0058be] rounded-lg hover:bg-[#0058be]/90 transition-colors disabled:opacity-70 shadow-sm">{isSaving ? 'Đang lưu...' : 'Lưu cấu hình'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
