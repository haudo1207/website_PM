'use client';
import React, { useState, useEffect } from 'react';
import { X, Sparkles, AlertTriangle } from 'lucide-react';

interface Props { isOpen: boolean; onClose: () => void; }

export default function PromptSettingsModal({ isOpen, onClose }: Props) {
  const [promptTemplate, setPromptTemplate] = useState('');
  const [hasApiKey, setHasApiKey] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => { if (isOpen) fetchSettings(); }, [isOpen]);

  const fetchSettings = async () => {
    setIsLoading(true); setError(''); setSuccess(false);
    try {
      const res = await fetch('/api/ai/settings');
      const data = await res.json();
      if (data.success) { setPromptTemplate(data.promptTemplate); setHasApiKey(data.hasApiKey); }
      else setError(data.error || 'Không thể tải cấu hình AI.');
    } catch (err: any) { setError(err.message || 'Lỗi kết nối.'); }
    finally { setIsLoading(false); }
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
