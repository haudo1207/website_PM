'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { getAvatar, getName, logout, getRole } from '@/lib/auth';
import { useState, useEffect, Suspense } from 'react';
import { getProjects } from '@/lib/api';
import { brand } from '@/lib/brand';

function NavbarContent() {
  const path = usePathname();
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [role, setRole] = useState('');
  const [sheets, setSheets] = useState<any[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setName(getName() ?? '');
    setAvatar(getAvatar() ?? '');
    setRole(getRole() ?? '');
    getProjects().then(setSheets).catch(() => {});
  }, [path]);

  const currentProjId = searchParams.get('project') || searchParams.get('id');

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
    { href: '/meetings', label: 'Meetings', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    )},
    { href: '/leave-request', label: 'Leave Request', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6" />
      </svg>
    )},
    { href: '/accounts', label: 'Accounts', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    ), show: role === 'admin' },
    { href: '/settings', label: 'Settings', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ), show: role === 'admin' },
  ].filter(n => n.show !== false);

  return (
    <>
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-[#0F172A] border-b border-slate-800 flex items-center justify-between px-4 z-50">
        <div className="flex items-center gap-2">
          <img src={brand.logo} alt={`${brand.name} logo`} className="w-6 h-6 rounded-lg flex-shrink-0 object-cover" />
          <span className="text-sm font-bold text-white">{brand.productName}</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-slate-400 hover:text-white"
        >
          {mobileMenuOpen ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Sidebar - Hidden on mobile, visible on md+ */}
      <aside className={`
        w-[230px] flex-shrink-0 bg-[#0F172A] border-r border-slate-800 flex flex-col fixed top-0 bottom-0 left-0 z-50 overflow-y-auto
        hidden md:flex
      `}>

        {/* Logo */}
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <img src={brand.logo} alt={`${brand.name} logo`} className="w-8 h-8 rounded-lg flex-shrink-0 object-cover" />
            <div>
              <div className="text-sm font-extrabold text-white tracking-tight leading-none">{brand.productName}</div>
              <div className="text-[10px] text-slate-400 font-semibold mt-0.5">{brand.subtitle}</div>
            </div>
          </div>
        </div>

        {/* Nav Links */}
        <nav className="px-3 py-4 space-y-1 shrink-0">
          {nav.map(n => {
            const active = path === n.href || (n.href === '/leave-request' && path.startsWith('/leave-request'));
            return (
              <Link key={n.href} href={n.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                {n.icon}
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* Projects Section */}
        <div className="flex-grow px-3 py-2 space-y-1 overflow-y-auto no-scrollbar border-t border-slate-800/60 pt-4">
          <div className="flex items-center justify-between px-3 mb-2 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Projects</span>
            {role === 'admin' && (
              <Link href="/projects/new" className="text-slate-400 hover:text-white hover:bg-slate-800 p-1 rounded-md transition-all duration-150 flex items-center justify-center border border-transparent hover:border-slate-700/50" title="Thêm dự án mới">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </Link>
            )}
          </div>
          <div className="space-y-0.5">
            {sheets.map(s => {
              const href = `/project/detail?id=${s.id}`;
              const active = currentProjId === String(s.id);
              return (
                <Link key={s.id} href={href}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all truncate ${
                    active
                      ? 'bg-white/10 text-white border-l-2 border-indigo-500 rounded-l-none pl-2.5'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-indigo-500' : 'bg-slate-600'}`} />
                  <span className="truncate">{s.name || 'Unnamed'}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* User */}
        <div className="p-3 border-t border-slate-800 space-y-2.5">
          <div className="flex items-center gap-2.5 px-1">
            {avatar ? (
              <img src={avatar} alt={`${name || 'User'} avatar`} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover border border-white/10" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/10 border border-white/5 flex items-center justify-center text-xs font-bold text-white uppercase">
                {name ? name.substring(0, 2) : 'US'}
              </div>
            )}
            <div className="truncate flex-grow">
              <div className="text-[11px] font-bold text-white truncate">{name || 'User'}</div>
              <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">{role || 'member'}</div>
            </div>
          </div>
          <button onClick={logout}
            className="w-full text-center py-1.5 rounded-lg bg-slate-800 hover:bg-red-950/40 text-xs font-semibold text-slate-300 hover:text-red-400 transition-colors border border-slate-700/60">
            Sign out
          </button>
          <div className="text-[9px] text-slate-600 text-center">{brand.footer}</div>
        </div>
      </aside>

      {/* Mobile Menu Drawer */}
      <aside className={`
        md:hidden fixed top-0 left-0 bottom-0 w-[260px] bg-[#0F172A] z-50 transform transition-transform duration-300 ease-in-out
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Mobile Logo */}
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <img src={brand.logo} alt={`${brand.name} logo`} className="w-8 h-8 rounded-lg flex-shrink-0 object-cover" />
            <div>
              <div className="text-sm font-extrabold text-white tracking-tight leading-none">{brand.productName}</div>
              <div className="text-[10px] text-slate-400 font-semibold mt-0.5">{brand.subtitle}</div>
            </div>
          </div>
        </div>

        {/* Mobile Nav Links */}
        <nav className="px-3 py-4 space-y-1 shrink-0">
          {nav.map(n => {
            const active = path === n.href || (n.href === '/leave-request' && path.startsWith('/leave-request'));
            return (
              <Link key={n.href} href={n.href} onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                {n.icon}
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* Mobile Projects Section */}
        <div className="flex-grow px-3 py-2 space-y-1 overflow-y-auto no-scrollbar border-t border-slate-800/60 pt-4">
          <div className="flex items-center justify-between px-3 mb-2 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Projects</span>
            {role === 'admin' && (
              <Link href="/projects/new" className="text-slate-400 hover:text-white hover:bg-slate-800 p-1 rounded-md transition-all duration-150 flex items-center justify-center border border-transparent hover:border-slate-700/50">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </Link>
            )}
          </div>
          <div className="space-y-0.5">
            {sheets.map(s => {
              const href = `/project/detail?id=${s.id}`;
              const active = currentProjId === String(s.id);
              return (
                <Link key={s.id} href={href} onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all truncate ${
                    active
                      ? 'bg-white/10 text-white border-l-2 border-indigo-500 rounded-l-none pl-2.5'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-indigo-500' : 'bg-slate-600'}`} />
                  <span className="truncate">{s.name || 'Unnamed'}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Mobile User */}
        <div className="p-3 border-t border-slate-800 space-y-2.5">
          <div className="flex items-center gap-2.5 px-1">
            {avatar ? (
              <img src={avatar} alt={`${name || 'User'} avatar`} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover border border-white/10" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/10 border border-white/5 flex items-center justify-center text-xs font-bold text-white uppercase">
                {name ? name.substring(0, 2) : 'US'}
              </div>
            )}
            <div className="truncate flex-grow">
              <div className="text-[11px] font-bold text-white truncate">{name || 'User'}</div>
              <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">{role || 'member'}</div>
            </div>
          </div>
          <button onClick={logout}
            className="w-full text-center py-1.5 rounded-lg bg-slate-800 hover:bg-red-950/40 text-xs font-semibold text-slate-300 hover:text-red-400 transition-colors border border-slate-700/60">
            Sign out
          </button>
          <div className="text-[9px] text-slate-600 text-center">{brand.footer}</div>
        </div>
      </aside>
    </>
  );
}

export default function Navbar() {
  return (
    <Suspense fallback={<aside className="w-[230px] shrink-0 bg-[#0F172A] border-r border-slate-800 hidden md:flex" />}>
      <NavbarContent />
    </Suspense>
  );
}
