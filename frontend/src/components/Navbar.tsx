'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { getAvatar, getName, logout, getRole, isAdmin, isSuperAdmin } from '@/lib/auth';
import { useState, useEffect, Suspense } from 'react';
import { getSidebarTree, getProjects, getCustomers, getWorkspaces, Workspace } from '@/lib/api';
import { brand } from '@/lib/brand';

interface CustomerNode {
  id: number | null;
  name: string;
  project_count: number;
}

interface YearNode {
  year: number;
  project_count: number;
  customers: CustomerNode[];
}

function NavbarContent() {
  const path = usePathname();
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [role, setRole] = useState('');

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeBU, setActiveBU] = useState<string>('');
  const [expandedYearBU, setExpandedYearBU] = useState<Record<string, number | null>>({});
  const [customerSearchBU, setCustomerSearchBU] = useState<Record<string, string>>({});
  const [treeDataBU, setTreeDataBU] = useState<Record<string, YearNode[]>>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setName(getName() ?? '');
    setAvatar(getAvatar() ?? '');
    setRole(getRole() ?? '');
    getWorkspaces()
      .then(ws => {
        setWorkspaces(ws || []);
        setActiveBU(prev => prev || (ws?.[0]?.code || ''));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeBU) return;
    getSidebarTree(activeBU)
      .then((data: YearNode[]) => {
        setTreeDataBU(prev => ({ ...prev, [activeBU]: data || [] }));
      })
      .catch(() => {
        // Fallback calculation if API fails
        Promise.all([getCustomers(activeBU), getProjects()]).then(([custs, projs]) => {
          const yearMap = new Map<number, Map<string, CustomerNode>>();
          (projs || []).forEach((p: any) => {
            const yr = p.year || new Date().getFullYear();
            const cName = p.customer_name ? p.customer_name.trim() : 'Khác';
            const cId = p.customer_id || null;
            if (!yearMap.has(yr)) yearMap.set(yr, new Map());
            const cMap = yearMap.get(yr)!;
            const key = cName.toLowerCase();
            if (cMap.has(key)) {
              cMap.get(key)!.project_count += 1;
            } else {
              cMap.set(key, { id: cId, name: cName, project_count: 1 });
            }
          });
          const fallbackData: YearNode[] = Array.from(yearMap.entries())
            .sort((a, b) => b[0] - a[0])
            .map(([yr, cMap]) => {
              const custsList = Array.from(cMap.values()).sort((a, b) => a.name.localeCompare(b.name));
              const total = custsList.reduce((sum, c) => sum + c.project_count, 0);
              return { year: yr, project_count: total, customers: custsList };
            });
          setTreeDataBU(prev => ({ ...prev, [activeBU]: fallbackData }));
        });
      });
  }, [activeBU, path]);

  const currentParamYear = searchParams.get('year');
  const currentCustId = searchParams.get('customer_id');
  const currentCustName = searchParams.get('customer');

  const toggleYear = (year: number) => {
    setExpandedYearBU(prev => ({
      ...prev,
      [activeBU]: prev[activeBU] === year ? null : year
    }));
  };

  const nav = [
    { href: '/projects', label: 'Projects', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    )},
    { href: '/kpi', label: 'KPI', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ) },
    { href: '/meetings', label: 'Meetings', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    )},
    { href: '/leave-request', label: 'Leave Request', icon: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 2h6a1 1 0 011 1v1h2a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2V3a1 1 0 011-1zm0 2v1h6V4H9zm1.5 9l2 2 4-4"/>
    </svg>
    )},
    { href: '/accounts', label: 'Accounts', icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    ), show: isAdmin() },
  ].filter(n => n.show !== false);

  const renderTreeContent = () => {
    const currentTreeData = treeDataBU[activeBU] || [];
    const currentExpandedYear = expandedYearBU[activeBU];
    const currentSearch = customerSearchBU[activeBU] || '';
    const searchLow = currentSearch.trim().toLowerCase();

    return currentTreeData.map(yNode => {
      const matchingCusts = yNode.customers.filter(c =>
        !searchLow || c.name.toLowerCase().includes(searchLow)
      );

      if (searchLow && matchingCusts.length === 0) return null;

      const isExpanded = searchLow ? true : (currentExpandedYear === yNode.year);

      return (
        <div key={yNode.year} className="space-y-1 mb-2">
          {/* Year Header */}
          <button
            onClick={() => toggleYear(yNode.year)}
            className="flex items-center justify-between w-full px-2 py-1 rounded hover:bg-slate-800/80 transition-colors text-left group"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[9px] text-slate-400 font-bold w-3">
                {isExpanded ? '▼' : '▶'}
              </span>
              <span className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors">
                {yNode.year}
              </span>
            </div>
            <span className="text-[10px] font-bold text-slate-500 bg-slate-800 px-1.5 py-0.2 rounded-full">
              {yNode.project_count}
            </span>
          </button>

          {/* Nested Customer List */}
          {isExpanded && (
            <div className="pl-3.5 space-y-0.5 border-l border-slate-800/80 ml-2.5">
              {matchingCusts.map(c => {
                const href = c.id
                  ? `/projects?year=${yNode.year}&customer_id=${c.id}&business_unit=${activeBU}`
                  : `/projects?year=${yNode.year}&customer=${encodeURIComponent(c.name)}&business_unit=${activeBU}`;

                const isItemActive = (path === '/projects' || path === '/project') &&
                  currentParamYear === String(yNode.year) &&
                  ((currentCustId && currentCustId === String(c.id)) || (currentCustName && currentCustName.toLowerCase() === c.name.toLowerCase()));

                return (
                  <Link
                    key={c.id || c.name}
                    href={href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-between px-2.5 py-1 rounded-md text-xs font-medium transition-all truncate ${
                      isItemActive
                        ? 'bg-indigo-600/20 text-indigo-300 border-l-2 border-indigo-500 rounded-l-none pl-2'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isItemActive ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                      <span className="truncate">{c.name}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-bold ml-1 shrink-0">({c.project_count})</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  };

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

          {/* Dashboard single link */}
          {(() => {
            const active = path.startsWith('/dashboard');
            return (
              <Link href="/dashboard/overview"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
                  active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Dashboard
              </Link>
            );
          })()}

          {nav.map(n => {
            const active = path === n.href || (n.href === '/customers' && path.startsWith('/customers')) || (n.href === '/projects' && (path === '/projects' || path === '/project')) || (n.href === '/leave-request' && path.startsWith('/leave-request'));
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

        {/* Projects Tree Section */}
        <div className="flex-grow px-3 py-2 space-y-2 overflow-y-auto no-scrollbar border-t border-slate-800/60 pt-4">
          <div className="flex items-center justify-between px-2 mb-1 shrink-0">
            <Link href="/customers" className="text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors flex items-center gap-1.5" title="Mở trang Quản lý Khách hàng">
              <span>🏢</span> CUSTOMERS
            </Link>
          </div>

          {/* Workspace Tabs Switcher (from Workspace Master) */}
          <div className="flex bg-slate-900/90 p-0.5 rounded-lg border border-slate-800 my-2">
            {workspaces.length === 0 ? (
              <span className="flex-1 text-[10px] font-bold py-1 rounded-md text-slate-500 text-center">No Workspaces</span>
            ) : (
              workspaces.map(ws => (
                <button
                  key={ws.code}
                  onClick={() => setActiveBU(ws.code)}
                  className={`flex-1 text-[10px] font-bold py-1 rounded-md transition-all ${
                    activeBU === ws.code
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {ws.name}
                </button>
              ))
            )}
          </div>

          {/* Quick Search Input */}
          <div className="relative px-1 mb-2">
            <input
              type="text"
              placeholder="🔍 Search Customer..."
              value={customerSearchBU[activeBU] || ''}
              onChange={e => {
                const val = e.target.value;
                setCustomerSearchBU(prev => ({ ...prev, [activeBU]: val }));
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-[11px] text-slate-300 placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Tree View */}
          <div className="space-y-1">
            {renderTreeContent()}
          </div>
        </div>

        {/* User Profile Footer Section */}
        <div className="p-3 border-t border-slate-800 space-y-2.5">
          <Link
            href="/profile"
            className={`flex items-center gap-2.5 -mx-1 px-1 py-1 rounded-lg transition-colors ${
              path === '/profile' ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            {avatar ? (
              <img src={avatar} alt={`${name || 'User'} avatar`} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover border border-white/10" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/10 border border-white/5 flex items-center justify-center text-xs font-bold text-white uppercase">
                {name ? name.substring(0, 2) : 'US'}
              </div>
            )}
            <div className="truncate flex-grow">
              <div className="text-[11px] font-bold text-white truncate">{name || 'User'}</div>
              <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">{
                role === 'super_admin' ? 'Super Admin' :
                role === 'leader' ? 'Team Leader' :
                role === 'viewer' ? 'Viewer' :
                role || 'Member'
              }</div>
            </div>
          </Link>

          {/* Settings (Admin/Super Admin only) */}
          {(isSuperAdmin() || isAdmin() || role === 'super_admin' || role === 'admin') && (
            <Link
              href="/settings"
              className={`flex items-center justify-center gap-2 w-full py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                path.startsWith('/settings')
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/60'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Settings</span>
            </Link>
          )}

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
            const active = path === n.href || (n.href === '/customers' && path.startsWith('/customers')) || (n.href === '/projects' && (path === '/projects' || path === '/project')) || (n.href === '/leave-request' && path.startsWith('/leave-request'));
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

        {/* Mobile Projects Tree Section */}
        <div className="flex-grow px-3 py-2 space-y-2 overflow-y-auto no-scrollbar border-t border-slate-800/60 pt-4">
          <div className="flex items-center justify-between px-2 mb-1 shrink-0">
            <Link href="/customers" onClick={() => setMobileMenuOpen(false)} className="text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors flex items-center gap-1.5" title="Mở trang Quản lý Khách hàng">
              <span>🏢</span> CUSTOMERS
            </Link>
          </div>

          {/* Mobile Workspace Tabs Switcher */}
          <div className="flex bg-slate-900/90 p-0.5 rounded-lg border border-slate-800 my-2">
            {workspaces.length === 0 ? (
              <span className="flex-1 text-[10px] font-bold py-1 rounded-md text-slate-500 text-center">No Workspaces</span>
            ) : (
              workspaces.map(ws => (
                <button
                  key={ws.code}
                  onClick={() => setActiveBU(ws.code)}
                  className={`flex-1 text-[10px] font-bold py-1 rounded-md transition-all ${
                    activeBU === ws.code
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {ws.name}
                </button>
              ))
            )}
          </div>

          <div className="relative px-1 mb-2">
            <input
              type="text"
              placeholder="🔍 Search Customer..."
              value={customerSearchBU[activeBU] || ''}
              onChange={e => {
                const val = e.target.value;
                setCustomerSearchBU(prev => ({ ...prev, [activeBU]: val }));
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-[11px] text-slate-300 placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div className="space-y-1">
            {renderTreeContent()}
          </div>
        </div>

        {/* Mobile User */}
        <div className="p-3 border-t border-slate-800 space-y-2.5">
          <Link
            href="/profile"
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center gap-2.5 -mx-1 px-1 py-1 rounded-lg transition-colors ${
              path === '/profile' ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            {avatar ? (
              <img src={avatar} alt={`${name || 'User'} avatar`} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover border border-white/10" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/10 border border-white/5 flex items-center justify-center text-xs font-bold text-white uppercase">
                {name ? name.substring(0, 2) : 'US'}
              </div>
            )}
            <div className="truncate flex-grow">
              <div className="text-[11px] font-bold text-white truncate">{name || 'User'}</div>
              <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">{
                role === 'super_admin' ? 'Super Admin' :
                role === 'leader' ? 'Team Leader' :
                role === 'viewer' ? 'Viewer' :
                role || 'Member'
              }</div>
            </div>
          </Link>

          {/* Settings (Admin/Super Admin only) */}
          {(isSuperAdmin() || isAdmin() || role === 'super_admin' || role === 'admin') && (
            <Link
              href="/settings"
              onClick={() => setMobileMenuOpen(false)}
              className={`flex items-center justify-center gap-2 w-full py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                path.startsWith('/settings')
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/60'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Settings</span>
            </Link>
          )}

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
