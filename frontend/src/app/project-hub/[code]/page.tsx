'use client';
import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import ProjectListContent from '@/components/ProjectListContent';
import CustomersProjectsView from '@/components/CustomersProjectsView';
import { getWorkspaces, Workspace } from '@/lib/api';

type Tab = 'projects' | 'customers';

function TabBar({ code, wsName, active }: { code: string; wsName: string; active: Tab }) {
  const router = useRouter();
  const pill = (tab: Tab, label: string, icon: string) => (
    <button
      onClick={() => router.push(`/project-hub/${code}${tab === 'projects' ? '' : `?tab=${tab}`}`)}
      className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
        active === tab ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
      }`}
    >
      <span>{icon}</span> {label}
    </button>
  );
  return (
    <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 shrink-0">
      {pill('projects', 'Projects', '📁')}
      {pill('customers', 'Customers', '🏢')}
    </div>
  );
}

function CustomersTabPage({ code, wsName }: { code: string; wsName: string }) {
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
          <TabBar code={code} wsName={wsName} active="customers" />
          <CustomersProjectsView onFlash={flash} lockedWorkspace={code} />
        </main>
      </div>
    </div>
  );
}

function ProjectHubWorkspaceInner() {
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = String(params.code || '').toLowerCase();
  const tab: Tab = searchParams.get('tab') === 'customers' ? 'customers' : 'projects';

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => getWorkspaces(),
    staleTime: 5 * 60_000,
  });
  const list: Workspace[] = workspaces || [];
  const ws = list.find(w => w.code === code);

  useEffect(() => {
    if (isLoading) return;
    if (!ws) {
      router.replace(list.length > 0 ? `/project-hub/${list[0].code}` : '/project-hub');
    }
  }, [isLoading, ws, list, router]);

  if (isLoading || !ws) {
    return (
      <div className="min-h-screen flex bg-[#f8fafc]">
        <Navbar />
        <div className="flex-1 pl-[230px] flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (tab === 'customers') {
    return <CustomersTabPage code={ws.code} wsName={ws.name} />;
  }

  return (
    <ProjectListContent
      lockedWorkspace={ws.code}
      renderTabs={() => <TabBar code={ws.code} wsName={ws.name} active="projects" />}
    />
  );
}

export default function ProjectHubWorkspacePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f8fafc]" />}>
      <ProjectHubWorkspaceInner />
    </Suspense>
  );
}
