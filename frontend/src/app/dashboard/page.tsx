'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getProjects, getPriorities, getStatuses } from '@/lib/api';

function DashboardContent() {
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [priorities, setPriorities] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      getProjects().then(setProjects),
      getPriorities().then(setPriorities).catch(() => {}),
      getStatuses().then(setStatuses).catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalProjects = projects.length;
  const planningCount = projects.filter(p => p.status === 'Planning').length;
  const developingCount = projects.filter(p => p.status === 'Developing').length;
  const completedCount = projects.filter(p => p.status === 'Completed').length;

  return (
    <div className="h-screen bg-[#f0f2f5] text-[#0b1c30] flex overflow-hidden" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">
        {/* Top Bar */}
        <div className="h-14 bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-8 shrink-0 z-40">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#0058be] animate-pulse" />
            <h2 className="text-sm font-bold text-[#0b1c30]">Dashboard Tổng Quan</h2>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <button
              onClick={() => {
                setLoading(true);
                getProjects().then(setProjects).finally(() => setLoading(false));
              }}
              disabled={loading}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#eff4ff] border border-[#c2c6d6]/60 hover:bg-[#0058be]/10 text-[#0058be] transition-all disabled:opacity-50"
            >
              ↻ Tải lại
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Tổng số dự án', value: totalProjects, icon: '📋', border: 'border-l-[#0058be]', text: 'text-[#0058be]' },
              { label: 'Đang Lập Kế Hoạch', value: planningCount, icon: '📅', border: 'border-l-amber-500', text: 'text-amber-600' },
              { label: 'Đang Triển Khai', value: developingCount, icon: '⚡', border: 'border-l-blue-500', text: 'text-blue-600' },
              { label: 'Đã Hoàn Thành', value: completedCount, icon: '✅', border: 'border-l-emerald-500', text: 'text-emerald-600' },
            ].map(c => (
              <div key={c.label} className={`relative overflow-hidden rounded-xl border border-[#c2c6d6]/60 border-l-4 ${c.border} bg-white p-5 shadow-sm`}>
                <div className="absolute -right-2 -top-2 text-4xl opacity-10">{c.icon}</div>
                <p className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">{c.label}</p>
                <p className={`text-3xl font-extrabold mt-2 ${c.text}`}>{c.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Project List Panel */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-[#c2c6d6]/60 p-5 shadow-sm flex flex-col space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-[#0b1c30] uppercase tracking-wider">Danh sách dự án hoạt động</h3>
                <button
                  onClick={() => router.push('/project')}
                  className="text-xs text-[#0058be] font-bold hover:underline"
                >
                  Xem tất cả
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-[#f8f9ff] text-[#565e74] border-b border-[#c2c6d6]/60 font-bold">
                      <th className="px-4 py-3">MÃ DỰ ÁN</th>
                      <th className="px-4 py-3">TÊN DỰ ÁN</th>
                      <th className="px-4 py-3">KHÁCH HÀNG</th>
                      <th className="px-4 py-3">TRẠNG THÁI</th>
                      <th className="px-4 py-3">QUẢN LÝ DỰ ÁN (PM)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-[#565e74]">
                          Đang tải dữ liệu...
                        </td>
                      </tr>
                    ) : projects.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-slate-400">
                          Chưa có dự án nào được tạo.
                        </td>
                      </tr>
                    ) : (
                      projects.slice(0, 5).map(p => (
                        <tr
                          key={p.id}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                          onClick={() => router.push(`/project/detail?id=${p.id}`)}
                        >
                          <td className="px-4 py-3 font-mono font-bold text-slate-600">{p.code || `#${p.id}`}</td>
                          <td className="px-4 py-3 font-bold text-[#0b1c30]">{p.name}</td>
                          <td className="px-4 py-3 text-slate-500">{p.customer_name || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              p.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                              p.status === 'Developing' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                              'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-700">{p.pm_name || '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Side Panel: System Categories Info */}
            <div className="bg-white rounded-xl border border-[#c2c6d6]/60 p-5 shadow-sm flex flex-col space-y-4">
              <h3 className="text-sm font-bold text-[#0b1c30] uppercase tracking-wider">Cấu hình Hệ thống</h3>
              
              <div className="space-y-3 flex-1 overflow-y-auto">
                <div>
                  <h4 className="text-xs font-bold text-[#565e74] mb-1.5">Mức độ ưu tiên (Priorities)</h4>
                  <div className="flex flex-wrap gap-2">
                    {priorities.map((p: any) => (
                      <span key={p.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-[#0b1c30] text-xs font-semibold">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || '#94a3b8' }} />
                        {p.name} (Base KPI: {p.kpi_base})
                      </span>
                    ))}
                  </div>
                </div>

                <hr className="border-slate-100" />

                <div>
                  <h4 className="text-xs font-bold text-[#565e74] mb-1.5">Trạng thái công việc (Task Statuses)</h4>
                  <div className="flex flex-wrap gap-2">
                    {statuses.map((s: any) => (
                      <span key={s.id} className="px-2.5 py-1 rounded-lg bg-[#eff4ff] text-[#0058be] text-xs font-semibold">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs">Đang tải trang...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
