'use client';

import React, { useState } from 'react';
import { Video, Folder, Calendar, Clock, User, Sparkles, MoreVertical, ChevronRight, ExternalLink } from 'lucide-react';

interface MeetingCardProps {
  meeting: any;
  onDelete?: (id: string) => void;
  onSummarize?: (meeting: any) => void;
  onSync?: (meeting: any) => Promise<any>;
  onOpenDetail?: (meeting: any) => void;
}

export default function MeetingCard({ meeting, onDelete, onSummarize, onSync, onOpenDetail }: MeetingCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncClick = async () => {
    if (!onSync || isSyncing) return;
    setIsSyncing(true);
    try {
      await onSync(meeting);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Lỗi khi đồng bộ cuộc họp');
    } finally {
      setIsSyncing(false);
    }
  };

  const statusUpper = String(meeting.status || 'SẮP TỚI').toUpperCase();
  const isDone = statusUpper === 'ĐÃ DIỄN RA' || statusUpper === 'DONE' || statusUpper === 'COMPLETED';
  const isProcessing = statusUpper === 'ĐANG XỬ LÝ AI' || (meeting as any).ai_status === 'processing';
  
  const durationStr = meeting.duration ? `${meeting.duration} phút` : '30 phút';
  const execSummary = meeting.executive_summary || (meeting.summary && meeting.summary.length ? meeting.summary[0] : '');
  const hasAISummary = Boolean(execSummary || meeting.ai_summary);

  const creatorName = meeting.creator_name || meeting.creator?.display_name || meeting.created_by_name || 'Host mkt.szone';
  const platformName = meeting.platform || 'Google Meet';
  const isN8nSource = meeting.ai_summary?.source === 'n8n_google_sheet' || meeting.ai_summary?.n8n_metadata;
  const isAutoCreated = Boolean(meeting.is_auto_created ?? meeting.ai_summary?.is_auto_created);

  const rawLink = meeting.meet_link || meeting.link || meeting.meeting_url || meeting.join_url || '';
  const baseLink = rawLink ? (rawLink.startsWith('http') ? rawLink : `https://${rawLink}`) : 'https://meet.google.com/new';
  const hostJoinLink = baseLink.includes('authuser=')
    ? baseLink
    : `${baseLink}${baseLink.includes('?') ? '&' : '?'}authuser=mkt.szone@gmail.com`;

  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] p-4 sm:p-5 shadow-2xs hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
      {/* Left Column: Meeting Info & Badges */}
      <div className="flex items-start gap-3.5 flex-1 min-w-0">
        <div className="w-11 h-11 rounded-2xl bg-[#f5f3ff] text-[#6366f1] flex items-center justify-center shrink-0 border border-[#e0e7ff] mt-0.5">
          {hasAISummary ? <Video size={20} className="text-[#6366f1]" /> : <Folder size={20} className="text-amber-600" />}
        </div>

        <div className="space-y-2 min-w-0 flex-1">
          {/* Title & Badges Row */}
          <div>
            <h3 
              onClick={() => onOpenDetail?.(meeting)} 
              className="font-bold text-[#0b1c30] text-sm sm:text-[15px] hover:text-[#6366f1] cursor-pointer transition-colors leading-snug"
            >
              {meeting.title || 'Cuộc họp chưa có tên'}
            </h3>

            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              {isDone ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#dcfce7] text-[#166534]">
                  Completed
                </span>
              ) : isProcessing ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                  Processing
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700">
                  Scheduled
                </span>
              )}

              {hasAISummary ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#f5f3ff] text-[#6366f1]">
                  AI Summary sẵn sàng
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                  Chưa có AI Summary
                </span>
              )}

              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#f1f5f9] text-[#64748b]">
                {platformName}
              </span>

              {isAutoCreated && (
                <span
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-50 text-teal-700 border border-teal-200"
                  title="Meeting này không được tạo qua nút 'Tạo meeting' trên web — n8n tự động tạo từ video ghi hình phát hiện được"
                >
                  🤖 Tự động tạo
                </span>
              )}
            </div>
          </div>

          {/* Sub Metadata Row */}
          <div className="flex items-center gap-4 text-[12px] text-[#64748b] flex-wrap font-medium pt-0.5">
            <span className="flex items-center gap-1">
              <Calendar size={13} className="text-[#94a3b8]" />
              {meeting.date || meeting.meeting_date || 'Chưa đặt ngày'}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={13} className="text-[#94a3b8]" />
              {meeting.time || meeting.start_time || 'Chưa đặt giờ'}
            </span>
            <span className="flex items-center gap-1">
              <User size={13} className="text-[#94a3b8]" />
              {creatorName}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={13} className="text-[#94a3b8]" />
              {durationStr}
            </span>
          </div>
        </div>
      </div>

      {/* Middle Column: AI Summary Box (Light Purple Tint Container) */}
      <div className="w-full md:w-[320px] lg:w-[360px] shrink-0 cursor-pointer" onClick={() => onOpenDetail?.(meeting)}>
        {hasAISummary ? (
          <div className="bg-[#f8f6ff] border border-[#eee9fe] rounded-2xl p-3 sm:p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 text-[#6366f1] text-[11px] font-bold uppercase tracking-wider">
              <Sparkles size={13} />
              <span>AI Summary sẵn sàng</span>
            </div>
            <p className="text-[12px] text-[#475569] leading-relaxed line-clamp-2 font-normal">
              {execSummary}
            </p>
          </div>
        ) : (
          <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-2xl p-3 sm:p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 text-[#64748b] text-[11px] font-bold uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full border-2 border-slate-400"></span>
              <span>Chưa có AI Summary</span>
            </div>
            <p className="text-[12px] text-[#94a3b8] leading-relaxed italic">
              Sẽ được tạo sau khi kết thúc
            </p>
          </div>
        )}
      </div>

      {/* Right Column: Actions */}
      <div className="flex items-center justify-end gap-2 shrink-0 flex-wrap sm:flex-nowrap">
        {/* Join as Host link */}
        <a
          href={hostJoinLink}
          target="_blank"
          rel="noreferrer"
          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1"
          title="Vào Google Meet bằng tài khoản Host mkt.szone@gmail.com để duyệt người tham gia và bật ghi âm"
        >
          <Video size={14} />
          <span>Tham gia (Host)</span>
          <ExternalLink size={11} />
        </a>

        <button
          type="button"
          onClick={() => onOpenDetail?.(meeting)}
          className="px-3 py-2 bg-white hover:bg-[#f8fafc] border border-[#cbd5e1] text-[#475569] hover:text-[#0b1c30] text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1"
        >
          <span>Xem chi tiết</span>
          <ChevronRight size={14} />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 text-[#94a3b8] hover:text-[#0b1c30] rounded-xl hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200"
          >
            <MoreVertical size={16} />
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-30 text-xs font-medium">
              <button
                onClick={() => { setShowMenu(false); onOpenDetail?.(meeting); }}
                className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-[#0b1c30]"
              >
                Xem chi tiết
              </button>
              {onSummarize && (
                <button
                  onClick={() => { setShowMenu(false); onSummarize(meeting); }}
                  className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-purple-700"
                >
                  Chạy AI Tóm tắt
                </button>
              )}
              {onSync && (
                <button
                  onClick={() => { setShowMenu(false); handleSyncClick(); }}
                  disabled={isSyncing}
                  className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-[#0058be] disabled:opacity-50"
                >
                  {isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ (Sync)'}
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => { setShowMenu(false); onDelete(meeting.id); }}
                  className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-red-600 border-t border-slate-100"
                >
                  Xóa cuộc họp
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


