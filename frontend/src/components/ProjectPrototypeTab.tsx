'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Target, Paperclip, Plus, Clock, Brain, Info, Trash2, Loader2, Download, Pencil, Check, X, Eye, FileText, Sparkles, Upload,
} from 'lucide-react';
import {
  getProjectFeatures, createProjectFeature, renameProjectFeature, deleteProjectFeature,
  getProjectFeatureLogs, createProjectFeatureLog, deleteProjectFeatureLog, getProjectFeatureLogAttachmentBlob,
  uploadFeatureLogAttachment,
} from '@/lib/api';
import WipLogDetailModal from './WipLogDetailModal';

// Real feature: "Tính năng" + WIP log timeline scoped to one project. Ported
// from markee-dashboard's ProjectDetailContent.tsx concept (skill_library
// rows tagged skill_type='wip' + feature_name), rebuilt as normalized tables
// in pm-new's own DB — no cross-system dependency on markee-dashboard.

interface Feature {
  id: number;
  name: string;
  created_by: string | null;
  created_at: string | null;
  log_count: number;
}

export interface AttachedFile {
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
}

export interface AiTask {
  detail_task: string;
  priority: string;
  assigned_name: string;
  deadline: string;
  ai_task_inbox_id?: number;
  imported_task_id?: number | null;
  task_code?: string;
  pushed_at?: string;
}

export interface FeatureLog {
  id: number;
  feature_id: number;
  content: string;
  status: string;
  author: string | null;
  created_at: string | null;
  attached_files: AttachedFile[];
  ai_summary?: string | null;
  ai_tasks?: AiTask[];
}

export const CONTENT_TRUNCATE_LENGTH = 320;

export function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isPreviewableMime(mime: string | null) {
  if (!mime) return false;
  return mime.startsWith('text/') || mime.startsWith('image/') || mime === 'application/pdf' || mime === 'application/json';
}

const AVATAR_COLORS = ['#0058be', '#E3000F', '#059669', '#d97706', '#7c3aed'];
function colorFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function initialsFor(name: string) {
  return name.split(' ').map((p) => p[0]).filter(Boolean).slice(-2).join('').toUpperCase() || '?';
}
function formatDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ProjectPrototypeTab({ projectId, projectName }: { projectId: number; projectName?: string }) {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [logs, setLogs] = useState<FeatureLog[]>([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [newFeatureName, setNewFeatureName] = useState('');
  const [showNewFeatureInput, setShowNewFeatureInput] = useState(false);
  const [newLogContent, setNewLogContent] = useState('');
  const [submittingFeature, setSubmittingFeature] = useState(false);
  const [submittingLog, setSubmittingLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingFeatureId, setRenamingFeatureId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<number>>(new Set());
  const [detailModal, setDetailModal] = useState<{ log: FeatureLog; attachmentIdx?: number; tab?: 'description' | 'tasks' } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, l] = await Promise.all([
        getProjectFeatures(projectId),
        getProjectFeatureLogs(projectId),
      ]);
      setFeatures(f);
      setLogs(l);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Không tải được dữ liệu tính năng');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleCreateFeature(e: React.FormEvent) {
    e.preventDefault();
    const name = newFeatureName.trim();
    if (!name) return;
    setSubmittingFeature(true);
    setError(null);
    try {
      const created = await createProjectFeature(projectId, name);
      setFeatures((prev) => [...prev, created]);
      setNewFeatureName('');
      setShowNewFeatureInput(false);
      setSelectedFeatureId(created.id);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Lỗi khi tạo tính năng');
    } finally {
      setSubmittingFeature(false);
    }
  }

  function startRename(f: Feature) {
    setRenamingFeatureId(f.id);
    setRenameValue(f.name);
  }

  async function handleRenameFeature(f: Feature) {
    const name = renameValue.trim();
    if (!name || name === f.name) {
      setRenamingFeatureId(null);
      return;
    }
    try {
      const updated = await renameProjectFeature(projectId, f.id, name);
      setFeatures((prev) => prev.map((x) => (x.id === f.id ? { ...x, name: updated.name } : x)));
      setRenamingFeatureId(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Lỗi khi đổi tên tính năng');
    }
  }

  async function handleDeleteFeature(f: Feature) {
    if (!confirm(`Xóa tính năng "${f.name}"?`)) return;
    try {
      await deleteProjectFeature(projectId, f.id);
      setFeatures((prev) => prev.filter((x) => x.id !== f.id));
      if (selectedFeatureId === f.id) setSelectedFeatureId('all');
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Lỗi khi xóa tính năng');
    }
  }

  async function handleCreateLog(e: React.FormEvent) {
    e.preventDefault();
    const content = newLogContent.trim();
    if (!content || selectedFeatureId === 'all') return;
    setSubmittingLog(true);
    setError(null);
    try {
      const created = await createProjectFeatureLog(projectId, selectedFeatureId, content);
      setLogs((prev) => [created, ...prev]);
      setFeatures((prev) => prev.map((f) => f.id === selectedFeatureId ? { ...f, log_count: f.log_count + 1 } : f));
      setNewLogContent('');
      pollForAiSummary(created.id, created.feature_id);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Lỗi khi thêm log');
    } finally {
      setSubmittingLog(false);
    }
  }

  // AI summary/tasks for a new log run in the backend AFTER the create
  // response returns (see backend's BackgroundTasks use) — poll briefly so
  // the "✨ AI Tasks (N)" badge appears on its own once ready, no manual
  // refresh needed.
  function pollForAiSummary(logId: number, featureId: number, attempt = 0) {
    if (attempt >= 15) return; // ~90s ceiling — AI_TIMEOUT_SECONDS is 60s server-side
    setTimeout(async () => {
      try {
        const freshLogs = await getProjectFeatureLogs(projectId, featureId);
        const fresh = freshLogs.find((l: FeatureLog) => l.id === logId);
        if (fresh && fresh.ai_summary) {
          setLogs((prev) => prev.map((l) => (l.id === logId ? fresh : l)));
          setDetailModal((prev) => (prev && prev.log.id === logId ? { ...prev, log: fresh } : prev));
        } else {
          pollForAiSummary(logId, featureId, attempt + 1);
        }
      } catch {
        // silent — this is a best-effort background refresh, not user-facing
      }
    }, 5000);
  }

  function toggleExpandLog(logId: number) {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) next.delete(logId);
      else next.add(logId);
      return next;
    });
  }

  function handleLogUpdated(updated: FeatureLog) {
    setLogs((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setDetailModal((prev) => (prev && prev.log.id === updated.id ? { ...prev, log: updated } : prev));
  }

  async function handleDownloadAttachment(log: FeatureLog, idx: number, fileName: string) {
    try {
      const blob = await getProjectFeatureLogAttachmentBlob(projectId, log.id, idx);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Không tải được file');
    }
  }

  const [uploadingLogId, setUploadingLogId] = useState<number | null>(null);

  async function handleUploadAttachment(log: FeatureLog, file: File) {
    setUploadingLogId(log.id);
    try {
      const updated = await uploadFeatureLogAttachment(projectId, log.id, file);
      handleLogUpdated(updated);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Không upload được file');
    } finally {
      setUploadingLogId(null);
    }
  }

  async function handleDeleteLog(log: FeatureLog) {
    if (!confirm('Xóa log này?')) return;
    try {
      await deleteProjectFeatureLog(projectId, log.id);
      setLogs((prev) => prev.filter((x) => x.id !== log.id));
      setFeatures((prev) => prev.map((f) => f.id === log.feature_id ? { ...f, log_count: Math.max(0, f.log_count - 1) } : f));
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Lỗi khi xóa log');
    }
  }

  const visibleLogs = selectedFeatureId === 'all'
    ? logs
    : logs.filter((l) => l.feature_id === selectedFeatureId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 gap-2 text-[13px]">
        <Loader2 className="w-4 h-4 animate-spin" /> Đang tải dữ liệu tính năng...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-blue-800 leading-relaxed">
            <strong>Tính năng & WIP Log</strong> — dữ liệu thật, lưu trong DB của pm-new. Tải extension
            <strong> KPI Prototype</strong> bên dưới (chỉ cần tải 1 lần, dùng chung cho mọi dự án) để
            tự động ghi log WIP và thư viện kỹ năng AI — chọn/đổi dự án ngay trong extension, tải lần
            này sẽ gợi ý sẵn dự án hiện tại. Log được nhóm theo ô "🛠️ TÍNH NĂNG" bạn gõ trong extension
            trước khi lưu — để trống sẽ vào nhóm "Chưa đặt tên"; có thể bấm ✏️ cạnh tên tính năng bên
            dưới để đổi tên lại bất cứ lúc nào.
          </p>
          <a
            href={`/api/extension/ai-tracker?project_id=${projectId}&project_name=${encodeURIComponent(projectName || '')}`}
            download
            className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Tải KPI Prototype (.zip)
          </a>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-[12.5px] text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr]">
          {/* LEFT: Features sidebar */}
          <div className="border-b lg:border-b-0 lg:border-r border-slate-200 p-4 space-y-2 bg-slate-50/50">
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <Target className="w-3.5 h-3.5" /> Tính năng ({features.length})
              </span>
              <button
                onClick={() => setShowNewFeatureInput((v) => !v)}
                title="Tạo tính năng mới"
                className="w-5 h-5 rounded flex items-center justify-center text-[#0058be] border border-[#0058be]/30 bg-white hover:bg-[#0058be]/5 transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {showNewFeatureInput && (
              <form onSubmit={handleCreateFeature} className="flex items-center gap-1.5 mb-2">
                <input
                  autoFocus
                  value={newFeatureName}
                  onChange={(e) => setNewFeatureName(e.target.value)}
                  placeholder="Tên tính năng..."
                  className="flex-1 min-w-0 text-[12px] border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]"
                />
                <button
                  type="submit"
                  disabled={submittingFeature || !newFeatureName.trim()}
                  className="text-[11px] font-semibold text-white bg-[#0058be] px-2 py-1.5 rounded-lg disabled:opacity-50"
                >
                  Tạo
                </button>
              </form>
            )}

            <div className="space-y-1">
              <button
                onClick={() => setSelectedFeatureId('all')}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] font-medium flex items-center justify-between transition-colors ${
                  selectedFeatureId === 'all' ? 'bg-[#0058be] text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                Tất cả tính năng
                <span className="opacity-70">{logs.length}</span>
              </button>
              {features.length === 0 && (
                <p className="text-[11.5px] text-slate-400 px-2.5 py-2">Chưa có tính năng nào.</p>
              )}
              {features.map((f) => (
                renamingFeatureId === f.id ? (
                  <form
                    key={f.id}
                    onSubmit={(e) => { e.preventDefault(); handleRenameFeature(f); }}
                    className="flex items-center gap-1 px-1"
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setRenamingFeatureId(null); }}
                      className="flex-1 min-w-0 text-[12px] border border-[#0058be] rounded-lg px-2 py-1 outline-none"
                    />
                    <button type="submit" title="Lưu" className="w-5 h-5 shrink-0 flex items-center justify-center text-emerald-600 hover:bg-emerald-50 rounded">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" title="Hủy" onClick={() => setRenamingFeatureId(null)} className="w-5 h-5 shrink-0 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </form>
                ) : (
                  <div
                    key={f.id}
                    className={`group w-full px-2.5 py-1.5 rounded-lg text-[12px] font-medium flex items-center justify-between transition-colors cursor-pointer ${
                      selectedFeatureId === f.id ? 'bg-[#0058be] text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                    onClick={() => setSelectedFeatureId(f.id)}
                  >
                    <span className="truncate" title={f.name}>{f.name}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span className="opacity-70">{f.log_count}</span>
                      <Pencil
                        className={`w-3 h-3 opacity-0 group-hover:opacity-70 hover:!opacity-100 ${selectedFeatureId === f.id ? 'text-white' : 'text-slate-500'}`}
                        onClick={(e) => { e.stopPropagation(); startRename(f); }}
                      />
                      <Trash2
                        className={`w-3 h-3 opacity-0 group-hover:opacity-70 hover:!opacity-100 ${selectedFeatureId === f.id ? 'text-white' : 'text-red-500'}`}
                        onClick={(e) => { e.stopPropagation(); handleDeleteFeature(f); }}
                      />
                    </span>
                  </div>
                )
              ))}
            </div>
          </div>

          {/* RIGHT: Log timeline */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 border-b border-slate-200 mb-4 pb-2">
              <Clock className="w-3.5 h-3.5 text-[#0058be]" />
              <span className="text-[12px] font-semibold text-[#0058be]">
                {selectedFeatureId === 'all' ? 'Tất cả log' : features.find((f) => f.id === selectedFeatureId)?.name}
              </span>
            </div>

            {selectedFeatureId !== 'all' && (
              <form onSubmit={handleCreateLog} className="mb-4 flex items-start gap-2">
                <textarea
                  value={newLogContent}
                  onChange={(e) => setNewLogContent(e.target.value)}
                  placeholder="Ghi log tiến độ cho tính năng này..."
                  rows={2}
                  className="flex-1 text-[12.5px] border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[#0058be] resize-none"
                />
                <button
                  type="submit"
                  disabled={submittingLog || !newLogContent.trim()}
                  className="text-[12px] font-semibold text-white bg-[#0058be] px-3 py-2 rounded-lg disabled:opacity-50 shrink-0"
                >
                  {submittingLog ? '...' : 'Lưu log'}
                </button>
              </form>
            )}

            <div className="space-y-3">
              {visibleLogs.map((log) => {
                const authorName = log.author || 'Ẩn danh';
                return (
                  <div key={log.id} className="group border border-slate-200 rounded-lg p-3.5 hover:border-slate-300 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                          style={{ backgroundColor: colorFor(authorName) }}
                        >
                          {initialsFor(authorName)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-semibold text-slate-800 truncate">{authorName}</div>
                          <div className="text-[11px] text-slate-400">
                            {formatDate(log.created_at)}
                            {selectedFeatureId === 'all' && (
                              <> · {features.find((f) => f.id === log.feature_id)?.name || ''}</>
                            )}
                          </div>
                        </div>
                      </div>
                      <Trash2
                        className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 hover:!text-red-500 cursor-pointer shrink-0"
                        onClick={() => handleDeleteLog(log)}
                      />
                    </div>
                    {(() => {
                      const isLong = log.content.length > CONTENT_TRUNCATE_LENGTH;
                      const isExpanded = expandedLogIds.has(log.id);
                      const shown = isLong && !isExpanded ? log.content.slice(0, CONTENT_TRUNCATE_LENGTH).trimEnd() + '…' : log.content;
                      return (
                        <>
                          <p className="text-[12.5px] text-slate-600 leading-relaxed whitespace-pre-wrap">{shown}</p>
                          {isLong && (
                            <button
                              onClick={() => toggleExpandLog(log.id)}
                              className="mt-1 text-[11.5px] font-semibold text-[#0058be] hover:underline"
                            >
                              {isExpanded ? 'Thu gọn ↑' : 'Xem thêm ↓'}
                            </button>
                          )}
                        </>
                      );
                    })()}

                    {log.attached_files && log.attached_files.length > 0 && (
                      <div className="mt-2.5 space-y-1.5">
                        <div className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                          <Paperclip className="w-3 h-3" /> Tài liệu đính kèm ({log.attached_files.length})
                        </div>
                        {log.attached_files.map((file, idx) => (
                          <div key={idx} className="border border-slate-200 rounded-lg overflow-hidden">
                            <div className="flex items-center gap-2 px-2.5 py-2 bg-slate-50/70">
                              <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="text-[12px] font-medium text-slate-700 truncate flex-1" title={file.file_name}>{file.file_name}</span>
                              <span className="text-[10.5px] text-slate-400 shrink-0">{formatBytes(file.size_bytes)}</span>
                              {isPreviewableMime(file.mime_type) && (
                                <button
                                  onClick={() => setDetailModal({ log, attachmentIdx: idx, tab: 'description' })}
                                  className="flex items-center gap-1 text-[11px] font-semibold text-[#0058be] hover:bg-[#0058be]/10 px-2 py-1 rounded shrink-0"
                                >
                                  <Eye className="w-3 h-3" /> Xem
                                </button>
                              )}
                              <button
                                onClick={() => handleDownloadAttachment(log, idx, file.file_name)}
                                className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 px-2 py-1 rounded shrink-0"
                              >
                                <Download className="w-3 h-3" /> Tải về
                              </button>
                              <label className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded shrink-0 cursor-pointer">
                                {uploadingLogId === log.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Upload className="w-3 h-3" />
                                )}
                                Upload
                                <input
                                  type="file"
                                  className="hidden"
                                  disabled={uploadingLogId === log.id}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    e.target.value = '';
                                    if (f) handleUploadAttachment(log, f);
                                  }}
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => setDetailModal({ log, attachmentIdx: log.attached_files?.length ? 0 : undefined, tab: 'description' })}
                      className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-bold text-slate-500 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> Xem chi tiết
                    </button>
                  </div>
                );
              })}
              {visibleLogs.length === 0 && (
                <div className="text-center py-10 text-[12.5px] text-slate-400">
                  {selectedFeatureId === 'all' ? 'Chưa có log hoạt động nào.' : 'Chưa có log nào cho tính năng này.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {detailModal && (
        <WipLogDetailModal
          projectId={projectId}
          log={detailModal.log}
          featureName={features.find((f) => f.id === detailModal.log.feature_id)?.name || ''}
          initialAttachmentIndex={detailModal.attachmentIdx}
          initialTab={detailModal.tab}
          onClose={() => setDetailModal(null)}
          onLogUpdated={handleLogUpdated}
        />
      )}
    </div>
  );
}
