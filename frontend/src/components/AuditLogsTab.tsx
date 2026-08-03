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

      // Collect unique users for filter dropdown
      const usersMap = new Map<number, string>();
      res.items.forEach(item => {
        if (item.user_id && item.user_name) {
          usersMap.set(item.user_id, item.user_name);
        }
      });
      setUniqueUsers(prev => {
        const merged = new Map(prev.map(u => [u.id, u.name]));
        usersMap.forEach((name, id) => merged.set(id, name));
        return Array.from(merged.entries()).map(([id, name]) => ({ id, name }));
      });
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, moduleFilter, actionFilter, userFilter, search, dateFilter, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [search, moduleFilter, actionFilter, userFilter, dateFilter]);

  // Handle Export CSV
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
      link.setAttribute('download', `Audit_Logs_Project_${projectId}.csv`);
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
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">🟢 CREATE</span>;
      case 'UPDATE':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">🟡 UPDATE</span>;
      case 'DELETE':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">🔴 DELETE</span>;
      case 'CHECK':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">🟣 AI CHECK</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">🔵 SYSTEM</span>;
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
    <div className="space-y-4 text-slate-100">
      {/* TOOLBAR */}
      <div className="bg-slate-900/80 backdrop-blur-md p-4 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        {/* Left Filters */}
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 text-sm">
              🔍
            </span>
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-slate-800/90 text-slate-200 border border-slate-700 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Module Filter */}
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <span>Module:</span>
            <select
              value={moduleFilter}
              onChange={e => setModuleFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Modules</option>
              <option value="Project">Project</option>
              <option value="Phase">Phase</option>
              <option value="Task Group">Task Group</option>
              <option value="Task">Task</option>
              <option value="Meeting">Meeting</option>
              <option value="File">File</option>
              <option value="AI Check">AI Check</option>
            </select>
          </div>

          {/* Action Filter */}
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <span>Action:</span>
            <select
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Actions</option>
              <option value="CREATE">CREATE</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
              <option value="CHECK">AI CHECK</option>
            </select>
          </div>

          {/* User Filter */}
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <span>User:</span>
            <select
              value={userFilter}
              onChange={e => setUserFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Users</option>
              {uniqueUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Date Filter */}
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <span>Date:</span>
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="30">Last 30 days</option>
              <option value="7">Last 7 days</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>

        {/* Right Export Button */}
        <div>
          <button
            onClick={handleExportCSV}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors shadow disabled:opacity-50"
          >
            <span>📥</span>
            <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
        </div>
      </div>

      {/* AUDIT LOGS TABLE */}
      <div className="bg-slate-900/80 backdrop-blur-md rounded-xl border border-slate-800 overflow-hidden shadow-lg">
        {loading ? (
          <div className="p-8 text-center text-slate-400">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-2"></div>
            <p>Đang tải nhật ký Audit Logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <span className="text-4xl block mb-2">📜</span>
            <p className="text-base font-medium">Chưa có nhật ký ghi nhận nào</p>
            <p className="text-xs text-slate-600 mt-1">Các thao tác chỉnh sửa dự án, task, meeting và AI check sẽ tự động hiển thị ở đây.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-800/90 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3 w-32">Time</th>
                  <th className="px-4 py-3 w-40">User</th>
                  <th className="px-4 py-3 w-28">Module</th>
                  <th className="px-4 py-3 w-32">Action</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 w-20 text-center">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {logs.map(log => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-xs font-mono text-slate-400 whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-200 whitespace-nowrap">
                      {log.user_name}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-300">
                      {log.module}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-sm max-w-md truncate">
                      {log.description}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLog(log);
                        }}
                        className="px-2 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-indigo-400 hover:text-indigo-300 rounded border border-slate-700 transition-colors"
                      >
                        👁️ Xem
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
          <div className="bg-slate-900 px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <div>
              Hiển thị <span className="font-semibold text-slate-200">{logs.length}</span> / <span className="font-semibold text-slate-200">{total}</span> nhật ký
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded border border-slate-700 transition-colors"
              >
                Trước
              </button>
              <span>Trang {page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded border border-slate-700 transition-colors"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>

      {/* DETAIL MODAL */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-0">
            {/* Header */}
            <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">📜</span>
                <div>
                  <h3 className="font-bold text-slate-100 text-lg">
                    Chi tiết Audit Log #{selectedLog.id}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Module: <span className="text-indigo-400 font-semibold">{selectedLog.module}</span> | Entity: {selectedLog.entity_type} #{selectedLog.entity_id || 'N/A'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors text-xl"
              >
                ✕
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto text-sm">
              {/* Meta Rows */}
              <div className="grid grid-cols-2 gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                <div>
                  <span className="text-xs text-slate-400 block">Hành động (Action)</span>
                  <div className="mt-1">{getActionBadge(selectedLog.action)}</div>
                </div>
                <div>
                  <span className="text-xs text-slate-400 block">Người thực hiện (Updated By)</span>
                  <span className="font-semibold text-slate-200">{selectedLog.user_name}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-400 block">Thời gian (Time)</span>
                  <span className="font-mono text-slate-300 text-xs">{selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString('vi-VN') : '--'}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-400 block">Trường thay đổi (Field)</span>
                  <span className="font-semibold text-amber-400">{selectedLog.field_name || 'Tất cả / Tổng thể'}</span>
                </div>
              </div>

              {/* Description */}
              <div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Mô tả chi tiết (Description)</span>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-200 leading-relaxed font-medium">
                  {selectedLog.description}
                </div>
              </div>

              {/* Diff Values Comparison */}
              {(selectedLog.old_value || selectedLog.new_value) && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">So sánh Giá trị (Old vs New Diff)</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Old Value */}
                    <div className="bg-rose-950/20 border border-rose-900/40 rounded-xl p-3">
                      <span className="text-xs font-bold text-rose-400 uppercase block mb-1.5 flex items-center gap-1">
                        <span>-</span> Giá trị cũ (Old Value)
                      </span>
                      <pre className="text-xs text-rose-200 whitespace-pre-wrap font-mono bg-rose-950/40 p-2.5 rounded-lg border border-rose-900/30 max-h-48 overflow-y-auto">
                        {selectedLog.old_value || '(Trống / NULL)'}
                      </pre>
                    </div>

                    {/* New Value */}
                    <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-3">
                      <span className="text-xs font-bold text-emerald-400 uppercase block mb-1.5 flex items-center gap-1">
                        <span>+</span> Giá trị mới (New Value)
                      </span>
                      <pre className="text-xs text-emerald-200 whitespace-pre-wrap font-mono bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-900/30 max-h-48 overflow-y-auto">
                        {selectedLog.new_value || '(Trống / NULL)'}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-slate-800/80 px-6 py-3 border-t border-slate-800 text-right">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
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
