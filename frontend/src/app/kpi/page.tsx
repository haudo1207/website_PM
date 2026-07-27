'use client';
import React, { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { useRouter } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getMembers, getTeams, getPositions, getDepartments } from '@/lib/api';

export default function KPIPage() {
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [activeTab, setActiveTab] = useState<'KPItotal' | 'KPIweek'>('KPItotal');
    const [members, setMembers] = useState<any[]>([]);
    const [search, setSearch] = useState("");
    const [month, setMonth] = useState("");
    const [year, setYear] = useState("");
    const [team, setTeam] = useState("");
    const [position, setPosition] = useState("");
    const [department, setDepartment] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    
    const [teamOptions, setTeamOptions] = useState<any[]>([]);
    const [positionOptions, setPositionOptions] = useState<any[]>([]);
    const [deptOptions, setDeptOptions] = useState<any[]>([]);

    useEffect(() => {
        getTeams().then(setTeamOptions).catch(() => {});
        getPositions().then(setPositionOptions).catch(() => {});
        getDepartments().then(setDeptOptions).catch(() => {});
    }, []);

    useEffect(() => {
        if (!isAdmin()) {
            router.push('/dashboard');
        } else {
            setAuthorized(true);
            const params: any = {};
            if (activeTab === 'KPItotal') {
                if (month) params.month = parseInt(month);
                if (year) params.year = parseInt(year);
                if (team) params.team = team;
                if (position) params.position = position;
                if (department) params.department = department;
                if (search) params.search = search;
            } else {
                if (startDate) params.start_date = startDate;
                if (endDate) params.end_date = endDate;
            }
            getMembers(params).then(setMembers).catch(() => { });
        }
    }, [router, activeTab, month, year, team, position, department, search, startDate, endDate]);

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

                                    {/* Team */}
                                    <select 
                                        value={team} 
                                        onChange={e => setTeam(e.target.value)}
                                        className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[140px] shadow-sm transition-all cursor-pointer hover:border-blue-300"
                                    >
                                        <option value="">Tất cả Team</option>
                                        {teamOptions.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                                    </select>

                                    {/* Position */}
                                    <select 
                                        value={position} 
                                        onChange={e => setPosition(e.target.value)}
                                        className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[140px] shadow-sm transition-all cursor-pointer hover:border-blue-300"
                                    >
                                        <option value="">Tất cả Chức vụ</option>
                                        {positionOptions.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>

                                    {/* Department */}
                                    <select 
                                        value={department} 
                                        onChange={e => setDepartment(e.target.value)}
                                        className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[160px] shadow-sm transition-all cursor-pointer hover:border-blue-300"
                                    >
                                        <option value="">Tất cả Phòng ban</option>
                                        {deptOptions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
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
                                    {(month || year || search || team || position || department) && (
                                        <button onClick={() => { setMonth(''); setYear(''); setSearch(''); setTeam(''); setPosition(''); setDepartment(''); }}
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
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                        <div className="overflow-x-auto overflow-y-auto max-h-[60vh] relative">
                            <table className="w-full text-xs text-[#0f172a] whitespace-nowrap">
                                {activeTab === 'KPItotal' ? (
                                    <>
                                        <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
                                            <tr className="divide-x divide-slate-200">
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-12 bg-slate-50">STT</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 min-w-[200px]">Display Name</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Team</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Chức vụ</th>
                                                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Phòng ban</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Manday</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Trung bình KPI</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">KPI Bonus</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-blue-600 bg-slate-50">Tổng KPI</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 border-t border-slate-200">
                                            {members.map((m, idx) => (
                                                <tr key={m.id} className="hover:bg-slate-50/60 transition-colors group divide-x divide-slate-200">
                                                    <td className="px-4 py-3 text-slate-400 font-medium w-12 text-center">{idx + 1}</td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2.5">
                                                            <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px] border border-blue-100 group-hover:bg-blue-100 transition-colors">{m.display_name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-600 font-medium">{m.team || '-'}</td>
                                                    <td className="px-4 py-3 text-slate-600 font-medium">{m.position || '-'}</td>
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
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">(P) MANDAY EST</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">(P) MANDAY ACTUAL</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">(P) KPI EST</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">(P) KPI ACTUAL</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">(P) % KPI ACHIEVED</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">(P) TASKS PROGRESS</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 border-t border-slate-200">
                                            {members.map((m, idx) => {
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
                                                            {achieved === 0 ? '' : `${achieved}%`}
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