'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { isAdmin, getName, logout, getRole } from '@/lib/auth';
import { useState, useEffect, Suspense } from 'react';
import { getSheets } from '@/lib/api';

function NavbarContent() {
  const path = usePathname();
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [sheets, setSheets] = useState<any[]>([]);

  useEffect(() => {
    setName(getName() ?? '');
    setRole(getRole() ?? '');
    getSheets().then(setSheets).catch(() => {});
  }, [path]);

  const currentProjId = searchParams.get('project');

  const nav = [
    { href: '/dashboard', label: 'Dashboard', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )},
    { href: '/project', label: 'Projects', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    )},
    { href: '/settings', label: 'Settings', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ), show: role === 'admin' },
  ].filter(n => n.show !== false);

  return (
    <aside className="w-[230px] flex-shrink-0 bg-primary border-r border-border/50 flex flex-col fixed top-0 bottom-0 left-0 z-50 overflow-y-auto">

      {/* Logo */}
      <div className="p-5 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
            ⚡
          </div>
          <div>
            <div className="text-sm font-extrabold text-text-primary tracking-tight leading-none">Plane.so</div>
            <div className="text-[10px] text-text-secondary font-semibold mt-0.5">SecurityZone · v2.1</div>
          </div>
        </div>
      </div>

      {/* Nav Links */}
      <nav className="px-3 py-4 space-y-1 shrink-0">
        {nav.map(n => {
          const active = path === n.href;
          return (
            <Link key={n.href} href={n.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
                active
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-secondary hover:bg-secondary hover:text-text-primary'
              }`}>
              {n.icon}
              {n.label}
            </Link>
          );
        })}
      </nav>

      {/* Projects Section */}
      <div className="flex-grow px-3 py-2 space-y-1 overflow-y-auto no-scrollbar border-t border-border/30 pt-4">
        <div className="flex items-center justify-between px-3 mb-2 shrink-0">
          <span className="text-[10px] font-bold text-text-secondary/60 uppercase tracking-wider">Projects</span>
          <Link href="/projects/new" className="text-text-secondary/60 hover:text-accent p-0.5 rounded transition-colors" title="Tạo dự án mới">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </Link>
        </div>
        <div className="space-y-0.5">
          {sheets.map(s => {
            const href = `/dashboard?project=${s.id}`;
            const active = path === '/dashboard' && currentProjId === String(s.id);
            return (
              <Link key={s.id} href={href}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all truncate ${
                  active
                    ? 'bg-accent/10 text-accent border-l-2 border-accent rounded-l-none pl-2.5'
                    : 'text-text-secondary hover:bg-secondary hover:text-text-primary'
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-accent' : 'bg-text-secondary/40'}`} />
                <span className="truncate">{s.name || 'Unnamed'}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* User */}
      <div className="p-3 border-t border-border/50 space-y-2.5">
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-xs font-bold text-accent uppercase">
            {name ? name.substring(0, 2) : 'US'}
          </div>
          <div className="truncate flex-grow">
            <div className="text-[11px] font-bold text-text-primary truncate">{name || 'User'}</div>
            <div className="text-[9px] text-text-secondary uppercase font-bold tracking-wider">{role || 'member'}</div>
          </div>
        </div>
        <button onClick={logout}
          className="w-full text-center py-1.5 rounded-lg bg-secondary hover:bg-danger/10 text-xs font-semibold text-text-secondary hover:text-danger transition-colors border border-border/50">
          Sign out
        </button>
        <div className="text-[9px] text-slate-600 text-center">© 2026 SecurityZone Team</div>
      </div>
    </aside>
  );
}

export default function Navbar() {
  return (
    <Suspense fallback={<aside className="w-[230px] shrink-0 bg-[#12141c] border-r border-[#2e3250]/50" />}>
      <NavbarContent />
    </Suspense>
  );
}
