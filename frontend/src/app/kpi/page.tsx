'use client';
import React, { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { useRouter } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getMembers } from '@/lib/api';

export default function KPIPage() {
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [activeTab, setActiveTab] = useState<'overview'>('overview');
    const [members, setMembers] = useState<any[]>([]);
    const [search, setSearch] = useState("");
    const [month, setMonth] = useState("");
    const [year, setYear] = useState("");

    useEffect(() => {
        if (!isAdmin()) {
            router.push('/dashboard');
        } else {
            setAuthorized(true);
            const params: any = {};
            if (month) params.month = parseInt(month);
            if (year) params.year = parseInt(year);
            getMembers(params).then(setMembers).catch(() => { });
        }
    }, [router, month, year]);

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
                        onClick={() => setActiveTab('overview')}
                        className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'overview'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >   Tổng hợp KPI
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
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl px-5 py-4 shadow-sm flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                            </svg>
                            <span className="text-sm font-bold text-blue-800 uppercase tracking-wider">Bộ lọc thời gian:</span>
                        </div>
                        <select 
                            value={month} 
                            onChange={e => setMonth(e.target.value)}
                            className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[160px] shadow-sm transition-all cursor-pointer hover:border-blue-300"
                        >
                            <option value="">Tất cả các tháng</option>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                <option key={m} value={m}>Tháng {m}</option>
                            ))}
                        </select>

                        <select 
                            value={year} 
                            onChange={e => setYear(e.target.value)}
                            className="border-2 border-blue-200 rounded-lg px-4 py-2 text-sm font-semibold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 bg-white min-w-[160px] shadow-sm transition-all cursor-pointer hover:border-blue-300"
                        >
                            <option value="">Tất cả các năm</option>
                            {[2023, 2024, 2025, 2026, 2027].map(y => (
                                <option key={y} value={y}>Năm {y}</option>
                            ))}
                        </select>

                        {(month || year) && (
                            <button onClick={() => { setMonth(''); setYear(''); }}
                                className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 font-bold transition-all ml-auto bg-red-50 hover:bg-red-100 px-4 py-2 rounded-lg border border-red-200 shadow-sm">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Xóa bộ lọc
                            </button>
                        )}
                    </div>

                    {/* Table */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                        <div className="overflow-x-auto overflow-y-auto max-h-[60vh] relative">
                            <table className="w-full text-xs text-[#0f172a] whitespace-nowrap">
                                <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
                                    <tr>
                                        <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-12 bg-slate-50">STT</th>
                                        <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 min-w-[200px]">Display Name</th>
                                        <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">Trung bình KPI</th>
                                        <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">KPI Bonus</th>
                                        <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-blue-600 bg-slate-50">Tổng KPI</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {members.map((m, idx) => (
                                        <tr key={m.id} className="hover:bg-slate-50/60 transition-colors group">
                                            <td className="px-4 py-3 text-slate-400 font-medium w-12 text-center">{idx + 1}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px] border border-blue-100 group-hover:bg-blue-100 transition-colors">{m.display_name}</span>
                                                </div>
                                            </td>
                                            <td className={`px-4 py-3 text-center font-semibold tabular-nums ${(m.kpi_avg || 0) === 0 ? 'text-red-500' : 'text-slate-600'}`}>{m.kpi_avg || 0}</td>
                                            <td className={`px-4 py-3 text-center font-semibold tabular-nums ${(m.kpi_bonus || 0) === 0 ? 'text-red-500' : 'text-slate-600'}`}>{m.kpi_bonus || 0}</td>
                                            <td className={`px-4 py-3 text-center font-extrabold tabular-nums ${(m.kpi_total || 0) === 0 ? 'text-red-500' : 'text-blue-600'}`}>{m.kpi_total || 0}</td>
                                        </tr>
                                    ))}
                                    {members.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="text-center py-16 text-slate-400 font-medium">
                                                Đang tải danh sách thành viên...
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}