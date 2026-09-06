'use client';

import { createContext, useContext, useEffect, useState } from 'react';

interface SidebarCollapseContextValue {
  /** Thu gọn thanh Navbar bên trái (icon-only) hay để full width - shared
   * toàn app (mirror pattern của WorkspaceFilterProvider) để mọi trang tự
   * điều chỉnh padding-left theo đúng width thật của sidebar. */
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
}

const SidebarCollapseContext = createContext<SidebarCollapseContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
});

const STORAGE_KEY = 'sidebar_collapsed';

export function SidebarCollapseProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setCollapsedState(true);
    } catch {}
  }, []);

  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch {}
  };
  const toggle = () => setCollapsed(!collapsed);

  return (
    <SidebarCollapseContext.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarCollapseContext.Provider>
  );
}

export function useSidebarCollapse() {
  return useContext(SidebarCollapseContext);
}

// Width thật của sidebar ở 2 trạng thái - các trang dùng để tính padding-left
// thay vì hard-code "pl-[230px]".
export const SIDEBAR_PAD_EXPANDED = 'md:pl-[230px]';
export const SIDEBAR_PAD_COLLAPSED = 'md:pl-[64px]';
