// The Portal Access JWT lives ONLY in frontend memory — it is never persisted
// to localStorage/sessionStorage. The refresh session is a server-side
// HttpOnly cookie managed by the backend.
let accessToken: string | null = null;

export const setToken = (t: string | null) => {
  accessToken = t;
};

export const saveToken = (t: string, r: string, n: string, avatar?: string | null, email?: string | null) => {
  if (typeof window === 'undefined') return;
  accessToken = t;
  localStorage.setItem('role', r);
  localStorage.setItem('name', n);
  if (avatar) localStorage.setItem('avatar', avatar);
  else localStorage.removeItem('avatar');
  if (email) localStorage.setItem('email', email);
  else localStorage.removeItem('email');
};

export const getToken = () => accessToken;
export const getRole = () => typeof window !== 'undefined' ? localStorage.getItem('role') : null;
export const getName = () => typeof window !== 'undefined' ? localStorage.getItem('name') : null;
export const getEmail = () => typeof window !== 'undefined' ? localStorage.getItem('email') : null;
export const getAvatar = () => typeof window !== 'undefined' ? localStorage.getItem('avatar') : null;
// ── 4-role model helpers ──
export const isSuperAdmin = () => {
  const r = getRole();
  return r === 'super_admin' || r === 'admin';
};
export const isLeader = () => getRole() === 'leader';
export const isMember = () => getRole() === 'member';
export const isViewer = () => getRole() === 'viewer';

// Manager: super_admin, admin or leader — may perform most write operations.
export const isAdmin = () => {
  const r = getRole();
  return r === 'super_admin' || r === 'admin' || r === 'leader';
};

// Kept for backward compatibility — maps to isAdmin().
export const isGroupA = isAdmin;
export const logout = () => {
  if (typeof window === 'undefined') return;
  accessToken = null;
  localStorage.clear();
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
  // Best-effort server-side revocation (works even when the Access JWT is
  // expired — the backend revokes via the HttpOnly refresh cookie).
  try {
    fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => {
        window.location.href = '/login';
      });
  } catch {
    window.location.href = '/login';
  }
};