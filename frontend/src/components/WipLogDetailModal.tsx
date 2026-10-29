'use client';

import React, { useEffect, useMemo, useState } from 'react';
import WipContentSections from '@/components/WipContentSections';
import {
  X, Minimize2, Download, Info, Sparkles, Loader2, RefreshCw, CheckCircle2, FileText, ListTodo, Upload,
} from 'lucide-react';
import {
  getProjectFeatureLogAttachmentBlob, generateFeatureLogAiTasks, pushFeatureLogTasks, uploadFeatureLogAttachment,
  getProjectFeatureLogs, getCategories,
} from '@/lib/api';
import { PhaseSelectCell, TaskGroupSelectCell, PickedRef } from '@/components/common/PhaseTaskGroupSelect';
import SearchableSelect from '@/components/common/SearchableSelect';
import {
  FeatureLog, AttachedFile, AiTask, formatBytes, isPreviewableMime,
} from './ProjectPrototypeTab';

// Fullscreen split-view preview modal, modeled after markee-dashboard's
// FilePreviewModal.tsx (left = file preview, right = 350px "Mô tả"/"Tasks"
// tabbed sidebar) — but the "Tasks" tab here is a REAL feature (AI summary +
// proposed tasks, pushed into the real Project Plan), unlike the reference
// app's tab of the same name, which turned out to just be a file/version
// switcher with no actual task data behind it.

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
  // Mirrors MeetingDetailModal's "Task Đề Xuất Từ AI" tab: every task starts
  // checked (uncheck to exclude), and every field is editable before push —
  // not just a read-only proposal.
  const [checkedMap, setCheckedMap] = useState<Record<number, boolean>>({});
  const [editMap, setEditMap] = useState<Record<number, Partial<AiTask>>>({});
  const [pushing, setPushing] = useState(false);
  // Project is already fixed (this log belongs to `projectId`) — unlike
  // meeting's per-task project picker, we only need Phase + "Task cha" so
  // the pushed task lands in the right spot in this project's plan instead
  // of always falling back to the project's first Phase/TaskGroup.
  const [taskPhaseMap, setTaskPhaseMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskGroupMap, setTaskGroupMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskSkillSolutionMap, setTaskSkillSolutionMap] = useState<Record<number, PickedRef | undefined>>({});
  const [taskSkillVendorMap, setTaskSkillVendorMap] = useState<Record<number, PickedRef | undefined>>({});
  const [categoriesList, setCategoriesList] = useState<any[]>([]);

  // Skill Area = Group, Skill = Skill nested under it — same shape
  // as MeetingDetailModal's task table.
  const allSkillGroups: any[] = categoriesList.flatMap((c: any) => c.groups || []);
  const getSkillVendorsForGroup = (groupId?: number) => {
    if (!groupId) return [];
    const group = allSkillGroups.find((g: any) => g.id === groupId);
    return group?.skills || [];
  };

  useEffect(() => {
    getCategories().then((res: any) => {
      const items = Array.isArray(res) ? res : (res?.data || []);
      if (Array.isArray(items)) setCategoriesList(items);
    }).catch(() => setCategoriesList([]));
  }, []);

  // Pre-select Skill Area from the AI's best-effort guess (skill_group_name,
  // matched by name against the real Skill Master list) — quick suggestion the
  // user can still override, never re-applied once they've picked one manually.
  useEffect(() => {
    if (!allSkillGroups.length) return;
    setTaskSkillSolutionMap((prev) => {
      let changed = false;
      const next = { ...prev };
      (log.ai_tasks || []).forEach((t, i) => {
        if (next[i] || !t.skill_group_name) return;
        const match = allSkillGroups.find(
          (g: any) => g.name.trim().toLowerCase() === t.skill_group_name!.trim().toLowerCase()
        );
        if (match) {
          next[i] = { id: match.id, name: match.name };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSkillGroups.length, log.ai_tasks]);

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

  const [uploading, setUploading] = useState(false);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const updated = await uploadFeatureLogAttachment(projectId, log.id, file);
      onLogUpdated(updated);
      setActiveAttachmentIdx((updated.attached_files || []).length - 1);
    } finally {
      setUploading(false);
    }
  }

  // A log created via the extension never goes through ProjectPrototypeTab's
  // own pollForAiSummary() (that only fires after the web UI's own "add log"
  // form submits) — so opening "Xem chi tiết" right after an extension save
  // used to show the manual "Tạo tóm tắt" button even though the backend's
  // BackgroundTask was already about to finish. Poll here too, independent
  // of how the log was created, so the summary/tasks just appear on their
  // own once ready — same ~90s ceiling as ProjectPrototypeTab's poll.
  const [autoChecking, setAutoChecking] = useState(!log.ai_summary);
  useEffect(() => {
    if (log.ai_summary) {
      setAutoChecking(false);
      return;
    }
    setAutoChecking(true);
    let cancelled = false;
    let attempt = 0;
    async function tick() {
      if (cancelled || attempt >= 15) {
        if (!cancelled) setAutoChecking(false);
        return;
      }
      attempt += 1;
      try {
        const freshLogs = await getProjectFeatureLogs(projectId, log.feature_id);
        const fresh = freshLogs.find((l: FeatureLog) => l.id === log.id);
        if (cancelled) return;
        if (fresh && fresh.ai_summary) {
          onLogUpdated(fresh);
          setAutoChecking(false);
          return;
        }
      } catch {
        // best-effort background refresh — ignore and retry
      }
      if (!cancelled) setTimeout(tick, 5000);
    }
    const timer = setTimeout(tick, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.id, log.ai_summary]);

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const updated = await generateFeatureLogAiTasks(projectId, log.id);
      onLogUpdated(updated);
      setCheckedMap({});
      setEditMap({});
    } catch (e: any) {
      setGenError(e?.response?.data?.detail || 'Tạo tóm tắt AI thất bại');
    } finally {
      setGenerating(false);
    }
  }

  function updateEdit(idx: number, patch: Partial<AiTask>) {
    setEditMap((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));
  }

  async function handlePushSelected() {
    const tasks = log.ai_tasks || [];
    const indices = tasks.map((_, i) => i).filter((i) => checkedMap[i] !== false && !tasks[i].imported_task_id);
    if (!indices.length) return;

    const missingPlacement = indices.some((i) => !taskPhaseMap[i]?.id || !taskGroupMap[i]?.id);
    if (missingPlacement && !window.confirm(
      'Có task chưa chọn đủ Phase / Task cha. Task đó sẽ được đẩy vào Inbox nhưng chưa gắn đúng vị trí trong kế hoạch dự án — bạn vẫn muốn tiếp tục?'
    )) {
      return;
    }

    const toPush = indices.map((i) => ({
      ...tasks[i],
      ...editMap[i],
      phase_id: taskPhaseMap[i]?.id,
      task_group_id: taskGroupMap[i]?.id,
      skill_solution_id: taskSkillSolutionMap[i]?.id,
      skill_vendor_id: taskSkillVendorMap[i]?.id,
    }));
    setPushing(true);
    try {
      const result = await pushFeatureLogTasks(projectId, log.id, toPush);
      onLogUpdated(result.log);
      setCheckedMap({});
      setEditMap({});
      setTaskPhaseMap({});
      setTaskGroupMap({});
      setTaskSkillSolutionMap({});
      setTaskSkillVendorMap({});
    } catch (e: any) {
      setGenError(e?.response?.data?.detail || 'Đẩy task vào dự án thất bại');
    } finally {
      setPushing(false);
    }
  }

  const aiTasks = log.ai_tasks || [];
  const selectedCount = useMemo(
    () => aiTasks.filter((t, i) => checkedMap[i] !== false && !t.imported_task_id).length,
    [aiTasks, checkedMap],
  );
  const pendingCount = useMemo(() => aiTasks.filter((t) => !t.imported_task_id).length, [aiTasks]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col">
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
        <label className="flex items-center gap-1.5 text-[12px] font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Upload
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) handleUpload(f);
            }}
          />
        </label>
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
              <div className="max-w-3xl mx-auto bg-white rounded-xl border border-slate-200 p-6 md:p-8">
                <WipContentSections content={log.content} />
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
                activeTab === 'description' ? 'bg-[#6366f1] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Info className="w-3.5 h-3.5" /> Mô tả
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tasks')}
              className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'tasks' ? 'bg-[#6366f1] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ListTodo className="w-3.5 h-3.5" /> Task AI {aiTasks.length > 0 && `(${aiTasks.length})`}
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-xs text-slate-800 bg-white">
            {activeTab === 'description' ? (
              <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden bg-white">
                <h5 className="font-bold text-slate-800 flex items-center gap-1.5 text-xs mb-2.5 shrink-0">Nội dung bài viết / Mô tả:</h5>
                <div className="flex-1 overflow-y-auto bg-slate-50/70 p-4 rounded-xl border border-slate-200 text-slate-800 text-xs leading-relaxed">
                  <WipContentSections content={log.content} />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {!log.ai_summary ? (
                    autoChecking ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                        <Loader2 className="w-8 h-8 text-[#a5b4fc] animate-spin" />
                        <p className="text-[12px] text-slate-500">
                          AI đang tự động tóm tắt và đề xuất task cho log này — sẽ hiện ra ngay khi xong,
                          không cần bấm gì cả.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                        <Sparkles className="w-8 h-8 text-[#a5b4fc]" />
                        <p className="text-[12px] text-slate-500">
                          Lần tự động tóm tắt vừa rồi gặp lỗi tạm thời. Bấm nút bên dưới để thử lại.
                        </p>
                        {genError && <p className="text-[11.5px] text-red-600">{genError}</p>}
                        <button
                          onClick={handleGenerate}
                          disabled={generating}
                          className="flex items-center gap-1.5 text-[12px] font-bold text-white bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
                        >
                          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          {generating ? 'Đang tạo...' : 'Tạo tóm tắt & đề xuất task'}
                        </button>
                      </div>
                    )
                  ) : (
                    <>
                      <div className="p-3 bg-[#f8f6ff] border border-[#eee9fe] rounded-xl text-[12px] text-[#334155] leading-relaxed">
                        {log.ai_summary}
                      </div>

                      <div className="flex items-center justify-between">
                        <h5 className="text-[11px] font-bold text-[#6366f1] uppercase tracking-wide flex items-center gap-1.5">
                          <ListTodo className="w-3.5 h-3.5" /> Task Đề Xuất Từ AI ({aiTasks.length})
                        </h5>
                        <button
                          onClick={handleGenerate}
                          disabled={generating}
                          className="flex items-center gap-1 text-[11px] font-semibold text-[#6366f1] hover:underline disabled:opacity-50"
                        >
                          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Tạo lại
                        </button>
                      </div>

                      {genError && <p className="text-[11.5px] text-red-600">{genError}</p>}

                      <div className="space-y-2.5">
                        {aiTasks.map((t, i) => {
                          const isPushed = !!t.imported_task_id;
                          const isChecked = checkedMap[i] !== false;
                          const edit = editMap[i] || {};
                          const fieldLabelCls = 'block text-[9.5px] font-bold text-slate-500 uppercase tracking-wider mb-0.5';

                          if (isPushed) {
                            return (
                              <div key={i} className="p-3 border rounded-xl text-xs space-y-1 bg-emerald-50/40 border-emerald-200">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <span className="text-[10px] font-bold text-emerald-700">Đã đẩy — {t.task_code}</span>
                                </div>
                                <p className="font-bold text-[#0b1c30]">{t.detail_task}</p>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={i}
                              className={`border rounded-2xl p-3 transition-all ${isChecked ? 'border-[#cbd5e1] bg-white shadow-2xs' : 'border-slate-200 opacity-50 bg-slate-50'}`}
                            >
                              <div className="flex items-start gap-2 mb-2.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => setCheckedMap((prev) => ({ ...prev, [i]: e.target.checked }))}
                                  className="w-3.5 h-3.5 mt-1 text-[#6366f1] rounded border-slate-300 focus:ring-[#6366f1] cursor-pointer shrink-0"
                                  title="Chọn task để đẩy vào dự án"
                                />
                                <div className="flex-1 min-w-0">
                                  <label className={fieldLabelCls}>Detail Task</label>
                                  <input
                                    type="text"
                                    value={edit.detail_task ?? t.detail_task}
                                    onChange={(e) => updateEdit(i, { detail_task: e.target.value })}
                                    className="w-full px-2 py-1.5 text-xs font-bold text-[#0b1c30] border border-[#cbd5e1] rounded-lg focus:outline-none focus:border-[#6366f1]"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className={fieldLabelCls}>Priority</label>
                                  <select
                                    value={edit.priority ?? t.priority}
                                    onChange={(e) => updateEdit(i, { priority: e.target.value })}
                                    className="w-full text-[11px] border border-[#cbd5e1] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[#6366f1]"
                                  >
                                    <option value="Critical">🔥 Critical</option>
                                    <option value="High">High</option>
                                    <option value="Normal">Normal</option>
                                  </select>
                                </div>
                                <div>
                                  <label className={fieldLabelCls}>Deadline</label>
                                  <input
                                    type="date"
                                    value={edit.deadline ?? t.deadline ?? ''}
                                    onChange={(e) => updateEdit(i, { deadline: e.target.value })}
                                    className="w-full text-[11px] border border-[#cbd5e1] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#6366f1]"
                                  />
                                </div>
                                <div>
                                  <label className={fieldLabelCls}>Manday Est</label>
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.25}
                                    value={edit.manday_est ?? t.manday_est ?? ''}
                                    onChange={(e) => updateEdit(i, { manday_est: e.target.value })}
                                    placeholder="1"
                                    className="w-full text-[11px] border border-[#cbd5e1] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#6366f1]"
                                  />
                                </div>
                                <div>
                                  <label className={fieldLabelCls}>Start Date</label>
                                  <input
                                    type="date"
                                    value={edit.start_date ?? t.start_date ?? ''}
                                    onChange={(e) => updateEdit(i, { start_date: e.target.value })}
                                    className="w-full text-[11px] border border-[#cbd5e1] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#6366f1]"
                                  />
                                </div>
                                <div className="col-span-2">
                                  <label className={fieldLabelCls}>Người phụ trách</label>
                                  <input
                                    type="text"
                                    value={edit.assigned_name ?? t.assigned_name ?? ''}
                                    onChange={(e) => updateEdit(i, { assigned_name: e.target.value })}
                                    placeholder="Để trống sẽ tự gán cho bạn"
                                    className="w-full text-[11px] border border-[#cbd5e1] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#6366f1]"
                                  />
                                </div>
                                <div>
                                  <label className={fieldLabelCls}>Phase</label>
                                  <PhaseSelectCell
                                    projectId={projectId}
                                    phase={taskPhaseMap[i]}
                                    onPhaseChange={(p) => setTaskPhaseMap((prev) => ({ ...prev, [i]: p }))}
                                    onTaskGroupChange={(g) => setTaskGroupMap((prev) => ({ ...prev, [i]: g }))}
                                  />
                                </div>
                                <div>
                                  <label className={fieldLabelCls}>Task cha</label>
                                  {taskPhaseMap[i] ? (
                                    <TaskGroupSelectCell
                                      phase={taskPhaseMap[i]}
                                      taskGroup={taskGroupMap[i]}
                                      onTaskGroupChange={(g) => setTaskGroupMap((prev) => ({ ...prev, [i]: g }))}
                                    />
                                  ) : (
                                    <p className="text-[11px] text-slate-400 py-1.5">Chọn phase trước</p>
                                  )}
                                </div>
                                <div>
                                  <label className={fieldLabelCls}>
                                    Skill Area{t.skill_group_name && !taskSkillSolutionMap[i] && (
                                      <span className="text-[#6366f1] normal-case font-semibold"> · AI gợi ý: {t.skill_group_name}</span>
                                    )}
                                  </label>
                                  <SearchableSelect
                                    label="skill area"
                                    options={allSkillGroups.map((g: any) => ({ id: g.id, name: g.name }))}
                                    value={taskSkillSolutionMap[i]?.id || ''}
                                    onChange={(val: any) => {
                                      const gid = Number(val);
                                      const found = allSkillGroups.find((g: any) => g.id === gid);
                                      setTaskSkillSolutionMap((prev) => ({ ...prev, [i]: found ? { id: found.id, name: found.name } : undefined }));
                                      setTaskSkillVendorMap((prev) => ({ ...prev, [i]: undefined }));
                                    }}
                                    placeholder="Gõ tìm..."
                                    searchThreshold={0}
                                    className="w-full"
                                  />
                                </div>
                                <div>
                                  <label className={fieldLabelCls}>Skill</label>
                                  <SearchableSelect
                                    label="skill"
                                    options={getSkillVendorsForGroup(taskSkillSolutionMap[i]?.id).map((s: any) => ({ id: s.id, name: s.name }))}
                                    value={taskSkillVendorMap[i]?.id || ''}
                                    onChange={(val: any) => {
                                      const sid = Number(val);
                                      const found = getSkillVendorsForGroup(taskSkillSolutionMap[i]?.id).find((s: any) => s.id === sid);
                                      setTaskSkillVendorMap((prev) => ({ ...prev, [i]: found ? { id: found.id, name: found.name } : undefined }));
                                    }}
                                    disabled={!taskSkillSolutionMap[i]}
                                    placeholder={taskSkillSolutionMap[i] ? 'Gõ tìm...' : 'Chọn Skill Area trước'}
                                    searchThreshold={0}
                                    className="w-full"
                                  />
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
                      disabled={pushing || selectedCount === 0}
                      className="w-full flex items-center justify-center gap-1.5 text-[12.5px] font-bold text-white bg-[#6366f1] hover:bg-[#4f46e5] disabled:bg-slate-300 disabled:opacity-100 px-4 py-2.5 rounded-xl transition-all shadow-sm"
                    >
                      {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '📥'}
                      {pushing ? 'Đang đẩy...' : `Đẩy ${selectedCount} task đã chọn vào Dự án`}
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
