'use client';

import React, { useEffect, useState } from 'react';
import { X, Paperclip, Upload, Loader2, FileText } from 'lucide-react';
import {
  getProjects, updateProjectFeatureLog, uploadFeatureLogAttachment, removeProjectFeatureLogAttachment,
} from '@/lib/api';
import { FeatureLog, formatBytes } from './ProjectPrototypeTab';

// "Sửa bản nháp WIP" — ported field-for-field from markee-dashboard's own
// edit modal (Tiêu đề / Tính năng / Dự án / Nội dung Markdown / Đính kèm),
// adapted to pm-new's normalized Feature table: "Tính năng" here is still a
// free-text field (matches markee-dashboard's own UX — type or pick an
// existing name) resolved server-side to a real ProjectFeature row.

interface ProjectOption {
  id: number;
  name: string;
}

export default function EditWipLogModal({
  projectId,
  log,
  featureName,
  featureNames,
  onClose,
  onSaved,
}: {
  projectId: number;
  log: FeatureLog;
  featureName: string;
  featureNames: string[];
  onClose: () => void;
  onSaved: (updated: FeatureLog, movedToProjectId: number) => void;
}) {
  const [title, setTitle] = useState((log as any).title || '');
  const [feature, setFeature] = useState(featureName);
  const [content, setContent] = useState(log.content);
  const [targetProjectId, setTargetProjectId] = useState<number>(projectId);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [attachedFiles, setAttachedFiles] = useState(log.attached_files || []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjects().then((list: any[]) => setProjects(list.map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
  }, []);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const updated = await uploadFeatureLogAttachment(projectId, log.id, file);
      setAttachedFiles(updated.attached_files || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Không upload được file');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveAttachment(idx: number) {
    try {
      const updated = await removeProjectFeatureLogAttachment(projectId, log.id, idx);
      setAttachedFiles(updated.attached_files || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Không gỡ được file');
    }
  }

  async function handleSave() {
    const trimmed = content.trim();
    if (!trimmed) {
      setError('Nội dung không được để trống');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProjectFeatureLog(projectId, log.id, trimmed, {
        title: title.trim() || undefined,
        feature_name: feature.trim() || undefined,
        target_project_id: targetProjectId !== projectId ? targetProjectId : undefined,
      });
      onSaved(updated, targetProjectId);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Lỗi khi lưu thay đổi');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white border border-slate-200 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-6 py-4 bg-slate-50/60 flex items-center justify-between shrink-0">
          <h3 className="text-base font-bold text-[#0b1c30]">Sửa bản nháp WIP</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11.5px] text-red-700">{error}</div>
          )}

          <div>
            <label htmlFor="editWipTitleInput" className="block text-xs font-semibold text-slate-700 mb-1.5">Tiêu đề</label>
            <input
              id="editWipTitleInput"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tiêu đề..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-[#0058be]"
            />
          </div>

          <div>
            <label htmlFor="editWipFeatureInput" className="block text-xs font-semibold text-slate-700 mb-1.5">Tính năng</label>
            <input
              id="editWipFeatureInput"
              list="editWipFeaturesDatalist"
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
              placeholder="Nhập hoặc chọn tính năng..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-[#0058be]"
            />
            <datalist id="editWipFeaturesDatalist">
              {featureNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>

          <div>
            <label htmlFor="editWipProjectSelect" className="block text-xs font-semibold text-slate-700 mb-1.5">Dự án (Chuyển dự án nếu cần)</label>
            <select
              id="editWipProjectSelect"
              value={targetProjectId}
              onChange={(e) => setTargetProjectId(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-[#0058be] cursor-pointer font-medium"
            >
              {projects.length === 0 && <option value={projectId}>Đang tải...</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.id === projectId ? ' (Hiện tại)' : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="editWipContentInput" className="block text-xs font-semibold text-slate-700 mb-1.5">Nội dung Markdown</label>
            <textarea
              id="editWipContentInput"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder="Nhập nội dung markdown..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-[#0058be] font-mono resize-y"
            />
          </div>

          <div className="border-t border-slate-100 pt-4">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Đính kèm tài liệu (Đa file)</label>
            <label
              htmlFor="editWipFileUploadInput"
              className={`relative border-2 border-dashed rounded-xl p-3 mb-3 flex flex-col items-center justify-center gap-1 text-center cursor-pointer border-slate-300 hover:border-[#0058be] bg-slate-50/50 hover:bg-slate-50 ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const f = e.dataTransfer.files?.[0];
                if (f) handleUpload(f);
              }}
            >
              <input
                id="editWipFileUploadInput"
                type="file"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) handleUpload(f);
                }}
              />
              <span className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-slate-600">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                <span>{uploading ? 'Đang upload...' : 'Kéo thả file vào đây hoặc bấm để chọn...'}</span>
              </span>
            </label>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {attachedFiles.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2.5 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-700 truncate text-[11px] flex-1 min-w-0" title={file.file_name}>{file.file_name}</span>
                    <span className="text-[9px] text-slate-400 shrink-0 font-medium">{formatBytes(file.size_bytes)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(idx)}
                    className="text-red-500 hover:text-red-700 transition-colors p-1 shrink-0 text-xs font-bold"
                    title="Gỡ bỏ"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {attachedFiles.length === 0 && (
                <p className="text-[11px] text-slate-400 text-center py-1">Chưa có file đính kèm.</p>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 px-6 py-3.5 flex justify-end gap-2.5 bg-slate-50/60 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-300 bg-white text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50">
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !content.trim()}
            className="px-4 py-2 bg-[#0058be] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </div>
    </div>
  );
}
