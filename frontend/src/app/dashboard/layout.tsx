'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { ReactNode, useEffect, useState } from 'react';
import { isSuperAdmin, isLeader, isViewer } from '@/lib/auth';

type Tab = 'report' | 'overview' | 'system-audit';

const ALL_TABS: { id: Tab; label: string; path: string }[] = [
  { id: 'overview',     label: 'Overview',     path: '/dashboard/overview' },
  { id: 'report',       label: 'Report',       path: '/dashboard/report' },
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
    // Viewer is read-only on Report; the Dashboard Overview tab is not
    // available to Viewer because it surfaces Leader / Member-scoped
    // KPI Matrix + Leader Cards + Project Overview that have no meaning
    // for a Viewer account.
    const canOverview = !isViewer();

    const filtered = ALL_TABS.filter(t => {
      if (t.id === 'system-audit') return canAudit;
      if (t.id === 'overview') return canOverview;
      return true;
    });

    setAllowedTabs(filtered);

    // Permission guard — Viewer attempting to reach Overview directly is
    // bounced back to Report (the only Dashboard tab available to them).
    if (pathname.includes('/overview') && !canOverview) {
      router.replace('/dashboard/report');
    }
    if (pathname.includes('/system-audit') && !canAudit) {
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
      <div className="flex-1 min-w-0 pl-0 md:pl-[230px] pt-14 md:pt-0 flex flex-col h-screen overflow-hidden">
        {/* Top Bar */}
        <div className="h-14 bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-4 md:px-8 shrink-0 z-30 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-2 h-2 rounded-full bg-[#0058be] animate-pulse shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-[#0b1c30] leading-none">Dashboard</h2>
              <p className="text-[10px] text-slate-400 mt-0.5 truncate">{tabSubtitle[activeTab]}</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 shrink-0">
            <span>📅</span>
            <span className="font-semibold">Tháng {currentDateStr}</span>
          </div>
        </div>

        {/* Tab Bar — Strictly filtered by user role permissions */}
        <div className="bg-white border-b border-slate-200 px-4 md:px-8 flex gap-4 md:gap-6 shrink-0 z-20 overflow-x-auto">
          {allowedTabs.map(tab => (
            <Link
              key={tab.id}
              href={tab.path}
              scroll={false}
              prefetch={true}
              className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
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
        <div className="flex-1 min-w-0 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
