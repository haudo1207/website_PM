'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { ReactNode, useEffect, useState } from 'react';
import { isSuperAdmin, isLeader } from '@/lib/auth';

type Tab = 'report' | 'overview' | 'system-audit';

const ALL_TABS: { id: Tab; label: string; path: string }[] = [
  { id: 'report',       label: 'Report',       path: '/dashboard/report' },
  { id: 'overview',     label: 'Overview',     path: '/dashboard/overview' },
  { id: 'system-audit', label: 'System Audit', path: '/dashboard/system-audit' },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [allowedTabs, setAllowedTabs] = useState<{ id: Tab; label: string; path: string }[]>([
    { id: 'report', label: 'Report', path: '/dashboard/report' }
  ]);

  useEffect(() => {
    const canAudit = isSuperAdmin();
    const canOverview = isLeader() || isSuperAdmin();

    const filtered = ALL_TABS.filter(t => {
      if (t.id === 'system-audit') return canAudit;
      if (t.id === 'overview') return canOverview;
      return true;
    });

    setAllowedTabs(filtered);

    // Permission guard
    if (pathname.includes('/system-audit') && !canAudit) {
      router.replace('/dashboard/report');
    } else if (pathname.includes('/overview') && !canOverview) {
      router.replace('/dashboard/report');
    }
  }, [pathname, router]);

  let activeTab: Tab = 'report';
  if (pathname === '/dashboard/overview' || pathname === '/dashboard/leader') {
    activeTab = 'overview';
  } else if (pathname === '/dashboard/system-audit' || pathname === '/dashboard/super-admin') {
    activeTab = 'system-audit';
  } else {
    activeTab = 'report';
  }

  const tabSubtitle: Record<Tab, string> = {
    report:         'Dashboard hiệu suất & công việc cá nhân',
    overview:       'Dashboard quản lý & Audit log dành cho Team Leader',
    'system-audit': 'Dashboard kiểm toán hệ thống dành cho Sys Admin',
  };

  const currentDateStr = new Date().toLocaleDateString('vi-VN', { month: 'numeric', year: 'numeric' });

  return (
    <div className="h-screen bg-[#f0f2f5] text-[#0b1c30] flex overflow-hidden" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">
        {/* Top Bar */}
        <div className="h-14 bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-8 shrink-0 z-40">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#0058be] animate-pulse" />
            <div>
              <h2 className="text-sm font-bold text-[#0b1c30] leading-none">Dashboard</h2>
              <p className="text-[10px] text-slate-400 mt-0.5">{tabSubtitle[activeTab]}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span>📅</span>
            <span className="font-semibold">Tháng {currentDateStr}</span>
          </div>
        </div>

        {/* Tab Bar — Strictly filtered by user role permissions */}
        <div className="bg-white border-b border-slate-200 px-8 flex gap-6 shrink-0 z-30">
          {allowedTabs.map(tab => (
            <Link
              key={tab.id}
              href={tab.path}
              scroll={false}
              prefetch={true}
              className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'border-[#0058be] text-[#0058be]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
