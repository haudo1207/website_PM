'use client';

import React, { useState } from 'react';
import { Video, Users, Sparkles, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

interface MeetingCardProps {
  meeting: {
    id: string;
    title: string;
    project?: string;
    platform: string;
    date: string;
    time: string;
    duration: string;
    link?: string;
    status: string;
    summary: string[];
  };
  onEdit?: (meeting: any) => void;
  onDelete?: (id: string) => void;
  onSummarize?: (meeting: any) => void;
  onSync?: (meeting: any) => Promise<any>;
}

export default function MeetingCard({ meeting, onEdit, onDelete, onSummarize, onSync }: MeetingCardProps) {
  const [isExpanded, setIsExpanded] = useState(meeting.status === 'ĐÃ DIỄN RA');
  const [isSyncing, setIsSyncing] = useState(false);

  const isUpcoming = meeting.status === 'SẮP TỚI';
  const canSync = (meeting.status === 'SẮP TỚI' || meeting.status === 'ĐANG XỬ LÝ AI') &&
    meeting.link &&
    (meeting.platform?.toLowerCase().includes('zoom') || meeting.platform?.toLowerCase().includes('google') || meeting.platform?.toLowerCase().includes('meet'));
  
  const Icon = meeting.platform.toLowerCase().includes('zoom') ? Video : Users;
  const borderColor = isUpcoming ? 'border-l-[#0058be]' : 'border-l-emerald-500';
  const badgeBg = isUpcoming 
    ? 'bg-[#eff4ff] text-[#0058be] border border-[#0058be]/20' 
    : meeting.status === 'ĐANG XỬ LÝ AI'
      ? 'bg-amber-50 text-amber-700 border border-amber-200'
      : 'bg-emerald-50 text-emerald-700 border border-emerald-200';

  const handleSync = async () => {
    if (!onSync || isSyncing) return;
    setIsSyncing(true);
    try {
      await onSync(meeting);
    } catch (error: any) {
      console.error("Sync failed:", error);
      alert(error.response?.data?.detail || error.message || "Lỗi đồng bộ cuộc họp");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className={`bg-white rounded-xl border border-[#c2c6d6]/60 overflow-hidden shadow-sm hover:shadow-md transition-all relative ${borderColor} border-l-[6px]`}>
      <div className="p-5 flex items-start gap-4">
        {/* Icon box */}
        <div className="bg-[#eff4ff] w-11 h-11 rounded-lg flex flex-shrink-0 items-center justify-center text-[#0058be] border border-[#0058be]/10">
          <Icon size={22} />
        </div>
        
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-bold text-[#0b1c30] text-[14px]">{meeting.title}</h3>
              <p className="text-[#565e74] text-[12px] mt-1 flex items-center gap-1.5">
                <span>{meeting.platform}</span>
                <span className="text-[#c2c6d6]">•</span>
                <span>{meeting.date}</span>
                <span className="text-[#c2c6d6]">•</span>
                <span>{meeting.time}</span>
                {meeting.duration && (
                  <>
                    <span className="text-[#c2c6d6]">•</span>
                    <span>{meeting.duration} phút</span>
                  </>
                )}
              </p>
              {meeting.project && (
                <p className="text-[#727785] text-[11px] mt-0.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-amber-500">folder</span>
                  {meeting.project}
                </p>
              )}
            </div>
            
            <div className="flex flex-col items-end gap-2">
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider ${badgeBg}`}>
                {meeting.status}
              </span>
              <div className="flex items-center gap-2.5">
                {meeting.link && (
                   <a href={meeting.link} target="_blank" rel="noreferrer" className="text-[11px] text-[#0058be] hover:underline font-semibold">
                     Tham gia
                   </a>
                )}
                {onSync && canSync && (
                  <button
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="text-[11px] font-semibold flex items-center gap-0.5 text-violet-600 hover:text-violet-700 transition-colors disabled:opacity-60"
                    title="Đồng bộ transcript & tóm tắt AI từ nền tảng cuộc họp"
                  >
                    <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} />
                    {isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ'}
                  </button>
                )}
                {onEdit && <button onClick={() => onEdit(meeting)} className="text-[11px] text-[#565e74] hover:text-[#0058be] font-medium transition-colors">Sửa</button>}
                {onDelete && <button onClick={() => onDelete(meeting.id)} className="text-[11px] text-[#565e74] hover:text-red-600 font-medium transition-colors">Xóa</button>}
                {onSummarize && <button
                  onClick={() => onSummarize?.(meeting)}
                  className="text-[11px] font-semibold flex items-center gap-0.5 text-emerald-600 hover:text-emerald-700 transition-colors"
                  title="Tạo hoặc cập nhật tóm tắt AI cho cuộc họp này"
                >
                  <Sparkles size={11} />
                  Tóm tắt AI
                </button>}
              </div>
            </div>
          </div>
          
          {/* AI Summary toggle */}
          {meeting.summary && meeting.summary.length > 0 && (
            <div className="mt-4">
              <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 text-[#0058be] text-[12px] font-bold hover:text-[#0058be]/80 transition-colors"
              >
                <Sparkles size={14} />
                AI Summary
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              
              {isExpanded && (
                <div className="mt-3 bg-[#f8f9fe] border border-[#0058be]/10 rounded-lg p-4 space-y-1 text-[12px] text-[#565e74] leading-relaxed">
                  {meeting.summary.map((item, idx) => {
                    const trimmed = item.trim();
                    const isBullet = trimmed.startsWith('•') || trimmed.startsWith('*') || trimmed.startsWith('-');
                    const isNumbered = /^\d+\./.test(trimmed);
                    const isTitle = trimmed.startsWith('MEETING SUMMARY') || trimmed.startsWith('Task cha đã chốt');
                    
                    let className = "min-h-[20px]";
                    if (isBullet) className += " pl-5 text-[#727785] font-normal";
                    else if (isNumbered) className += " font-bold text-[#0b1c30] mt-3";
                    else if (isTitle) className += " font-bold text-[#0b1c30] text-[13px] mt-2 block";
                    else className += " text-[#565e74]";

                    return (
                      <div key={idx} className={className}>
                        {item}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
