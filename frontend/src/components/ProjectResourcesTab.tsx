'use client';

import React, { useState, useMemo } from 'react';
import { 
  Search, Link as LinkIcon, ExternalLink, Copy, Check, Filter, 
  Globe, Download
} from 'lucide-react';

export interface ResourceItem {
  id: string;
  url: string;
  displayUrl: string;
  title: string;
  type: 'drive' | 'figma' | 'github' | 'notion' | 'meeting' | 'ticket' | 'link';
  typeLabel: string;
  badgeStyle: string;
  iconName: string;
  taskId: string;
  taskDetail: string;
  phaseName: string;
  assignedName: string;
  dateStr: string;
}

interface ProjectResourcesTabProps {
  tasks: any[];
  projectName?: string;
  onNavigateToTask?: (taskId: string | number) => void;
}

// Regex to extract all HTTP/HTTPS links or domain links from raw text
const URL_REGEX = /(https?:\/\/[^\s<>"'\(\)]+|www\.[^\s<>"'\(\)]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\/[^\s<>"'\(\)]*)/gi;

function detectResourceType(urlStr: string): { type: ResourceItem['type']; typeLabel: string; badgeStyle: string; iconName: string } {
  const lower = (urlStr || '').toLowerCase();
  
  if (lower.includes('drive.google.com') || lower.includes('docs.google.com') || lower.includes('sheets.google.com') || lower.includes('slides.google.com')) {
    return { type: 'drive', typeLabel: 'Google Drive / Docs', badgeStyle: 'bg-emerald-100 text-emerald-800 border-emerald-200', iconName: 'drive' };
  }
  if (lower.includes('figma.com')) {
    return { type: 'figma', typeLabel: 'Figma Design', badgeStyle: 'bg-purple-100 text-purple-800 border-purple-200', iconName: 'figma' };
  }
  if (lower.includes('github.com') || lower.includes('gitlab.com') || lower.includes('bitbucket.org')) {
    return { type: 'github', typeLabel: 'GitHub / Source', badgeStyle: 'bg-slate-800 text-white border-slate-700', iconName: 'github' };
  }
  if (lower.includes('notion.so') || lower.includes('notion.site')) {
    return { type: 'notion', typeLabel: 'Notion Doc', badgeStyle: 'bg-stone-100 text-stone-800 border-stone-300', iconName: 'notion' };
  }
  if (lower.includes('zoom.us') || lower.includes('meet.google.com') || lower.includes('teams.microsoft.com')) {
    return { type: 'meeting', typeLabel: 'Meeting Link', badgeStyle: 'bg-blue-100 text-blue-800 border-blue-200', iconName: 'meeting' };
  }
  if (/^[a-z0-9_\-]+$/i.test(urlStr.trim()) || lower.includes('jira') || lower.includes('ticket')) {
    return { type: 'ticket', typeLabel: 'Ticket / Reference', badgeStyle: 'bg-amber-100 text-amber-800 border-amber-200', iconName: 'ticket' };
  }

  return { type: 'link', typeLabel: 'Website / Resource', badgeStyle: 'bg-indigo-100 text-indigo-800 border-indigo-200', iconName: 'link' };
}

export default function ProjectResourcesTab({
  tasks = [],
  projectName = '',
  onNavigateToTask
}: ProjectResourcesTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedPhase, setSelectedPhase] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // Extract all valid resources from task fields
  const resourcesList = useMemo(() => {
    const list: ResourceItem[] = [];
    const seenUrls = new Set<string>();

    (tasks || []).forEach((t: any, idx: number) => {
      const taskIdStr = t.task_code || t.task_id || (t.id ? `#${t.id}` : `Task #${idx + 1}`);
      const taskDetail = t.detail || t.title || t.name || 'Nhiệm vụ không tên';
      const phaseName = t.phase_name || t.task_group_name || t.group_name || 'Hạng mục chung';
      const assignedName = t.assigned_name || t.assigned_member_name || t.owner || 'Chưa phân công';
      const dateStr = t.start_date || t.created_at || '';

      // 1. Direct LINK / ticket_id field
      const directLink = String(t.link || t.ticket_id || t.LINK || '').trim();
      if (directLink && directLink !== 'Trống' && directLink !== '-') {
        const fullUrl = directLink.startsWith('http') ? directLink : `https://${directLink}`;
        const key = `${t.id || idx}-${fullUrl}`;
        if (!seenUrls.has(key)) {
          seenUrls.add(key);
          const meta = detectResourceType(directLink);
          list.push({
            id: key,
            url: fullUrl,
            displayUrl: directLink,
            title: taskDetail,
            type: meta.type,
            typeLabel: meta.typeLabel,
            badgeStyle: meta.badgeStyle,
            iconName: meta.iconName,
            taskId: String(taskIdStr),
            taskDetail,
            phaseName,
            assignedName,
            dateStr
          });
        }
      }

      // 2. Extract URLs embedded in detail, notes, remark, send
      const extraTexts = [t.detail, t.notes, t.remark, t.send].filter(Boolean).join(' ');
      const matches = extraTexts.match(URL_REGEX);
      if (matches) {
        matches.forEach((rawUrl: string) => {
          const cleanUrl = rawUrl.trim().replace(/[,\.\)]+$/, '');
          if (!cleanUrl || cleanUrl === directLink) return;
          const fullUrl = cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`;
          const key = `${t.id || idx}-${fullUrl}`;
          if (!seenUrls.has(key)) {
            seenUrls.add(key);
            const meta = detectResourceType(cleanUrl);
            list.push({
              id: key,
              url: fullUrl,
              displayUrl: cleanUrl,
              title: taskDetail,
              type: meta.type,
              typeLabel: meta.typeLabel,
              badgeStyle: meta.badgeStyle,
              iconName: meta.iconName,
              taskId: String(taskIdStr),
              taskDetail,
              phaseName,
              assignedName,
              dateStr
            });
          }
        });
      }
    });

    return list;
  }, [tasks]);

  // Extract unique phases for filter
  const phasesList = useMemo(() => {
    const set = new Set<string>();
    resourcesList.forEach(r => {
      if (r.phaseName) set.add(r.phaseName);
    });
    return Array.from(set);
  }, [resourcesList]);

  // Filtered resources based on search, type, and phase
  const filteredResources = useMemo(() => {
    return resourcesList.filter(r => {
      const matchesSearch = !searchTerm.trim() || 
        r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.displayUrl.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.taskId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.assignedName.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesType = selectedType === 'ALL' || r.type === selectedType;
      const matchesPhase = selectedPhase === 'ALL' || r.phaseName === selectedPhase;

      return matchesSearch && matchesType && matchesPhase;
    });
  }, [resourcesList, searchTerm, selectedType, selectedPhase]);

  const handleCopyLink = (item: ResourceItem) => {
    navigator.clipboard.writeText(item.url);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAllLinks = () => {
    if (!filteredResources.length) return;
    const text = filteredResources.map(r => `[${r.taskId}] ${r.title}\n🔗 ${r.url}`).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleExportCSV = () => {
    if (!filteredResources.length) return;
    const headers = ['Task ID', 'Nhiệm vụ', 'Loại tài nguyên', 'Đường dẫn Link', 'Hạng mục/Phase', 'Người phụ trách'];
    const rows = filteredResources.map(r => [
      `"${r.taskId}"`,
      `"${r.title.replace(/"/g, '""')}"`,
      `"${r.typeLabel}"`,
      `"${r.url}"`,
      `"${r.phaseName.replace(/"/g, '""')}"`,
      `"${r.assignedName.replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Danh_sach_Tai_nguyen_${projectName || 'Du_an'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
      {/* Header & Stats Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-indigo-50 text-[#0058be] rounded-xl flex items-center justify-center font-bold">
              <LinkIcon size={20} />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#0b1c30]">
                Tài Nguyên & Liên Kết Dự Án
              </h3>
              <p className="text-xs text-[#565e74] mt-0.5">
                Tổng hợp tự động tất cả tài liệu, file Google Drive, Figma, GitHub và link đính kèm trong các nhiệm vụ.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <button
            type="button"
            onClick={handleCopyAllLinks}
            disabled={!filteredResources.length}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
          >
            {copiedAll ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
            <span>{copiedAll ? 'Đã sao chép tất cả!' : 'Sao chép link'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!filteredResources.length}
            className="px-3.5 py-2 bg-[#0058be] hover:bg-[#004499] text-white text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download size={14} />
            <span>Xuất CSV</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
        {/* Search Bar */}
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo tên link, tiêu đề task, mã task, người phụ trách..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-[#0b1c30] placeholder-slate-400 focus:outline-none focus:border-[#0058be] focus:ring-1 focus:ring-[#0058be]"
          />
        </div>

        {/* Type Filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-slate-500 hidden sm:inline" />
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-bold text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
          >
            <option value="ALL">Tất cả loại tài nguyên ({resourcesList.length})</option>
            <option value="drive">📁 Google Drive / Docs</option>
            <option value="figma">🎨 Figma Design</option>
            <option value="github">💻 GitHub / Code</option>
            <option value="notion">📝 Notion Doc</option>
            <option value="meeting">🎥 Zoom / Meeting</option>
            <option value="link">🌐 Website / Link khác</option>
          </select>
        </div>

        {/* Phase Filter */}
        {phasesList.length > 0 && (
          <div>
            <select
              value={selectedPhase}
              onChange={(e) => setSelectedPhase(e.target.value)}
              className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-bold text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
            >
              <option value="ALL">Tất cả Hạng mục/Phase</option>
              {phasesList.map((p, idx) => (
                <option key={idx} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Resource Cards Grid */}
      {filteredResources.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredResources.map((item) => {
            const isCopied = copiedId === item.id;

            return (
              <div 
                key={item.id}
                className="bg-white border border-slate-200 hover:border-[#0058be]/50 rounded-xl p-4 transition-all shadow-2xs hover:shadow-md flex flex-col justify-between space-y-3 group"
              >
                <div className="space-y-2">
                  {/* Badge & Type Icon */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${item.badgeStyle}`}>
                      {item.typeLabel}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                      {item.taskId}
                    </span>
                  </div>

                  {/* Task Detail Title */}
                  <h4 
                    onClick={() => onNavigateToTask?.(item.taskId)}
                    className="font-bold text-xs sm:text-sm text-[#0b1c30] line-clamp-2 hover:text-[#0058be] cursor-pointer transition-colors"
                    title={item.taskDetail}
                  >
                    {item.title}
                  </h4>

                  {/* URL Text / Preview */}
                  <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-lg text-xs font-mono text-slate-600 truncate break-all select-all flex items-center gap-2">
                    <Globe size={14} className="text-slate-400 shrink-0" />
                    <span className="truncate">{item.displayUrl}</span>
                  </div>
                </div>

                {/* Card Footer: Metadata & Actions */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                  <div className="space-y-0.5 truncate pr-2">
                    <p className="truncate">👤 {item.assignedName}</p>
                    <p className="truncate text-slate-400">🏷️ {item.phaseName}</p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopyLink(item)}
                      className="p-1.5 text-slate-500 hover:text-[#0058be] hover:bg-slate-100 rounded-lg transition-colors"
                      title="Sao chép link"
                    >
                      {isCopied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                    </button>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-[#0058be] hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs"
                      title="Mở liên kết trong tab mới"
                    >
                      <ExternalLink size={15} />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="text-center py-16 space-y-3 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
          <div className="w-12 h-12 bg-indigo-50 text-[#0058be] rounded-full flex items-center justify-center mx-auto">
            <LinkIcon size={24} />
          </div>
          <h4 className="text-sm font-bold text-[#0b1c30]">Chưa tìm thấy tài nguyên / liên kết phù hợp</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {resourcesList.length === 0
              ? 'Dự án này chưa có công việc nào gắn đường dẫn trong cột LINK hoặc ghi chú.'
              : 'Không tìm thấy tài nguyên nào khớp với bộ lọc tìm kiếm của bạn.'}
          </p>
        </div>
      )}
    </div>
  );
}
