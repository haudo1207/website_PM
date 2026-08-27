'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getProjectDocuments, getProjectDocumentCategories, getProjectDocumentHistory,
  createProjectDocument, updateProjectDocument, approveProjectDocument, rejectProjectDocument,
  toggleStarProjectDocument, deleteProjectDocument, projectDocumentFileUrl,
  ProjectDocumentItem,
} from '@/lib/api';
import { getName, getEmail } from '@/lib/auth';

interface ProjectDocumentsTabProps {
  projectId: number;
  phases: any[];
  tasks: any[];
  isProjectLeader: boolean;
  onNavigateToTask?: (taskId: string | number) => void;
  projectName?: string;
}

export interface AutoLinkItem {
  id: string;
  url: string;
  displayUrl: string;
  title: string;
  type: 'drive' | 'figma' | 'github' | 'notion' | 'meeting' | 'ticket' | 'link';
  typeLabel: string;
  badgeStyle: string;
  taskId: string;
  taskDetail: string;
  phaseName: string;
  assignedName: string;
  dateStr: string;
}

// Regex to extract all HTTP/HTTPS links or domain links from raw text
const AUTO_LINK_URL_REGEX = /(https?:\/\/[^\s<>"'\(\)]+|www\.[^\s<>"'\(\)]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\/[^\s<>"'\(\)]*)/gi;

function detectAutoLinkType(urlStr: string): { type: AutoLinkItem['type']; typeLabel: string; badgeStyle: string } {
  const lower = (urlStr || '').toLowerCase();

  if (lower.includes('drive.google.com') || lower.includes('docs.google.com') || lower.includes('sheets.google.com') || lower.includes('slides.google.com')) {
    return { type: 'drive', typeLabel: 'Google Drive / Docs', badgeStyle: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  }
  if (lower.includes('figma.com')) {
    return { type: 'figma', typeLabel: 'Figma Design', badgeStyle: 'bg-purple-100 text-purple-800 border-purple-200' };
  }
  if (lower.includes('github.com') || lower.includes('gitlab.com') || lower.includes('bitbucket.org')) {
    return { type: 'github', typeLabel: 'GitHub / Source', badgeStyle: 'bg-slate-800 text-white border-slate-700' };
  }
  if (lower.includes('notion.so') || lower.includes('notion.site')) {
    return { type: 'notion', typeLabel: 'Notion Doc', badgeStyle: 'bg-stone-100 text-stone-800 border-stone-300' };
  }
  if (lower.includes('zoom.us') || lower.includes('meet.google.com') || lower.includes('teams.microsoft.com')) {
    return { type: 'meeting', typeLabel: 'Meeting Link', badgeStyle: 'bg-blue-100 text-blue-800 border-blue-200' };
  }
  if (/^[a-z0-9_\-]+$/i.test(urlStr.trim()) || lower.includes('jira') || lower.includes('ticket')) {
    return { type: 'ticket', typeLabel: 'Ticket / Reference', badgeStyle: 'bg-amber-100 text-amber-800 border-amber-200' };
  }

  return { type: 'link', typeLabel: 'Website / Resource', badgeStyle: 'bg-indigo-100 text-indigo-800 border-indigo-200' };
}

const DOC_TYPES = ['Tài liệu', 'Biên bản', 'Bảng tính', 'Hình ảnh', 'Liên kết', 'Quy trình', 'Cấu hình', 'Biểu mẫu', 'Nhật ký', 'Báo cáo'];

const EXT_COLORS: Record<string, string> = {
  PDF: '#e11d48', DOCX: '#2563eb', XLSX: '#059669', URL: '#0891b2',
  FIGMA: '#7c3aed', PNG: '#f59e0b', JPG: '#f59e0b', ZIP: '#f59e0b', TXT: '#64748b',
};
const extColor = (ext: string) => EXT_COLORS[(ext || '').toUpperCase()] || '#64748b';

const STATUS_LABEL: Record<string, string> = { approved: 'Đã duyệt', review: 'Chờ duyệt', draft: 'Bản nháp' };
const STATUS_CLASS: Record<string, string> = {
  approved: 'bg-[#e7f8f0] text-[#07855a]',
  review: 'bg-[#fff3dc] text-[#b56b00]',
  draft: 'bg-[#eef1f5] text-[#667085]',
};

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN');
  } catch {
    return iso;
  }
}

function initials(name: string): string {
  return (name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(-2).join('').toUpperCase();
}

type Section = 'all' | 'starred' | 'recent' | 'review' | 'settings' | 'auto_links' | { phaseId: number; phaseName: string };

export default function ProjectDocumentsTab({ projectId, phases, tasks, isProjectLeader, onNavigateToTask, projectName = '' }: ProjectDocumentsTabProps) {
  const [section, setSection] = useState<Section>('all');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [phaseFilter, setPhaseFilter] = useState<number | 'ALL'>('ALL');
  const [uploaderFilter, setUploaderFilter] = useState<number | 'ALL'>('ALL');

  const [items, setItems] = useState<ProjectDocumentItem[]>([]);
  const [metrics, setMetrics] = useState({ total: 0, starred: 0, review: 0, approved: 0, approved_pct: 0 });
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploaders, setUploaders] = useState<Map<number, string>>(new Map());
  const [typesSeen, setTypesSeen] = useState<Set<string>>(new Set());

  const [selectedDoc, setSelectedDoc] = useState<ProjectDocumentItem | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [sourceMode, setSourceMode] = useState<'file' | 'link'>('file');
  const [editingDoc, setEditingDoc] = useState<ProjectDocumentItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('Tài liệu');
  const [formPhase, setFormPhase] = useState<string>('');
  const [formTask, setFormTask] = useState<string>('');
  const [formUrl, setFormUrl] = useState('');
  const [formFile, setFormFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<{ doc_type: string; count: number }[]>([]);

  const sectionKey = typeof section === 'string' ? section : `phase:${section.phaseId}`;

  const fetchDocuments = useCallback(async () => {
    if (section === 'auto_links') return;
    try {
      setLoading(true);
      const params: any = {};
      if (typeof section === 'string') {
        if (section === 'starred' || section === 'recent' || section === 'review') params.special = section;
      } else {
        params.phase_id = section.phaseId;
      }
      if (search.trim()) params.q = search.trim();
      if (typeFilter !== 'ALL') params.doc_type = typeFilter;
      if (phaseFilter !== 'ALL' && typeof section === 'string') params.phase_id = phaseFilter;
      if (uploaderFilter !== 'ALL') params.uploader_id = uploaderFilter;

      const res = await getProjectDocuments(projectId, params);
      setItems(res.items || []);
      setMetrics(res.metrics || { total: 0, starred: 0, review: 0, approved: 0, approved_pct: 0 });
      setCanApprove(!!res.can_approve);

      setUploaders(prev => {
        const next = new Map(prev);
        (res.items || []).forEach(d => { if (d.uploader_user_id) next.set(d.uploader_user_id, d.uploader_name); });
        return next;
      });
      setTypesSeen(prev => {
        const next = new Set(prev);
        (res.items || []).forEach(d => next.add(d.doc_type));
        return next;
      });
    } catch (err) {
      console.error('Failed to load project documents:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, section, search, typeFilter, phaseFilter, uploaderFilter]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  useEffect(() => {
    if (section === 'settings') {
      getProjectDocumentCategories(projectId).then(res => setCategories(res.items || [])).catch(() => {});
    }
  }, [section, projectId]);

  const openDetail = useCallback(async (doc: ProjectDocumentItem) => {
    setSelectedDoc(doc);
    try {
      const res = await getProjectDocumentHistory(projectId, doc.id);
      setHistory(res.items || []);
    } catch {
      setHistory([]);
    }
  }, [projectId]);

  const refreshSelected = async (docId: number) => {
    const res = await getProjectDocuments(projectId, {});
    const updated = (res.items || []).find(d => d.id === docId);
    if (updated) setSelectedDoc(updated);
    fetchDocuments();
  };

  const handleToggleStar = async (doc: ProjectDocumentItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await toggleStarProjectDocument(projectId, doc.id);
      fetchDocuments();
      if (selectedDoc?.id === doc.id) refreshSelected(doc.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (doc: ProjectDocumentItem) => {
    if (!window.confirm(`Xóa dữ liệu "${doc.name}"? Hành động này không thể hoàn tác.`)) return;
    try {
      await deleteProjectDocument(projectId, doc.id);
      setSelectedDoc(null);
      fetchDocuments();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Không thể xóa dữ liệu.');
    }
  };

  const handleApprove = async (doc: ProjectDocumentItem) => {
    try {
      await approveProjectDocument(projectId, doc.id);
      refreshSelected(doc.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Không thể duyệt dữ liệu.');
    }
  };

  const handleReject = async (doc: ProjectDocumentItem) => {
    try {
      await rejectProjectDocument(projectId, doc.id);
      refreshSelected(doc.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Không thể từ chối dữ liệu.');
    }
  };

  const openUploadModal = (mode: 'file' | 'link') => {
    setEditingDoc(null);
    setSourceMode(mode);
    setFormName(''); setFormType(mode === 'link' ? 'Liên kết' : 'Tài liệu');
    setFormPhase(''); setFormTask(''); setFormUrl(''); setFormFile(null);
    setShowModal(true);
  };

  const openEditModal = (doc: ProjectDocumentItem) => {
    setEditingDoc(doc);
    setSourceMode(doc.source);
    setFormName(doc.name);
    setFormType(doc.doc_type);
    setFormPhase(doc.phase_id ? String(doc.phase_id) : '');
    setFormTask(doc.task_id ? String(doc.task_id) : '');
    setFormUrl(doc.url || '');
    setFormFile(null);
    setShowModal(true);
  };

  const handleFileChosen = (f: File | null) => {
    setFormFile(f);
    if (f && !formName.trim()) setFormName(f.name.replace(/\.[^.]+$/, ''));
  };

  const handleSubmit = async () => {
    if (!formName.trim()) { alert('Vui lòng nhập tên dữ liệu.'); return; }
    if (sourceMode === 'file' && !formFile && !editingDoc) { alert('Vui lòng chọn file.'); return; }
    if (sourceMode === 'link' && !formUrl.trim()) { alert('Vui lòng nhập liên kết.'); return; }

    const fd = new FormData();
    fd.append('name', formName.trim());
    fd.append('doc_type', formType);
    if (formPhase) fd.append('phase_id', formPhase);
    if (formTask) fd.append('task_id', formTask);
    if (sourceMode === 'file' && formFile) fd.append('file', formFile);
    if (sourceMode === 'link' && formUrl.trim()) fd.append('url', formUrl.trim());

    setSubmitting(true);
    try {
      if (editingDoc) {
        await updateProjectDocument(projectId, editingDoc.id, fd);
      } else {
        await createProjectDocument(projectId, fd);
      }
      setShowModal(false);
      fetchDocuments();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Không thể lưu dữ liệu.');
    } finally {
      setSubmitting(false);
    }
  };

  const clearFilters = () => {
    setSearch(''); setTypeFilter('ALL'); setPhaseFilter('ALL'); setUploaderFilter('ALL');
  };

  const sectionTitle = useMemo(() => {
    if (typeof section === 'string') {
      return { all: 'Tất cả dữ liệu', starred: 'Quan trọng', recent: 'Gần đây', review: 'Chờ duyệt', settings: 'Danh mục & quy tắc', auto_links: 'Liên kết tự động từ Task' }[section] || 'Tất cả dữ liệu';
    }
    return section.phaseName;
  }, [section]);

  const currentUserName = getName() || 'Người dùng';
  const currentUserEmail = getEmail() || '';

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[#152238]">Trung tâm dữ liệu dự án</h2>
          <p className="text-xs text-[#718096] mt-0.5">Một nơi duy nhất để tìm, kiểm soát và liên kết mọi dữ liệu của dự án.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openUploadModal('link')}
            className="h-10 px-4 border border-[#cdd7e5] bg-white text-[#34425a] rounded-lg text-xs font-bold flex items-center gap-1.5 hover:bg-slate-50"
          >
            <span className="material-symbols-outlined text-[16px]">link</span>
            Thêm liên kết
          </button>
          <button
            onClick={() => openUploadModal('file')}
            className="h-10 px-4 bg-[#0963c8] hover:bg-[#0963c8]/90 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">upload</span>
            Tải lên
          </button>
        </div>
      </div>

      {/* METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricTile icon="description" iconClass="bg-[#e7f2ff] text-[#176acd]" label="Tổng dữ liệu" value={String(metrics.total)} hint="Toàn bộ dữ liệu dự án" />
        <MetricTile icon="star" iconClass="bg-[#efedff] text-[#6754df]" label="Quan trọng" value={String(metrics.starred)} hint="Cần dễ truy cập" />
        <MetricTile icon="schedule" iconClass="bg-[#fff4d9] text-[#be7600]" label="Chờ duyệt" value={String(metrics.review)} hint="Cần Leader dự án xử lý" />
        <MetricTile icon="verified" iconClass="bg-[#e7faf2] text-[#07845b]" label="Đã chuẩn hóa" value={`${metrics.approved_pct}%`} hint={`${metrics.approved} / ${metrics.total} dữ liệu`} />
      </div>

      {/* DATA BOX */}
      <div className="grid grid-cols-1 md:grid-cols-[210px_1fr] bg-white border border-[#dce3ed] rounded-[13px] overflow-hidden min-h-[420px]">
        {/* LEFT NAV */}
        <aside className="bg-[#f9fbfd] border-r border-[#e0e6ef] p-2.5">
          <NavLabel text="KHÁM PHÁ" />
          <NavButton active={section === 'all'} onClick={() => setSection('all')} label="Tất cả dữ liệu" icon="apps" count={metrics.total} />
          <NavButton active={section === 'starred'} onClick={() => setSection('starred')} label="Quan trọng" icon="star" count={metrics.starred} />
          <NavButton active={section === 'recent'} onClick={() => setSection('recent')} label="Gần đây" icon="schedule" />

          <NavLabel text="TỪ TASK" />
          <NavButton active={section === 'auto_links'} onClick={() => setSection('auto_links')} label="Liên kết tự động" icon="link" />

          {phases.length > 0 && (
            <>
              <NavLabel text="THEO PHASE" />
              {phases.map((p: any) => (
                <NavButton
                  key={p.id}
                  active={typeof section === 'object' && section.phaseId === p.id}
                  onClick={() => setSection({ phaseId: p.id, phaseName: p.name })}
                  label={p.name}
                  icon="folder_open"
                />
              ))}
            </>
          )}

          <NavLabel text="QUẢN TRỊ" />
          <NavButton active={section === 'review'} onClick={() => setSection('review')} label="Chờ duyệt" icon="pending_actions" count={metrics.review} warn />
          <NavButton active={section === 'settings'} onClick={() => setSection('settings')} label="Danh mục & quy tắc" icon="settings" />
        </aside>

        {/* RIGHT PANEL */}
        {section === 'settings' ? (
          <SettingsPanel categories={categories} />
        ) : section === 'auto_links' ? (
          <AutoLinksPanel tasks={tasks} phases={phases} projectName={projectName} onNavigateToTask={onNavigateToTask} />
        ) : (
          <div className="min-w-0 flex flex-col">
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-[#e6eaf0]">
              <div>
                <small className="text-[8px] tracking-widest font-extrabold text-slate-400">ĐANG XEM</small>
                <h3 className="text-[15px] font-bold text-[#152238] mt-0.5">{sectionTitle}</h3>
              </div>
              <span className="text-[10px] text-slate-400">{items.length} dữ liệu trong danh mục</span>
            </div>

            {/* TOOLBAR */}
            <div className="p-3 flex flex-wrap gap-2 border-b border-[#e6eaf0]">
              <div className="flex-1 min-w-[240px] h-9 border border-[#cdd6e2] rounded-lg flex items-center px-2.5 gap-2 text-[#78869a]">
                <span className="material-symbols-outlined text-[16px]">search</span>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Tìm tên dữ liệu..."
                  className="border-0 outline-0 flex-1 text-xs min-w-0"
                />
              </div>
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="h-9 border border-[#cdd6e2] rounded-lg px-2.5 text-xs text-[#46546b] bg-white">
                <option value="ALL">Tất cả loại</option>
                {Array.from(typesSeen).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {typeof section === 'string' && (
                <select value={phaseFilter} onChange={e => setPhaseFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))} className="h-9 border border-[#cdd6e2] rounded-lg px-2.5 text-xs text-[#46546b] bg-white max-w-[160px]">
                  <option value="ALL">Mọi phase</option>
                  {phases.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <select value={uploaderFilter} onChange={e => setUploaderFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))} className="h-9 border border-[#9ebee5] bg-[#f7fbff] text-[#15599f] rounded-lg px-2.5 text-xs font-semibold max-w-[170px]">
                <option value="ALL">Tất cả người tải</option>
                {Array.from(uploaders.entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <div className="flex border border-[#cdd6e2] rounded-lg overflow-hidden">
                <button onClick={() => setView('list')} className={`w-9 h-9 flex items-center justify-center ${view === 'list' ? 'bg-[#e8f1ff] text-[#0963c8]' : 'bg-white text-[#7d899c]'}`}>
                  <span className="material-symbols-outlined text-[16px]">view_list</span>
                </button>
                <button onClick={() => setView('grid')} className={`w-9 h-9 flex items-center justify-center ${view === 'grid' ? 'bg-[#e8f1ff] text-[#0963c8]' : 'bg-white text-[#7d899c]'}`}>
                  <span className="material-symbols-outlined text-[16px]">grid_view</span>
                </button>
              </div>
            </div>

            <div className="h-8 bg-[#fbfcfe] border-b border-[#e6eaf0] flex items-center justify-between px-3.5 text-[10px] text-[#8994a5]">
              <span>Đang hiển thị <b className="text-[#152238]">{items.length}</b> dữ liệu</span>
              <button onClick={clearFilters} className="text-[#0963c8] font-extrabold">Xóa bộ lọc</button>
            </div>

            {/* CONTENT */}
            {loading ? (
              <div className="p-12 text-center text-xs text-[#718096]">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-[#0963c8] mb-2" />
                <p>Đang tải dữ liệu...</p>
              </div>
            ) : items.length === 0 ? (
              <div className="p-14 text-center text-[#8995a7]">
                <span className="material-symbols-outlined text-4xl text-slate-300 mb-2 block">folder_off</span>
                <p className="text-sm font-bold text-[#152238]">Không tìm thấy dữ liệu</p>
                <p className="text-xs mt-1">Thử từ khóa hoặc bộ lọc khác, hoặc tải lên dữ liệu mới.</p>
              </div>
            ) : view === 'list' ? (
              <div className="overflow-auto">
                <table className="w-full border-collapse min-w-[880px] text-xs">
                  <thead>
                    <tr className="bg-[#f4f6f9] text-[#7c8798] text-[9px] tracking-wider">
                      <th className="text-left px-3.5 py-2.5">TÊN DỮ LIỆU</th>
                      <th className="text-left px-3.5 py-2.5">PHASE / TASK LIÊN KẾT</th>
                      <th className="text-left px-3.5 py-2.5">NGƯỜI TẢI LÊN</th>
                      <th className="text-left px-3.5 py-2.5">CẬP NHẬT</th>
                      <th className="text-left px-3.5 py-2.5">TRẠNG THÁI</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(doc => (
                      <tr key={doc.id} onClick={() => openDetail(doc)} className="border-b border-[#edf0f4] hover:bg-[#f3f8ff] cursor-pointer">
                        <td className="px-3.5 py-3">
                          <div className="flex items-center gap-2.5 min-w-[220px]">
                            <span className="w-8 h-9 rounded flex items-center justify-center text-white font-black text-[11px] shrink-0" style={{ background: extColor(doc.ext) }}>
                              {doc.ext?.[0] || '?'}
                            </span>
                            <div>
                              <strong className="block text-[#152238]">{doc.name}</strong>
                              <small className="text-slate-400">{doc.ext} {doc.size_bytes ? `· ${formatSize(doc.size_bytes)}` : ''}</small>
                            </div>
                            <button onClick={(e) => handleToggleStar(doc, e)} className={`ml-auto ${doc.is_starred ? 'text-[#edae19]' : 'text-slate-300'}`}>
                              <span className="material-symbols-outlined text-[16px]">star</span>
                            </button>
                          </div>
                        </td>
                        <td className="px-3.5 py-3">
                          <strong className="block text-[11px] text-[#46556e]">{doc.phase_name || '—'}</strong>
                          <small className="text-slate-400">{doc.task_label || 'Không gắn task'}</small>
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="w-6 h-6 rounded-full bg-[#ebe8ff] text-[#5543c4] flex items-center justify-center text-[9px] font-extrabold shrink-0">{initials(doc.uploader_name)}</span>
                            <b className="text-[10px] text-[#152238]">{doc.uploader_name}</b>
                          </div>
                        </td>
                        <td className="px-3.5 py-3 text-[10px] text-[#69768a] whitespace-nowrap">{formatDate(doc.updated_at)}</td>
                        <td className="px-3.5 py-3">
                          <span className={`inline-block rounded-full px-2 py-1 text-[9px] font-extrabold ${STATUS_CLASS[doc.status]}`}>● {STATUS_LABEL[doc.status]}</span>
                        </td>
                        <td className="px-2">
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(doc); }} className="text-slate-400 hover:text-rose-600">
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3.5">
                {items.map(doc => (
                  <div key={doc.id} onClick={() => openDetail(doc)} className="border border-[#e0e6ee] rounded-lg p-3.5 cursor-pointer hover:border-[#8db8ee] hover:shadow-md transition-all">
                    <div className="flex justify-between items-center">
                      <span className="w-8 h-9 rounded flex items-center justify-center text-white font-black text-[11px]" style={{ background: extColor(doc.ext) }}>{doc.ext?.[0] || '?'}</span>
                      <button onClick={(e) => handleToggleStar(doc, e)} className={doc.is_starred ? 'text-[#edae19]' : 'text-slate-300'}>
                        <span className="material-symbols-outlined text-[16px]">star</span>
                      </button>
                    </div>
                    <strong className="block mt-3 text-xs text-[#152238] line-clamp-2">{doc.name}</strong>
                    <small className="text-slate-400">{doc.ext} {doc.size_bytes ? `· ${formatSize(doc.size_bytes)}` : ''}</small>
                    <div className="flex items-center gap-1.5 mt-3">
                      <span className="w-6 h-6 rounded-full bg-[#ebe8ff] text-[#5543c4] flex items-center justify-center text-[9px] font-extrabold">{initials(doc.uploader_name)}</span>
                      <b className="text-[10px] text-[#152238]">{doc.uploader_name}</b>
                    </div>
                    <div className="flex justify-between items-center border-t border-[#edf0f4] mt-3 pt-2.5 text-[9px] text-[#66758b]">
                      <span>{doc.phase_name || 'Không gắn phase'}</span>
                      <span className={`inline-block rounded-full px-2 py-1 font-extrabold ${STATUS_CLASS[doc.status]}`}>● {STATUS_LABEL[doc.status]}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* DETAIL DRAWER */}
      {selectedDoc && (
        <>
          <div className="fixed inset-0 bg-[#0d182b]/40 z-[39]" onClick={() => setSelectedDoc(null)} />
          <aside className="fixed inset-y-0 right-0 w-[410px] max-w-[100vw] bg-white z-40 shadow-2xl overflow-auto pb-20">
            <div className="p-5 border-b border-[#e5e9ef] flex justify-between">
              <div>
                <small className="text-[9px] tracking-widest text-[#8b96a8] font-extrabold">CHI TIẾT DỮ LIỆU</small>
                <h3 className="text-[15px] font-bold mt-1 max-w-[300px]">{selectedDoc.name}</h3>
              </div>
              <button onClick={() => setSelectedDoc(null)} className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="mx-5 my-4 min-h-[130px] bg-slate-50 border border-dashed border-[#cdd6e2] rounded-lg flex flex-col items-center justify-center gap-2 p-4">
              <span className="text-white font-black text-xs px-4 py-3 rounded" style={{ background: extColor(selectedDoc.ext) }}>{selectedDoc.ext}</span>
              <span className="text-xs text-slate-500">Xem trước tài liệu</span>
              {(selectedDoc.source === 'file' ? true : !!selectedDoc.url) && (
                <a
                  href={selectedDoc.source === 'file' ? projectDocumentFileUrl(projectId, selectedDoc.id) : (selectedDoc.url || '#')}
                  target="_blank" rel="noopener noreferrer"
                  className="text-[#0963c8] font-bold text-xs"
                >
                  Mở dữ liệu gốc ↗
                </a>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 mx-5 py-4 border-b border-[#e7ebf0]">
              <DetailField label="Phase" value={selectedDoc.phase_name || '—'} />
              <DetailField label="Loại dữ liệu" value={selectedDoc.doc_type} />
              <div>
                <label className="block text-[10px] text-[#8995a7] mb-1">Task liên kết</label>
                {selectedDoc.task_id ? (
                  <button onClick={() => onNavigateToTask?.(selectedDoc.task_id!)} className="text-[11px] text-[#0963c8] font-bold text-left">{selectedDoc.task_label}</button>
                ) : <b className="text-[11px]">—</b>}
              </div>
              <DetailField label="Người phụ trách" value={selectedDoc.owner_name || '—'} />
              <DetailField label="Người tải lên" value={selectedDoc.uploader_name} />
              <DetailField label="Thời gian tải" value={formatDate(selectedDoc.updated_at)} />
            </div>

            <div className="mx-5 py-4 border-b border-[#e7ebf0]">
              <b className="text-xs">Phiên bản</b>
              <div className="mt-2 space-y-2">
                {history.filter(h => h.action === 'CREATE' || h.field_name === 'file').length === 0 ? (
                  <small className="text-slate-400">Chưa có lịch sử phiên bản.</small>
                ) : history.filter(h => h.action === 'CREATE' || h.field_name === 'file').map((h, idx, arr) => (
                  <div key={h.id} className="flex items-center gap-2.5 py-1">
                    <span className="w-7 h-7 rounded bg-[#e8f2ff] text-[#0963c8] flex items-center justify-center text-[10px] font-black shrink-0">v{arr.length - idx}</span>
                    <div className="flex-1">
                      <b className="block text-[10px]">{idx === 0 ? 'Bản hiện tại' : 'Đã thay thế'}</b>
                      <small className="text-slate-400">{formatDate(h.created_at)} · {h.user_name}</small>
                    </div>
                    {idx === 0 && <em className="text-[8px] not-italic bg-[#e8f8f1] text-[#07855a] px-1.5 py-1 rounded">Mới nhất</em>}
                  </div>
                ))}
              </div>
            </div>

            <div className="mx-5 py-4">
              <b className="text-xs">Hoạt động gần đây</b>
              <div className="mt-2 space-y-2.5 text-[10px] text-[#5e6c81]">
                {history.length === 0 ? <p>Chưa có hoạt động nào.</p> : history.slice(0, 8).map(h => (
                  <p key={h.id}><b>{h.user_name}</b> {h.description} <br /><small className="text-slate-400">{formatDate(h.created_at)}</small></p>
                ))}
              </div>
            </div>

            <div className="fixed bottom-0 right-0 w-[410px] max-w-[100vw] bg-white border-t border-[#e3e8ef] p-3 flex gap-2">
              <button onClick={() => handleDelete(selectedDoc)} className="flex-1 h-10 border border-[#cdd7e5] rounded-lg text-xs font-bold text-[#34425a]">Xóa</button>
              {canApprove && selectedDoc.status === 'review' ? (
                <>
                  <button onClick={() => handleReject(selectedDoc)} className="flex-1 h-10 border border-rose-200 bg-rose-50 text-rose-700 rounded-lg text-xs font-bold">Từ chối</button>
                  <button onClick={() => handleApprove(selectedDoc)} className="flex-1 h-10 bg-[#0963c8] text-white rounded-lg text-xs font-bold">Duyệt</button>
                </>
              ) : (
                <button onClick={() => openEditModal(selectedDoc)} className="flex-1 h-10 bg-[#0963c8] text-white rounded-lg text-xs font-bold">Cập nhật dữ liệu</button>
              )}
            </div>
          </aside>
        </>
      )}

      {/* UPLOAD / EDIT MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-[#0d182b]/60 z-[60] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="w-full max-w-[620px] max-h-[94vh] bg-white rounded-2xl overflow-auto">
            <div className="p-5 border-b border-[#e5e9ef] flex justify-between">
              <div>
                <small className="text-[9px] tracking-widest text-[#8b96a8] font-extrabold">{editingDoc ? 'CẬP NHẬT DỮ LIỆU' : 'THÊM DỮ LIỆU'}</small>
                <h3 className="text-[15px] font-bold mt-1">{editingDoc ? 'Cập nhật dữ liệu dự án' : 'Thêm dữ liệu vào dự án'}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 bg-[#f3f6fa] border border-[#dce3ed] rounded-lg p-1 m-4">
              <button onClick={() => setSourceMode('file')} className={`h-9 rounded-md text-xs font-bold ${sourceMode === 'file' ? 'bg-white text-[#0963c8] shadow-sm' : 'text-[#69768a]'}`}>⇧ Tải file</button>
              <button onClick={() => setSourceMode('link')} className={`h-9 rounded-md text-xs font-bold ${sourceMode === 'link' ? 'bg-white text-[#0963c8] shadow-sm' : 'text-[#69768a]'}`}>🔗 Gắn liên kết</button>
            </div>

            {sourceMode === 'file' ? (
              <div className="mx-4 mb-4 h-[110px] border-[1.5px] border-dashed border-[#a8bfdd] bg-[#f7faff] rounded-lg flex flex-col items-center justify-center gap-1 text-[#58718f]"
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFileChosen(f); }}
              >
                <b className="text-[#293a52]">{formFile ? `✓ ${formFile.name}` : (editingDoc ? 'Kéo thả file mới để thay thế' : 'Kéo thả file vào đây')}</b>
                <span className="text-[10px]">PDF, Word, Excel, ảnh, ZIP... tối đa 100 MB</span>
                <button onClick={() => fileInputRef.current?.click()} className="text-[#0963c8] font-bold text-xs">Chọn file từ máy tính</button>
                <input ref={fileInputRef} type="file" hidden onChange={e => handleFileChosen(e.target.files?.[0] || null)} />
              </div>
            ) : (
              <div className="mx-4 mb-4">
                <input value={formUrl} onChange={e => setFormUrl(e.target.value)} placeholder="https://drive.google.com/..." className="w-full h-10 border border-[#cfd7e3] rounded-lg px-3 text-xs" />
              </div>
            )}

            <div className="px-4 grid grid-cols-2 gap-3">
              <label className="text-[10px] text-[#617087] font-bold">Tên dữ liệu
                <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ví dụ: Biên bản họp kickoff" className="block w-full h-9 mt-1.5 border border-[#cfd7e3] rounded px-2.5 text-xs font-normal" />
              </label>
              <label className="text-[10px] text-[#617087] font-bold">Loại dữ liệu
                <select value={formType} onChange={e => setFormType(e.target.value)} className="block w-full h-9 mt-1.5 border border-[#cfd7e3] rounded px-2.5 text-xs font-normal bg-white">
                  {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-[#617087] font-bold">Gắn vào phase
                <select value={formPhase} onChange={e => setFormPhase(e.target.value)} className="block w-full h-9 mt-1.5 border border-[#cfd7e3] rounded px-2.5 text-xs font-normal bg-white">
                  <option value="">Không gắn phase</option>
                  {phases.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-[#617087] font-bold">Gắn vào task
                <select value={formTask} onChange={e => setFormTask(e.target.value)} className="block w-full h-9 mt-1.5 border border-[#cfd7e3] rounded px-2.5 text-xs font-normal bg-white">
                  <option value="">Không gắn task</option>
                  {tasks.map((t: any) => <option key={t.id} value={t.id}>{t.task_code || t.id} · {t.detail || t.title || t.name}</option>)}
                </select>
              </label>
            </div>

            <div className="mx-4 mt-4 flex items-center gap-2.5 p-2.5 bg-slate-50 border border-[#e0e6ed] rounded-lg">
              <span className="w-8 h-8 rounded-full bg-[#ebe8ff] text-[#5543c4] flex items-center justify-center text-[10px] font-extrabold">{initials(currentUserName)}</span>
              <div className="flex-1">
                <b className="block text-[11px]">{currentUserName}</b>
                <small className="text-[9px] text-[#8591a4]">{currentUserEmail} · Người đang đăng nhập</small>
              </div>
              <span className="text-[9px] text-[#738199] bg-slate-100 px-2 py-1 rounded">Tự động ghi nhận</span>
            </div>

            {(formType === 'Biên bản' || formType === 'Báo cáo') && !editingDoc && (
              <p className="mx-4 mt-3.5 p-2.5 rounded bg-[#f1efff] text-[#5b50b6] text-[10px]">
                ✨ Loại dữ liệu này yêu cầu Leader của dự án duyệt trước khi được đánh dấu "Đã duyệt".
              </p>
            )}

            <div className="flex justify-end gap-2 p-4">
              <button onClick={() => setShowModal(false)} className="h-10 px-4 border border-[#cdd7e5] rounded-lg text-xs font-bold text-[#34425a]">Hủy</button>
              <button onClick={handleSubmit} disabled={submitting} className="h-10 px-4 bg-[#0963c8] text-white rounded-lg text-xs font-bold disabled:opacity-50">
                {submitting ? 'Đang lưu...' : (editingDoc ? 'Lưu thay đổi' : 'Thêm vào dự án')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricTile({ icon, iconClass, label, value, hint }: { icon: string; iconClass: string; label: string; value: string; hint: string }) {
  return (
    <div className="bg-white border border-[#dce3ed] rounded-xl p-3.5 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}>
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </div>
      <div>
        <label className="block text-[11px] text-[#708096]">{label}</label>
        <strong className="text-lg text-[#152238] mr-1.5">{value}</strong>
        <small className="text-[9px] text-[#8995a6]">{hint}</small>
      </div>
    </div>
  );
}

function NavLabel({ text }: { text: string }) {
  return <label className="block text-[9px] tracking-wider text-slate-400 font-extrabold px-2.5 pt-3 pb-1.5">{text}</label>;
}

function NavButton({ active, onClick, label, icon, count, warn }: { active: boolean; onClick: () => void; label: string; icon: string; count?: number; warn?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-left text-[11.5px] ${active ? 'bg-[#e8f1ff] text-[#075dbf] font-extrabold' : 'text-[#536177] hover:bg-slate-100'}`}
    >
      <span className="material-symbols-outlined text-[15px]">{icon}</span>
      <span className="truncate">{label}</span>
      {typeof count === 'number' && (
        <span className={`ml-auto text-[10px] ${warn ? 'bg-[#fff1db] text-[#b66a00] px-1.5 py-0.5 rounded-full font-bold' : 'text-slate-400'}`}>{count}</span>
      )}
    </button>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-[10px] text-[#8995a7] mb-1">{label}</label>
      <b className="text-[11px]">{value}</b>
    </div>
  );
}

function SettingsPanel({ categories }: { categories: { doc_type: string; count: number }[] }) {
  const rules = [
    ['Tự nhận diện loại file', 'Phân loại theo định dạng và nội dung'],
    ['Cảnh báo tài liệu trùng', 'So khớp tên, task và nội dung'],
    ['Bắt buộc gắn Phase/Task', 'Không cho lưu dữ liệu chưa phân loại'],
    ['Yêu cầu duyệt bản chính thức', 'Áp dụng cho Biên bản và Báo cáo — chỉ Leader dự án được duyệt'],
  ];
  return (
    <div className="p-5">
      <div className="mb-5">
        <small className="text-[9px] tracking-widest text-slate-400 font-extrabold">QUẢN TRỊ DỮ LIỆU</small>
        <h3 className="text-[15px] font-bold mt-1">Danh mục & quy tắc</h3>
        <p className="text-[11px] text-[#7c889b] mt-1">Các danh mục dùng chung và quy tắc kiểm soát dữ liệu.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="border border-[#e0e6ee] rounded-lg overflow-hidden">
          <div className="h-11 bg-[#f6f8fb] border-b border-[#e3e8ef] flex items-center justify-between px-3.5">
            <b className="text-xs">Danh mục dữ liệu</b>
            <span className="text-[9px] text-slate-400">{categories.length} danh mục</span>
          </div>
          {categories.length === 0 ? (
            <p className="p-4 text-xs text-slate-400">Chưa có dữ liệu nào được phân loại.</p>
          ) : categories.map(c => (
            <div key={c.doc_type} className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[#edf0f4] last:border-0">
              <span className="w-7 h-7 rounded bg-[#eaf3ff] text-[#0963c8] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[15px]">folder</span>
              </span>
              <b className="flex-1 text-[11px]">{c.doc_type}</b>
              <em className="text-[9px] not-italic text-slate-500 bg-slate-100 px-1.5 py-1 rounded">{c.count} dữ liệu</em>
            </div>
          ))}
        </section>
        <section className="border border-[#e0e6ee] rounded-lg overflow-hidden">
          <div className="h-11 bg-[#f6f8fb] border-b border-[#e3e8ef] flex items-center justify-between px-3.5">
            <b className="text-xs">Quy tắc tự động</b>
            <span className="text-[9px] text-slate-400">{rules.length} đang bật</span>
          </div>
          {rules.map(([title, desc]) => (
            <div key={title} className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[#edf0f4] last:border-0">
              <div className="flex-1">
                <b className="block text-[11px]">{title}</b>
                <small className="text-[9px] text-slate-400">{desc}</small>
              </div>
              <span className="w-8 h-[19px] rounded-full bg-[#1570d3] relative shrink-0">
                <span className="absolute w-3.5 h-3.5 bg-white rounded-full top-[2px] right-[2px]" />
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function AutoLinksPanel({ tasks, phases, projectName, onNavigateToTask }: { tasks: any[]; phases: any[]; projectName: string; onNavigateToTask?: (taskId: string | number) => void }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedPhase, setSelectedPhase] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // Extract all valid links/resources embedded in task fields (LINK, ticket_id, detail, notes, remark, send)
  const linksList = useMemo(() => {
    const list: AutoLinkItem[] = [];
    const seenUrls = new Set<string>();

    (tasks || []).forEach((t: any, idx: number) => {
      const taskIdStr = t.task_code || t.task_id || (t.id ? `#${t.id}` : `Task #${idx + 1}`);
      const taskDetail = t.detail || t.title || t.name || 'Nhiệm vụ không tên';
      const phaseName = t.phase_name || t.task_group_name || t.group_name || 'Hạng mục chung';
      const assignedName = t.assigned_name || t.assigned_member_name || t.owner || 'Chưa phân công';
      const dateStr = t.start_date || t.created_at || '';

      const directLink = String(t.link || t.ticket_id || t.LINK || '').trim();
      if (directLink && directLink !== 'Trống' && directLink !== '-') {
        const fullUrl = directLink.startsWith('http') ? directLink : `https://${directLink}`;
        const key = `${t.id || idx}-${fullUrl}`;
        if (!seenUrls.has(key)) {
          seenUrls.add(key);
          const meta = detectAutoLinkType(directLink);
          list.push({ id: key, url: fullUrl, displayUrl: directLink, title: taskDetail, ...meta, taskId: String(taskIdStr), taskDetail, phaseName, assignedName, dateStr });
        }
      }

      const extraTexts = [t.detail, t.notes, t.remark, t.send].filter(Boolean).join(' ');
      const matches = extraTexts.match(AUTO_LINK_URL_REGEX);
      if (matches) {
        matches.forEach((rawUrl: string) => {
          const cleanUrl = rawUrl.trim().replace(/[,\.\)]+$/, '');
          if (!cleanUrl || cleanUrl === directLink) return;
          const fullUrl = cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`;
          const key = `${t.id || idx}-${fullUrl}`;
          if (!seenUrls.has(key)) {
            seenUrls.add(key);
            const meta = detectAutoLinkType(cleanUrl);
            list.push({ id: key, url: fullUrl, displayUrl: cleanUrl, title: taskDetail, ...meta, taskId: String(taskIdStr), taskDetail, phaseName, assignedName, dateStr });
          }
        });
      }
    });

    return list;
  }, [tasks]);

  const phasesList = useMemo(() => {
    const set = new Set<string>();
    linksList.forEach(r => { if (r.phaseName) set.add(r.phaseName); });
    return Array.from(set);
  }, [linksList]);

  const filteredLinks = useMemo(() => {
    return linksList.filter(r => {
      const matchesSearch = !searchTerm.trim() ||
        r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.displayUrl.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.taskId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.assignedName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = selectedType === 'ALL' || r.type === selectedType;
      const matchesPhase = selectedPhase === 'ALL' || r.phaseName === selectedPhase;
      return matchesSearch && matchesType && matchesPhase;
    });
  }, [linksList, searchTerm, selectedType, selectedPhase]);

  const handleCopyLink = (item: AutoLinkItem) => {
    navigator.clipboard.writeText(item.url);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAllLinks = () => {
    if (!filteredLinks.length) return;
    const text = filteredLinks.map(r => `[${r.taskId}] ${r.title}\n${r.url}`).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleExportCSV = () => {
    if (!filteredLinks.length) return;
    const headers = ['Task ID', 'Nhiệm vụ', 'Loại tài nguyên', 'Đường dẫn Link', 'Hạng mục/Phase', 'Người phụ trách'];
    const rows = filteredLinks.map(r => [
      `"${r.taskId}"`,
      `"${r.title.replace(/"/g, '""')}"`,
      `"${r.typeLabel}"`,
      `"${r.url}"`,
      `"${r.phaseName.replace(/"/g, '""')}"`,
      `"${r.assignedName.replace(/"/g, '""')}"`,
    ]);
    const csvContent = '﻿' + [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Danh_sach_Lien_ket_${projectName || 'Du_an'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-w-0 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-[#e6eaf0]">
        <div>
          <small className="text-[8px] tracking-widest font-extrabold text-slate-400">ĐANG XEM</small>
          <h3 className="text-[15px] font-bold text-[#152238] mt-0.5">Liên kết tự động từ Task</h3>
          <p className="text-[11px] text-[#7c889b] mt-0.5">Tổng hợp tự động link Drive, Figma, GitHub, Notion, Meeting... đính kèm trong các nhiệm vụ.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyAllLinks}
            disabled={!filteredLinks.length}
            className="h-9 px-3 border border-[#cdd6e2] bg-white text-[#34425a] text-xs font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[15px]">{copiedAll ? 'check' : 'content_copy'}</span>
            {copiedAll ? 'Đã sao chép!' : 'Sao chép link'}
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!filteredLinks.length}
            className="h-9 px-3 bg-[#0963c8] hover:bg-[#0963c8]/90 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[15px]">download</span>
            Xuất CSV
          </button>
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="p-3 flex flex-wrap gap-2 border-b border-[#e6eaf0]">
        <div className="flex-1 min-w-[240px] h-9 border border-[#cdd6e2] rounded-lg flex items-center px-2.5 gap-2 text-[#78869a]">
          <span className="material-symbols-outlined text-[16px]">search</span>
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Tìm theo link, tiêu đề task, mã task, người phụ trách..."
            className="border-0 outline-0 flex-1 text-xs min-w-0"
          />
        </div>
        <select value={selectedType} onChange={e => setSelectedType(e.target.value)} className="h-9 border border-[#cdd6e2] rounded-lg px-2.5 text-xs text-[#46546b] bg-white">
          <option value="ALL">Tất cả loại ({linksList.length})</option>
          <option value="drive">Google Drive / Docs</option>
          <option value="figma">Figma Design</option>
          <option value="github">GitHub / Code</option>
          <option value="notion">Notion Doc</option>
          <option value="meeting">Zoom / Meeting</option>
          <option value="ticket">Ticket / Reference</option>
          <option value="link">Website / Link khác</option>
        </select>
        {phasesList.length > 0 && (
          <select value={selectedPhase} onChange={e => setSelectedPhase(e.target.value)} className="h-9 border border-[#cdd6e2] rounded-lg px-2.5 text-xs text-[#46546b] bg-white max-w-[180px]">
            <option value="ALL">Mọi phase</option>
            {phasesList.map((p, idx) => <option key={idx} value={p}>{p}</option>)}
          </select>
        )}
      </div>

      <div className="h-8 bg-[#fbfcfe] border-b border-[#e6eaf0] flex items-center px-3.5 text-[10px] text-[#8994a5]">
        <span>Đang hiển thị <b className="text-[#152238]">{filteredLinks.length}</b> liên kết</span>
      </div>

      {/* CONTENT */}
      {filteredLinks.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3.5">
          {filteredLinks.map(item => {
            const isCopied = copiedId === item.id;
            return (
              <div key={item.id} className="border border-[#e0e6ee] rounded-lg p-3.5 hover:border-[#8db8ee] hover:shadow-md transition-all flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${item.badgeStyle}`}>{item.typeLabel}</span>
                  <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{item.taskId}</span>
                </div>
                <h4
                  onClick={() => onNavigateToTask?.(item.taskId)}
                  className="font-bold text-xs text-[#152238] line-clamp-2 hover:text-[#0963c8] cursor-pointer transition-colors"
                  title={item.taskDetail}
                >
                  {item.title}
                </h4>
                <div className="p-2 bg-slate-50 border border-[#e6eaf0] rounded-md text-[11px] font-mono text-slate-600 truncate break-all flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-slate-400 shrink-0">public</span>
                  <span className="truncate">{item.displayUrl}</span>
                </div>
                <div className="pt-2 border-t border-[#edf0f4] flex items-center justify-between text-[10px] text-slate-500">
                  <div className="truncate pr-2">
                    <p className="truncate">{item.assignedName}</p>
                    <p className="truncate text-slate-400">{item.phaseName}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => handleCopyLink(item)} className="p-1.5 text-slate-500 hover:text-[#0963c8] hover:bg-slate-100 rounded-lg" title="Sao chép link">
                      <span className="material-symbols-outlined text-[15px]">{isCopied ? 'check' : 'content_copy'}</span>
                    </button>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-[#0963c8] hover:bg-blue-50 rounded-lg" title="Mở liên kết trong tab mới">
                      <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-14 text-center text-[#8995a7]">
          <span className="material-symbols-outlined text-4xl text-slate-300 mb-2 block">link_off</span>
          <p className="text-sm font-bold text-[#152238]">Chưa tìm thấy liên kết phù hợp</p>
          <p className="text-xs mt-1">
            {linksList.length === 0
              ? 'Dự án này chưa có nhiệm vụ nào gắn đường dẫn trong cột LINK hoặc ghi chú.'
              : 'Không tìm thấy liên kết nào khớp với bộ lọc tìm kiếm của bạn.'}
          </p>
        </div>
      )}
    </div>
  );
}
