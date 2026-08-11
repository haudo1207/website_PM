'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getProjectAuditLogs, exportProjectAuditLogs, AuditLogItem } from '@/lib/api';
import SearchableSelect from './common/SearchableSelect';

interface AuditLogsTabProps {
  projectId: number;
  onSelectTask?: (taskCodeOrId: string) => void;
  onSelectTaskGroup?: (taskGroupId: string) => void;
  onSelectPhase?: (phaseId: string) => void;
  onSelectMeeting?: (meetingId: string) => void;
  onSelectProject?: (projectId: number) => void;
}

interface GroupedAuditEvent {
  event_id: string;
  created_at: string;
  user_name: string;
  user_id?: number;
  module: string;
  entity_type: string;
  entity_id: string;
  action: string;
  main_description: string;
  items: AuditLogItem[];
}

interface DateGroupedEvents {
  dateLabel: string;
  dateKey: string;
  events: GroupedAuditEvent[];
}

// REFINEMENT 4: Search Highlight helper matching across all fields
function HighlightText({ text, query }: { text?: string; query: string }) {
  if (!text) return null;
  if (!query.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 text-yellow-950 px-1 py-0.5 rounded font-bold">{part}</mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

export default function AuditLogsTab({
  projectId,
  onSelectTask,
  onSelectTaskGroup,
  onSelectPhase,
  onSelectMeeting,
  onSelectProject
}: AuditLogsTabProps) {
  // Filter States
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState('30'); // '7', '30', 'all'
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Data States
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Expanded Event Card IDs
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());

  // Selected Log for Detail Modal
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  // Users list for filter dropdown
  const [uniqueUsers, setUniqueUsers] = useState<{ id: number; name: string }[]>([]);

  // Fetch Audit Logs
  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      let startDateStr: string | undefined = undefined;
      const now = new Date();
      if (dateFilter === '7') {
        const d = new Date(now.setDate(now.getDate() - 7));
        startDateStr = d.toISOString().split('T')[0];
      } else if (dateFilter === '30') {
        const d = new Date(now.setDate(now.getDate() - 30));
        startDateStr = d.toISOString().split('T')[0];
      }

      const res = await getProjectAuditLogs(projectId, {
        module: moduleFilter !== 'all' ? moduleFilter : undefined,
        action: actionFilter !== 'all' ? actionFilter : undefined,
        user_id: userFilter !== 'all' ? parseInt(userFilter) : undefined,
        search: search.trim() || undefined,
        start_date: startDateStr,
        page,
        page_size: pageSize
      });

      setLogs(res.items || []);
      setTotal(res.total || 0);
      setTotalPages(res.total_pages || 1);

      // Collect unique users for filter list
      if (res.items) {
        setUniqueUsers(prev => {
          const map = new Map<number, string>();
          prev.forEach(u => map.set(u.id, u.name));
          res.items.forEach(item => {
            if (item.user_id) {
              map.set(item.user_id, item.user_name);
            }
          });
          return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
        });
      }
    } catch (err) {
      console.error('Failed to load project audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, moduleFilter, actionFilter, userFilter, search, dateFilter, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset to page 1 on filter changes
  useEffect(() => {
    setPage(1);
  }, [search, moduleFilter, actionFilter, userFilter, dateFilter]);

  // REFINEMENT 5: Strict Event Grouping by event_id (or single id)
  const groupedEvents = useMemo<GroupedAuditEvent[]>(() => {
    const groupsMap = new Map<string, GroupedAuditEvent>();
    
    logs.forEach(log => {
      const key = log.event_id || `single-${log.id}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          event_id: key,
          created_at: log.created_at,
          user_name: log.user_name || 'System',
          user_id: log.user_id,
          module: log.module,
          entity_type: log.entity_type,
          entity_id: log.entity_id,
          action: log.action,
          main_description: log.description || '',
          items: []
        });
      }
      groupsMap.get(key)!.items.push(log);
    });

    return Array.from(groupsMap.values());
  }, [logs]);

  // REFINEMENT 3: Timeline Grouped by Date with Explicit Counter Format (e.g. "Hôm nay (36)")
  const dateGroupedEvents = useMemo<DateGroupedEvents[]>(() => {
    const map = new Map<string, GroupedAuditEvent[]>();
    const todayStr = new Date().toISOString().split('T')[0];
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    groupedEvents.forEach(evt => {
      let dateKey = 'Khác';
      if (evt.created_at) {
        try {
          dateKey = evt.created_at.split('T')[0];
        } catch {
          dateKey = 'Khác';
        }
      }

      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(evt);
    });

    const result: DateGroupedEvents[] = [];
    map.forEach((events, key) => {
      let label = key;
      if (key === todayStr) {
        label = 'Hôm nay';
      } else if (key === yesterdayStr) {
        label = 'Hôm qua';
      } else if (key !== 'Khác') {
        try {
          const parts = key.split('-');
          if (parts.length === 3) {
            label = `${parts[2]}/${parts[1]}/${parts[0]}`;
          }
        } catch {}
      }

      result.push({
        dateLabel: `${label} (${events.length})`,
        dateKey: key,
        events
      });
    });

    return result;
  }, [groupedEvents]);

  const toggleExpandEvent = (eventId: string) => {
    setExpandedEventIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  // Export CSV Handler
  const handleExportCSV = async () => {
    try {
      setExporting(true);
      const data = await exportProjectAuditLogs(projectId, {
        module: moduleFilter !== 'all' ? moduleFilter : undefined,
        action: actionFilter !== 'all' ? actionFilter : undefined,
        user_id: userFilter !== 'all' ? parseInt(userFilter) : undefined,
        search: search.trim() || undefined
      });

      const url = window.URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Audit_Logs_Project_${projectId}_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Failed to export audit logs:', err);
      alert('Không thể xuất file CSV. Vui lòng thử lại sau.');
    } finally {
      setExporting(false);
    }
  };

  // Badge Color & Label Helper
  const getActionBadge = (action: string) => {
    const act = (action || '').toUpperCase();
    switch (act) {
      case 'CREATE':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">🟢 CREATE</span>;
      case 'UPDATE':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">🟡 UPDATE</span>;
      case 'DELETE':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">🔴 DELETE</span>;
      case 'COPY':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-[#0058be] border border-blue-200">🔵 COPY</span>;
      case 'CHECK':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">🟣 AI CHECK</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">⚪ SYSTEM</span>;
    }
  };

  // Module Icon Helper
  const getModuleIcon = (module: string) => {
    const mod = (module || '').toLowerCase();
    if (mod.includes('project')) return <span className="text-base" title="Project">📁</span>;
    if (mod.includes('phase')) return <span className="text-base" title="Phase">🧩</span>;
    if (mod.includes('group') || mod.includes('cha')) return <span className="text-base" title="Task Group">📂</span>;
    if (mod.includes('task')) return <span className="text-base" title="Task">✅</span>;
    if (mod.includes('meeting') || mod.includes('họp')) return <span className="text-base" title="Meeting">📅</span>;
    if (mod.includes('ai')) return <span className="text-base" title="AI Check">🤖</span>;
    return <span className="text-base" title="System">⚙️</span>;
  };

  // REFINEMENT 1: Render Deep Link Button for matching Entity Type
  const renderDeepLinkButton = (event: GroupedAuditEvent) => {
    const mod = (event.module || event.entity_type || '').toLowerCase();

    if (mod.includes('task') && !mod.includes('group') && onSelectTask && event.entity_id) {
      return (
        <button
          type="button"
          onClick={() => onSelectTask(event.entity_id)}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0058be] hover:underline bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 shrink-0 cursor-pointer transition-colors"
          title={`Mở chi tiết Task ${event.entity_id}`}
        >
          <span>Open Task {event.entity_id}</span>
          <span className="material-symbols-outlined text-[13px]">open_in_new</span>
        </button>
      );
    }

    if ((mod.includes('group') || mod.includes('cha')) && onSelectTaskGroup && event.entity_id) {
      return (
        <button
          type="button"
          onClick={() => onSelectTaskGroup(event.entity_id)}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:underline bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded border border-amber-200 shrink-0 cursor-pointer transition-colors"
          title={`Mở Task Cha ${event.entity_id}`}
        >
          <span>Open Task Group #{event.entity_id}</span>
          <span className="material-symbols-outlined text-[13px]">open_in_new</span>
        </button>
      );
    }

    if (mod.includes('phase') && onSelectPhase && event.entity_id) {
      return (
        <button
          type="button"
          onClick={() => onSelectPhase(event.entity_id)}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:underline bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200 shrink-0 cursor-pointer transition-colors"
          title={`Mở Phase ${event.entity_id}`}
        >
          <span>Open Phase #{event.entity_id}</span>
          <span className="material-symbols-outlined text-[13px]">open_in_new</span>
        </button>
      );
    }

    if (mod.includes('meeting') && onSelectMeeting && event.entity_id) {
      return (
        <button
          type="button"
          onClick={() => onSelectMeeting(event.entity_id)}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 hover:underline bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded border border-purple-200 shrink-0 cursor-pointer transition-colors"
          title={`Mở cuộc họp ${event.entity_id}`}
        >
          <span>Open Meeting #{event.entity_id}</span>
          <span className="material-symbols-outlined text-[13px]">open_in_new</span>
        </button>
      );
    }

    if (mod.includes('project') && onSelectProject) {
      return (
        <button
          type="button"
          onClick={() => onSelectProject(projectId)}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-800 hover:underline bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded border border-slate-300 shrink-0 cursor-pointer transition-colors"
          title="Mở chỉnh sửa dự án"
        >
          <span>Open Project</span>
          <span className="material-symbols-outlined text-[13px]">open_in_new</span>
        </button>
      );
    }

    return null;
  };

  // Format Time
  const formatTimeOnly = (isoStr: string) => {
    if (!isoStr) return '--:--';
    try {
      const d = new Date(isoStr);
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return `${hours}:${mins}`;
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="space-y-4">
      {/* TOOLBAR & FILTERS */}
      <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3 relative z-30">
        {/* Left Filter Controls */}
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Search Input */}
          <div className="relative min-w-[220px] flex-1 max-w-xs">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
              search
            </span>
            <input
              type="text"
              placeholder="Tìm mô tả, mã task, người dùng, giá trị..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white text-[#0b1c30] border border-[#c2c6d6]/60 rounded-lg focus:outline-none focus:border-[#0058be] focus:ring-1 focus:ring-[#0058be] font-medium"
            />
          </div>

          {/* Module Filter */}
          <SearchableSelect
            label="Phân hệ"
            icon="📂"
            options={[
              { id: 'Project', name: 'Project 📁' },
              { id: 'Phase', name: 'Phase 🧩' },
              { id: 'Task Group', name: 'Task Group 📂' },
              { id: 'Task', name: 'Task ✅' },
              { id: 'Meeting', name: 'Meeting 📅' },
              { id: 'AI Check', name: 'AI Check 🤖' }
            ]}
            value={moduleFilter}
            onChange={val => setModuleFilter(String(val))}
            placeholder="Tìm phân hệ..."
          />

          {/* Action Filter */}
          <SearchableSelect
            label="Hành động"
            icon="⚡"
            options={[
              { id: 'CREATE', name: 'Tạo mới (CREATE)' },
              { id: 'UPDATE', name: 'Cập nhật (UPDATE)' },
              { id: 'DELETE', name: 'Xóa (DELETE)' },
              { id: 'COPY', name: 'Sao chép (COPY)' },
              { id: 'CHECK', name: 'AI CHECK' }
            ]}
            value={actionFilter}
            onChange={val => setActionFilter(String(val))}
            placeholder="Tìm hành động..."
          />

          {/* User Filter */}
          <SearchableSelect
            label="Người dùng"
            icon="👤"
            options={uniqueUsers.map(u => ({ id: u.id, name: u.name }))}
            value={userFilter}
            onChange={val => setUserFilter(String(val))}
            placeholder="Tìm người dùng..."
          />

          {/* Date Filter */}
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
            <span>Thời gian:</span>
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be]"
            >
              <option value="30">30 ngày qua</option>
              <option value="7">7 ngày qua</option>
              <option value="all">Toàn bộ</option>
            </select>
          </div>
        </div>

        {/* Right Actions: Export CSV */}
        <button
          onClick={handleExportCSV}
          disabled={exporting}
          className="flex items-center gap-1.5 bg-[#eff4ff] hover:bg-[#0058be]/10 text-[#0058be] border border-[#c2c6d6]/60 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all shadow-sm disabled:opacity-50 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[16px]">download</span>
          <span>{exporting ? 'Đang xuất...' : 'Xuất CSV'}</span>
        </button>
      </div>

      {/* ACTIVITY FEED TIMELINE BY DATE */}
      <div className="space-y-6">
        {loading ? (
          <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-12 text-center text-xs text-[#565e74]">
            <div className="inline-block animate-spin rounded-full h-7 w-7 border-b-2 border-[#0058be] mb-2"></div>
            <p className="font-semibold text-slate-600">Đang tải nhật ký Activity Feed...</p>
          </div>
        ) : dateGroupedEvents.length === 0 ? (
          <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-12 text-center text-[#565e74]">
            <span className="material-symbols-outlined text-4xl text-slate-300 mb-2 block">history</span>
            <p className="text-sm font-bold text-[#0b1c30]">Không tìm thấy nhật ký thỏa mãn bộ lọc</p>
            <p className="text-xs text-[#565e74] mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.</p>
          </div>
        ) : (
          dateGroupedEvents.map(group => (
            <div key={group.dateKey} className="space-y-4">
              {/* REFINEMENT 3: Date Header with Exact Counter Format */}
              <div className="flex items-center gap-3 my-2">
                <div className="h-px bg-slate-200 flex-1" />
                <span className="text-[12px] font-bold text-slate-700 bg-slate-100 px-3.5 py-1 rounded-full border border-slate-200 shadow-2xs tracking-wide">
                  📅 {group.dateLabel}
                </span>
                <div className="h-px bg-slate-200 flex-1" />
              </div>

              {/* Activity Feed Container with Vertical Timeline Line */}
              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {group.events.map(event => {
                  const isExpanded = expandedEventIds.has(event.event_id);
                  const changeCount = event.items.length;
                  const hasMultipleChanges = changeCount > 1 || (changeCount === 1 && (event.items[0].old_value || event.items[0].new_value));

                  return (
                    <div key={event.event_id} className="relative group">
                      {/* Timeline Node Icon Dot */}
                      <div className="absolute -left-6 top-3 -translate-x-1/2 w-5 h-5 rounded-full bg-white border-2 border-slate-300 flex items-center justify-center text-[10px] shadow-2xs group-hover:border-blue-500 transition-colors">
                        {event.action === 'CREATE' ? '🟢' : event.action === 'DELETE' ? '🔴' : event.action === 'COPY' ? '🔵' : '🟡'}
                      </div>

                      {/* Activity Card */}
                      <div className="bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 shadow-sm transition-all text-xs">
                        {/* Event Card Header */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            {/* Module Icon Badge */}
                            <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs">
                              {getModuleIcon(event.module)}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {getActionBadge(event.action)}
                                <span className="font-bold text-[#0b1c30] text-[13px]">
                                  <HighlightText text={event.user_name} query={search} />
                                </span>
                                <span className="text-[#565e74]">•</span>
                                <span className="font-mono text-[11px] text-slate-500">{formatTimeOnly(event.created_at)}</span>
                                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-semibold border border-slate-200/60">
                                  {event.module}
                                </span>
                              </div>

                              {/* Description & Deep Link Button */}
                              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                <p className="text-slate-800 font-semibold text-xs leading-relaxed flex-1">
                                  <HighlightText text={event.main_description || `Thực hiện ${event.action} trên ${event.module}`} query={search} />
                                </p>

                                {/* REFINEMENT 1: Deep Link by matching Entity Type */}
                                {renderDeepLinkButton(event)}
                              </div>

                              {/* REFINEMENT 2: Rich Copy Task Details (Task gốc -> Task mới -> Người copy -> Thời gian) */}
                              {event.action === 'COPY' && event.items[0]?.old_value && (
                                <div className="mt-2.5 text-xs bg-blue-50/80 p-3 rounded-xl border border-blue-200/80 space-y-1.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-slate-700 font-bold text-[11px]">🔗 Thao tác Sao chép Task:</span>
                                    <span className="text-slate-600 font-mono bg-white px-2 py-0.5 rounded border border-slate-200">
                                      Task gốc: <HighlightText text={event.items[0].old_value} query={search} />
                                    </span>
                                    <span className="text-blue-600 font-bold">➔</span>
                                    <span className="text-blue-800 font-mono font-bold bg-white px-2 py-0.5 rounded border border-blue-300">
                                      Task mới: <HighlightText text={event.items[0].new_value} query={search} />
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-blue-100">
                                    <span>👤 Người copy: <strong className="text-slate-800">{event.user_name}</strong></span>
                                    <span>🕒 Thời gian: <strong className="text-slate-800">{new Date(event.created_at).toLocaleString('vi-VN')}</strong></span>

                                    {onSelectTask && (
                                      <button
                                        type="button"
                                        onClick={() => onSelectTask(event.items[0].old_value!)}
                                        className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0058be] hover:underline bg-white px-2.5 py-0.5 rounded border border-blue-300 cursor-pointer shadow-2xs"
                                      >
                                        <span>Xem Task gốc ({event.items[0].old_value})</span>
                                        <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Expand / Collapse Button for Batch Changes */}
                          {hasMultipleChanges && (
                            <button
                              onClick={() => toggleExpandEvent(event.event_id)}
                              className="flex items-center gap-1 text-[11px] font-bold text-[#0058be] bg-blue-50/80 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-200/60 transition-colors shrink-0 cursor-pointer"
                            >
                              <span>{changeCount} thay đổi</span>
                              <span className="material-symbols-outlined text-[16px]">
                                {isExpanded ? 'expand_less' : 'expand_more'}
                              </span>
                            </button>
                          )}
                        </div>

                        {/* Event Card Expanded Body (Multi-field Diffs) */}
                        {isExpanded && hasMultipleChanges && (
                          <div className="mt-3.5 pt-3 border-t border-slate-100 space-y-2.5 bg-slate-50/80 p-3.5 rounded-xl">
                            <span className="text-[10px] font-bold uppercase text-slate-400 block tracking-wider">
                              Chi tiết các trường thay đổi ({changeCount} trường):
                            </span>

                            <div className="space-y-2">
                              {event.items.map((item, idx) => (
                                <div
                                  key={item.id || idx}
                                  onClick={() => setSelectedLog(item)}
                                  className="bg-white p-2.5 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-2 hover:border-blue-300 transition-colors cursor-pointer"
                                >
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-slate-700 text-xs">
                                      <HighlightText text={item.field_name || 'Thông tin'} query={search} />:
                                    </span>
                                    <span className="text-slate-500 line-through text-[11px] font-mono bg-rose-50 text-rose-700 px-2 py-0.5 rounded border border-rose-200/60">
                                      <HighlightText text={item.old_value || 'Trống'} query={search} />
                                    </span>
                                    <span className="text-slate-400 font-bold">↓</span>
                                    <span className="text-emerald-700 font-bold text-xs bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/60">
                                      <HighlightText text={item.new_value || 'Trống'} query={search} />
                                    </span>
                                  </div>

                                  <span className="text-[10px] text-slate-400 font-semibold hover:text-[#0058be]">
                                    Xem JSON ➔
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="bg-white border border-[#c2c6d6]/60 rounded-xl px-4 py-3 flex items-center justify-between text-xs text-[#565e74] shadow-sm">
          <div>
            Hiển thị <span className="font-bold text-[#0b1c30]">{logs.length}</span> bản ghi nhật ký
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1 bg-white hover:bg-slate-50 disabled:opacity-40 text-[#0b1c30] font-semibold rounded border border-[#c2c6d6]/60 transition-colors shadow-sm cursor-pointer"
            >
              Trước
            </button>
            <span className="font-medium">Trang {page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-3 py-1 bg-white hover:bg-slate-50 disabled:opacity-40 text-[#0b1c30] font-semibold rounded border border-[#c2c6d6]/60 transition-colors shadow-sm cursor-pointer"
            >
              Sau
            </button>
          </div>
        </div>
      )}

      {/* DETAIL MODAL */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-[#0058be]">
                <span className="material-symbols-outlined text-[24px]">history</span>
                <h3 className="text-base font-bold text-[#0b1c30]">Chi tiết Audit Log #{selectedLog.id}</h3>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto text-xs">
              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3 bg-[#eff4ff]/60 p-3.5 rounded-xl border border-[#0058be]/10">
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Thời gian</span>
                  <span className="font-mono text-[#0b1c30] font-bold">
                    {selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString('vi-VN') : '--'}
                  </span>
                </div>
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Người thực hiện</span>
                  <span className="font-bold text-[#0b1c30]">
                    <HighlightText text={selectedLog.user_name} query={search} />
                  </span>
                </div>
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Module</span>
                  <span className="font-bold text-[#0058be]">
                    <HighlightText text={`${selectedLog.module} (${selectedLog.entity_type})`} query={search} />
                  </span>
                </div>
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Hành động</span>
                  <div className="mt-0.5">{getActionBadge(selectedLog.action)}</div>
                </div>
              </div>

              {/* Description */}
              <div>
                <span className="text-[#565e74] font-bold text-[11px] uppercase tracking-wider block mb-1">Mô tả</span>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-[#0b1c30] font-medium">
                  <HighlightText text={selectedLog.description} query={search} />
                </div>
              </div>

              {/* Diff Values Comparison */}
              {(selectedLog.old_value || selectedLog.new_value) && (
                <div className="space-y-2">
                  <span className="text-[#565e74] font-bold text-[11px] uppercase tracking-wider block">So sánh Thay đổi (Old vs New)</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-rose-50 border border-rose-200/60 rounded-xl p-3">
                      <span className="font-bold text-rose-700 text-[11px] uppercase block mb-1">
                        - Giá trị cũ (Old Value)
                      </span>
                      <pre className="text-rose-900 whitespace-pre-wrap font-mono text-[11px] bg-white p-2 rounded-lg border border-rose-100 max-h-36 overflow-y-auto">
                        <HighlightText text={selectedLog.old_value || '(NULL)'} query={search} />
                      </pre>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-3">
                      <span className="font-bold text-emerald-700 text-[11px] uppercase block mb-1">
                        + Giá trị mới (New Value)
                      </span>
                      <pre className="text-emerald-900 whitespace-pre-wrap font-mono text-[11px] bg-white p-2 rounded-lg border border-emerald-100 max-h-36 overflow-y-auto">
                        <HighlightText text={selectedLog.new_value || '(NULL)'} query={search} />
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50/50">
              <button
                onClick={() => setSelectedLog(null)}
                className="bg-[#0058be] hover:bg-[#0058be]/95 text-white font-bold text-xs px-4 py-2 rounded-lg shadow-sm transition-all"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
