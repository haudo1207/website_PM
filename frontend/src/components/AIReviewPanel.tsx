import React, { useEffect, useState } from 'react';
import { triggerAIReview, getAIReviewHistory, getAIReviewLog } from '@/lib/api';

interface AIReviewPanelProps {
  entityType: 'PROJECT' | 'PHASE' | 'TASK' | 'MEMBER';
  entityId: number;
  entityName: string;
  onSuccessCheck?: () => void;
  // Required for entityType 'MEMBER' only — a member has no project of
  // their own, so the review must say which project's tasks to scope to.
  projectId?: number;
  // When a member-scoping context is active (drilled in from /kpi) while
  // reviewing some other entity (typically the whole project), offer an
  // extra tab beside "Báo Cáo Hiện Tại" that shows that one person's own
  // report — without leaving/replacing the current view.
  memberTab?: { memberId: number; memberName: string; projectId: number };
}

interface ReviewLog {
  id: number;
  score: number;
  status: string;
  result_markdown: string;
  issues: string[];
  suggestions: string[];
  checked_at: string;
  prompt_snapshot?: string;
}

// One entity's review state (history + currently-displayed log + the scan
// trigger) — used once for the panel's primary entity, and again for the
// optional member-scoped side tab, so both can be fetched/scanned
// independently without leaving the widget.
function useEntityReview(entityType: string, entityId: number, projectId: number | undefined, onSuccessCheck?: () => void) {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ReviewLog[]>([]);
  const [currentLog, setCurrentLog] = useState<ReviewLog | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);

  const loadHistory = async () => {
    try {
      const res = await getAIReviewHistory(entityType, entityId, projectId);
      if (res.success && res.data) {
        setHistory(res.data);
        if (res.data.length > 0) {
          setCurrentLog(res.data[0]);
          setSelectedLogId(res.data[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching AI review history:', err);
    }
  };

  useEffect(() => {
    if (entityId) {
      loadHistory();
      setCurrentLog(null);
      setSelectedLogId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, projectId]);

  const handleRunCheck = async () => {
    setLoading(true);
    try {
      const res = await triggerAIReview(entityType, entityId, projectId);
      if (res.success && res.data) {
        if (onSuccessCheck) onSuccessCheck();
        await loadHistory();
      }
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.detail || 'Không thể thực hiện AI Review. Vui lòng kiểm tra lại prompt cấu hình hoặc API Key.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLog = async (logId: number) => {
    setSelectedLogId(logId);
    setLoading(true);
    try {
      const res = await getAIReviewLog(logId);
      if (res.success && res.data) {
        setCurrentLog(res.data);
      }
    } catch (err) {
      console.error('Error loading review log details:', err);
    } finally {
      setLoading(false);
    }
  };

  return { loading, history, currentLog, selectedLogId, handleRunCheck, handleSelectLog };
}

function ReportBody({ log, loading, onRunCheck }: { log: ReviewLog | null; loading: boolean; onRunCheck: () => void }) {
  return (
    <>
      {/* Trigger Button & Status Summary card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Trạng thái:</span>
            {log ? (
              <span className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                log.status === 'GOOD'
                  ? 'bg-emerald-100 text-emerald-800'
                  : log.status === 'HAS_ISSUE'
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-amber-100 text-amber-800'
              }`}>
                {log.status}
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 uppercase tracking-wider">
                Chưa kiểm tra
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 uppercase font-semibold">
            {log ? `Lần cuối lúc: ${new Date(log.checked_at).toLocaleString('vi-VN')}` : 'Hãy bắt đầu phân tích dữ liệu'}
          </p>
        </div>
        <button
          onClick={onRunCheck}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-1.5 active:scale-95 shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">psychology</span>
          Quét & Đánh giá lại
        </button>
      </div>

      {log ? (
        <div className="space-y-6 mt-6">
          {/* Score & Health Indicator */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col items-center justify-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Điểm tuân thủ</span>
              <div className="relative flex items-center justify-center w-24 h-24 rounded-full border-8 border-slate-100">
                <div className={`absolute inset-0 rounded-full border-8 border-t-transparent ${
                  log.score >= 80 ? 'border-emerald-500' : log.score >= 50 ? 'border-amber-500' : 'border-rose-500'
                } transform -rotate-45`}></div>
                <span className="text-2xl font-black text-slate-800">{log.score}</span>
              </div>
            </div>

            <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Phát hiện của AI</span>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0"></span>
                    <span className="text-xs text-slate-600 font-semibold">{log.issues.length} Vấn đề / Rủi ro</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></span>
                    <span className="text-xs text-slate-600 font-semibold">{log.suggestions.length} Đề xuất cải thiện</span>
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-3 text-[11px] text-slate-400 italic">
                *Đánh giá dựa trên thông tin tại thời điểm quét. Dữ liệu sẽ tự động chuyển sang trạng thái NEED_RECHECK nếu có sự thay đổi.
              </div>
            </div>
          </div>

          {log.issues.length > 0 && (
            <div className="bg-rose-50/50 border border-rose-100 rounded-xl p-5 space-y-3">
              <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-rose-500">error</span>
                Danh sách vấn đề rủi ro ({log.issues.length})
              </h4>
              <ul className="space-y-2">
                {log.issues.map((issue, idx) => (
                  <li key={idx} className="text-xs text-rose-950 flex items-start gap-2 leading-relaxed">
                    <span className="text-rose-500 font-bold shrink-0 mt-0.5">•</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {log.suggestions.length > 0 && (
            <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-5 space-y-3">
              <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-amber-500">lightbulb</span>
                Đề xuất & Giải pháp cải tiến ({log.suggestions.length})
              </h4>
              <ul className="space-y-2">
                {log.suggestions.map((sug, idx) => (
                  <li key={idx} className="text-xs text-amber-950 flex items-start gap-2 leading-relaxed">
                    <span className="text-amber-500 font-bold shrink-0 mt-0.5">•</span>
                    <span>{sug}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {log.result_markdown && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                <span className="material-symbols-outlined text-[16px]">summarize</span>
                Nhận xét chi tiết từ AI
              </h4>
              <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed font-medium space-y-2">
                {log.result_markdown}
              </div>
            </div>
          )}

          {log.prompt_snapshot && (
            <details className="group bg-slate-100 border border-slate-200 rounded-xl p-4 transition-all">
              <summary className="text-[10px] font-bold text-slate-500 uppercase tracking-wider cursor-pointer list-none flex items-center justify-between select-none">
                <span>🔍 Xem Prompt Snapshot của lần quét này</span>
                <span className="transition-transform group-open:rotate-180">▼</span>
              </summary>
              <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg text-[11px] text-slate-600 font-mono whitespace-pre-wrap overflow-x-auto">
                {log.prompt_snapshot}
              </div>
            </details>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-10 shadow-sm text-center mt-6">
          <span className="material-symbols-outlined text-[48px] text-slate-300">smart_toy</span>
          <h3 className="text-sm font-bold text-slate-700 mt-4">Chưa có kết quả phân tích nào</h3>
          <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
            Vui lòng bấm nút "Quét & Đánh giá lại" ở góc trên để AI tiến hành phân tích và kiểm tra các tiêu chí tuân thủ.
          </p>
        </div>
      )}
    </>
  );
}

export default function AIReviewPanel({
  entityType,
  entityId,
  entityName,
  onSuccessCheck,
  projectId,
  memberTab,
}: AIReviewPanelProps) {
  const [innerTab, setInnerTab] = useState<'current' | 'history' | 'member'>('current');

  const primary = useEntityReview(entityType, entityId, projectId, onSuccessCheck);
  // Harmless no-op when memberTab isn't provided (entityId falls back to 0,
  // whose effect guard skips the fetch).
  const member = useEntityReview('MEMBER', memberTab?.memberId ?? 0, memberTab?.projectId, onSuccessCheck);

  const loading = innerTab === 'member' ? member.loading : primary.loading;

  return (
    <div className="relative">
      {/* Tab Selection */}
      <div className="flex border-b border-slate-200 px-1 shrink-0 bg-white">
        <button
          onClick={() => setInnerTab('current')}
          className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 mr-6 transition-all ${
            innerTab === 'current' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          📊 Báo Cáo Hiện Tại
        </button>
        <button
          onClick={() => setInnerTab('history')}
          className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 mr-6 transition-all ${
            innerTab === 'history' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          🕒 Lịch sử quét ({primary.history.length})
        </button>
        {memberTab && (
          <button
            onClick={() => setInnerTab('member')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              innerTab === 'member' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            👤 Báo cáo {memberTab.memberName}
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="pt-6 space-y-6">

        {loading && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex flex-col items-center justify-center z-20">
            <div className="w-10 h-10 border-4 border-[#0058be] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-bold text-slate-600 mt-4 animate-pulse">AI Đang đánh giá dữ liệu...</p>
          </div>
        )}

        {innerTab === 'current' && (
          <ReportBody log={primary.currentLog} loading={primary.loading} onRunCheck={primary.handleRunCheck} />
        )}

        {innerTab === 'member' && memberTab && (
          <ReportBody log={member.currentLog} loading={member.loading} onRunCheck={member.handleRunCheck} />
        )}

        {innerTab === 'history' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="divide-y divide-slate-100">
              {primary.history.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-10">Chưa có lịch sử quét.</p>
              ) : (
                primary.history.map((log) => (
                  <div
                    key={log.id}
                    onClick={() => primary.handleSelectLog(log.id)}
                    className={`p-4 flex items-center justify-between cursor-pointer transition-colors hover:bg-slate-50 ${
                      primary.selectedLogId === log.id ? 'bg-blue-50/50' : ''
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                          log.status === 'GOOD'
                            ? 'bg-emerald-100 text-emerald-800'
                            : log.status === 'HAS_ISSUE'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {log.status}
                        </span>
                        <span className="text-xs font-semibold text-slate-700">
                          Điểm: {log.score}/100
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium block mt-1 uppercase">
                        {new Date(log.checked_at).toLocaleString('vi-VN')}
                      </span>
                    </div>
                    <span className="material-symbols-outlined text-slate-400 text-[18px]">
                      arrow_forward_ios
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
