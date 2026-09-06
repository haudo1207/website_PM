'use client';
import React, { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import { useRouter } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getMembers, getTeams, getDepartments, getWorkspaces, getMe } from '@/lib/api';
import { useWorkspaceFilter } from '@/lib/workspaceFilter';
import { useSidebarCollapse, SIDEBAR_PAD_EXPANDED, SIDEBAR_PAD_COLLAPSED } from '@/lib/sidebarCollapse';

export default function KPIPage() {
    const router = useRouter();
    const { collapsed: sidebarCollapsed } = useSidebarCollapse();
    const [authorized, setAuthorized] = useState(false);
    useEffect(() => { setAuthorized(true); }, []);
    const [activeTab, setActiveTab] = useState<'KPItotal' | 'KPIweek'>('KPItotal');
    const [search, setSearch] = useState("");
    // Debounce ô tìm kiếm: gõ xong 400ms mới gọi API, không gọi theo từng ký tự.
    const [debouncedSearch, setDebouncedSearch] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 400);
        return () => clearTimeout(timer);
    }, [search]);
    const [month, setMonth] = useState("");
    const [year, setYear] = useState("");
    const [level, setLevel] = useState("");
    const [workspace, setWorkspace] = useState("");
    const [team, setTeam] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [levelOptions, setLevelOptions] = useState<any[]>([]);
    // Shared ['workspaces'] react-query cache — same key/staleTime as Navbar/
    // Dashboard/ProjectListContent, so this doesn't fire a duplicate request.
    const { data: workspaceOptionsData } = useQuery({
        queryKey: ['workspaces'],
        queryFn: () => getWorkspaces(),
        staleTime: 5 * 60_000,
    });
    const workspaceOptions: any[] = workspaceOptionsData || [];
    const [teamOptions, setTeamOptions] = useState<any[]>([]);
    // Workspace data scope: for Leader/Member/Viewer the assigned Workspace(s)
    // are the effective KPI data scope. The full list (multi-Workspace aware)
    // is sourced from `me.workspace_ids[]` + `me.workspaces[]` — never the
    // legacy single-column `me.data_scope`, which only carries the first code.
    const [userRole, setUserRole] = useState("");
    const [authorizedWorkspaceCodes, setAuthorizedWorkspaceCodes] = useState<string[]>([]);
    const isScopedUser = (userRole === 'member' || userRole === 'viewer' || userRole === 'leader');
    // The list of Workspaces the current user is authorized to view. For a
    // single-Workspace Leader/Member/Viewer this is a 1-element array (locked);
    // for a multi-Workspace Leader it lists every granted Workspace, plus an
    // "All authorized Workspaces" pseudo-option. Super Admin gets an empty
    // array (treated as "no restriction", same as the existing pre-fix path).
    const lockedWorkspaceOptions = useMemo(() => {
        if (!isScopedUser) return [];
        const codes = authorizedWorkspaceCodes.filter(c => c && c !== 'all');
        return codes.map(code => {
            const w = workspaceOptions.find(o => (o.code || "").toLowerCase() === code.toLowerCase());
            return { code, name: w ? w.name : code };
        });
    }, [isScopedUser, authorizedWorkspaceCodes, workspaceOptions]);
    const lockedWorkspaceName = lockedWorkspaceOptions.length === 1 ? lockedWorkspaceOptions[0].name : "";
    // UI-shape flags derived from the authorized scope. Lifted to the
    // component scope so the "Clear filter" button can reuse them.
    const isMultiWs = isScopedUser && lockedWorkspaceOptions.length > 1;
    const isLockedSingle = isScopedUser && lockedWorkspaceOptions.length === 1;
    const [sortConfig, setSortConfig] = useState({
        key: "kpi_total",
        direction: "desc",
    });

    const handleSort = (key: string) => {
    let direction = "asc";

    if (
        sortConfig.key === key &&
        sortConfig.direction === "asc"
    ) {
        direction = "desc";
    }

    setSortConfig({
        key,
        direction,
    });
};

    useEffect(() => {
        getTeams().then(setLevelOptions).catch(() => {});
        getDepartments().then(setTeamOptions).catch(() => {});
        getMe().then(me => {
            setUserRole(me.role);
            // Prefer the new multi-Workspace grant list; fall back to the
            // legacy single-column `data_scope` if `workspace_ids` is missing
            // (older backend responses / defensive default).
            const ids: string[] = Array.isArray(me.workspace_ids) && me.workspace_ids.length > 0
                ? me.workspace_ids
                : (me.data_scope ? [me.data_scope] : []);
            setAuthorizedWorkspaceCodes(ids);
        }).catch(() => {});
    }, []);

    // Member/Viewer: keep the Workspace filter pinned to the single assigned Workspace.
    // Multi-Workspace Leaders are not auto-pinned — they get an "All authorized
    // Workspaces" option as default so they see the union of their granted data.
    useEffect(() => {
        if (!isScopedUser) return;
        if (lockedWorkspaceOptions.length === 1 && workspace !== lockedWorkspaceOptions[0].name) {
            setWorkspace(lockedWorkspaceOptions[0].name);
        }
    }, [isScopedUser, lockedWorkspaceOptions, workspace]);

    // Company selection is shared app-wide via WorkspaceFilterProvider (see
    // Navbar's Workspace switcher) — picking a Workspace there filters this
    // page too, converting the shared code into the name this page's filter
    // (and its `?workspace=` API param) already expects.
    const { workspaceCode: ctxWorkspaceCode, setWorkspaceCode } = useWorkspaceFilter();
    useEffect(() => {
        if (isScopedUser) return;
        const name = ctxWorkspaceCode
            ? (workspaceOptions.find(o => (o.code || '').toLowerCase() === ctxWorkspaceCode.toLowerCase())?.name || '')
            : '';
        setWorkspace(name);
    }, [ctxWorkspaceCode, workspaceOptions, isScopedUser]);

    const handleWorkspaceChange = (name: string) => {
        setWorkspace(name);
        const code = name ? (workspaceOptions.find(o => o.name === name)?.code || null) : null;
        setWorkspaceCode(code);
    };

    const memberParams = useMemo(() => {
        const params: any = {};
        // For scoped users, the Workspace filter is only sent when a SPECIFIC
        // Workspace is picked. The "All authorized Workspaces" pseudo-option
        // resolves to `workspace = ""` and is intentionally NOT forwarded —
        // the backend's `member_query_for_user` already clamps to the union of
        // the caller's granted Workspaces (multi-Workspace aware), so omitting
        // the param yields the combined dataset instead of one workspace only.
        const effectiveWorkspace = isScopedUser
            ? (lockedWorkspaceOptions.length > 1 ? workspace : lockedWorkspaceName)
            : workspace;
        if (activeTab === 'KPItotal') {
            if (month) params.month = parseInt(month);
            if (year) params.year = parseInt(year);
            if (level) params.team = level;
            if (effectiveWorkspace) params.workspace = effectiveWorkspace;
            if (team) params.department = team;
            if (debouncedSearch) params.search = debouncedSearch;
        } else {
            // KPI Tuần: gửi date range thay vì tháng/năm
            if (startDate) params.start_date = startDate;
            if (endDate) params.end_date = endDate;
            if (level) params.team = level;
            if (effectiveWorkspace) params.workspace = effectiveWorkspace;
            if (team) params.department = team;
            if (debouncedSearch) params.search = debouncedSearch;
        }
        return params;
    }, [activeTab, month, year, level, workspace, team, debouncedSearch, startDate, endDate, isScopedUser, lockedWorkspaceName, lockedWorkspaceOptions]);

    const { data: members = [], isLoading } = useQuery({
        queryKey: ['kpi-members', memberParams],
        queryFn: () => getMembers(memberParams),
        staleTime: 2 * 60_000,
    });

    const sortedMembers = useMemo(() => {
        let sortableItems = [...members];
        if (sortConfig.key !== "") {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key] || 0;
                let bValue = b[sortConfig.key] || 0;

                // Handle derived percentage sorting for KPIweek tab
                if (sortConfig.key === 'kpi_achieved') {
                    const aEst = a.kpi_base_total || 0;
                    const aAct = a.kpi_total || 0;
                    aValue = aEst > 0 ? Math.round((aAct / aEst) * 100) : 0;
                    
                    const bEst = b.kpi_base_total || 0;
                    const bAct = b.kpi_total || 0;
                    bValue = bEst > 0 ? Math.round((bAct / bEst) * 100) : 0;
                }

                if (aValue < bValue) {
                    return sortConfig.direction === "asc" ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === "asc" ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [members, sortConfig]);

    if (!authorized) return null;

    return (
        <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] flex" style={{ fontFamily: "'Inter', sans-serif" }}>
            <Navbar />
            <div className={`flex-1 min-w-0 pl-0 ${sidebarCollapsed ? SIDEBAR_PAD_COLLAPSED : SIDEBAR_PAD_EXPANDED} pt-14 md:pt-0 flex flex-col min-h-screen transition-[padding] duration-200`}>
                {/* Header */}
                <div className="h-[56px] bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 sticky top-14 md:top-0 z-30 shadow-sm">
                    <h2 className="text-sm font-bold tracking-wider text-[#0f172a] uppercase">Thống Kê KPI Toàn Dự Án</h2>
                </div>

                {/* Tabbar Navigation */}
                <div className="bg-white border-b border-slate-200 px-4 md:px-8 flex gap-4 md:gap-6 z-20 overflow-x-auto">
                    <button
                        onClick={() => setActiveTab('KPItotal')}
                        className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${activeTab === 'KPItotal'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >   Tổng hợp KPI
                    </button>
                    <button
                        onClick={() => setActiveTab('KPIweek')}
                        className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${activeTab === 'KPIweek'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >   Tổng hợp KPI tuần
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 md:p-8 max-w-7xl w-full mx-auto space-y-6 min-w-0">

                    {/* Header Bảng */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">Bảng Xếp Hạng KPI Tổng</h1>
                            <p className="text-sm text-slate-500 mt-0.5">Thống kê tổng KPI của toàn bộ thành viên từ các Dự án và Meeting</p>
                        </div>
                    </div>

                    {/* Bộ lọc nổi bật */}
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl px-5 py-4 shadow-sm flex flex-col gap-4">
                        <div className="flex items-center gap-2 border-b border-blue-100 pb-2">
                            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                            </svg>
                            <span className="text-sm font-bold text-blue-800 uppercase tracking-wider">Bộ lọc dữ liệu:</span>
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-3">
                            {activeTab === 'KPItotal' ? (
                                <>
                                    {/* Search */}
                                    <input 
                                        type="text" 
                                        placeholder="Tìm kiếm tên..." 
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[200px] shadow-sm transition-all hover:border-blue-300"
                                    />

                                    {/* Level */}
                                    <select 
                                        value={level} 
                                        onChange={e => setLevel(e.target.value)}
                                        className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[140px] shadow-sm transition-all cursor-pointer hover:border-blue-300"
                                    >
                                        <option value="">Tất cả Level</option>
                                        {levelOptions.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                                    </select>

                                    {/* Workspace */}
                                    {(() => {
                                        // Three UI shapes depending on the user's
                                        // authorized scope:
                                        //  - Super Admin   → full dropdown (existing)
                                        //  - Single-Ws scoped user (Member/Viewer or
                                        //    single-Workspace Leader) → locked dropdown
                                        //    with the single assigned option (existing)
                                        //  - Multi-Ws Leader → enabled dropdown with
                                        //    "All authorized Workspaces" + one option per
                                        //    granted Workspace (NEW)
                                        const selectValue = isLockedSingle
                                            ? lockedWorkspaceOptions[0].name
                                            : workspace;
                                        return (
                                            <select
                                                value={selectValue}
                                                onChange={e => handleWorkspaceChange(e.target.value)}
                                                disabled={isLockedSingle}
                                                title={isLockedSingle
                                                    ? `Workspace cố định theo tài khoản: ${lockedWorkspaceOptions[0].name}`
                                                    : isMultiWs
                                                        ? 'Chọn một Workspace được gán hoặc kết hợp tất cả'
                                                        : undefined}
                                                className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[160px] shadow-sm transition-all cursor-pointer hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-70"
                                            >
                                                {isLockedSingle ? (
                                                    <option value={lockedWorkspaceOptions[0].name}>{lockedWorkspaceOptions[0].name}</option>
                                                ) : isMultiWs ? (
                                                    <>
                                                        <option value="">Tất cả Workspace được gán ({lockedWorkspaceOptions.length})</option>
                                                        {lockedWorkspaceOptions.map(w => (
                                                            <option key={w.code} value={w.name}>{w.name}</option>
                                                        ))}
                                                    </>
                                                ) : (
                                                    <>
                                                        <option value="">Tất cả Workspace</option>
                                                        {workspaceOptions.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                                                    </>
                                                )}
                                            </select>
                                        );
                                    })()}

                                    {/* Team */}
                                    <select 
                                        value={team} 
                                        onChange={e => setTeam(e.target.value)}
                                        className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[160px] shadow-sm transition-all cursor-pointer hover:border-blue-300"
                                    >
                                        <option value="">Tất cả Team</option>
                                        {teamOptions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                                    </select>

                                    {/* Month */}
                                    <select 
                                        value={month} 
                                        onChange={e => setMonth(e.target.value)}
                                        className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[140px] shadow-sm transition-all cursor-pointer hover:border-blue-300"
                                    >
                                        <option value="">Tất cả các tháng</option>
                                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                            <option key={m} value={m}>Tháng {m}</option>
                                        ))}
                                    </select>

                                    {/* Year */}
                                    <select 
                                        value={year} 
                                        onChange={e => setYear(e.target.value)}
                                        className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[140px] shadow-sm transition-all cursor-pointer hover:border-blue-300"
                                    >
                                        <option value="">Tất cả các năm</option>
                                        {[2023, 2024, 2025, 2026, 2027].map(y => (
                                            <option key={y} value={y}>Năm {y}</option>
                                        ))}
                                    </select>

                                    {/* Clear filter */}
                                    {(month || year || search || level || team || (!isLockedSingle && workspace)) && (
                                        <button onClick={() => { setMonth(''); setYear(''); setSearch(''); setLevel(''); setTeam(''); if (!isLockedSingle) setWorkspace(''); }}
                                            className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 font-bold transition-all ml-auto bg-red-50 hover:bg-red-100 px-4 py-2 rounded-lg border border-red-200 shadow-sm">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                            Xóa bộ lọc
                                        </button>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="flex flex-col">
                                        <label className="text-xs font-bold text-slate-500 mb-1">Từ ngày</label>
                                        <input 
                                            type="date"
                                            value={startDate}
                                            onChange={e => setStartDate(e.target.value)}
                                            className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white shadow-sm transition-all"
                                        />
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-xs font-bold text-slate-500 mb-1">Đến ngày</label>
                                        <input 
                                            type="date"
                                            value={endDate}
                                            onChange={e => setEndDate(e.target.value)}
                                            className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white shadow-sm transition-all"
                                        />
                                    </div>
                                    
                                    {(startDate || endDate) && (
                                        <button onClick={() => { setStartDate(''); setEndDate(''); }}
                                            className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 font-bold transition-all mt-5 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-lg border border-red-200 shadow-sm">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                            Xóa
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Table */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm relative">
                        {isLoading && (
                            <div className="absolute inset-0 z-50 bg-white/60 backdrop-blur-[2px] flex items-center justify-center rounded-xl">
                                <div className="flex flex-col items-center gap-3">
                                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                    <p className="text-sm font-semibold text-blue-900">Đang tải dữ liệu...</p>
                                </div>
                            </div>
                        )}
                        <div className="overflow-x-auto overflow-y-auto max-h-[60vh] relative">
                            <table className="w-full text-xs text-[#0f172a] whitespace-nowrap">
                                {activeTab === 'KPItotal' ? (
                                    <>
                                        <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
                                            <tr className="divide-x divide-slate-200">
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-12 bg-slate-50">STT</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 min-w-[200px]">Display Name</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Level</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Workspace</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Team</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("manday_total")}>
                                                    Manday <span className="ml-1 opacity-60">{sortConfig.key === 'manday_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_avg")}>
                                                    Trung bình KPI <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_avg' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_bonus")}>
                                                    KPI Bonus <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_bonus' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-blue-600 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_total")}>
                                                    Tổng KPI <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 border-t border-slate-200">
                                            {sortedMembers.map((m, idx) => (
                                                <tr key={m.id} className="hover:bg-slate-50/60 transition-colors group divide-x divide-slate-200">
                                                    <td className="px-4 py-3 text-slate-400 font-medium w-12 text-center">{idx + 1}</td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2.5">
                                                            <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px] border border-blue-100 group-hover:bg-blue-100 transition-colors">{m.display_name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-600 font-medium">{m.team || '-'}</td>
                                                    <td className="px-4 py-3 text-slate-600 font-medium">{m.workspace || '-'}</td>
                                                    <td className="px-4 py-3 text-slate-600 font-medium">{m.department || '-'}</td>
                                                    <td className={`px-4 py-3 text-center font-semibold tabular-nums ${(m.manday_total || 0) === 0 ? 'text-red-500' : 'text-slate-600'}`}>{(m.manday_total || 0).toFixed(1)}</td>
                                                    <td className={`px-4 py-3 text-center font-semibold tabular-nums ${(m.kpi_avg || 0) === 0 ? 'text-red-500' : 'text-slate-600'}`}>{m.kpi_avg || 0}</td>
                                                    <td className={`px-4 py-3 text-center font-semibold tabular-nums ${(m.kpi_bonus || 0) === 0 ? 'text-red-500' : 'text-slate-600'}`}>{m.kpi_bonus || 0}</td>
                                                    <td className={`px-4 py-3 text-center font-extrabold tabular-nums ${(m.kpi_total || 0) === 0 ? 'text-red-500' : 'text-blue-600'}`}>{m.kpi_total || 0}</td>
                                                </tr>
                                            ))}
                                            {members.length === 0 && (
                                                <tr>
                                                    <td colSpan={9} className="text-center py-16 text-slate-400 font-medium">
                                                        Đang tải danh sách thành viên...
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </>
                                ) : (
                                    <>
                                        <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
                                            <tr className="divide-x divide-slate-200">
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-12 bg-slate-50">STT</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 min-w-[200px]">Display Name</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("manday_est_total")}>
                                                    (P) MANDAY EST <span className="ml-1 opacity-60">{sortConfig.key === 'manday_est_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("manday_total")}>
                                                    (P) MANDAY ACTUAL <span className="ml-1 opacity-60">{sortConfig.key === 'manday_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_base_total")}>
                                                    (P) KPI EST <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_base_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_total")}>
                                                    (P) KPI ACTUAL <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_total' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors group/th" onClick={() => handleSort("kpi_achieved")}>
                                                    (P) % KPI ACHIEVED <span className="ml-1 opacity-60">{sortConfig.key === 'kpi_achieved' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                                                </th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">
                                                    (P) TASKS PROGRESS
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 border-t border-slate-200">
                                            {sortedMembers.map((m, idx) => {
                                                const md_est = m.manday_est_total || 0;
                                                const md_act = m.manday_total || 0;
                                                const kpi_est = m.kpi_base_total || 0;
                                                const kpi_act = m.kpi_total || 0;
                                                const achieved = kpi_est > 0 ? Math.round((kpi_act / kpi_est) * 100) : 0;
                                                return (
                                                    <tr key={m.id} className="hover:bg-slate-50/60 transition-colors group divide-x divide-slate-200">
                                                        <td className="px-4 py-3 text-slate-400 font-medium w-12 text-center">{idx + 1}</td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-2.5">
                                                                <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px] border border-blue-100 group-hover:bg-blue-100 transition-colors">{m.display_name}</span>
                                                            </div>
                                                        </td>
                                                        
                                                        <td className={`px-4 py-3 text-center font-semibold tabular-nums ${md_est === 0 ? 'text-slate-400' : 'text-slate-600'}`}>{md_est === 0 ? '0' : md_est.toFixed(1)}</td>
                                                        <td className={`px-4 py-3 text-center font-semibold tabular-nums ${md_act === 0 ? 'text-slate-400' : 'text-slate-600'}`}>{md_act === 0 ? '0' : md_act.toFixed(1)}</td>
                                                        <td className={`px-4 py-3 text-center font-semibold tabular-nums ${kpi_est === 0 ? 'text-slate-400' : 'text-slate-600'}`}>{kpi_est === 0 ? '0' : kpi_est.toFixed(2)}</td>
                                                        <td className={`px-4 py-3 text-center font-semibold tabular-nums ${kpi_act === 0 ? 'text-slate-400' : 'text-slate-600'}`}>{kpi_act === 0 ? '0' : kpi_act.toFixed(2)}</td>
                                                        
                                                        <td className={`px-4 py-3 text-center font-bold tabular-nums ${achieved === 0 ? 'text-slate-400' : (achieved >= 100 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50')}`}>
                                                            {`${achieved}%`}
                                                        </td>
                                                        
                                                        <td className="px-4 py-3 text-center font-semibold text-slate-400">-</td>
                                                    </tr>
                                                );
                                            })}
                                            {members.length === 0 && (
                                                <tr>
                                                    <td colSpan={8} className="text-center py-16 text-slate-400 font-medium">
                                                        Đang tải danh sách thành viên...
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </>
                                )}
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}