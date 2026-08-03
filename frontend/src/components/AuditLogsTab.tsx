'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getProjectAuditLogs, exportProjectAuditLogs, AuditLogItem } from '@/lib/api';

interface AuditLogsTabProps {
  projectId: number;
}

export default function AuditLogsTab({ projectId }: AuditLogsTabProps) {
  // Filter States
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState('30'); // '7', '30', 'all'
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Data States
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

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

  // Badge Color Helper
  const getActionBadge = (action: string) => {
    const act = (action || '').toUpperCase();
    switch (act) {
      case 'CREATE':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">CREATE</span>;
      case 'UPDATE':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">UPDATE</span>;
      case 'DELETE':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200/60">DELETE</span>;
      case 'CHECK':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200/60">AI CHECK</span>;
      case 'LOGIN':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-[#0058be] border border-blue-200/60">LOGIN</span>;
      case 'FAILED_LOGIN':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300 font-bold animate-pulse">FAILED LOGIN</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200/60">SYSTEM</span>;
    }
  };

  // Format Date
  const formatDate = (isoStr: string) => {
    if (!isoStr) return '--';
    try {
      const d = new Date(isoStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return `${day}/${month} ${hours}:${mins}`;
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="space-y-4">
      {/* TOOLBAR & FILTERS */}
      <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        {/* Left Filter Controls */}
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Search Input */}
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
              search
            </span>
            <input
              type="text"
              placeholder="Search description, field..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white text-[#0b1c30] border border-[#c2c6d6]/60 rounded-lg focus:outline-none focus:border-[#0058be] focus:ring-1 focus:ring-[#0058be] font-medium"
            />
          </div>

          {/* Module Filter */}
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
            <span>Module:</span>
            <select
              value={moduleFilter}
              onChange={e => setModuleFilter(e.target.value)}
              className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be]"
            >
              <option value="all">All Modules</option>
              <option value="Project">Project</option>
              <option value="Phase">Phase</option>
              <option value="Task Group">Task Group</option>
              <option value="Task">Task</option>
              <option value="Meeting">Meeting</option>
              <option value="AI Check">AI Check</option>
            </select>
          </div>

          {/* Action Filter */}
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
            <span>Action:</span>
            <select
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be]"
            >
              <option value="all">All Actions</option>
              <option value="CREATE">CREATE</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
              <option value="CHECK">AI CHECK</option>
            </select>
          </div>

          {/* User Filter */}
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
            <span>User:</span>
            <select
              value={userFilter}
              onChange={e => setUserFilter(e.target.value)}
              className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be] max-w-[140px] truncate"
            >
              <option value="all">All Users</option>
              {uniqueUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Date Filter */}
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
            <span>Date:</span>
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be]"
            >
              <option value="30">Last 30 days</option>
              <option value="7">Last 7 days</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>

        {/* Right Actions: Export CSV */}
        <button
          onClick={handleExportCSV}
          disabled={exporting}
          className="flex items-center gap-1.5 bg-[#eff4ff] hover:bg-[#0058be]/10 text-[#0058be] border border-[#c2c6d6]/60 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all shadow-sm disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">download</span>
          <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
        </button>
      </div>

      {/* AUDIT LOGS TABLE */}
      <div className="bg-white border border-[#c2c6d6]/60 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-[#565e74]">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-[#0058be] mb-2"></div>
            <p>Đang tải nhật ký Audit Logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-[#565e74]">
            <span className="material-symbols-outlined text-4xl text-slate-300 mb-2 block">history</span>
            <p className="text-sm font-bold text-[#0b1c30]">Không tìm thấy nhật ký thỏa mãn bộ lọc</p>
            <p className="text-xs text-[#565e74] mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#0b1c30]">
              <thead className="bg-[#eff4ff]/60 text-[#565e74] font-bold text-[11px] uppercase tracking-wider border-b border-[#c2c6d6]/60">
                <tr>
                  <th className="px-4 py-3 w-32">Time</th>
                  <th className="px-4 py-3 w-36">User</th>
                  <th className="px-4 py-3 w-28">Module</th>
                  <th className="px-4 py-3 w-32">Action</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 w-16 text-center">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map(log => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-[#eff4ff]/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-[#565e74] whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3 font-bold text-[#0b1c30] whitespace-nowrap">
                      {log.user_name}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#565e74]">
                      {log.module}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="px-4 py-3 text-[#0b1c30] max-w-md truncate font-medium">
                      {log.description}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLog(log);
                        }}
                        className="p-1 text-[#0058be] hover:bg-[#eff4ff] rounded transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">visibility</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* PAGINATION */}
        {totalPages > 1 && (
          <div className="bg-[#f8fafc] px-4 py-3 border-t border-[#c2c6d6]/60 flex items-center justify-between text-xs text-[#565e74]">
            <div>
              Hiển thị <span className="font-bold text-[#0b1c30]">{logs.length}</span> / <span className="font-bold text-[#0b1c30]">{total}</span> nhật ký
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 bg-white hover:bg-slate-50 disabled:opacity-40 text-[#0b1c30] font-semibold rounded border border-[#c2c6d6]/60 transition-colors shadow-sm"
              >
                Trước
              </button>
              <span>Trang {page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="px-3 py-1 bg-white hover:bg-slate-50 disabled:opacity-40 text-[#0b1c30] font-semibold rounded border border-[#c2c6d6]/60 transition-colors shadow-sm"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>

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
                  <span className="font-bold text-[#0b1c30]">{selectedLog.user_name}</span>
                </div>
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Module</span>
                  <span className="font-bold text-[#0058be]">{selectedLog.module} ({selectedLog.entity_type})</span>
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
                  {selectedLog.description}
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
                        {selectedLog.old_value || '(NULL)'}
                      </pre>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-3">
                      <span className="font-bold text-emerald-700 text-[11px] uppercase block mb-1">
                        + Giá trị mới (New Value)
                      </span>
                      <pre className="text-emerald-900 whitespace-pre-wrap font-mono text-[11px] bg-white p-2 rounded-lg border border-emerald-100 max-h-36 overflow-y-auto">
                        {selectedLog.new_value || '(NULL)'}
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
