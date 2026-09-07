'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Trash2, Unlink, Clock } from 'lucide-react';
import {
  getProjectZaloSummary, deleteZaloSummary, unlinkZaloConversationFromProject,
  getZaloSummaryConfig, updateZaloSummaryConfig,
  ZaloConversationSummary, ZaloProjectGroupSummary,
} from '@/lib/api';
import ZaloSummaryCard from '@/components/zalo/ZaloSummaryCard';
import { isAdmin } from '@/lib/auth';

// Vietnam has no DST, so a fixed Asia/Ho_Chi_Minh format is exact for
// bucketing a summary's period_end into "which calendar day is this" —
// what the reader actually wants to browse by, not the raw UTC timestamp.
const vnDateKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(iso));

const vnDateLabel = (dateKey: string) => {
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

  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);
  const handleUnlink = async (conversationId: number, name: string) => {
    if (!confirm(`Gỡ nhóm "${name}" khỏi dự án này? (Gán nhầm thì gỡ ra, không xóa dữ liệu hội thoại)`)) return;
    setUnlinkingId(conversationId);
    try {
      await unlinkZaloConversationFromProject(conversationId);
      queryClient.setQueryData<ZaloProjectGroupSummary[]>(queryKey, (old) =>
        (old || []).filter((g) => g.conversation_id !== conversationId)
      );
    } catch (err: any) {
      alert('Lỗi gỡ nhóm: ' + (err.response?.data?.detail || err.message));
    } finally {
      setUnlinkingId(null);
    }
  };

  // Daily auto-summary time (Asia/Ho_Chi_Minh) — company-wide (applies to
  // every project's Zalo groups, not just this one), editable by admin
  // only. Was a fixed env var; now a Setting an admin can change without a
  // redeploy, and the background job picks it up on its next run.
  const { data: summaryConfig, refetch: refetchSummaryConfig } = useQuery({
    queryKey: ['zalo-summary-config'],
    queryFn: getZaloSummaryConfig,
  });
  const [dailyAtDraft, setDailyAtDraft] = useState('');
  const [savingDailyAt, setSavingDailyAt] = useState(false);
  useEffect(() => {
    if (summaryConfig?.daily_at) setDailyAtDraft(summaryConfig.daily_at);
  }, [summaryConfig?.daily_at]);
  const handleSaveDailyAt = async () => {
    setSavingDailyAt(true);
    try {
      await updateZaloSummaryConfig(dailyAtDraft);
      await refetchSummaryConfig();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Lỗi lưu giờ tóm tắt.');
    } finally {
      setSavingDailyAt(false);
    }
  };

  const dailyAtBar = (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap">
      <Clock className="w-4 h-4 text-[#0058be] shrink-0" />
      {isAdmin() ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">Tự động tóm tắt mỗi ngày lúc</span>
          <input
            type="time"
            value={dailyAtDraft}
            onChange={e => setDailyAtDraft(e.target.value)}
            className="text-xs font-bold border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:border-[#0058be]"
          />
          <span className="text-xs text-slate-500">(giờ VN, áp dụng cho mọi dự án)</span>
          {dailyAtDraft !== summaryConfig?.daily_at && (
            <button
              type="button"
              onClick={handleSaveDailyAt}
              disabled={savingDailyAt}
              className="text-[11px] font-bold px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
            >
              {savingDailyAt ? 'Đang lưu…' : 'Lưu'}
            </button>
          )}
        </div>
      ) : (
        <span className="text-xs text-slate-500">
          Tự động tóm tắt mỗi ngày lúc <b>{summaryConfig?.daily_at || '...'}</b> (giờ VN).
        </span>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-5">
        {dailyAtBar}
        <div className="text-sm text-slate-400 text-center py-16">Đang tải…</div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="space-y-5">
        {dailyAtBar}
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <MessageCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">Chưa có nhóm Zalo nào gán vào dự án này.</p>
          <p className="text-xs text-slate-400 mt-1.5">
            Vào <a href="/zalo-account" className="text-[#0058be] font-semibold hover:underline">Tài khoản Zalo giao task</a> để
            chọn 1 hội thoại nhóm và gán vào dự án này.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {dailyAtBar}
      {groups.map((g) => (
        <div key={g.conversation_id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <MessageCircle className="w-4 h-4 text-[#0058be] shrink-0" />
              <span className="text-sm font-bold text-slate-800 truncate">{g.name}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[11px] text-slate-400">
                {g.last_message_at ? `Tin cuối: ${new Date(g.last_message_at).toLocaleString('vi-VN')}` : 'Chưa có tin nhắn'}
              </span>
              <button
                type="button"
                onClick={() => handleUnlink(g.conversation_id, g.name)}
                disabled={unlinkingId === g.conversation_id}
                title="Gỡ nhóm này khỏi dự án (gán nhầm)"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors disabled:opacity-50"
              >
                <Unlink size={12} />
                Gỡ nhóm
              </button>
            </div>
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
