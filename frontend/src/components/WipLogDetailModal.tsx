'use client';

import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  X, Minimize2, Download, Info, Sparkles, Loader2, RefreshCw, Rocket, CheckCircle2, FileText,
} from 'lucide-react';
import {
  getProjectFeatureLogAttachmentBlob, generateFeatureLogAiTasks, pushFeatureLogTasks,
} from '@/lib/api';
import {
  FeatureLog, AttachedFile, AiTask, formatBytes, isPreviewableMime,
} from './ProjectPrototypeTab';

// Fullscreen split-view preview modal, modeled after markee-dashboard's
// FilePreviewModal.tsx (left = file preview, right = 350px "Mô tả"/"Tasks"
// tabbed sidebar) — but the "Tasks" tab here is a REAL feature (AI summary +
// proposed tasks, pushed into the real Project Plan), unlike the reference
// app's tab of the same name, which turned out to just be a file/version
// switcher with no actual task data behind it.

function priorityStyle(priority: string) {
  if (priority === 'Critical') return { dot: 'bg-red-600', badge: 'bg-red-50 text-red-700 border-red-200', label: '🔥 Critical' };
  if (priority === 'High') return { dot: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 border-orange-200', label: 'High' };
  return { dot: 'bg-slate-400', badge: 'bg-slate-50 text-slate-600 border-slate-200', label: 'Normal' };
}

export default function WipLogDetailModal({
  projectId,
  log,
  featureName,
  initialAttachmentIndex,
  initialTab,
  onClose,
  onLogUpdated,
}: {
  projectId: number;
  log: FeatureLog;
  featureName: string;
  initialAttachmentIndex?: number;
  initialTab?: 'description' | 'tasks';
  onClose: () => void;
  onLogUpdated: (updated: FeatureLog) => void;
}) {
  const attachments = log.attached_files || [];
  const [activeAttachmentIdx, setActiveAttachmentIdx] = useState(initialAttachmentIndex ?? 0);
  const [activeTab, setActiveTab] = useState<'description' | 'tasks'>(initialTab || 'description');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pushing, setPushing] = useState(false);

  const activeFile: AttachedFile | undefined = attachments[activeAttachmentIdx];

  useEffect(() => {
    let revoke: string | null = null;
    if (!activeFile || !isPreviewableMime(activeFile.mime_type)) {
      setPreviewUrl(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    getProjectFeatureLogAttachmentBlob(projectId, log.id, activeAttachmentIdx)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        revoke = url;
        setPreviewUrl(url);
      })
      .catch(() => setPreviewError('Không tải được file để xem trước'))
      .finally(() => setPreviewLoading(false));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, log.id, activeAttachmentIdx]);

  async function handleDownload() {
    if (!activeFile) return;
    const blob = await getProjectFeatureLogAttachmentBlob(projectId, log.id, activeAttachmentIdx);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.file_name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const updated = await generateFeatureLogAiTasks(projectId, log.id);
      onLogUpdated(updated);
      setSelected(new Set());
    } catch (e: any) {
      setGenError(e?.response?.data?.detail || 'Tạo tóm tắt AI thất bại');
    } finally {
      setGenerating(false);
    }
  }

  function toggleSelected(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function handlePushSelected() {
    const tasks = log.ai_tasks || [];
    const toPush = tasks.filter((t, i) => selected.has(i) && !t.imported_task_id);
    if (!toPush.length) return;
    setPushing(true);
    try {
      const result = await pushFeatureLogTasks(projectId, log.id, toPush);
      onLogUpdated(result.log);
      setSelected(new Set());
    } catch (e: any) {
      setGenError(e?.response?.data?.detail || 'Đẩy task vào dự án thất bại');
    } finally {
      setPushing(false);
    }
  }

  const aiTasks = log.ai_tasks || [];
  const pendingCount = useMemo(() => aiTasks.filter((t) => !t.imported_task_id).length, [aiTasks]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex flex-col">
      {/* HEADER */}
      <div className="h-14 bg-[#0b1c30] text-white flex items-center px-4 gap-3 shrink-0">
        <FileText className="w-4 h-4 text-slate-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold truncate">
            {activeFile ? `Xem trước: ${activeFile.file_name}` : featureName}
          </div>
          {activeFile && (
            <div className="text-[10.5px] text-slate-400">
              Định dạng: {activeFile.mime_type || 'không rõ'} · Kích thước: {formatBytes(activeFile.size_bytes)}
            </div>
          )}
        </div>
        {activeFile && (
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-[12px] font-semibold bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Tải về
          </button>
        )}
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-[12px] font-semibold bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Minimize2 className="w-3.5 h-3.5" /> Thu nhỏ
        </button>
        <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* LEFT: file preview or content */}
        <div className="flex-1 min-w-0 bg-slate-100 flex flex-col overflow-hidden">
          {attachments.length > 1 && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-white border-b border-slate-200 overflow-x-auto shrink-0">
              {attachments.map((f, i) => (
                <button
                  key={i}
                  onClick={() => setActiveAttachmentIdx(i)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
                    i === activeAttachmentIdx ? 'bg-[#0058be] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f.file_name}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-auto p-4 md:p-6">
            {!activeFile ? (
              <div className="max-w-3xl mx-auto bg-white rounded-xl border border-slate-200 p-6 md:p-8 prose prose-sm prose-slate max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{log.content}</ReactMarkdown>
              </div>
            ) : !isPreviewableMime(activeFile.mime_type) ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
                <FileText className="w-10 h-10" />
                <p className="text-[13px]">Không thể xem trước loại file này.</p>
                <button onClick={handleDownload} className="text-[12.5px] font-semibold text-[#0058be] hover:underline">
                  Tải về để xem
                </button>
              </div>
            ) : previewLoading ? (
              <div className="h-full flex items-center justify-center gap-2 text-slate-400 text-[13px]">
                <Loader2 className="w-4 h-4 animate-spin" /> Đang tải bản xem trước...
              </div>
            ) : previewError ? (
              <div className="h-full flex items-center justify-center text-red-500 text-[13px]">{previewError}</div>
            ) : previewUrl && activeFile.mime_type?.startsWith('image/') ? (
              <img src={previewUrl} alt={activeFile.file_name} className="max-w-full mx-auto rounded-lg shadow-sm" />
            ) : previewUrl ? (
              <iframe src={previewUrl} title={activeFile.file_name} className="w-full h-full min-h-[70vh] bg-white rounded-lg shadow-sm" />
            ) : null}
          </div>
        </div>

        {/* RIGHT: Mô tả / AI Tasks sidebar */}
        <div className="w-full md:w-80 lg:w-[350px] bg-white border-t md:border-t-0 md:border-l border-slate-200 flex flex-col shrink-0">
          <div className="flex items-center border-b border-slate-200 bg-slate-50 p-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('description')}
              className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'description' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Info className="w-3.5 h-3.5" /> Mô tả
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tasks')}
              className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'tasks' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> AI Tasks {aiTasks.length > 0 && `(${aiTasks.length})`}
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-xs text-slate-800 bg-white">
            {activeTab === 'description' ? (
              <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden bg-white">
                <h5 className="font-bold text-slate-800 flex items-center gap-1.5 text-xs mb-2.5 shrink-0">Nội dung bài viết / Mô tả:</h5>
                <div className="flex-1 overflow-y-auto bg-slate-50/70 p-4 rounded-xl border border-slate-200 text-slate-800 text-xs leading-relaxed">
                  <div className="prose prose-sm prose-slate max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{log.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {!log.ai_summary ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                      <Sparkles className="w-8 h-8 text-purple-400" />
                      <p className="text-[12px] text-slate-500">
                        Log mới thường được AI tự động tóm tắt và đề xuất task ngay khi lưu. Nếu chưa có
                        (lần lưu trước gặp lỗi tạm thời), bấm nút bên dưới để thử lại.
                      </p>
                      {genError && <p className="text-[11.5px] text-red-600">{genError}</p>}
                      <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="flex items-center gap-1.5 text-[12px] font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
                      >
                        {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        {generating ? 'Đang tạo...' : 'Tạo tóm tắt & đề xuất task'}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="p-3 bg-[#f8f6ff] border border-[#eee9fe] rounded-xl text-[12px] text-[#334155] leading-relaxed">
                        {log.ai_summary}
                      </div>

                      <div className="flex items-center justify-between">
                        <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                          Task đề xuất ({aiTasks.length})
                        </h5>
                        <button
                          onClick={handleGenerate}
                          disabled={generating}
                          className="flex items-center gap-1 text-[11px] font-semibold text-purple-600 hover:underline disabled:opacity-50"
                        >
                          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Tạo lại
                        </button>
                      </div>

                      {genError && <p className="text-[11.5px] text-red-600">{genError}</p>}

                      <div className="space-y-2">
                        {aiTasks.map((t, i) => {
                          const style = priorityStyle(t.priority);
                          const isPushed = !!t.imported_task_id;
                          return (
                            <div key={i} className={`p-3 border rounded-xl text-xs space-y-1.5 ${isPushed ? 'bg-emerald-50/40 border-emerald-200' : 'bg-[#f8fafc] border-[#e2e8f0]'}`}>
                              <div className="flex items-start gap-2">
                                {!isPushed && (
                                  <input
                                    type="checkbox"
                                    checked={selected.has(i)}
                                    onChange={() => toggleSelected(i)}
                                    className="mt-0.5 shrink-0"
                                  />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${style.badge}`}>{style.label}</span>
                                    {isPushed && (
                                      <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-0.5">
                                        <CheckCircle2 className="w-3 h-3" /> Đã đẩy — {t.task_code}
                                      </span>
                                    )}
                                  </div>
                                  <p className="font-bold text-[#0b1c30] mt-1">{t.detail_task}</p>
                                  {(t.assigned_name || t.deadline) && (
                                    <div className="flex items-center gap-3 text-[10.5px] text-[#64748b] font-medium mt-1">
                                      {t.assigned_name && <span>👤 {t.assigned_name}</span>}
                                      {t.deadline && <span>📅 {t.deadline}</span>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {log.ai_summary && pendingCount > 0 && (
                  <div className="p-3 border-t border-slate-200 shrink-0">
                    <button
                      onClick={handlePushSelected}
                      disabled={pushing || selected.size === 0}
                      className="w-full flex items-center justify-center gap-1.5 text-[12.5px] font-bold text-white bg-[#0058be] hover:bg-[#0058be]/90 disabled:opacity-40 px-4 py-2.5 rounded-lg transition-colors"
                    >
                      {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
                      {pushing ? 'Đang đẩy...' : `Đẩy ${selected.size} task vào dự án`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
