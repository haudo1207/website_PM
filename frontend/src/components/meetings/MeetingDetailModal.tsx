'use client';

import React, { useState } from 'react';
import { X, Video, Share2, Check, ExternalLink, Calendar, Clock, User, Users, Edit3, Sparkles, Link as LinkIcon, Building2 } from 'lucide-react';

interface MeetingDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: any;
  onEdit?: (meeting: any) => void;
  onSummarize?: (meeting: any) => void;
}

export default function MeetingDetailModal({
  isOpen,
  onClose,
  meeting,
  onEdit,
  onSummarize
}: MeetingDetailModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !meeting) return null;

  const rawLink = meeting.meet_link || meeting.link || meeting.meeting_url || meeting.join_url || '';
  const meetingLink = rawLink ? (rawLink.startsWith('http') ? rawLink : `https://${rawLink}`) : '';

  const creatorName = meeting.creator_name || meeting.creator?.display_name || meeting.created_by_name || 'Trang Nguyễn';
  const durationStr = meeting.duration ? `${meeting.duration} phút` : (meeting.time ? '60 phút' : 'Chưa xác định');
  const platformName = meeting.platform || 'Google Meet';
  const projectName = typeof meeting.project === 'string' ? meeting.project : (meeting.project?.name || meeting.project_name || 'Dự án chung');

  const statusUpper = String(meeting.status || 'SẮP TỚI').toUpperCase();
  const isDone = statusUpper === 'ĐÃ DIỄN RA' || statusUpper === 'DONE' || statusUpper === 'COMPLETED';

  const handleShare = () => {
    if (!meetingLink) {
      alert("Cuộc họp này chưa có đường link. Bạn có thể bổ sung link bằng nút 'Sửa cuộc họp'.");
      return;
    }
    navigator.clipboard.writeText(meetingLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const membersList = Array.isArray(meeting.members) ? meeting.members : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col border border-slate-200 animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 bg-[#f8f9fe] border-b border-[#c2c6d6]/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#eff4ff] text-[#0058be] flex items-center justify-center">
              <Calendar size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#0b1c30]">Chi tiết cuộc họp</h2>
              <p className="text-[11px] text-[#565e74]">Thông tin chi tiết và liên kết tham gia</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#565e74] hover:text-[#0b1c30] rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          
          {/* Main Title & Status Banner */}
          <div className="p-4 bg-[#edf5ff] border border-[#b8d8ff] rounded-xl space-y-2">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-extrabold text-[#0b1c30] text-base leading-snug">
                {meeting.title || 'Cuộc họp chưa có tên'}
              </h3>
              <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                isDone
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                  : 'bg-blue-100 text-[#0058be] border-blue-300'
              }`}>
                {isDone ? 'Đã diễn ra' : 'Sắp tới'}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-[#565e74] flex-wrap font-medium pt-1 border-t border-[#cce3ff]">
              <span className="flex items-center gap-1 font-bold text-[#0058be]">
                <Building2 size={13} />
                {projectName}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Video size={13} className="text-slate-500" />
                {platformName}
              </span>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Host */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <User size={12} className="text-[#0058be]" />
                Người Host (Khởi tạo)
              </span>
              <p className="font-bold text-[#0b1c30] text-sm">{creatorName}</p>
            </div>

            {/* Time & Duration */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Clock size={12} className="text-[#0058be]" />
                Thời gian & Thời lượng
              </span>
              <p className="font-bold text-[#0b1c30]">
                {meeting.date || meeting.meeting_date || 'Chưa đặt ngày'} · {meeting.time || meeting.start_time || '09:00'}
              </p>
              <p className="text-[11px] text-slate-500 font-medium">Thời lượng: {durationStr}</p>
            </div>
          </div>

          {/* Meeting Link Card */}
          <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                <LinkIcon size={14} className="text-[#0058be]" />
                Link cuộc họp ({platformName})
              </span>
              {meetingLink && (
                <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  Link đã sẵn sàng
                </span>
              )}
            </div>

            {meetingLink ? (
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-[#0b1c30] truncate select-all">
                {meetingLink}
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 italic">
                Chưa có đường link cuộc họp. Bạn có thể nhấn Sửa cuộc họp để thêm link hoặc tạo tự động.
              </div>
            )}

            {/* Interactive Link Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              {/* Share / Copy Link */}
              <button
                type="button"
                onClick={handleShare}
                className="flex-1 py-2 px-3 bg-white hover:bg-slate-50 border border-slate-300 text-[#0b1c30] text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-2xs"
              >
                {copied ? (
                  <>
                    <Check size={15} className="text-emerald-600" />
                    <span className="text-emerald-600 font-bold">Đã chép link!</span>
                  </>
                ) : (
                  <>
                    <Share2 size={15} className="text-[#0058be]" />
                    <span>Chia sẻ / Sao chép link</span>
                  </>
                )}
              </button>

              {/* Join Meeting Button */}
              {meetingLink ? (
                <a
                  href={`${meetingLink.startsWith('http') ? meetingLink : `https://${meetingLink}`}${meetingLink.includes('?') ? '&' : '?'}authuser=mkt.szone@gmail.com`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm text-center"
                >
                  <Video size={15} />
                  <span>Tham gia cuộc họp</span>
                  <ExternalLink size={12} />
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex-1 py-2 px-3 bg-slate-100 text-slate-400 text-xs font-bold rounded-xl cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <Video size={15} />
                  <span>Chưa có link</span>
                </button>
              )}
            </div>
          </div>

          {/* Members / Participants Section */}
          {membersList.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block flex items-center gap-1.5">
                <Users size={14} className="text-[#0058be]" />
                Người tham dự ({membersList.length})
              </span>
              <div className="flex flex-wrap gap-2">
                {membersList.map((m: any, idx: number) => (
                  <div key={idx} className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-[#0b1c30] flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-[#0058be]/10 text-[#0058be] text-[10px] font-bold flex items-center justify-center">
                      {(m.display_name || m.full_name || 'U')[0].toUpperCase()}
                    </div>
                    <span>{m.display_name || m.full_name || 'Thành viên'}</span>
                    {m.role && <span className="text-[10px] text-slate-400 font-normal">({m.role})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-[#f8f9fe] border-t border-[#c2c6d6]/40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={() => { onClose(); onEdit(meeting); }}
                className="px-3.5 py-2 bg-white hover:bg-slate-100 text-[#0b1c30] border border-slate-300 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-2xs"
              >
                <Edit3 size={14} className="text-slate-600" />
                <span>Sửa cuộc họp</span>
              </button>
            )}

            {onSummarize && (
              <button
                type="button"
                onClick={() => { onClose(); onSummarize(meeting); }}
                className="px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
              >
                <Sparkles size={14} className="text-purple-600" />
                <span>Dán biên bản / Chạy AI</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 text-xs font-bold rounded-xl transition-colors"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
}
