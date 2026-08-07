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
  const [severityFilter, setSeverityFilter] = useState('all');
  const [loginMethodFilter, setLoginMethodFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [ipRiskFilter, setIpRiskFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('table');
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
  const [exportingJSON, setExportingJSON] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);

  // Session Timeline Drill-down State
  const [sessionTimelineEvents, setSessionTimelineEvents] = useState<SystemAuditItem[] | null>(null);

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
        severity: severityFilter !== 'all' ? severityFilter : undefined,
        login_method: loginMethodFilter !== 'all' ? loginMethodFilter : undefined,
        source: sourceFilter !== 'all' ? sourceFilter : undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        ip_risk: ipRiskFilter !== 'all' ? ipRiskFilter : undefined,
        outcome: outcomeFilter !== 'all' ? outcomeFilter : undefined,
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
  }, [businessFilter, projectFilter, moduleFilter, actionFilter, severityFilter, loginMethodFilter, sourceFilter, categoryFilter, ipRiskFilter, outcomeFilter, userFilter, search, dateFilter, customStart, customEnd, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    setPage(1);
  }, [search, businessFilter, projectFilter, moduleFilter, actionFilter, severityFilter, loginMethodFilter, sourceFilter, categoryFilter, ipRiskFilter, outcomeFilter, userFilter, dateFilter, customStart, customEnd]);

  // Export Handlers
  const handleExportCSV = async () => {
    try {
      setExporting(true);
      const data = await exportSystemAuditLogs({
        business_unit: businessFilter !== 'all' ? businessFilter : undefined,
        project_id: projectFilter !== 'all' ? parseInt(projectFilter) : undefined,
        module: moduleFilter !== 'all' ? moduleFilter : undefined,
        action: actionFilter !== 'all' ? actionFilter : undefined,
        severity: severityFilter !== 'all' ? severityFilter : undefined,
        login_method: loginMethodFilter !== 'all' ? loginMethodFilter : undefined,
        source: sourceFilter !== 'all' ? sourceFilter : undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        ip_risk: ipRiskFilter !== 'all' ? ipRiskFilter : undefined,
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

  const handleExportJSON = async () => {
    try {
      setExportingJSON(true);
      const data = await exportSystemAuditLogsJSON({
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        source: sourceFilter !== 'all' ? sourceFilter : undefined,
        search: search.trim() || undefined
      });

      const url = window.URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `System_Audit_Logs_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Failed to export JSON system audit logs:', err);
      alert('Không thể xuất file JSON. Vui lòng thử lại sau.');
    } finally {
      setExportingJSON(false);
    }
  };

  const handleLoadSessionTimeline = async (sessionId: string) => {
    if (!sessionId) return;
    try {
      const data = await getSessionTimeline(sessionId);
      setSessionTimelineEvents(data.events || []);
    } catch (err) {
      console.error('Failed to load session timeline:', err);
      alert('Không thể tải dòng thời gian của Session này.');
    }
  };

  // Module Icon Helper
  const getModuleIcon = (moduleName?: string) => {
    const mod = (moduleName || '').toLowerCase();
    if (mod.includes('auth') || mod.includes('login')) return '🔒';
    if (mod.includes('user') || mod.includes('member') || mod.includes('permission')) return '👤';
    if (mod.includes('kpi')) return '📊';
    if (mod.includes('ai')) return '🤖';
    if (mod.includes('template')) return '📁';
    if (mod.includes('customer')) return '🏢';
    if (mod.includes('file') || mod.includes('attach')) return '📎';
    if (mod.includes('export')) return '📤';
    if (mod.includes('integration') || mod.includes('slack')) return '🔌';
    if (mod.includes('security')) return '🚨';
    return '⚙️';
  };

  // Category Badge Helper
  const getCategoryBadge = (catName?: string) => {
    const cat = catName || 'Administration';
    switch (cat) {
      case 'Security':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200/80">🛡️ Security</span>;
      case 'Configuration':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200/80">⚙️ Config</span>;
      case 'Integration':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200/80">🔌 Integration</span>;
      case 'System':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200/80">💻 System</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/80">👤 Admin</span>;
    }
  };

  // IP Risk Badge Helper
  const getIpRiskBadge = (ipRiskName?: string, ipAddress?: string) => {
    const risk = ipRiskName || 'Internal';
    switch (risk) {
      case 'Internal':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/80" title={`IP nội bộ: ${ipAddress || 'Internal'}`}>
            <span>🛡️</span> Internal ({ipAddress || '127.0.0.1'})
          </span>
        );
      case 'Trusted':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/80" title={`IP tin cậy: ${ipAddress || 'Trusted'}`}>
            <span>🟢</span> Trusted ({ipAddress || 'Office'})
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/80" title={`IP công cộng: ${ipAddress || 'Unknown'}`}>
            <span>⚠️</span> Unknown ({ipAddress || 'Public IP'})
          </span>
        );
    }
  };

  // Source Badge Helper
  const getSourceBadge = (sourceName?: string) => {
    const src = (sourceName || 'WEB').toUpperCase();
    switch (src) {
      case 'GOOGLE_OAUTH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/60">🌐 GOOGLE</span>;
      case 'CRON':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">⏱️ CRON</span>;
      case 'SYSTEM':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200/60">⚙️ SYSTEM</span>;
      case 'AI':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200/60">🤖 AI</span>;
      case 'API':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200/60">🔌 API</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60">💻 WEB</span>;
    }
  };

  // Outcome Badge Helper
  const getOutcomeBadge = (outcomeName?: string) => {
    const out = (outcomeName || 'SUCCESS').toUpperCase();
    switch (out) {
      case 'FAILED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300">🔴 FAILED</span>;
      case 'PARTIAL':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">🟡 PARTIAL</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">🟢 SUCCESS</span>;
    }
  };

  // Duration Helper
  const getDurationBadge = (durationMs?: number) => {
    if (!durationMs) return null;
    const isSlow = durationMs > 3000;
    return (
      <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${isSlow ? 'bg-amber-100 text-amber-900 border border-amber-300 animate-pulse' : 'bg-slate-100 text-slate-600'}`}>
        ⚡ {durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`}
      </span>
    );
  };

  // Device Badge Helper
  const getDeviceBadge = (browser?: string, os?: string, deviceType?: string) => {
    const b = browser || 'Browser';
    const o = os || 'OS';
    const icon = deviceType === 'Mobile' ? '📱' : deviceType === 'Tablet' ? '📱' : '💻';
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200" title={`${deviceType}: ${b} on ${o}`}>
        <span>{icon}</span> {b} / {o}
      </span>
    );
  };

  // Security Flags Helper
  const getSecurityFlags = (isNewIp?: boolean, isNewDev?: boolean) => {
    return (
      <div className="flex items-center gap-1">
        {isNewIp && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-rose-600 text-white animate-pulse">🚨 NEW IP</span>}
        {isNewDev && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-purple-600 text-white">⚡ NEW DEVICE</span>}
      </div>
    );
  };

  // Badge Helper
  const getSeverityBadge = (severity?: string) => {
    const sev = (severity || 'INFO').toUpperCase();
    switch (sev) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 tracking-wider">
            <span>🔴</span> CRITICAL
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <span>⚠️</span> WARNING
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <span>ℹ️</span> INFO
          </span>
        );
    }
  };

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
                <option value="all">Tất cả Module</option>
                <option value="Authentication">Authentication</option>
                <option value="User">User / Account</option>
                <option value="Permission">Permission / Role</option>
                <option value="Setting">Settings</option>
                <option value="KPI Engine">KPI Engine</option>
                <option value="AI Config">AI Configuration</option>
                <option value="Template">Project Template</option>
                <option value="Customer">Customer</option>
                <option value="File">File System</option>
                <option value="Export">Export CSV</option>
                <option value="Integration">Integration</option>
                <option value="Security">Security Alert</option>
              </select>
            </div>

            {/* Severity Filter */}
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
              <span>Mức độ (Severity):</span>
              <select
                value={severityFilter}
                onChange={e => setSeverityFilter(e.target.value)}
                className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be]"
              >
                <option value="all">Tất cả Mức độ</option>
                <option value="INFO">ℹ️ INFO</option>
                <option value="WARNING">⚠️ WARNING</option>
                <option value="CRITICAL">🔴 CRITICAL</option>
              </select>
            </div>

            {/* Login Method Filter */}
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
              <span>Phương thức Login:</span>
              <select
                value={loginMethodFilter}
                onChange={e => setLoginMethodFilter(e.target.value)}
                className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be]"
              >
                <option value="all">Tất cả Phương thức</option>
                <option value="Password">🔑 Password</option>
                <option value="Google OAuth">🌐 Google OAuth</option>
              </select>
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
              <span>Category:</span>
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be]"
              >
                <option value="all">Tất cả Category</option>
                <option value="Security">🛡️ Security</option>
                <option value="Administration">👤 Administration</option>
                <option value="Configuration">⚙️ Configuration</option>
                <option value="Integration">🔌 Integration</option>
                <option value="System">💻 System</option>
              </select>
            </div>

            {/* IP Risk Filter */}
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
              <span>IP Risk:</span>
              <select
                value={ipRiskFilter}
                onChange={e => setIpRiskFilter(e.target.value)}
                className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be]"
              >
                <option value="all">Tất cả IP Risk</option>
                <option value="Internal">🛡️ Internal (Local/VPN)</option>
                <option value="Trusted">🟢 Trusted (Office)</option>
                <option value="Unknown">⚠️ Unknown (Public)</option>
              </select>
            </div>

            {/* Outcome Filter */}
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#565e74]">
              <span>Outcome:</span>
              <select
                value={outcomeFilter}
                onChange={e => setOutcomeFilter(e.target.value)}
                className="bg-white border border-[#c2c6d6]/60 text-[#0b1c30] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0058be]"
              >
                <option value="all">Tất cả Kết quả</option>
                <option value="SUCCESS">🟢 SUCCESS</option>
                <option value="FAILED">🔴 FAILED</option>
                <option value="PARTIAL">🟡 PARTIAL</option>
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
                <option value="all">Tất cả Action</option>
                <option value="LOGIN">LOGIN</option>
                <option value="FAILED_LOGIN">FAILED_LOGIN</option>
                <option value="LOGOUT">LOGOUT</option>
                <option value="CREATE_USER">CREATE_USER</option>
                <option value="UPDATE_USER">UPDATE_USER</option>
                <option value="CHANGE_ROLE">CHANGE_ROLE</option>
                <option value="LOCK_ACCOUNT">LOCK_ACCOUNT</option>
                <option value="DELETE_USER">DELETE_USER</option>
                <option value="CREATE">CREATE</option>
                <option value="UPDATE">UPDATE</option>
                <option value="DELETE">DELETE</option>
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

          <div className="flex items-center gap-2">
            {/* View Mode Switcher */}
            <div className="bg-[#eff4ff] p-1 rounded-lg border border-[#c2c6d6]/60 flex items-center gap-1 shrink-0">
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-all ${
                  viewMode === 'table' ? 'bg-[#0058be] text-white shadow-xs' : 'text-[#565e74] hover:text-[#0b1c30]'
                }`}
                title="Chế độ Bảng Dữ liệu Tra cứu"
              >
                <span className="material-symbols-outlined text-[16px]">table_chart</span>
                <span>Table</span>
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-all ${
                  viewMode === 'timeline' ? 'bg-[#0058be] text-white shadow-xs' : 'text-[#565e74] hover:text-[#0b1c30]'
                }`}
                title="Chế độ Dòng Thời gian Theo Phút (Minute Timeline Mode)"
              >
                <span className="material-symbols-outlined text-[16px]">timeline</span>
                <span>Timeline</span>
              </button>
            </div>

            {/* Export CSV Button */}
            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="flex items-center gap-1.5 bg-[#eff4ff] hover:bg-[#0058be]/10 text-[#0058be] border border-[#c2c6d6]/60 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all shadow-sm disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              <span>{exporting ? 'CSV...' : 'CSV'}</span>
            </button>

            {/* Export JSON Button */}
            <button
              onClick={handleExportJSON}
              disabled={exportingJSON}
              className="flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all shadow-sm disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">code</span>
              <span>{exportingJSON ? 'JSON...' : 'JSON'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. SYSTEM AUDIT TABLE OR TIMELINE VIEW */}
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
        ) : viewMode === 'timeline' ? (
          /* MINUTE TIMELINE MODE */
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-xs font-bold text-[#565e74] uppercase tracking-wider flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px] text-[#0058be]">schedule</span>
                Dòng Thời Gian Nhật Ký Theo Phút (Minute Incident Timeline)
              </h3>
              <span className="text-xs font-bold text-[#0058be] bg-[#eff4ff] px-2.5 py-1 rounded-full border border-[#0058be]/20">
                {logs.length} sự kiện
              </span>
            </div>

            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
              {logs.map((log) => (
                <div
                  key={log.id}
                  onClick={() => setSelectedLog(log)}
                  className="relative group cursor-pointer bg-slate-50 hover:bg-[#eff4ff]/50 p-4 rounded-xl border border-slate-200 hover:border-[#0058be]/40 transition-all shadow-2xs space-y-2.5"
                >
                  {/* Timeline Node Point */}
                  <div className="absolute -left-[31px] top-4 w-3.5 h-3.5 rounded-full bg-white border-2 border-[#0058be] group-hover:scale-125 transition-transform" />

                  {/* Header Row */}
                  <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-[#0058be] bg-[#eff4ff] px-2 py-0.5 rounded border border-[#0058be]/20">
                        ⏱️ {log.created_at ? new Date(log.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                      </span>
                      <span className="font-bold text-[#0b1c30]">{log.user_name}</span>
                      {getCategoryBadge(log.category)}
                      {getSourceBadge(log.source)}
                      {getActionBadge(log.action)}
                      {getSeverityBadge(log.severity)}
                    </div>
                    <div>
                      {getIpRiskBadge(log.ip_risk, log.ip_address)}
                    </div>
                  </div>

                  {/* Resource Name & Description */}
                  <div className="text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#0058be]">Target: {log.resource_name || log.entity_id || 'N/A'}</span>
                      {log.changes_count && log.changes_count > 1 && (
                        <span className="text-[10px] font-black bg-purple-100 text-purple-800 px-2 py-0.5 rounded border border-purple-200">
                          {log.changes_count} thay đổi
                        </span>
                      )}
                    </div>
                    <p className="text-[#0b1c30] font-medium leading-relaxed bg-white p-2.5 rounded-lg border border-slate-200/70">
                      {log.description}
                    </p>
                  </div>

                  {/* GitHub-style Pill Diff Preview */}
                  {log.changes && log.changes.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="text-slate-400 font-bold">Thay đổi:</span>
                      {log.changes.slice(0, 3).map((ch, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 bg-white px-2 py-1 rounded border border-slate-200">
                          <span className="font-mono text-slate-500 font-bold">{ch.field_name}:</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 line-through">{ch.old_value || 'NULL'}</span>
                          <span className="text-slate-400 font-bold">➔</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">{ch.new_value || 'NULL'}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Tracing Links Footer */}
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1">
                    <span>Correlation ID: {log.correlation_id || 'N/A'}</span>
                    <span>Session ID: {log.session_id ? `${log.session_id.substring(0, 12)}...` : 'N/A'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* DATA TABLE MODE */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#0b1c30]">
              <thead className="bg-[#eff4ff]/60 text-[#565e74] font-bold text-[11px] uppercase tracking-wider border-b border-[#c2c6d6]/60">
                <tr>
                  <th className="px-4 py-3 w-28">Thời gian</th>
                  <th className="px-4 py-3 w-32">Người dùng</th>
                  <th className="px-4 py-3 w-24">Category</th>
                  <th className="px-4 py-3 w-24">Nguồn</th>
                  <th className="px-4 py-3 w-28">Hành động</th>
                  <th className="px-4 py-3 w-36">Đối tượng (Resource)</th>
                  <th className="px-4 py-3 w-28">IP Risk</th>
                  <th className="px-4 py-3">Mô tả diễn giải</th>
                  <th className="px-4 py-3 w-16 text-center">Chi tiết</th>
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
                      {getCategoryBadge(log.category)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getSourceBadge(log.source)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="px-4 py-3 font-bold text-[#0058be] whitespace-nowrap truncate max-w-[140px]" title={log.resource_name || log.entity_id || ''}>
                      {log.resource_name || log.entity_id || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getIpRiskBadge(log.ip_risk, log.ip_address)}
                    </td>
                    <td className="px-4 py-3 text-[#0b1c30] max-w-xs font-medium" title={log.description || ''}>
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{log.description}</span>
                        {log.changes_count && log.changes_count > 1 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black bg-purple-100 text-purple-800 border border-purple-200 shrink-0">
                            {log.changes_count} thay đổi
                          </span>
                        )}
                      </div>
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

      {/* 5. SLIDE-OUT DRAWER DETAIL VIEW */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-[999] flex justify-end">
          <div
            className="fixed inset-0"
            onClick={() => setSelectedLog(null)}
          />
          <div className="relative w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col z-10 animate-in slide-in-from-right duration-250">
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 text-[#0058be]">
                <span className="material-symbols-outlined text-[24px]">shield</span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-[#0b1c30]">
                      Chi tiết Nhật ký #{selectedLog.id}
                    </h3>
                    {getSeverityBadge(selectedLog.severity)}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Module: <strong className="text-slate-800">{selectedLog.module}</strong> | Target: {selectedLog.entity_type} #{selectedLog.entity_id || 'N/A'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
                title="Đóng Drawer"
              >
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>

            {/* Drawer Scrollable Content */}
            <div className="flex-1 p-6 space-y-5 overflow-y-auto text-xs">
              {/* Event Meta Card */}
              <div className="bg-[#eff4ff]/60 p-4 rounded-xl border border-[#0058be]/15 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase font-bold block">Hành động & Kết quả</span>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      {getActionBadge(selectedLog.action)}
                      {getOutcomeBadge(selectedLog.outcome)}
                      {getDurationBadge(selectedLog.duration_ms)}
                      {getSourceBadge(selectedLog.source)}
                      {selectedLog.login_method && (
                        <span className="text-[10px] font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded">
                          {selectedLog.login_method}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase font-bold block">Đối tượng (Resource Name)</span>
                    <span className="font-bold text-[#0058be] text-xs mt-1 block truncate" title={selectedLog.resource_name || selectedLog.entity_id || ''}>
                      {selectedLog.resource_name || selectedLog.entity_id || 'N/A'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#0058be]/10">
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase font-bold block">Người thực hiện (Actor)</span>
                    <span className="font-bold text-[#0b1c30] text-xs mt-0.5 block">{selectedLog.user_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase font-bold block">Thời gian phát sinh</span>
                    <span className="font-mono text-slate-800 font-bold mt-0.5 block">
                      {selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString('vi-VN') : '--'}
                    </span>
                  </div>
                </div>

                {selectedLog.target_user_name && (
                  <div className="pt-2 border-t border-[#0058be]/10">
                    <span className="text-slate-500 text-[10px] uppercase font-bold block">Target User</span>
                    <span className="font-bold text-purple-800 text-xs mt-0.5 block">👤 {selectedLog.target_user_name}</span>
                  </div>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <span className="text-slate-500 font-bold text-[11px] uppercase tracking-wider block">Mô tả diễn giải câu lệnh</span>
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-[#0b1c30] font-medium leading-relaxed">
                  {selectedLog.description}
                </div>
              </div>

              {/* Session Timeline Drill-down Button */}
              {selectedLog.session_id && (
                <div className="bg-gradient-to-r from-[#eff4ff] to-purple-50 p-3.5 rounded-xl border border-[#0058be]/20 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-[#0b1c30] text-xs block">Truy vết Dòng thời gian Session này</span>
                    <span className="font-mono text-[10px] text-slate-500 block truncate max-w-[280px]">Session: {selectedLog.session_id}</span>
                  </div>
                  <button
                    onClick={() => handleLoadSessionTimeline(selectedLog.session_id!)}
                    className="bg-[#0058be] hover:bg-[#004499] text-white font-bold text-xs px-3 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <span className="material-symbols-outlined text-[16px]">timeline</span>
                    <span>Xem Timeline</span>
                  </button>
                </div>
              )}

              {/* Session Timeline Drill-down Results Accordion */}
              {sessionTimelineEvents && (
                <div className="space-y-2 bg-slate-900 text-white p-4 rounded-xl border border-slate-700 max-h-72 overflow-y-auto font-mono text-[11px]">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-700">
                    <span className="font-bold text-purple-300">⏱️ Chuỗi Hành Động Trong Session ({sessionTimelineEvents.length} sự kiện)</span>
                    <button onClick={() => setSessionTimelineEvents(null)} className="text-slate-400 hover:text-white text-xs">✕ Đóng</button>
                  </div>
                  <div className="space-y-2 pt-2">
                    {sessionTimelineEvents.map((evt, i) => (
                      <div key={evt.id} className="bg-slate-800 p-2.5 rounded border border-slate-700 space-y-1">
                        <div className="flex items-center justify-between text-slate-300">
                          <span>#{i + 1} {new Date(evt.created_at!).toLocaleTimeString('vi-VN')}</span>
                          <span className="font-bold text-emerald-400">{evt.action}</span>
                        </div>
                        <p className="text-slate-200">{evt.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Full State Snapshot Viewer */}
              {selectedLog.snapshot_json && (
                <div className="space-y-1.5">
                  <span className="text-slate-500 font-bold text-[11px] uppercase tracking-wider block flex items-center gap-1 text-purple-800">
                    <span className="material-symbols-outlined text-[16px]">photo_camera</span>
                    Bản chụp JSON Trạng thái (Full State Snapshot JSON)
                  </span>
                  <pre className="bg-slate-900 text-emerald-400 p-3.5 rounded-xl font-mono text-[11px] max-h-60 overflow-y-auto border border-slate-800 leading-tight">
                    {selectedLog.snapshot_json}
                  </pre>
                </div>
              )}

              {/* Grouped Changes Diff Comparison */}
              {selectedLog.changes && selectedLog.changes.length > 0 ? (
                <div className="space-y-3">
                  <span className="text-slate-500 font-bold text-[11px] uppercase tracking-wider block flex items-center justify-between">
                    <span>Danh sách Trường thay đổi (Diff List)</span>
                    <span className="text-purple-700 font-bold">({selectedLog.changes.length} thay đổi)</span>
                  </span>
                  <div className="space-y-3">
                    {selectedLog.changes.map((ch, idx) => (
                      <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                        <span className="font-bold text-slate-800 text-[11px] block flex items-center justify-between">
                          <span>Trường: <strong className="text-[#0058be] font-mono">{ch.field_name}</strong></span>
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="bg-rose-50/70 border border-rose-200 rounded-lg p-2">
                            <span className="font-bold text-rose-800 text-[10px] uppercase block mb-1">
                              - Cũ (Old)
                            </span>
                            <pre className="text-rose-900 whitespace-pre-wrap font-mono text-[10px] bg-white p-1.5 rounded border border-rose-100 max-h-32 overflow-y-auto">
                              {ch.old_value || '(Trống)'}
                            </pre>
                          </div>
                          <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-2">
                            <span className="font-bold text-emerald-800 text-[10px] uppercase block mb-1">
                              + Mới (New)
                            </span>
                            <pre className="text-emerald-900 whitespace-pre-wrap font-mono text-[10px] bg-white p-1.5 rounded border border-emerald-100 max-h-32 overflow-y-auto">
                              {ch.new_value || '(Trống)'}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (selectedLog.old_value || selectedLog.new_value) && (
                <div className="space-y-2">
                  <span className="text-slate-500 font-bold text-[11px] uppercase tracking-wider block">So sánh Giá trị (Old vs New Diff)</span>
                  <div className="space-y-3">
                    <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3">
                      <span className="font-bold text-rose-800 text-[11px] uppercase block mb-1 flex items-center gap-1">
                        <span>-</span> Giá trị cũ (Old Value)
                      </span>
                      <pre className="text-rose-900 whitespace-pre-wrap font-mono text-[11px] bg-white p-2.5 rounded-lg border border-rose-100 max-h-48 overflow-y-auto">
                        {selectedLog.old_value || '(Trống / NULL)'}
                      </pre>
                    </div>
                    <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3">
                      <span className="font-bold text-emerald-800 text-[11px] uppercase block mb-1 flex items-center gap-1">
                        <span>+</span> Giá trị mới (New Value)
                      </span>
                      <pre className="text-emerald-900 whitespace-pre-wrap font-mono text-[11px] bg-white p-2.5 rounded-lg border border-emerald-100 max-h-48 overflow-y-auto">
                        {selectedLog.new_value || '(Trống / NULL)'}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Network / Client Metadata */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2.5">
                <span className="text-slate-500 font-bold text-[11px] uppercase tracking-wider block">Thông tin Kỹ thuật & Network Tracing</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Client IP Address:</span>
                    <div className="mt-0.5">{getIpRiskBadge(selectedLog.ip_risk, selectedLog.ip_address)}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Event Category:</span>
                    <div className="mt-0.5">{getCategoryBadge(selectedLog.category)}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Device & Browser:</span>
                    <div className="mt-0.5">{getDeviceBadge(selectedLog.browser, selectedLog.os, selectedLog.device_type)}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Security Flags:</span>
                    <div className="mt-0.5">{getSecurityFlags(selectedLog.is_new_ip, selectedLog.is_new_device)}</div>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Session ID (Tracing Lifecycle):</span>
                    <span className="text-indigo-600 font-bold break-all">{selectedLog.session_id || 'N/A (Stateless Request)'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Correlation ID (Request X-ID):</span>
                    <span className="text-slate-700 font-bold break-all">{selectedLog.correlation_id || 'N/A'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">API Endpoint URL:</span>
                    <span className="text-slate-700 break-all">{selectedLog.request_url || 'N/A'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Browser User Agent:</span>
                    <span className="text-slate-600 break-all">{selectedLog.user_agent || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex justify-end shrink-0">
              <button
                onClick={() => setSelectedLog(null)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-5 py-2 rounded-lg shadow-sm transition-all cursor-pointer"
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
