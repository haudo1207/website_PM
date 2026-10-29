// The Portal Access JWT lives ONLY in frontend memory — it is never persisted
// to localStorage/sessionStorage. The refresh session is a server-side
// HttpOnly cookie managed by the backend.
let accessToken: string | null = null;

export const setToken = (t: string | null) => {
  accessToken = t;
};

export const saveToken = (t: string, r: string, n: string, avatar?: string | null, email?: string | null, userId?: number | null, memberId?: number | null) => {
  if (typeof window === 'undefined') return;
  accessToken = t;
  localStorage.setItem('role', r);
  localStorage.setItem('name', n);
  if (avatar) localStorage.setItem('avatar', avatar);
  else localStorage.removeItem('avatar');
  if (email) localStorage.setItem('email', email);
  else localStorage.removeItem('email');
  if (userId) localStorage.setItem('user_id', String(userId));
  else localStorage.removeItem('user_id');
  if (memberId) localStorage.setItem('member_id', String(memberId));
  else localStorage.removeItem('member_id');
};

export const getToken = () => accessToken;
export const getRole = () => typeof window !== 'undefined' ? localStorage.getItem('role') : null;
export const getName = () => typeof window !== 'undefined' ? localStorage.getItem('name') : null;
export const getEmail = () => typeof window !== 'undefined' ? localStorage.getItem('email') : null;
export const getAvatar = () => typeof window !== 'undefined' ? localStorage.getItem('avatar') : null;
// ── 4-role model helpers ──
export const isSuperAdmin = () => {
  return getRole() === 'super_admin';
};
export const isLeader = () => getRole() === 'leader';
export const isMember = () => getRole() === 'member';
export const isViewer = () => getRole() === 'viewer';

// Manager: super_admin or leader — may perform most write operations.
export const isAdmin = () => {
  const r = getRole();
  return r === 'super_admin' || r === 'leader';
};

// super_admin, leader, or member — excludes viewer. Used for features a
// Member also needs (e.g. connecting their own Zalo account), not just
// management-tier ones.
export const isMemberOrAbove = () => {
  const r = getRole();
  return r === 'super_admin' || r === 'leader' || r === 'member';
};

// Kept for backward compatibility — maps to isAdmin().
export const isGroupA = isAdmin;

// Only an internal, same-path redirect target is ever safe to carry through
// `/login?redirect=` — a bare "/" prefix rules out absolute URLs, and "//" /
// "/\" are explicitly rejected because browsers treat both as protocol-
// relative (i.e. "//evil.com" or "/\evil.com" navigate off-site exactly like
// "https://evil.com" would). The "://" check is a second net against a value
// that slipped a scheme in some other way. Exported so login/page.tsx
// validates with this exact same rule instead of a second, driftable copy.
export function isSafeRedirectPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//') || path.startsWith('/\\')) return false;
  if (path.includes('://')) return false;
  return true;
}

// attachRedirect (chốt 2026-10-29): only the session-expiry/401 call sites
// (api.ts's refresh-failure and response-interceptor paths) pass this —
// never the user's own "Sign out" click (Navbar.tsx), which must keep
// landing back on /dashboard/overview like before. Checked as
// `=== true` rather than a truthy `if (opts)` specifically so this stays
// safe even if a caller is ever wired as a bare onClick={logout} again (a
// click handler receives the MouseEvent as its first argument, which has no
// `attachRedirect` property, so it reads as false either way).
export const logout = (opts?: { attachRedirect?: boolean }) => {
  if (typeof window === 'undefined') return;
  accessToken = null;
  // Chỉ xoá đúng identity/auth (role/name/avatar/email) - KHÔNG localStorage.
  // clear() nữa, vì đó xoá luôn mọi preference UI của user (cột ghim/ẩn/độ
  // rộng, density, sidebar thu gọn, grid/list project, ghim phase...) chỉ vì
  // họ bấm Sign out, dù các preference đó vốn không liên quan gì tới phiên
  // đăng nhập.
  localStorage.removeItem('role');
  localStorage.removeItem('name');
  localStorage.removeItem('avatar');
  localStorage.removeItem('email');
  localStorage.removeItem('user_id');
  localStorage.removeItem('member_id');
  let target = '/login';
  // Never redirect back to /login itself (would loop) — only ever attach a
  // return path for a forced logout, not a manual one.
  if (opts?.attachRedirect === true && window.location.pathname !== '/login') {
    const current = window.location.pathname + window.location.search;
    if (isSafeRedirectPath(current)) {
      target = `/login?redirect=${encodeURIComponent(current)}`;
    }
  }
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
  // Best-effort server-side revocation (works even when the Access JWT is
  // expired — the backend revokes via the HttpOnly refresh cookie).
  try {
    fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => {
        window.location.href = target;
      });
  } catch {
    window.location.href = target;
  }
};