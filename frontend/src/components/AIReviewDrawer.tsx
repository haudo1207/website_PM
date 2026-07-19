import React, { useEffect, useState } from 'react';
import { triggerAIReview, getAIReviewHistory, getAIReviewLog } from '@/lib/api';

interface AIReviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'PROJECT' | 'PHASE' | 'TASK';
  entityId: number;
  entityName: string;
  onSuccessCheck?: () => void;
}

interface ReviewLog {
  id: number;
  score: number;
  ai_status: string;
  summary_markdown: string;
  issues: string[];
  suggestions: string[];
  created_at: string;
  prompt_snapshot?: string;
}

export default function AIReviewDrawer({
  isOpen,
  onClose,
  entityType,
  entityId,
  entityName,
  onSuccessCheck
}: AIReviewDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ReviewLog[]>([]);
  const [currentLog, setCurrentLog] = useState<ReviewLog | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');

  useEffect(() => {
    if (isOpen && entityId) {
      loadHistory();
      setCurrentLog(null);
      setSelectedLogId(null);
      setActiveTab('current');
    }
  }, [isOpen, entityType, entityId]);

  const loadHistory = async () => {
    try {
      const res = await getAIReviewHistory(entityType, entityId);
      if (res.success && res.data) {
        setHistory(res.data);
        if (res.data.length > 0) {
          // Default to showing the latest review
          setCurrentLog(res.data[0]);
          setSelectedLogId(res.data[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching AI review history:', err);
    }
  };

  const handleRunCheck = async () => {
    setLoading(true);
    try {
      const res = await triggerAIReview(entityType, entityId);
      if (res.success && res.data) {
        // Trigger callback to refresh status badges on main page
        if (onSuccessCheck) onSuccessCheck();
        await loadHistory();
        setActiveTab('current');
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
        setActiveTab('current');
      }
    } catch (err) {
      console.error('Error loading review log details:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300"
      />

      {/* Drawer Body */}
      <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col z-10 transition-transform duration-300 animate-slide-in">
        
        {/* Drawer Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-[#0058be] text-white tracking-wider">
                {entityType === 'PROJECT' ? 'Dự án' : entityType === 'PHASE' ? 'Giai đoạn' : 'Công việc'}
              </span>
              <span className="text-slate-400 text-xs">•</span>
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">AI Quality Check</span>
            </div>
            <h2 className="text-base font-bold text-[#0f172a] truncate max-w-[450px] mt-1">
              {entityName}
            </h2>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-200/50 rounded-lg transition-all"
          >
            <span className="material-symbols-outlined text-[20px] block">close</span>
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-100 px-6 shrink-0 bg-white">
          <button
            onClick={() => setActiveTab('current')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 mr-6 transition-all ${
              activeTab === 'current' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            📊 Báo Cáo Hiện Tại
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'history' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            🕒 Lịch sử quét ({history.length})
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 space-y-6">
          
          {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex flex-col items-center justify-center z-20">
              <div className="w-10 h-10 border-4 border-[#0058be] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-bold text-slate-600 mt-4 animate-pulse">AI Đang đánh giá dữ liệu...</p>
            </div>
          )}

          {activeTab === 'current' && (
            <>
              {/* Trigger Button & Status Summary card */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Trạng thái:</span>
                    {currentLog ? (
                      <span className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                        currentLog.ai_status === 'GOOD'
                          ? 'bg-emerald-100 text-emerald-800'
                          : currentLog.ai_status === 'HAS_ISSUE'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {currentLog.ai_status}
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 uppercase tracking-wider">
                        Chưa kiểm tra
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 uppercase font-semibold">
                    {currentLog ? `Lần cuối lúc: ${new Date(currentLog.created_at).toLocaleString('vi-VN')}` : 'Hãy bắt đầu phân tích dữ liệu'}
                  </p>
                </div>
                <button
                  onClick={handleRunCheck}
                  disabled={loading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-1.5 active:scale-95 shrink-0"
                >
                  <span className="material-symbols-outlined text-[16px]">psychology</span>
                  Quét & Đánh giá lại
                </button>
              </div>

              {currentLog ? (
                <div className="space-y-6">
                  {/* Score & Health Indicator */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Score Wheel Mockup */}
                    <div className="md:col-span-1 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col items-center justify-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Điểm tuân thủ</span>
                      <div className="relative flex items-center justify-center w-24 h-24 rounded-full border-8 border-slate-100">
                        <div className={`absolute inset-0 rounded-full border-8 border-t-transparent ${
                          currentLog.score >= 80 ? 'border-emerald-500' : currentLog.score >= 50 ? 'border-amber-500' : 'border-rose-500'
                        } transform -rotate-45`}></div>
                        <span className="text-2xl font-black text-slate-800">{currentLog.score}</span>
                      </div>
                    </div>

                    {/* Quick Stats overview */}
                    <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Phát hiện của AI</span>
                        <div className="flex gap-4">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0"></span>
                            <span className="text-xs text-slate-600 font-semibold">{currentLog.issues.length} Vấn đề / Rủi ro</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></span>
                            <span className="text-xs text-slate-600 font-semibold">{currentLog.suggestions.length} Đề xuất cải thiện</span>
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-slate-100 pt-3 text-[11px] text-slate-400 italic">
                        *Đánh giá dựa trên thông tin tại thời điểm quét. Dữ liệu sẽ tự động chuyển sang trạng thái NEED_RECHECK nếu có sự thay đổi.
                      </div>
                    </div>
                  </div>

                  {/* Issues block */}
                  {currentLog.issues.length > 0 && (
                    <div className="bg-rose-50/50 border border-rose-100 rounded-xl p-5 space-y-3">
                      <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-rose-500">error</span>
                        Danh sách vấn đề rủi ro ({currentLog.issues.length})
                      </h4>
                      <ul className="space-y-2">
                        {currentLog.issues.map((issue, idx) => (
                          <li key={idx} className="text-xs text-rose-950 flex items-start gap-2 leading-relaxed">
                            <span className="text-rose-500 font-bold shrink-0 mt-0.5">•</span>
                            <span>{issue}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Suggestions block */}
                  {currentLog.suggestions.length > 0 && (
                    <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-5 space-y-3">
                      <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-amber-500">lightbulb</span>
                        Đề xuất & Giải pháp cải tiến ({currentLog.suggestions.length})
                      </h4>
                      <ul className="space-y-2">
                        {currentLog.suggestions.map((sug, idx) => (
                          <li key={idx} className="text-xs text-amber-950 flex items-start gap-2 leading-relaxed">
                            <span className="text-amber-500 font-bold shrink-0 mt-0.5">•</span>
                            <span>{sug}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Summary block */}
                  {currentLog.summary_markdown && (
                    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                        <span className="material-symbols-outlined text-[16px]">summarize</span>
                        Nhận xét chi tiết từ AI
                      </h4>
                      <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed font-medium space-y-2">
                        {currentLog.summary_markdown}
                      </div>
                    </div>
                  )}

                  {/* Collapsible Prompt Snapshot */}
                  {currentLog.prompt_snapshot && (
                    <details className="group bg-slate-100 border border-slate-200 rounded-xl p-4 transition-all">
                      <summary className="text-[10px] font-bold text-slate-500 uppercase tracking-wider cursor-pointer list-none flex items-center justify-between select-none">
                        <span>🔍 Xem Prompt Snapshot của lần quét này</span>
                        <span className="transition-transform group-open:rotate-180">▼</span>
                      </summary>
                      <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg text-[11px] text-slate-600 font-mono whitespace-pre-wrap overflow-x-auto">
                        {currentLog.prompt_snapshot}
                      </div>
                    </details>
                  )}
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-10 shadow-sm text-center">
                  <span className="material-symbols-outlined text-[48px] text-slate-300">smart_toy</span>
                  <h3 className="text-sm font-bold text-slate-700 mt-4">Chưa có kết quả phân tích nào</h3>
                  <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                    Vui lòng bấm nút "Quét & Đánh giá lại" ở góc trên để AI tiến hành phân tích và kiểm tra các tiêu chí tuân thủ.
                  </p>
                </div>
              )}
            </>
          )}

          {activeTab === 'history' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="divide-y divide-slate-100">
                {history.length === 0 ? (
                  <p className="text-xs text-slate-400 italic text-center py-10">Chưa có lịch sử quét.</p>
                ) : (
                  history.map((log) => (
                    <div 
                      key={log.id} 
                      onClick={() => handleSelectLog(log.id)}
                      className={`p-4 flex items-center justify-between cursor-pointer transition-colors hover:bg-slate-50 ${
                        selectedLogId === log.id ? 'bg-blue-50/50' : ''
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                            log.ai_status === 'GOOD'
                              ? 'bg-emerald-100 text-emerald-800'
                              : log.ai_status === 'HAS_ISSUE'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {log.ai_status}
                          </span>
                          <span className="text-xs font-semibold text-slate-700">
                            Điểm: {log.score}/100
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium block mt-1 uppercase">
                          {new Date(log.created_at).toLocaleString('vi-VN')}
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
    </div>
  );
}
