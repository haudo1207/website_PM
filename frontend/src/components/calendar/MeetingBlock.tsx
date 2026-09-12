'use client';

import { CalendarMeeting } from '@/lib/api';

// Fixed indigo scheme — deliberately NOT keyed by project color like Task
// blocks, and NOT draggable (no useDraggable at all) — Meeting is read-only
// on the Calendar grid. Rescheduling a meeting goes through Meeting Detail/
// Edit Meeting, never a Calendar drag (see "Chốt thêm requirement" design
// note: "Meeting chỉ hiển thị cho người tham gia và mặc định read-only").
const MEETING_TEXT_COLOR = '#4338ca';
const MEETING_LABEL_COLOR = '#6366f1';

export function MeetingBlockContent({ meeting }: { meeting: CalendarMeeting }) {
  const projectNames = (meeting.projects || []).map(p => p.name).filter(Boolean).join(', ');
  return (
    <>
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-[10px] shrink-0" aria-hidden>📅</span>
        <span className="text-[11px] font-bold leading-[1.25] truncate" style={{ color: MEETING_TEXT_COLOR }}>
          {meeting.title}
        </span>
      </div>
      <div className="text-[10px] font-semibold truncate mt-0.5" style={{ color: MEETING_LABEL_COLOR }}>
        {meeting.time}{meeting.duration ? ` · ${meeting.duration} phút` : ''}
      </div>
      {projectNames && (
        <div className="text-[9.5px] text-indigo-400 truncate">{projectNames}</div>
      )}
    </>
  );
}

export default function MeetingBlock({
  meeting,
  top,
  height,
  lane,
  laneCount,
  onOpenDetail,
}: {
  meeting: CalendarMeeting;
  top: number;
  height: number;
  lane: number;
  laneCount: number;
  onOpenDetail: (meeting: CalendarMeeting) => void;
}) {
  const widthPct = 100 / laneCount;
  const leftPct = lane * widthPct;

  return (
    <div
      onClick={e => { e.stopPropagation(); onOpenDetail(meeting); }}
      // Dashed left border (vs Task's solid project-color border) + a
      // striped background — reads as visually distinct from Task blocks
      // at a glance, not just by a different hue (spec.md: "Meeting nên có
      // visual style khác Task để nhìn vào là phân biệt ngay").
      className="absolute rounded-lg px-2 py-1 overflow-hidden shadow-sm cursor-pointer border-l-[3px] border-dashed border-indigo-400"
      style={{
        top,
        height: Math.max(height, 30),
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        background: 'repeating-linear-gradient(135deg, #eef2ff 0, #eef2ff 7px, #e0e7ff 7px, #e0e7ff 14px)',
      }}
      title={`${meeting.title} — ${meeting.time}${meeting.duration ? ` (${meeting.duration} phút)` : ''}`}
    >
      <MeetingBlockContent meeting={meeting} />
    </div>
  );
}
