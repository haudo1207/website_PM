'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Trash2 } from 'lucide-react';
import { getProjectZaloSummary, deleteZaloSummary, ZaloConversationSummary, ZaloProjectGroupSummary } from '@/lib/api';
import ZaloSummaryCard from '@/components/zalo/ZaloSummaryCard';

// Vietnam has no DST, so a fixed Asia/Ho_Chi_Minh format is exact for
// bucketing a summary's period_end into "which calendar day is this" —
// what the reader actually wants to browse by, not the raw UTC timestamp.
const vnDateKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(iso));

const vnDateLabel = (dateKey: string) => {
  const todayKey = vnDateKey(new Date().toISOString());
  const yesterdayKey = vnDateKey(new Date(Date.now() - 86400000).toISOString());
  if (dateKey === todayKey) return 'Hôm nay';
  if (dateKey === yesterdayKey) return 'Hôm qua';
  const [, m, d] = dateKey.split('-');
  return `${d}/${m}`;
};

// One conversation's summaries, browsed as a horizontal strip of days
// instead of one long vertical stack — click a day to reveal it instead of
// always showing everything at once.
function GroupSummaryDays({
  summaries,
  onDeleted,
}: {
  summaries: ZaloConversationSummary[];
  onDeleted: (summaryId: number) => void;
}) {
  const byDay = useMemo(() => {
    const map = new Map<string, ZaloConversationSummary[]>();
    for (const s of summaries) {
      const key = vnDateKey(s.period_end);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [summaries]);

  const [activeDay, setActiveDay] = useState<string | null>(byDay[0]?.[0] ?? null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  if (byDay.length === 0) {
    return (
      <p className="text-xs text-slate-400 text-center py-4">
        Chưa có bản tóm tắt nào — chờ chu kỳ tự động hoặc vào trang Zalo bấm "Tóm tắt ngay".
      </p>
    );
  }

  const activeSummaries = byDay.find(([key]) => key === activeDay)?.[1] || [];

  const handleDelete = async (summaryId: number) => {
    if (!confirm('Xóa bản tóm tắt này?')) return;
    setDeletingId(summaryId);
    try {
      await deleteZaloSummary(summaryId);
      onDeleted(summaryId);
    } catch (err: any) {
      alert('Lỗi xóa: ' + (err.response?.data?.detail || err.message));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {byDay.map(([key, items]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveDay(prev => (prev === key ? null : key))}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors whitespace-nowrap ${
              activeDay === key
                ? 'bg-[#0058be] text-white border-[#0058be]'
                : 'bg-white text-slate-600 border-slate-200 hover:border-[#0058be]/50'
            }`}
          >
            {vnDateLabel(key)}
            {items.length > 1 && (
              <span className={activeDay === key ? 'text-white/80 ml-1.5' : 'text-slate-400 ml-1.5'}>×{items.length}</span>
            )}
          </button>
        ))}
      </div>

      {activeDay && (
        <div className="space-y-4">
          {activeSummaries.map((s) => (
            <div key={s.id} className="relative">
              <button
                type="button"
                onClick={() => handleDelete(s.id)}
                disabled={deletingId === s.id}
                title="Xóa bản tóm tắt này"
                className="absolute top-5 right-5 z-10 w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
              <ZaloSummaryCard s={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Read-only view of the real Zalo group(s) linked to this project (see
// zalo_conversations.project_id) plus their AI daily digests — separate
// from the older manual ChatGroup/AI Task Inbox system in the "Chats" tab,
// which has no connection to the real Zalo integration.
export default function ProjectZaloSummaryTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const queryKey = ['project-zalo-summary', projectId];
  const { data: groups = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getProjectZaloSummary(projectId),
  });

  const handleDeleted = (conversationId: number, summaryId: number) => {
    queryClient.setQueryData<ZaloProjectGroupSummary[]>(queryKey, (old) =>
      (old || []).map((g) =>
        g.conversation_id === conversationId
          ? { ...g, summaries: g.summaries.filter((s) => s.id !== summaryId) }
          : g
      )
    );
  };

  if (isLoading) {
    return <div className="text-sm text-slate-400 text-center py-16">Đang tải…</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <MessageCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-600">Chưa có nhóm Zalo nào gán vào dự án này.</p>
        <p className="text-xs text-slate-400 mt-1.5">
          Vào <a href="/zalo-account" className="text-[#0058be] font-semibold hover:underline">Tài khoản Zalo giao task</a> để
          chọn 1 hội thoại nhóm và gán vào dự án này.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.conversation_id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <MessageCircle className="w-4 h-4 text-[#0058be] shrink-0" />
              <span className="text-sm font-bold text-slate-800 truncate">{g.name}</span>
            </div>
            <span className="text-[11px] text-slate-400 shrink-0">
              {g.last_message_at ? `Tin cuối: ${new Date(g.last_message_at).toLocaleString('vi-VN')}` : 'Chưa có tin nhắn'}
            </span>
          </div>

          <div className="p-4">
            <GroupSummaryDays
              summaries={g.summaries}
              onDeleted={(summaryId) => handleDeleted(g.conversation_id, summaryId)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
