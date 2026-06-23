'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { isAdmin, getName, logout, getRole } from '@/lib/auth';
import { useState, useEffect } from 'react';
import { getSheets } from '@/lib/api';

export default function Navbar() {
  const path = usePathname();
  const router = useRouter();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [sheets, setSheets] = useState<any[]>([]);

  useEffect(() => {
    setName(getName() ?? '');
    setRole(getRole() ?? '');
    getSheets().then(setSheets).catch(() => {});
  }, [path]);

  const rl: Record<string, string> = {
    admin: 'bg-purple-950/40 text-purple-400 border border-purple-800/60',
    group_a: 'bg-blue-950/40 text-blue-400 border border-blue-800/60',
    group_b: 'bg-green-950/40 text-green-400 border border-green-800/60'
  };

  const nav = [
    { href: '/dashboard', label: 'Dashboard', icon: '📊' },
    { href: '/sheets', label: 'My Sheets', icon: '📁' },
    { href: '/settings', label: 'Settings', icon: '🛠️', show: role === 'admin' }
  ].filter(n => n.show !== false);

  const dotColors = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#06b6d4', '#f97316'];

  return (
    <aside className="w-[230px] flex-shrink-0 bg-[#1a1d27] border-r border-[#2e3250] flex flex-col fixed top-0 bottom-0 left-0 z-50 overflow-y-auto text-[#e2e8f0]">
      {/* Sidebar Logo */}
      <div className="p-4 border-b border-[#2e3250]">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-lg flex items-center justify-center text-base flex-shrink-0">
            ⚡
          </div>
          <div>
            <div className="text-sm font-bold text-[#e2e8f0]">Task Compliance</div>
            <div className="text-[10px] text-[#64748b]">SecurityZone · v2.1</div>
          </div>
        </div>
      </div>

      {/* Navigation Group: Main */}
      <nav className="flex-grow px-2.5 py-3 space-y-4">
        <div className="space-y-1">
          <div className="text-[9px] font-bold text-[#64748b] uppercase tracking-wider px-2 mb-1.5">
            Main
          </div>
          {nav.map(n => {
            const active = path === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all border border-transparent ${
                  active
                    ? 'bg-[#6366f1]/15 text-[#818cf8] border-[#6366f1]/25'
                    : 'text-[#94a3b8] hover:bg-[#22263a] hover:text-[#e2e8f0]'
                }`}
              >
                <span>{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </div>

        {/* Dynamic Project Dots */}
        <div className="space-y-1">
          <div className="text-[9px] font-bold text-[#64748b] uppercase tracking-wider px-2 mb-1.5">
            Dự án & Sheets
          </div>
          <Link
            href="/dashboard?project=all"
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#94a3b8] hover:bg-[#22263a] hover:text-[#e2e8f0]"
          >
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#6366f1' }} />
            Tất cả dự án
          </Link>
          {sheets.map((s, idx) => (
            <Link
              key={s.id}
              href={`/dashboard?project=${s.id}`}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#94a3b8] hover:bg-[#22263a] hover:text-[#e2e8f0] group"
            >
              <div className="flex items-center gap-2.5 truncate">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: dotColors[idx % dotColors.length] }}
                />
                <span className="truncate">{s.name}</span>
              </div>
            </Link>
          ))}
        </div>
      </nav>

      {/* User Information & Sign Out Bottom Area */}
      <div className="p-3 border-t border-[#2e3250] bg-[#151821] space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#2a2f47] border border-[#2e3250] flex items-center justify-center text-xs font-bold uppercase text-[#818cf8]">
            {name ? name.substring(0, 2) : 'US'}
          </div>
          <div className="truncate flex-grow">
            <div className="text-[11px] font-bold text-[#e2e8f0] truncate">{name || 'User'}</div>
            <div className="flex items-center mt-0.5">
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${rl[role] ?? 'bg-[#2a2f47] text-[#94a3b8]'}`}>
                {role || 'member'}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full text-center py-1.5 rounded-md bg-[#22263a] hover:bg-red-950/40 text-xs font-bold text-[#94a3b8] hover:text-red-400 transition-colors border border-[#2e3250]"
        >
          Sign out
        </button>
        <div className="text-[9px] text-[#64748b] text-center pt-1">
          © 2026 SecurityZone Team
        </div>
      </div>
    </aside>
  );
}
