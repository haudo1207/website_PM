'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { restoreSession } from '@/lib/api';
import { WorkspaceFilterProvider } from '@/lib/workspaceFilter';
import { SidebarCollapseProvider } from '@/lib/sidebarCollapse';

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const isPublicPath = window.location.pathname === '/login' || window.location.pathname.startsWith('/share/project/');
        if (!isPublicPath) {
          await restoreSession();
        }
      } catch {
        // Keep existing UX: restore failures fall back to the 401 flow.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center">
        <div className="animate-spin h-8 w-8 text-[#0058be] border-2 border-[#0058be] border-t-transparent rounded-full" />
      </div>
    );
  }
  return <>{children}</>;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceFilterProvider>
        <SidebarCollapseProvider>
          <SessionBootstrap>{children}</SessionBootstrap>
        </SidebarCollapseProvider>
      </WorkspaceFilterProvider>
    </QueryClientProvider>
  );
}