'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import ProjectListContent from '@/components/ProjectListContent';
import CustomersProjectsView from '@/components/CustomersProjectsView';
import { getWorkspaces, Workspace } from '@/lib/api';

type Tab = 'projects' | 'customers';

/**
 * Project Hub entry point — shows only the Workspace(s) the current user is
 * granted (GET /system-categories/workspaces already enforces this
 * server-side). Auto-enters the single Workspace when there's only one;
 * when there's more than one, renders a merged, unlocked view across every
 * granted Workspace (same as the old standalone /projects page) instead of
 * forcing the user through a "pick a Workspace" screen first — the
 * Workspace filter dropdown (Projects tab) / tab switcher (Customers tab)
 * is still there to narrow down when needed.
 */
function AllWorkspacesTabBar({ active }: { active: Tab }) {
  const router = useRouter();
  const pill = (tab: Tab, label: string, icon: string) => (
    <button
      onClick={() => router.push(`/project-hub${tab === 'projects' ? '' : `?tab=${tab}`}`)}
      className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
        active === tab ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
      }`}
    >
      <span>{icon}</span> {label}
    </button>
  );
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
      <div>
        <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">Projects</h1>
        <p className="text-sm text-slate-500 mt-1">Projects và Customers trên tất cả Workspace bạn được cấp quyền</p>
      </div>
      <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 self-start sm:self-auto">
        {pill('projects', 'Projects', '📁')}
        {pill('customers', 'Customers', '🏢')}
      </div>
    </div>
  );
}

function CustomersAllPage() {
  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);
  const flash = (t: string, e = false) => { setMsg({ t, e }); setTimeout(() => setMsg(null), 4000); };

  return (
    <div className="h-screen bg-[#f8fafc] text-[#0f172a] flex overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">
        {msg && (
          <div className={`fixed top-6 right-6 z-50 rounded-xl px-5 py-3 text-sm font-semibold shadow-xl border backdrop-blur-sm transition-all duration-300 ${msg.e ? 'bg-red-50/90 text-red-700 border-red-200' : 'bg-emerald-50/90 text-emerald-700 border-emerald-200'}`}>
            {msg.t}
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-6 max-w-[1400px] w-full mx-auto space-y-6">
          <AllWorkspacesTabBar active="customers" />
          <CustomersProjectsView onFlash={flash} />
        </main>
      </div>
    </div>
  );
}

function ProjectHubInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'customers' ? 'customers' : 'projects';

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => getWorkspaces(),
    staleTime: 5 * 60_000,
  });

  const list: Workspace[] = workspaces || [];

  useEffect(() => {
    if (!isLoading && list.length === 1) {
      router.replace(`/project-hub/${list[0].code}`);
    }
  }, [isLoading, list, router]);

  if (isLoading || list.length === 1) {
    return (
      <div className="min-h-screen flex bg-[#f8fafc]">
        <Navbar />
        <div className="flex-1 pl-[230px] flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="min-h-screen flex bg-[#f8fafc]" style={{ fontFamily: "'Inter', sans-serif" }}>
        <Navbar />
        <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
          <div className="p-8 space-y-6 max-w-[1400px] w-full mx-auto">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Projects</h1>
              <p className="text-sm text-slate-500 mt-1">Chọn Workspace để xem Projects và Customers.</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <p className="text-sm text-slate-500">Tài khoản của bạn chưa được cấp quyền truy cập Workspace nào.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // More than one granted Workspace — merged, unlocked view instead of a picker screen.
  if (tab === 'customers') {
    return <CustomersAllPage />;
  }

  return <ProjectListContent renderTabs={() => <AllWorkspacesTabBar active="projects" />} />;
}

export default function ProjectHubPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f8fafc]" />}>
      <ProjectHubInner />
    </Suspense>
  );
}
