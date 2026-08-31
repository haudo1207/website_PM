'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { getProjectZaloSummary } from '@/lib/api';
import ZaloSummaryCard from '@/components/zalo/ZaloSummaryCard';

// Read-only view of the real Zalo group(s) linked to this project (see
// zalo_conversations.project_id) plus their AI daily digests — separate
// from the older manual ChatGroup/AI Task Inbox system in the "Chats" tab,
// which has no connection to the real Zalo integration.
export default function ProjectZaloSummaryTab({ projectId }: { projectId: number }) {
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['project-zalo-summary', projectId],
    queryFn: () => getProjectZaloSummary(projectId),
  });

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

          <div className="p-4 space-y-3">
            {g.summaries.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">
                Chưa có bản tóm tắt nào — chờ chu kỳ tự động hoặc vào trang Zalo bấm "Tóm tắt ngay".
              </p>
            ) : (
              g.summaries.map((s) => <ZaloSummaryCard key={s.id} s={s} />)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
