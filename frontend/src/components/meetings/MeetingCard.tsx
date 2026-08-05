'use client';

import React from 'react';

interface MeetingCardProps {
  meeting: any;
  onEdit?: (meeting: any) => void;
  onDelete?: (id: string) => void;
  onSummarize?: (meeting: any) => void;
  onSync?: (meeting: any) => Promise<any>;
}

export default function MeetingCard({ meeting, onDelete, onSummarize }: MeetingCardProps) {
  const statusUpper = String(meeting.status || 'CHƯA DIỄN RA').toUpperCase();
  const isDone = statusUpper === 'ĐÃ DIỄN RA' || statusUpper === 'DONE' || statusUpper === 'COMPLETED';
  const isProcessing = statusUpper === 'ĐANG XỬ LÝ AI' || (meeting as any).ai_status === 'processing';
  
  // Real attendee count from meeting.members array
  const attendeeCount = Array.isArray(meeting.members) 
    ? meeting.members.length 
    : (meeting.member_count !== undefined ? meeting.member_count : (meeting.people || 0));

  const durationStr = meeting.duration ? `${meeting.duration} phút` : (meeting.time ? '30 phút' : 'Chưa đặt');
  const execSummary = meeting.executive_summary || (meeting.summary && meeting.summary.length ? meeting.summary[0] : '');
  const hasAISummary = Boolean(execSummary && isDone);
  const tasksCount = Array.isArray(meeting.recommended_tasks) ? meeting.recommended_tasks.length : 0;

  return (
    <div className="bg-white rounded-2xl border border-[#e4eaf3] p-5 shadow-xs hover:shadow-md transition-all space-y-4">
      {/* Top Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-[#17253d] text-[15px]">{meeting.title || 'Cuộc họp chưa có tên'}</h3>
            
            {/* Real Status Badge */}
            {isDone ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                Completed
              </span>
            ) : isProcessing ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                Processing
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 text-blue-700 border border-blue-200">
                Chưa diễn ra
              </span>
            )}
          </div>
          
          <div className="mt-1 flex items-center gap-2">
            {/* Real AI Summary Badge */}
            {hasAISummary ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                AI Summary sẵn sàng
              </span>
            ) : isProcessing ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                🔴 AI đang xử lý
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                Chưa có AI Summary
              </span>
            )}
          </div>
        </div>

        {onDelete && (
          <button onClick={() => onDelete(meeting.id)} className="text-[11px] text-slate-400 hover:text-red-500 font-medium">Xóa</button>
        )}
      </div>

      {/* Real Metadata Line */}
      <div className="text-[11px] text-[#718096] flex items-center gap-3 flex-wrap font-medium">
        <span>📅 {meeting.date || meeting.meeting_date || 'Chưa chọn'} · {meeting.time || meeting.start_time || 'Chưa chọn'}</span>
        <span>👤 {attendeeCount} người</span>
        <span>⏱ {durationStr}</span>
      </div>

      {/* Dynamic Stepper Workflow (4 steps) */}
      <div className="grid grid-cols-4 gap-1.5 text-[10px] font-extrabold text-center">
        <span className="py-1.5 px-2 rounded-lg bg-[#dcfce7] text-[#07865f]">1. Ghi nhận</span>
        
        <span className={`py-1.5 px-2 rounded-lg ${hasAISummary ? 'bg-[#dcfce7] text-[#07865f]' : isProcessing ? 'bg-[#fff7e8] text-[#c26900]' : 'bg-[#edf2f7] text-[#8190a6]'}`}>
          2. AI Summary
        </span>
        
        <span className={`py-1.5 px-2 rounded-lg ${hasAISummary && tasksCount > 0 ? 'bg-[#ede9fe] text-[#6d28d9]' : 'bg-[#edf2f7] text-[#8190a6]'}`}>
          3. Duyệt task
        </span>
        
        <span className="py-1.5 px-2 rounded-lg bg-[#edf2f7] text-[#8190a6]">
          4. Push Project
        </span>
      </div>

      {/* Dynamic AI Summary Box */}
      {hasAISummary ? (
        <div className="bg-[#f6f3ff] border border-[#ddd6fe] rounded-xl p-3.5 space-y-1">
          <b className="text-[11px] text-[#6d28d9] uppercase tracking-wider block">✦ AI TÓM TẮT</b>
          <p className="text-[12px] text-[#516079] leading-relaxed">
            {execSummary}
          </p>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1">
          <b className="text-[11px] text-slate-500 uppercase tracking-wider block">✦ AI TÓM TẮT</b>
          <p className="text-[12px] text-slate-500 leading-relaxed italic">
            Cuộc họp chưa diễn ra hoặc chưa có biên bản. Dán/nhập biên bản cuộc họp để AI tự động tóm tắt và tách task.
          </p>
        </div>
      )}

      {/* Dynamic Action Buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => onSummarize?.(meeting)}
          disabled={isProcessing}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-xs ${
            isProcessing
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : hasAISummary && tasksCount > 0
              ? 'bg-[#1769d2] hover:bg-[#1258b3] text-white'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
          }`}
        >
          {isProcessing
            ? 'Đang xử lý...'
            : hasAISummary && tasksCount > 0
            ? `Xem ${tasksCount} task AI tạo`
            : 'Tạo tóm tắt & Task AI'}
        </button>

        <button
          type="button"
          onClick={() => onSummarize?.(meeting)}
          className="px-4 py-2 rounded-xl text-xs font-bold text-[#445168] bg-white border border-[#dce3ee] hover:bg-slate-50 transition-all shadow-xs"
        >
          ⇩ Biên bản
        </button>
      </div>
    </div>
  );
}
