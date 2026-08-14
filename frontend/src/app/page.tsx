'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await broadcastResponseToMainFrame();
      } catch {
        // no auth response in the URL; proceed with normal navigation
      }
      if (cancelled) return;
      if (getToken()) {
        router.push('/dashboard/overview');
      } else {
        router.push('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center">
      <div className="animate-spin h-8 w-8 text-[#0058be] border-2 border-[#0058be] border-t-transparent rounded-full" />
    </div>
  );
}
