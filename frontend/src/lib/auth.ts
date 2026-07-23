export const saveToken = (t: string, r: string, n: string, avatar?: string | null) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('token', t);
  localStorage.setItem('role', r);
  localStorage.setItem('name', n);
  if (avatar) localStorage.setItem('avatar', avatar);
  else localStorage.removeItem('avatar');
};

export const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('token') : null;
export const getRole = () => typeof window !== 'undefined' ? localStorage.getItem('role') : null;
export const getName = () => typeof window !== 'undefined' ? localStorage.getItem('name') : null;
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
  localStorage.clear();
  window.location.href = '/login';
};
