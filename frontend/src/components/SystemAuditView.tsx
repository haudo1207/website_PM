'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  getSystemAuditStats,
  getSystemAuditLogs,
  exportSystemAuditLogs,
  getSystemAuditAnalytics,
  getProjects,
  getMembers,
  SystemAuditItem,
  SystemAuditStats
} from '@/lib/api';

export default function SystemAuditView() {
  // Stats Period State
  const [period, setPeriod] = useState('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [stats, setStats] = useState<SystemAuditStats | null>(null);

  // Filter States
  const [search, setSearch] = useState('');
  const [businessFilter, setBusinessFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState('30');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Data States
  const [logs, setLogs] = useState<SystemAuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);

  // Dropdown option lists
  const [projectsList, setProjectsList] = useState<{ id: number; name: string }[]>([]);
  const [usersList, setUsersList] = useState<{ id: number; name: string }[]>([]);

  // Selected Log for Detail Drawer
  const [selectedLog, setSelectedLog] = useState<SystemAuditItem | null>(null);

  // Load dropdown metadata
  useEffect(() => {
    getProjects().then(projs => {
      if (Array.isArray(projs)) {
        setProjectsList(projs.map((p: any) => ({ id: p.id, name: p.name })));
      }
    }).catch(() => {});

    getMembers().then(mems => {
      if (Array.isArray(mems)) {
        setUsersList(mems.map((m: any) => ({ id: m.id, name: m.display_name || m.email })));
      }
    }).catch(() => {});

    getSystemAuditAnalytics().then(setAnalytics).catch(() => {});
  }, []);

  // Fetch Stats
  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const res = await getSystemAuditStats({
        period,
        start_date: period === 'custom' && customStart ? customStart : undefined,
        end_date: period === 'custom' && customEnd ? customEnd : undefined
      });
      setStats(res);
    } catch (err) {
      console.error('Failed to load system audit stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [period, customStart, customEnd]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Fetch System Audit Logs
  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      let startDateStr: string | undefined = undefined;
      let endDateStr: string | undefined = undefined;
      const now = new Date();

      if (dateFilter === 'today') {
        startDateStr = now.toISOString().split('T')[0];
      } else if (dateFilter === 'yesterday') {
        const y = new Date(now.setDate(now.getDate() - 1));
        startDateStr = y.toISOString().split('T')[0];
        endDateStr = startDateStr;
      } else if (dateFilter === '7') {
        const d = new Date(now.setDate(now.getDate() - 7));
        startDateStr = d.toISOString().split('T')[0];
      } else if (dateFilter === '30') {
        const d = new Date(now.setDate(now.getDate() - 30));
        startDateStr = d.toISOString().split('T')[0];
      } else if (dateFilter === 'custom') {
        startDateStr = customStart || undefined;
        endDateStr = customEnd || undefined;
      }

      const res = await getSystemAuditLogs({
        business_unit: businessFilter !== 'all' ? businessFilter : undefined,
        project_id: projectFilter !== 'all' ? parseInt(projectFilter) : undefined,
        module: moduleFilter !== 'all' ? moduleFilter : undefined,
        action: actionFilter !== 'all' ? actionFilter : undefined,
        user_id: userFilter !== 'all' ? parseInt(userFilter) : undefined,
        search: search.trim() || undefined,
        start_date: startDateStr,
        end_date: endDateStr,
        page,
        page_size: pageSize
      });

      setLogs(res.items || []);
      setTotal(res.total || 0);
      setTotalPages(res.total_pages || 1);
    } catch (err) {
      console.error('Failed to load system audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [businessFilter, projectFilter, moduleFilter, actionFilter, userFilter, search, dateFilter, customStart, customEnd, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    setPage(1);
  }, [search, businessFilter, projectFilter, moduleFilter, actionFilter, userFilter, dateFilter, customStart, customEnd]);

  // Export Handler
  const handleExportCSV = async () => {
    try {
      setExporting(true);
      const data = await exportSystemAuditLogs({
        business_unit: businessFilter !== 'all' ? businessFilter : undefined,
        project_id: projectFilter !== 'all' ? parseInt(projectFilter) : undefined,
        module: moduleFilter !== 'all' ? moduleFilter : undefined,
        action: actionFilter !== 'all' ? actionFilter : undefined,
        user_id: userFilter !== 'all' ? parseInt(userFilter) : undefined,
        search: search.trim() || undefined
      });

      const url = window.URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `System_Audit_Logs_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Failed to export system audit logs:', err);
      alert('Không thể xuất file CSV. Vui lòng thử lại sau.');
    } finally {
      setExporting(false);
    }
  };

  // Badge Helper
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
      case 'LOGIN':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">🔑 LOGIN</span>;
      case 'FAILED_LOGIN':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-600/20 text-red-400 border border-red-500/40 animate-pulse">⚠️ FAILED LOGIN</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">🔵 SYSTEM</span>;
    }
  };

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
    <div className="space-y-6 text-slate-100">
      {/* 1. SYSTEM AUDIT SUMMARY STATS HEADER */}
      <div className="bg-slate-900/90 backdrop-blur-md p-5 rounded-2xl border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-xl">🛡️</span> SYSTEM AUDIT LOGS DASHBOARD
            </h2>
            <p className="text-xs text-slate-400">Theo dõi toàn bộ nhật ký thay đổi, AI Check và bảo mật hệ thống toàn cục.</p>
          </div>

          {/* Stats Time Range Selector */}
          <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            {['today', '7days', '30days', 'custom'].map(pKey => (
              <button
                key={pKey}
                onClick={() => setPeriod(pKey)}
                className={`px-3 py-1.5 rounded-lg font-semibold capitalize transition-all ${
                  period === pKey ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {pKey === 'today' ? 'Today' : pKey === '7days' ? '7 Days' : pKey === '30days' ? '30 Days' : 'Custom'}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Range Inputs */}
        {period === 'custom' && (
          <div className="flex items-center gap-3 text-xs bg-slate-950 p-2.5 rounded-xl border border-slate-800 w-fit">
            <span>Từ:</span>
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="bg-slate-900 text-slate-200 border border-slate-700 px-2 py-1 rounded focus:outline-none"
            />
            <span>Đến:</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="bg-slate-900 text-slate-200 border border-slate-700 px-2 py-1 rounded focus:outline-none"
            />
          </div>
        )}

        {/* Summary Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Update */}
          <div className="bg-amber-950/20 border border-amber-900/40 p-3.5 rounded-xl">
            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block">Update</span>
            <span className="text-2xl font-black text-amber-300 mt-1 block">
              {statsLoading ? '--' : stats?.update_count || 0}
            </span>
          </div>

          {/* Create */}
          <div className="bg-emerald-950/20 border border-emerald-900/40 p-3.5 rounded-xl">
            <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">Create</span>
            <span className="text-2xl font-black text-emerald-300 mt-1 block">
              {statsLoading ? '--' : stats?.create_count || 0}
            </span>
          </div>

          {/* Delete */}
          <div className="bg-rose-950/20 border border-rose-900/40 p-3.5 rounded-xl">
            <span className="text-[11px] font-bold text-rose-400 uppercase tracking-wider block">Delete</span>
            <span className="text-2xl font-black text-rose-300 mt-1 block">
              {statsLoading ? '--' : stats?.delete_count || 0}
            </span>
          </div>

          {/* AI Check */}
          <div className="bg-purple-950/20 border border-purple-900/40 p-3.5 rounded-xl">
            <span className="text-[11px] font-bold text-purple-400 uppercase tracking-wider block">AI Check</span>
            <span className="text-2xl font-black text-purple-300 mt-1 block">
              {statsLoading ? '--' : stats?.ai_check_count || 0}
            </span>
          </div>

          {/* Login */}
          <div className="bg-sky-950/20 border border-sky-900/40 p-3.5 rounded-xl">
            <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider block">Login</span>
            <span className="text-2xl font-black text-sky-300 mt-1 block">
              {statsLoading ? '--' : stats?.login_count || 0}
            </span>
          </div>

          {/* Failed Login */}
          <div className="bg-red-950/30 border border-red-800/60 p-3.5 rounded-xl">
            <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider block flex items-center gap-1">
              <span>⚠️</span> Failed Login
            </span>
            <span className="text-2xl font-black text-red-400 mt-1 block">
              {statsLoading ? '--' : stats?.failed_login_count || 0}
            </span>
          </div>
        </div>
      </div>

      {/* 2. RICH FILTER BAR */}
      <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-2xl border border-slate-800 shadow-xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 text-xs">
                🔍
              </span>
              <input
                type="text"
                placeholder="Search description, IP..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-800/90 text-slate-200 border border-slate-700 rounded-lg focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Business Filter */}
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <span>BU:</span>
              <select
                value={businessFilter}
                onChange={e => setBusinessFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none"
              >
                <option value="all">All BU</option>
                <option value="Infrastructure">Infrastructure</option>
                <option value="Markee">Markee</option>
              </select>
            </div>

            {/* Project Filter */}
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <span>Project:</span>
              <select
                value={projectFilter}
                onChange={e => setProjectFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none max-w-[160px] truncate"
              >
                <option value="all">All Projects</option>
                {projectsList.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Module Filter */}
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <span>Module:</span>
              <select
                value={moduleFilter}
                onChange={e => setModuleFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none"
              >
                <option value="all">All Modules</option>
                <option value="Customer">Customer</option>
                <option value="Project">Project</option>
                <option value="Phase">Phase</option>
                <option value="Task Group">Task Group</option>
                <option value="Task">Task</option>
                <option value="Meeting">Meeting</option>
                <option value="Member">Member</option>
                <option value="AI Check">AI Check</option>
                <option value="Prompt">Prompt</option>
                <option value="Setting">Setting</option>
                <option value="Permission">Permission</option>
                <option value="Authentication">Authentication</option>
              </select>
            </div>

            {/* Action Filter */}
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <span>Action:</span>
              <select
                value={actionFilter}
                onChange={e => setActionFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none"
              >
                <option value="all">All Actions</option>
                <option value="CREATE">CREATE</option>
                <option value="UPDATE">UPDATE</option>
                <option value="DELETE">DELETE</option>
                <option value="CHECK">AI CHECK</option>
                <option value="LOGIN">LOGIN</option>
                <option value="FAILED_LOGIN">FAILED LOGIN</option>
              </select>
            </div>

            {/* User Filter */}
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <span>User:</span>
              <select
                value={userFilter}
                onChange={e => setUserFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none max-w-[140px] truncate"
              >
                <option value="all">All Users</option>
                {usersList.map(u => (
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
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none"
              >
                <option value="30">Last 30 days</option>
                <option value="7">Last 7 days</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="all">All Time</option>
              </select>
            </div>
          </div>

          {/* Export Button */}
          <button
            onClick={handleExportCSV}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors shadow disabled:opacity-50"
          >
            <span>📥</span>
            <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
        </div>
      </div>

      {/* 3. SYSTEM AUDIT TABLE */}
      <div className="bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-10 text-center text-slate-400">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-2"></div>
            <p>Đang tải nhật ký System Audit Logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <span className="text-4xl block mb-2">🛡️</span>
            <p className="text-base font-semibold">Không tìm thấy nhật ký thỏa mãn bộ lọc</p>
            <p className="text-xs text-slate-600 mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/90 font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3 w-28">Time</th>
                  <th className="px-4 py-3 w-36">User</th>
                  <th className="px-4 py-3 w-28">Business</th>
                  <th className="px-4 py-3 w-36">Project</th>
                  <th className="px-4 py-3 w-28">Module</th>
                  <th className="px-4 py-3 w-32">Action</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 w-16 text-center">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {logs.map(log => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-200 whitespace-nowrap">
                      {log.user_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                        log.business_unit === 'Markee'
                          ? 'bg-purple-950/60 text-purple-300 border border-purple-800/50'
                          : 'bg-blue-950/60 text-blue-300 border border-blue-800/50'
                      }`}>
                        {log.business_unit || 'All'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 truncate max-w-[140px]" title={log.project_name || '--'}>
                      {log.project_name || '--'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-300">
                      {log.module}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="px-4 py-3 text-slate-300 max-w-xs truncate" title={log.description || ''}>
                      {log.description}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLog(log);
                        }}
                        className="px-2 py-1 font-medium bg-slate-800 hover:bg-slate-700 text-indigo-400 rounded border border-slate-700 transition-colors"
                      >
                        👁️
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

      {/* 4. ANALYTICS SUMMARY SECTION */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Top Active Users */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>🏆</span> Top Active Users
            </h3>
            <div className="space-y-2 text-xs">
              {analytics.top_active_users?.map((u: any, idx: number) => (
                <div key={u.user_id} className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-800">
                  <span className="font-semibold text-slate-200 truncate">{idx + 1}. {u.name}</span>
                  <span className="font-bold text-indigo-400 font-mono">{u.total_actions} tác vụ</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Updated Projects */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>📁</span> Top Updated Projects
            </h3>
            <div className="space-y-2 text-xs">
              {analytics.top_updated_projects?.map((p: any, idx: number) => (
                <div key={p.project_id} className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-800">
                  <span className="font-semibold text-slate-200 truncate">{idx + 1}. {p.name}</span>
                  <span className="font-bold text-amber-400 font-mono">{p.total_updates} lượt sửa</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top AI Users */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>🤖</span> Top AI Users
            </h3>
            <div className="space-y-2 text-xs">
              {analytics.top_ai_users?.map((u: any, idx: number) => (
                <div key={u.user_id} className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-800">
                  <span className="font-semibold text-slate-200 truncate">{idx + 1}. {u.name}</span>
                  <span className="font-bold text-purple-400 font-mono">{u.total_checks} AI Check</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Login Failures */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 text-red-400">
              <span>⚠️</span> Top Failed Logins (IPs)
            </h3>
            <div className="space-y-2 text-xs">
              {analytics.top_login_failures?.map((f: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-800">
                  <span className="font-mono text-slate-300 truncate">{f.ip_address}</span>
                  <span className="font-bold text-red-400 font-mono">{f.total_failures} thất bại</span>
                </div>
              ))}
              {(!analytics.top_login_failures || analytics.top_login_failures.length === 0) && (
                <p className="text-slate-500 italic text-center py-2">Không có cảnh báo thất bại.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. DETAIL DRAWER / MODAL */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-0">
            {/* Header */}
            <div className="bg-slate-800/90 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">🛡️</span>
                <div>
                  <h3 className="font-bold text-slate-100 text-base">
                    System Audit Detail #{selectedLog.id}
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
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Meta Rows */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-500 block text-[10px]">Hành động</span>
                  <div className="mt-1">{getActionBadge(selectedLog.action)}</div>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Người thực hiện</span>
                  <span className="font-bold text-slate-200">{selectedLog.user_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Business Unit</span>
                  <span className="font-bold text-slate-200">{selectedLog.business_unit || 'All'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Dự án</span>
                  <span className="font-bold text-slate-200">{selectedLog.project_name || '--'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Thời gian</span>
                  <span className="font-mono text-slate-300">{selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString('vi-VN') : '--'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Trường thay đổi</span>
                  <span className="font-bold text-amber-400">{selectedLog.field_name || 'Tất cả'}</span>
                </div>
              </div>

              {/* Description */}
              <div>
                <span className="font-semibold text-slate-400 uppercase tracking-wider block mb-1">Mô tả diễn giải</span>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-200 font-medium">
                  {selectedLog.description}
                </div>
              </div>

              {/* Diff Values Comparison */}
              {(selectedLog.old_value || selectedLog.new_value) && (
                <div className="space-y-2">
                  <span className="font-semibold text-slate-400 uppercase tracking-wider block">So sánh Giá trị (Old vs New Diff)</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-rose-950/20 border border-rose-900/40 rounded-xl p-3">
                      <span className="font-bold text-rose-400 uppercase block mb-1">
                        - Giá trị cũ (Old Value)
                      </span>
                      <pre className="text-rose-200 whitespace-pre-wrap font-mono bg-rose-950/40 p-2.5 rounded-lg border border-rose-900/30 max-h-48 overflow-y-auto">
                        {selectedLog.old_value || '(Trống / NULL)'}
                      </pre>
                    </div>
                    <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-3">
                      <span className="font-bold text-emerald-400 uppercase block mb-1">
                        + Giá trị mới (New Value)
                      </span>
                      <pre className="text-emerald-200 whitespace-pre-wrap font-mono bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-900/30 max-h-48 overflow-y-auto">
                        {selectedLog.new_value || '(Trống / NULL)'}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Network / Client Metadata */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <span className="font-semibold text-slate-400 uppercase tracking-wider block">Thông tin Kỹ thuật & Request</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Client IP</span>
                    <span className="text-sky-300 font-bold">{selectedLog.ip_address || 'N/A'}</span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-slate-500 block text-[10px]">Browser / User Agent</span>
                    <span className="text-slate-300 truncate block" title={selectedLog.user_agent || 'N/A'}>{selectedLog.user_agent || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-800/80 px-6 py-3 border-t border-slate-800 text-right">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-1.5 text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
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
