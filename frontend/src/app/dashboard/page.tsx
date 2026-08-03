'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import SystemAuditView from '@/components/SystemAuditView';
import { getProjects, getPriorities, getStatuses } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

function DashboardContent() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'system_audit'>('overview');
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [priorities, setPriorities] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      getProjects().then(setProjects),
      getPriorities().then(setPriorities).catch(() => { }),
      getStatuses().then(setStatuses).catch(() => { }),
    ])
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  const totalProjects = projects.length;
  const planningCount = projects.filter(p => p.status === 'Planning').length;
  const developingCount = projects.filter(p => p.status === 'Developing').length;
  const completedCount = projects.filter(p => p.status === 'Completed').length;

  const showAdminAuditTab = isAdmin();

  return (
    <div className="h-screen bg-[#f0f2f5] text-[#0b1c30] flex overflow-hidden" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">
        {/* Top Bar */}
        <div className="h-14 bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-8 shrink-0 z-40">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#0058be] animate-pulse" />
              <h2 className="text-sm font-bold text-[#0b1c30]">Dashboard</h2>
            </div>

            {/* Admin Sub-Tabs Navigation */}
            {showAdminAuditTab && (
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                    activeTab === 'overview'
                      ? 'bg-white text-[#0058be] shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  📊 Overview
                </button>
                <button
                  onClick={() => setActiveTab('system_audit')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                    activeTab === 'system_audit'
                      ? 'bg-slate-900 text-amber-400 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  🛡️ System Audit
                </button>
              </div>
            )}
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

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'system_audit' && showAdminAuditTab ? (
            <SystemAuditView />
          ) : (
            <div className="space-y-6">
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
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#0b1c30]">Danh sách dự án ({projects.length})</h3>
                    <button
                      onClick={() => router.push('/projects/new')}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#0058be] text-white hover:bg-[#0058be]/90 transition-all shadow-sm"
                    >
                      + Tạo dự án mới
                    </button>
                  </div>

                  {loading ? (
                    <div className="py-8 text-center text-xs text-[#565e74]">Đang tải dự án...</div>
                  ) : projects.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#565e74]">Chưa có dự án nào.</div>
                  ) : (
                    <div className="divide-y divide-slate-100 overflow-y-auto max-h-[420px]">
                      {projects.map(p => (
                        <div
                          key={p.id}
                          onClick={() => router.push(`/project/detail?id=${p.id}`)}
                          className="py-3 px-2 flex items-center justify-between hover:bg-[#eff4ff]/50 rounded-lg cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-lg">📁</span>
                            <div>
                              <p className="text-xs font-bold text-[#0b1c30]">{p.name}</p>
                              <p className="text-[11px] text-[#565e74]">{p.customer_name || 'Chưa chọn khách hàng'} • BU: {p.business || 'All'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              p.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' :
                              p.status === 'Developing' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                            }`}>
                              {p.status}
                            </span>
                            <span className="text-slate-400 text-xs">→</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick System Info Panel */}
                <div className="bg-white rounded-xl border border-[#c2c6d6]/60 p-5 shadow-sm flex flex-col space-y-4">
                  <h3 className="text-sm font-bold text-[#0b1c30]">Cấu hình hệ thống</h3>

                  <div>
                    <h4 className="text-xs font-bold text-[#565e74] mb-1.5">Độ ưu tiên (Priorities)</h4>
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
          )}
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
