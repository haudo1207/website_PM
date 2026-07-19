'use client';
import React, { useState, useEffect } from 'react';
import { X, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { getGoogleStatus, getGoogleAuthUrl } from '@/lib/api';

interface Props { isOpen: boolean; onClose: () => void; }

export default function PromptSettingsModal({ isOpen, onClose }: Props) {
  const [promptTemplate, setPromptTemplate] = useState('');
  const [hasApiKey, setHasApiKey] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [isCheckingGoogle, setIsCheckingGoogle] = useState(false);

  useEffect(() => { if (isOpen) fetchSettings(); }, [isOpen]);

  const fetchSettings = async () => {
    setIsLoading(true); setError(''); setSuccess(false);
    try {
      const res = await fetch('/api/ai/settings');
      const data = await res.json();
      if (data.success) { setPromptTemplate(data.promptTemplate); setHasApiKey(data.hasApiKey); }
      else setError(data.error || 'Không thể tải cấu hình AI.');

      await checkGoogleConnection();
    } catch (err: any) { setError(err.message || 'Lỗi kết nối.'); }
    finally { setIsLoading(false); }
  };

  const checkGoogleConnection = async () => {
    setIsCheckingGoogle(true);
    try {
      const googleData = await getGoogleStatus();
      setIsGoogleConnected(!!googleData.connected);
    } catch (err) {
      console.error("Failed to check Google status", err);
    } finally {
      setIsCheckingGoogle(false);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      const data = await getGoogleAuthUrl();
      if (data.auth_url) {
        window.open(data.auth_url, '_blank');
      } else {
        alert("Không thể lấy liên kết xác thực Google. Hãy chắc chắn bạn đã điền GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET vào .env.");
      }
    } catch (err: any) {
      alert("Lỗi kết nối API Google Auth: " + (err.response?.data?.detail || err.message));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSaving(true); setError(''); setSuccess(false);
    try {
      const res = await fetch('/api/ai/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promptTemplate }) });
      const data = await res.json();
      if (data.success) { setSuccess(true); setTimeout(onClose, 1000); }
      else setError(data.error || 'Lỗi khi lưu.');
    } catch (err: any) { setError(err.message || 'Lỗi kết nối.'); }
    finally { setIsSaving(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#c2c6d6]/40 flex items-center justify-between bg-[#f8f9fe]">
          <div className="flex items-center gap-2 text-[#0058be]"><Sparkles size={18} /><h2 className="text-[14px] font-bold text-[#0b1c30]">Cấu hình AI Prompt Template</h2></div>
          <button onClick={onClose} className="p-1.5 text-[#565e74] hover:text-[#0b1c30] rounded-lg hover:bg-[#eff4ff] transition-colors"><X size={18} /></button>
        </div>
        <form onSubmit={handleSave}>
          <div className="p-6 space-y-4">
            {error && <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg flex items-start gap-2 font-semibold border border-red-200"><AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>}
            {success && <div className="p-3 bg-emerald-50 text-emerald-700 text-xs rounded-lg font-semibold border border-emerald-200">✓ Đã lưu cấu hình Prompt AI thành công!</div>}
            {!hasApiKey && <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg flex items-start gap-2"><AlertTriangle size={18} className="mt-0.5 text-amber-600 flex-shrink-0" /><div><span className="font-bold">Cảnh báo:</span> Chưa tìm thấy GEMINI_API_KEY trong file .env.</div></div>}
            
            {/* Google Calendar & Drive Connection */}
            <div className="p-4 bg-slate-50 border border-[#c2c6d6]/40 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-[#0b1c30]">Kết nối Google Calendar & Drive</h3>
                  <p className="text-[11px] text-[#565e74]">Yêu cầu để tự động sinh link Google Meet và đồng bộ transcript từ Google Drive.</p>
                </div>
                {isGoogleConnected ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    ĐÃ KẾT NỐI
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                    CHƯA KẾT NỐI
                  </span>
                )}
              </div>
              
              <div className="flex flex-wrap items-center gap-2">
                {!isGoogleConnected ? (
                  <button
                    type="button"
                    onClick={handleConnectGoogle}
                    className="bg-white hover:bg-slate-50 text-[#0058be] border border-[#0058be] text-xs font-bold px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <img src="https://www.google.com/favicon.ico" alt="Google" className="w-3.5 h-3.5" />
                    Kết nối tài khoản Google
                  </button>
                ) : (
                  <div className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                    ✓ Google Calendar & Drive đã sẵn sàng!
                  </div>
                )}
                <button
                  type="button"
                  onClick={checkGoogleConnection}
                  disabled={isCheckingGoogle}
                  className="p-2 text-[#565e74] hover:text-[#0b1c30] rounded-lg hover:bg-slate-200/60 transition-colors inline-flex items-center justify-center gap-1.5 text-xs font-semibold"
                  title="Làm mới trạng thái kết nối"
                >
                  <RefreshCw size={14} className={isCheckingGoogle ? 'animate-spin' : ''} />
                  {isCheckingGoogle ? 'Đang kiểm tra...' : 'Kiểm tra lại kết nối'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-2">Prompt mẫu để tóm tắt cuộc họp:</label>
              <p className="text-[11px] text-[#727785] mb-3">Prompt này chỉ định cách AI (Gemini) phân tích biên bản cuộc họp.</p>
              {isLoading ? (
                <div className="w-full h-64 border border-[#c2c6d6] rounded-lg bg-[#f0f2f5] flex items-center justify-center text-[#565e74] text-xs"><div className="w-3 h-3 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin mr-2" />Đang tải...</div>
              ) : (
                <textarea value={promptTemplate} onChange={e => setPromptTemplate(e.target.value)} className="w-full h-72 px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-[12px] font-mono focus:outline-none focus:border-[#0058be] transition-all leading-relaxed text-[#0b1c30]" placeholder="Nhập Prompt tóm tắt hệ thống ở đây..." required />
              )}
            </div>
          </div>
          <div className="px-6 py-4 bg-[#f8f9fe] border-t border-[#c2c6d6]/40 flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-[#565e74] bg-white border border-[#c2c6d6] rounded-lg hover:bg-[#f0f2f5] transition-colors">Hủy</button>
            <button type="submit" disabled={isSaving || isLoading} className="px-4 py-2 text-xs font-bold text-white bg-[#0058be] rounded-lg hover:bg-[#0058be]/90 transition-colors disabled:opacity-70 shadow-sm">{isSaving ? 'Đang lưu...' : 'Lưu cấu hình'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

