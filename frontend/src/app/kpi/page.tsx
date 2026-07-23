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

                    {/* Bộ lọc */}
                    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm flex flex-wrap items-center gap-3">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mr-2">Lọc thời gian:</span>
                        <select 
                            value={month} 
                            onChange={e => setMonth(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-[#0f172a] outline-none focus:border-blue-500 bg-white min-w-[140px]"
                        >
                            <option value="">Tất cả các tháng</option>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                <option key={m} value={m}>Tháng {m}</option>
                            ))}
                        </select>

                        <select 
                            value={year} 
                            onChange={e => setYear(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-[#0f172a] outline-none focus:border-blue-500 bg-white min-w-[140px]"
                        >
                            <option value="">Tất cả các năm</option>
                            {[2023, 2024, 2025, 2026, 2027].map(y => (
                                <option key={y} value={y}>Năm {y}</option>
                            ))}
                        </select>

                        {(month || year) && (
                            <button onClick={() => { setMonth(''); setYear(''); }}
                                className="text-xs text-slate-500 hover:text-red-600 font-medium transition-colors ml-2">
                                Xóa bộ lọc
                            </button>
                        )}
                    </div>

                    {/* Table */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-[#0f172a]">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-12">STT</th>
                                        <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Display Name</th>
                                        <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Trung bình KPI</th>
                                        <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">KPI Bonus</th>
                                        <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-blue-600">Tổng KPI</th>
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