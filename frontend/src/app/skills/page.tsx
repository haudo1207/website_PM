'use client';

import { useEffect, useState } from 'react';
import { Brain, Search, Trash2, Paperclip, Download, ChevronDown, ChevronUp, Building2, FolderOpen, Loader2 } from 'lucide-react';
import {
  getAiSkills, deleteAiSkill, getAiSkillAttachmentBlob, AiSkillEntry,
  getDepartments, getTeams, getCustomers, getProjects,
} from '@/lib/api';

const CONTENT_TRUNCATE_LENGTH = 320;

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type Scope = 'all' | 'org' | 'project';

export default function SkillsLibraryPage() {
  const [scope, setScope] = useState<Scope>('all');
  const [keyword, setKeyword] = useState('');
  const [departments, setDepartments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [projectId, setProjectId] = useState<number | ''>('');

  const [skills, setSkills] = useState<AiSkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    getDepartments().then(setDepartments).catch(() => {});
    getTeams().then(setTeams).catch(() => {});
    getCustomers().then(setCustomers).catch(() => {});
  }, []);

  useEffect(() => {
    if (scope !== 'project' || !customerId) { setProjects([]); return; }
    getProjects({ customer_id: Number(customerId) }).then(setProjects).catch(() => setProjects([]));
  }, [scope, customerId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params: any = { keyword: keyword.trim() || undefined, limit: 100 };
      if (scope === 'org') {
        if (departmentId) params.department_id = Number(departmentId);
        if (teamId) params.team_id = Number(teamId);
      } else if (scope === 'project') {
        if (projectId) params.project_id = Number(projectId);
      }
      const data = await getAiSkills(params);
      setSkills(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Không tải được thư viện Kỹ năng');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope, departmentId, teamId, projectId]);

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDelete(s: AiSkillEntry) {
    if (!confirm(`Xóa Kỹ năng "${s.title}"? Không thể hoàn tác.`)) return;
    setDeletingId(s.id);
    try {
      await deleteAiSkill(s.id);
      setSkills((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Lỗi khi xóa');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDownload(skillId: number, idx: number, fileName: string) {
    try {
      const blob = await getAiSkillAttachmentBlob(skillId, idx);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Lỗi khi tải file đính kèm');
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
          <Brain className="w-4.5 h-4.5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-lg font-extrabold text-slate-900">Thư viện Kỹ năng</h1>
          <p className="text-xs text-slate-400">
            Nội dung do AI (ChatGPT/Claude/Gemini) đúc kết, lưu qua extension "KPI Prototype" — {skills.length} mục
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-[12.5px] text-red-700">{error}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['all', 'org', 'project'] as Scope[]).map((s) => (
            <button
              key={s}
              onClick={() => { setScope(s); setDepartmentId(''); setTeamId(''); setCustomerId(''); setProjectId(''); }}
              className={`px-3 py-1.5 rounded-full text-[12px] font-bold border transition-colors ${
                scope === s ? 'bg-[#0058be] text-white border-[#0058be]' : 'text-slate-500 border-slate-200 hover:border-slate-300'
              }`}
            >
              {s === 'all' ? 'Tất cả' : s === 'org' ? '🏢 Phòng ban & Vị trí' : '📁 Khách hàng & Dự án'}
            </button>
          ))}
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Tìm theo tiêu đề..."
              className="w-full pl-8 pr-3 py-1.5 text-[12.5px] border border-slate-300 rounded-full outline-none focus:ring-1 focus:ring-[#0058be]"
            />
          </div>
        </div>

        {scope === 'org' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value ? Number(e.target.value) : ''); setTeamId(''); }}
              className="text-[12.5px] border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
              <option value="">-- Tất cả Phòng ban --</option>
              {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')}
              className="text-[12.5px] border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
              <option value="">-- Tất cả Vị trí --</option>
              {teams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        {scope === 'project' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <select value={customerId} onChange={(e) => { setCustomerId(e.target.value ? Number(e.target.value) : ''); setProjectId(''); }}
              className="text-[12.5px] border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
              <option value="">-- Chọn Khách hàng --</option>
              {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} disabled={!customerId}
              className="text-[12.5px] border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be] disabled:opacity-50">
              <option value="">-- Tất cả Dự án --</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-14 text-slate-400 gap-2 text-[12.5px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang tải...
        </div>
      ) : (
        <div className="space-y-3">
          {skills.map((s) => {
            const isLong = s.markdown_content.length > CONTENT_TRUNCATE_LENGTH;
            const isExpanded = expandedIds.has(s.id);
            const shown = isLong && !isExpanded ? s.markdown_content.slice(0, CONTENT_TRUNCATE_LENGTH).trimEnd() + '…' : s.markdown_content;
            return (
              <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold text-slate-800 truncate">{s.title}</div>
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 mt-0.5">
                      <span>{s.created_by || 'Ẩn danh'} · {formatDate(s.created_at)}</span>
                      {s.project_name ? (
                        <span className="flex items-center gap-1 text-emerald-600 font-semibold"><FolderOpen className="w-3 h-3" /> {s.project_name}</span>
                      ) : (s.department_name || s.team_name) ? (
                        <span className="flex items-center gap-1 text-indigo-600 font-semibold">
                          <Building2 className="w-3 h-3" /> {[s.department_name, s.team_name].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                      <span className="uppercase font-bold text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{s.asset_type}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(s)}
                    disabled={deletingId === s.id}
                    className="text-slate-300 hover:text-red-500 shrink-0 disabled:opacity-50"
                    title="Xóa Kỹ năng này"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[12.5px] text-slate-600 leading-relaxed whitespace-pre-wrap font-mono">{shown}</p>
                {isLong && (
                  <button onClick={() => toggleExpand(s.id)} className="mt-1 flex items-center gap-1 text-[11.5px] font-semibold text-[#0058be] hover:underline">
                    {isExpanded ? <>Thu gọn <ChevronUp className="w-3 h-3" /></> : <>Xem thêm <ChevronDown className="w-3 h-3" /></>}
                  </button>
                )}
                {s.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.attachments.map((file, idx) => (
                      <button
                        key={file.id}
                        onClick={() => handleDownload(s.id, idx, file.file_name)}
                        className="flex items-center gap-1 text-[11px] text-slate-500 border border-slate-200 rounded-full px-2.5 py-1 hover:border-[#0058be] hover:text-[#0058be] transition-colors"
                      >
                        <Paperclip className="w-3 h-3" />
                        <span className="max-w-[140px] truncate">{file.file_name}</span>
                        <span className="text-slate-400 shrink-0">{formatBytes(file.size_bytes)}</span>
                        <Download className="w-3 h-3" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {skills.length === 0 && (
            <div className="text-center py-14 text-[12.5px] text-slate-400 bg-white border border-slate-200 rounded-xl">
              Chưa có Kỹ năng nào phù hợp với bộ lọc hiện tại.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
