'use client';
import React, { useState, useEffect } from 'react';
import { X, Sparkles, AlertTriangle, FileText, Save, Edit3, Eye } from 'lucide-react';

import { updateMeeting } from '@/lib/api';

interface Props { isOpen: boolean; onClose: () => void; meeting: any; onSave: (m: any) => void; }

export default function SummarizeModal({ isOpen, onClose, meeting, onSave }: Props) {
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState<string[]>([]);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (meeting && isOpen) {
      setTranscript(meeting.transcript || '');
      setSummary(meeting.summary || []);
      setIsEditingSummary(false); setError('');
    }
  }, [meeting, isOpen]);

  const handleSummarize = async () => {
    if (!transcript.trim()) { setError('Vui lòng dán/nhập biên bản cuộc họp trước.'); return; }
    setIsLoading(true); setError('');
    try {
      const res = await fetch('/api/ai/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId: meeting.id, transcript }) });
      const data = await res.json();
      if (res.ok && data.success) { setSummary(data.summary || []); setIsEditingSummary(false); }
      else setError(data.error || 'Lỗi khi gửi văn bản đến AI.');
    } catch (err: any) { setError(err.message || 'Không thể kết nối API tóm tắt.'); }
    finally { setIsLoading(false); }
  };

  const handleSaveAll = async () => {
    if (!meeting) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await updateMeeting(meeting.id, {
        ...meeting,
        transcript,
        summary,
        status: 'ĐÃ DIỄN RA'
      });
      if (data.success) {
        onSave(data.data);
        onClose();
      } else {
        setError('Lỗi khi lưu cuộc họp vào database.');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Lỗi kết nối khi lưu cuộc họp.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !meeting) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#c2c6d6]/40 flex items-center justify-between bg-[#f8f9fe] flex-shrink-0">
          <div className="flex items-center gap-2 text-emerald-600"><Sparkles size={18} /><h2 className="text-[14px] font-bold text-[#0b1c30]">Tóm tắt AI: {meeting.title}</h2></div>
          <button onClick={onClose} className="p-1.5 text-[#565e74] hover:text-[#0b1c30] rounded-lg hover:bg-[#eff4ff] transition-colors"><X size={18} /></button>
        </div>

        {/* Two Column Layout */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* Left: Transcript */}
          <div className="flex-1 p-6 flex flex-col min-h-0 border-r border-[#c2c6d6]/40">
            <span className="text-[12px] font-bold text-[#565e74] flex items-center gap-1.5 mb-2"><FileText size={16} className="text-[#727785]" />Biên bản cuộc họp / Transcript</span>
            {error && <div className="mb-3 p-3 bg-red-50 text-red-600 text-xs rounded-lg flex items-start gap-2 border border-red-200"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>}
            <textarea value={transcript} onChange={e => setTranscript(e.target.value)} className="w-full flex-1 p-3 border border-[#c2c6d6] rounded-lg text-xs focus:outline-none focus:border-[#0058be] transition-all resize-none leading-relaxed text-[#0b1c30]" placeholder="Dán hoặc viết biên bản cuộc họp (Transcript/Meeting Notes) thô vào đây..." />
            <div className="mt-4 flex-shrink-0">
              <button type="button" onClick={handleSummarize} disabled={isLoading || !transcript.trim()} className="w-full py-2.5 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-all shadow disabled:opacity-50">
                <Sparkles size={16} />{isLoading ? 'AI đang tóm tắt cuộc họp...' : 'Tạo tóm tắt bằng Gemini AI'}
              </button>
            </div>
          </div>

          {/* Right: AI Summary */}
          <div className="flex-1 p-6 bg-[#f8f9fe] flex flex-col min-h-0 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[12px] font-bold text-[#565e74] flex items-center gap-1.5"><Sparkles size={16} className="text-emerald-500" />Kết quả Tóm tắt (AI Summary)</span>
              <button type="button" onClick={() => {
                if (summary.length === 0) {
                  setSummary([`MEETING SUMMARY – ${meeting.title || 'Cuộc họp'}`, `Ngày họp: ${meeting.date || ''}`, 'Team: Không đề cập', 'Người summary: Không đề cập', '', 'Task cha đã chốt', '1. Project: Không đề cập', '• Task cha: ', '• Priority: Medium', '• Owner: ', '• Deadline: ', '• KPI / Output: ']);
                  setIsEditingSummary(true);
                } else setIsEditingSummary(!isEditingSummary);
              }} className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-md transition-colors border border-emerald-200">
                {isEditingSummary ? <><Eye size={14} />Xem trước</> : <><Edit3 size={14} />{summary.length === 0 ? '+ Tự viết' : 'Chỉnh sửa'}</>}
              </button>
            </div>
            {isEditingSummary ? (
              <div className="flex-1 flex flex-col"><textarea value={summary.join('\n')} onChange={e => setSummary(e.target.value.split('\n'))} className="w-full flex-1 p-4 border border-emerald-300 rounded-xl text-xs focus:outline-none focus:border-emerald-500 transition-all resize-none leading-relaxed bg-white" placeholder="Nhập nội dung tóm tắt..." /></div>
            ) : summary.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-[#c2c6d6] border-dashed rounded-xl bg-white">
                <Sparkles size={32} className="text-[#c2c6d6] mb-2" /><p className="text-xs font-bold text-[#565e74]">Chưa có bản tóm tắt AI</p><p className="text-[11px] text-[#727785] mt-1">Hãy dán nội dung hoặc click &quot;Tạo tóm tắt&quot;</p>
              </div>
            ) : (
              <div className="bg-white border border-[#c2c6d6]/60 p-5 rounded-xl shadow-sm space-y-1 max-h-[50vh] overflow-y-auto text-xs text-[#565e74] leading-relaxed">
                {summary.map((item, idx) => {
                  const t = item.trim();
                  const isBullet = t.startsWith('•') || t.startsWith('*') || t.startsWith('-');
                  const isNum = /^\d+\./.test(t);
                  const isTitle = t.startsWith('MEETING SUMMARY') || t.startsWith('Task cha đã chốt');
                  let cn = "min-h-[20px]";
                  if (isBullet) cn += " pl-5 text-[#727785]";
                  else if (isNum) cn += " font-bold text-[#0b1c30] mt-3";
                  else if (isTitle) cn += " font-bold text-[#0b1c30] text-[13px] mt-2";
                  else cn += " text-[#565e74]";
                  return <div key={idx} className={cn}>{item}</div>;
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#f8f9fe] border-t border-[#c2c6d6]/40 flex items-center justify-end gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-[#565e74] bg-white border border-[#c2c6d6] rounded-lg hover:bg-[#f0f2f5] transition-colors">Đóng</button>
          <button type="button" onClick={handleSaveAll} disabled={summary.length === 0} className="px-4 py-2 flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm"><Save size={16} />Lưu & Hoàn tất</button>
        </div>
      </div>
    </div>
  );
}
