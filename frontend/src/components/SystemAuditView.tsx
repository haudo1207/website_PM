'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  getSystemAuditStats,
  getSystemAuditLogs,
  exportSystemAuditLogs,
  getSystemAuditAnalytics,
  getProjects,
  getMembers,
  getWorkspaces,
  Workspace,
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
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  // Selected Log for Detail Modal
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

    getWorkspaces().then(ws => setWorkspaces(ws || [])).catch(() => {});

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
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">CREATE</span>;
      case 'UPDATE':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">UPDATE</span>;
      case 'DELETE':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200/60">DELETE</span>;
      case 'CHECK':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200/60">AI CHECK</span>;
      case 'LOGIN':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-[#0058be] border border-blue-200/60">LOGIN</span>;
      case 'FAILED_LOGIN':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300 font-bold animate-pulse">FAILED LOGIN</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200/60">SYSTEM</span>;
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
    <div className="space-y-6 text-[#0b1c30]">
      {/* 1. SYSTEM AUDIT SUMMARY STATS HEADER */}
      <div className="bg-white p-5 rounded-xl border border-[#c2c6d6]/60 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#0058be] text-[24px]">shield</span>
            <div>
              <h2 className="text-base font-bold text-[#0b1c30]">
                System Audit Logs Dashboard
              </h2>
              <p className="text-xs text-[#565e74]">Theo dõi nhật ký thay đổi, AI Check và bảo mật hệ thống toàn cục dành cho Admin.</p>
            </div>
          </div>

          {/* Stats Time Range Selector */}
          <div className="flex items-center gap-1 bg-[#eff4ff] p-1 rounded-xl border border-[#c2c6d6]/60 text-xs">
            {['today', '7days', '30days', 'custom'].map(pKey => (
              <button
                key={pKey}
                onClick={() => setPeriod(pKey)}
                className={`px-3 py-1 rounded-lg font-bold capitalize transition-all ${
                  period === pKey ? 'bg-[#0058be] text-white shadow-sm' : 'text-[#565e74] hover:text-[#0b1c30]'
                }`}
              >
                {pKey === 'today' ? 'Today' : pKey === '7days' ? '7 Days' : pKey === '30days' ? '30 Days' : 'Custom'}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Range Inputs */}
        {period === 'custom' && (
          <div className="flex items-center gap-3 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-200 w-fit">
            <span className="font-semibold text-[#565e74]">Từ:</span>
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="bg-white text-[#0b1c30] border border-[#c2c6d6]/60 px-2 py-1 rounded focus:outline-none focus:border-[#0058be]"
            />
            <span className="font-semibold text-[#565e74]">Đến:</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="bg-white text-[#0b1c30] border border-[#c2c6d6]/60 px-2 py-1 rounded focus:outline-none focus:border-[#0058be]"
            />
          </div>
        )}

        {/* Summary Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Update */}
          <div className="bg-amber-50/70 border border-amber-200/80 p-3.5 rounded-xl">
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Update</span>
            <span className="text-2xl font-black text-amber-800 mt-1 block">
              {statsLoading ? '--' : stats?.update_count || 0}
            </span>
          </div>

          {/* Create */}
          <div className="bg-emerald-50/70 border border-emerald-200/80 p-3.5 rounded-xl">
            <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Create</span>
            <span className="text-2xl font-black text-emerald-800 mt-1 block">
              {statsLoading ? '--' : stats?.create_count || 0}
            </span>
          </div>

          {/* Delete */}
          <div className="bg-rose-50/70 border border-rose-200/80 p-3.5 rounded-xl">
            <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block">Delete</span>
            <span className="text-2xl font-black text-rose-800 mt-1 block">
              {statsLoading ? '--' : stats?.delete_count || 0}
            </span>
          </div>

          {/* AI Check */}
          <div className="bg-purple-50/70 border border-purple-200/80 p-3.5 rounded-xl">
            <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider block">AI Check</span>
            <span className="text-2xl font-black text-purple-800 mt-1 block">
              {statsLoading ? '--' : stats?.ai_check_count || 0}
            </span>
          </div>

          {/* Login */}
          <div className="bg-blue-50/70 border border-blue-200/80 p-3.5 rounded-xl">
            <span className="text-[10px] font-bold text-[#0058be] uppercase tracking-wider block">Login</span>
            <span className="text-2xl font-black text-[#0058be] mt-1 block">
              {statsLoading ? '--' : stats?.login_count || 0}
            </span>
          </div>

          {/* Failed Login */}
          <div className="bg-rose-100/80 border border-rose-300 p-3.5 rounded-xl">
            <span className="text-[10px] font-bold text-rose-800 uppercase tracking-wider block flex items-center gap-1">
              <span>⚠️</span> Failed Login
            </span>
            <span className="text-2xl font-black text-rose-900 mt-1 block">
              {statsLoading ? '--' : stats?.failed_login_count || 0}
            </span>
          </div>
        </div>
      </div>

      {/* 2. RICH FILTER BAR */}
      <div className="bg-white p-4 rounded-xl border border-[#c2c6d6]/60 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
                search
              </span>
              <input
                type="text"
                placeholder="Search description, IP..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white text-[#0b1c30] border border-[#c2c6d6]/60 rounded-lg focus:outline-none focus:border-[#0058be] focus:ring-1 focus:ring-[#0058be] font-medium"
              />
            </div>

            {/* Business Filter (dynamic from Workspace Master) */}
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
              <span>BU:</span>
              <select
                value={businessFilter}
                onChange={e => setBusinessFilter(e.target.value)}
                className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be]"
              >
                <option value="all">All BU</option>
                {workspaces.map(ws => (
                  <option key={ws.code} value={ws.name}>{ws.name}</option>
                ))}
              </select>
            </div>

            {/* Project Filter */}
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
              <span>Project:</span>
              <select
                value={projectFilter}
                onChange={e => setProjectFilter(e.target.value)}
                className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be] max-w-[160px] truncate"
              >
                <option value="all">All Projects</option>
                {projectsList.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
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
                <option value="LOGIN">LOGIN</option>
                <option value="FAILED_LOGIN">FAILED LOGIN</option>
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
                {usersList.map(u => (
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
            className="flex items-center gap-1.5 bg-[#eff4ff] hover:bg-[#0058be]/10 text-[#0058be] border border-[#c2c6d6]/60 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all shadow-sm disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
        </div>
      </div>

      {/* 3. SYSTEM AUDIT TABLE */}
      <div className="bg-white border border-[#c2c6d6]/60 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-[#565e74]">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-[#0058be] mb-2"></div>
            <p>Đang tải nhật ký System Audit Logs...</p>
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
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-blue-50 text-[#0058be] border border-blue-200/60">
                        {log.business_unit || 'All'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#565e74] truncate max-w-[140px]" title={log.project_name || '--'}>
                      {log.project_name || '--'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#565e74]">
                      {log.module}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="px-4 py-3 text-[#0b1c30] max-w-xs truncate font-medium" title={log.description || ''}>
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

      {/* 4. ANALYTICS SUMMARY SECTION */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Top Active Users */}
          <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-[#565e74] uppercase tracking-wider flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#0058be]">leaderboard</span> Top Active Users
            </h3>
            <div className="space-y-2 text-xs">
              {analytics.top_active_users?.map((u: any, idx: number) => (
                <div key={u.user_id} className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <span className="font-bold text-[#0b1c30] truncate">{idx + 1}. {u.name}</span>
                  <span className="font-extrabold text-[#0058be] font-mono">{u.total_actions} tác vụ</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Updated Projects */}
          <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-[#565e74] uppercase tracking-wider flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-amber-600">folder_open</span> Top Updated Projects
            </h3>
            <div className="space-y-2 text-xs">
              {analytics.top_updated_projects?.map((p: any, idx: number) => (
                <div key={p.project_id} className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <span className="font-bold text-[#0b1c30] truncate">{idx + 1}. {p.name}</span>
                  <span className="font-extrabold text-amber-700 font-mono">{p.total_updates} lượt sửa</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top AI Users */}
          <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-[#565e74] uppercase tracking-wider flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-purple-600">psychology</span> Top AI Users
            </h3>
            <div className="space-y-2 text-xs">
              {analytics.top_ai_users?.map((u: any, idx: number) => (
                <div key={u.user_id} className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <span className="font-bold text-[#0b1c30] truncate">{idx + 1}. {u.name}</span>
                  <span className="font-extrabold text-purple-700 font-mono">{u.total_checks} AI Check</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Login Failures */}
          <div className="bg-white border border-rose-200/80 rounded-xl p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-rose-600">warning</span> Top Failed Logins (IPs)
            </h3>
            <div className="space-y-2 text-xs">
              {analytics.top_login_failures?.map((f: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between bg-rose-50/50 p-2 rounded-lg border border-rose-100">
                  <span className="font-mono font-bold text-rose-900 truncate">{f.ip_address}</span>
                  <span className="font-black text-rose-700 font-mono">{f.total_failures} thất bại</span>
                </div>
              ))}
              {(!analytics.top_login_failures || analytics.top_login_failures.length === 0) && (
                <p className="text-slate-400 italic text-center py-2">Không có cảnh báo thất bại.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. DETAIL MODAL */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-[#0058be]">
                <span className="material-symbols-outlined text-[24px]">shield</span>
                <div>
                  <h3 className="text-base font-bold text-[#0b1c30]">
                    System Audit Detail #{selectedLog.id}
                  </h3>
                  <p className="text-xs text-[#565e74]">
                    Module: <span className="text-[#0058be] font-bold">{selectedLog.module}</span> | Entity: {selectedLog.entity_type} #{selectedLog.entity_id || 'N/A'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Meta Rows */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-[#eff4ff]/60 p-3.5 rounded-xl border border-[#0058be]/10">
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Hành động</span>
                  <div className="mt-0.5">{getActionBadge(selectedLog.action)}</div>
                </div>
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Người thực hiện</span>
                  <span className="font-bold text-[#0b1c30]">{selectedLog.user_name}</span>
                </div>
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Business Unit</span>
                  <span className="font-bold text-[#0b1c30]">{selectedLog.business_unit || 'All'}</span>
                </div>
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Dự án</span>
                  <span className="font-bold text-[#0b1c30]">{selectedLog.project_name || '--'}</span>
                </div>
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Thời gian</span>
                  <span className="font-mono text-[#0b1c30] font-bold">{selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString('vi-VN') : '--'}</span>
                </div>
                <div>
                  <span className="text-[#565e74] text-[10px] block font-semibold">Trường thay đổi</span>
                  <span className="font-bold text-amber-700">{selectedLog.field_name || 'Tất cả'}</span>
                </div>
              </div>

              {/* Description */}
              <div>
                <span className="text-[#565e74] font-bold text-[11px] uppercase tracking-wider block mb-1">Mô tả diễn giải</span>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-[#0b1c30] font-medium">
                  {selectedLog.description}
                </div>
              </div>

              {/* Diff Values Comparison */}
              {(selectedLog.old_value || selectedLog.new_value) && (
                <div className="space-y-2">
                  <span className="text-[#565e74] font-bold text-[11px] uppercase tracking-wider block">So sánh Giá trị (Old vs New Diff)</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-rose-50 border border-rose-200/60 rounded-xl p-3">
                      <span className="font-bold text-rose-700 text-[11px] uppercase block mb-1">
                        - Giá trị cũ (Old Value)
                      </span>
                      <pre className="text-rose-900 whitespace-pre-wrap font-mono text-[11px] bg-white p-2 rounded-lg border border-rose-100 max-h-44 overflow-y-auto">
                        {selectedLog.old_value || '(Trống / NULL)'}
                      </pre>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-3">
                      <span className="font-bold text-emerald-700 text-[11px] uppercase block mb-1">
                        + Giá trị mới (New Value)
                      </span>
                      <pre className="text-emerald-900 whitespace-pre-wrap font-mono text-[11px] bg-white p-2 rounded-lg border border-emerald-100 max-h-44 overflow-y-auto">
                        {selectedLog.new_value || '(Trống / NULL)'}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Network / Client Metadata */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <span className="text-[#565e74] font-bold text-[11px] uppercase tracking-wider block">Thông tin Kỹ thuật & Request</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                  <div>
                    <span className="text-[#565e74] text-[10px] block font-semibold">Client IP</span>
                    <span className="text-[#0058be] font-bold">{selectedLog.ip_address || 'N/A'}</span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-[#565e74] text-[10px] block font-semibold">Browser / User Agent</span>
                    <span className="text-[#0b1c30] truncate block" title={selectedLog.user_agent || 'N/A'}>{selectedLog.user_agent || 'N/A'}</span>
                  </div>
                </div>
              </div>
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
