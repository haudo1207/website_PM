'use client';
import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import CustomersProjectsView from '@/components/CustomersProjectsView';

export default function CustomersPage() {
  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);

  const flash = (t: string, e = false) => {
    setMsg({ t, e });
    setTimeout(() => setMsg(null), 4000);
  };

  return (
    <div className="h-screen bg-[#f8fafc] text-[#0f172a] flex overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">
        {/* Flash Message */}
        {msg && (
          <div className={`fixed top-6 right-6 z-50 rounded-xl px-5 py-3 text-sm font-semibold shadow-xl border backdrop-blur-sm transition-all duration-300 transform translate-y-0 ${msg.e ? 'bg-red-50/90 text-red-700 border-red-200' : 'bg-emerald-50/90 text-emerald-700 border-emerald-200'}`}>
            {msg.t}
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-6 max-w-[1400px] w-full mx-auto space-y-6">
          <CustomersProjectsView onFlash={flash} />
        </main>
      </div>
    </div>
  );
}
