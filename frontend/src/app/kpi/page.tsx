'use client';
import React, { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import { useRouter } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getMembers, getTeams, getDepartments, getWorkspaces, getMe } from '@/lib/api';

export default function KPIPage() {
    const router = useRouter();
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
    const [workspaceOptions, setWorkspaceOptions] = useState<any[]>([]);
    const [teamOptions, setTeamOptions] = useState<any[]>([]);
    // Workspace data scope: for Member/Viewer the assigned Workspace is the
    // effective KPI data scope (fixed filter); other roles keep existing behavior.
    const [userRole, setUserRole] = useState("");
    const [userScope, setUserScope] = useState("");
    const isScopedUser = (userRole === 'member' || userRole === 'viewer') && userScope !== 'all';
    const lockedWorkspaceName = useMemo(() => {
        if (!isScopedUser || !userScope) return "";
        const w = workspaceOptions.find(o => (o.code || "").toLowerCase() === String(userScope).toLowerCase());
        return w ? w.name : "";
    }, [isScopedUser, userScope, workspaceOptions]);
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
        getWorkspaces().then(setWorkspaceOptions).catch(() => {});
        getDepartments().then(setTeamOptions).catch(() => {});
        getMe().then(me => { setUserRole(me.role); setUserScope(me.data_scope || ''); }).catch(() => {});
    }, []);

    // Member/Viewer: keep the Workspace filter pinned to the assigned Workspace.
    useEffect(() => {
        if (!isScopedUser) return;
        if (lockedWorkspaceName && workspace !== lockedWorkspaceName) {
            setWorkspace(lockedWorkspaceName);
        }
    }, [isScopedUser, lockedWorkspaceName, workspace]);

    const memberParams = useMemo(() => {
        const params: any = {};
        const effectiveWorkspace = isScopedUser ? lockedWorkspaceName : workspace;
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
    }, [activeTab, month, year, level, workspace, team, debouncedSearch, startDate, endDate, isScopedUser, lockedWorkspaceName]);

    const { data: members = [], isFetching: isLoading } = useQuery({
        queryKey: ['kpi-members', memberParams],
        queryFn: () => getMembers(memberParams),
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
            <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
                {/* Header */}
                <div className="h-[56px] bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-40 shadow-sm">
                    <h2 className="text-sm font-bold tracking-wider text-[#0f172a] uppercase">Thống Kê KPI Toàn Dự Án</h2>
                </div>

                {/* Tabbar Navigation */}
                <div className="bg-white border-b border-slate-200 px-8 flex gap-6 z-30">
                    <button
                        onClick={() => setActiveTab('KPItotal')}
                        className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'KPItotal'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >   Tổng hợp KPI
                    </button>
                    <button
                        onClick={() => setActiveTab('KPIweek')}
                        className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'KPIweek'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >   Tổng hợp KPI tuần
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 max-w-7xl w-full mx-auto space-y-6">

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
                                    <select 
                                        value={isScopedUser ? (lockedWorkspaceName || workspace) : workspace} 
                                        onChange={e => setWorkspace(e.target.value)}
                                        disabled={isScopedUser}
                                        title={isScopedUser ? `Workspace cố định theo tài khoản: ${lockedWorkspaceName || userScope}` : undefined}
                                        className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[140px] shadow-sm transition-all cursor-pointer hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                        {isScopedUser ? (
                                            <option value={lockedWorkspaceName || workspace}>{lockedWorkspaceName || 'Tất cả Workspace'}</option>
                                        ) : (
                                            <>
                                                <option value="">Tất cả Workspace</option>
                                                {workspaceOptions.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                                            </>
                                        )}
                                    </select>

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
                                    {(month || year || search || level || team || (!isScopedUser && workspace)) && (
                                        <button onClick={() => { setMonth(''); setYear(''); setSearch(''); setLevel(''); setTeam(''); if (!isScopedUser) setWorkspace(''); }}
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