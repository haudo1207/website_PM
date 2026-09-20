'use client';

import { createContext, useContext, useState } from 'react';

interface WorkspaceFilterContextValue {
  /** Selected Workspace code, or null for "All workspaces". Shared across
   * Navbar / Dashboard / KPI so picking a workspace in any one of them
   * updates the others instead of each keeping its own disconnected filter. */
  workspaceCode: string | null;
  setWorkspaceCode: (code: string | null) => void;
}

const WorkspaceFilterContext = createContext<WorkspaceFilterContextValue>({
  workspaceCode: null,
  setWorkspaceCode: () => {},
});

const STORAGE_KEY = 'selected_workspace_code';

export function WorkspaceFilterProvider({ children }: { children: React.ReactNode }) {
  // Lazy-initialized from localStorage instead of via a useEffect — every
  // page sharing this context (Dashboard, KPI, Navbar) otherwise rendered
  // its first pass with workspaceCode=null (unscoped/wrong), then corrected
  // itself a tick later once the effect read the real stored value. Reading
  // it synchronously on first render removes that "loads wrong, then fixes
  // itself" flash across all of them at once.
  const [workspaceCode, setWorkspaceCodeState] = useState<string | null>(
    () => (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null)
  );

  const setWorkspaceCode = (code: string | null) => {
    setWorkspaceCodeState(code);
    if (typeof window !== 'undefined') {
      if (code) localStorage.setItem(STORAGE_KEY, code);
      else localStorage.removeItem(STORAGE_KEY);
    }
  };

  return (
    <WorkspaceFilterContext.Provider value={{ workspaceCode, setWorkspaceCode }}>
      {children}
    </WorkspaceFilterContext.Provider>
  );
}

export function useWorkspaceFilter() {
  return useContext(WorkspaceFilterContext);
}
