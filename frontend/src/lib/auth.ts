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
export const isAdmin = () => getRole() === 'admin';
export const isGroupA = () => ['admin', 'group_a'].includes(getRole() ?? '');
export const logout = () => {
  if (typeof window === 'undefined') return;
  localStorage.clear();
  window.location.href = '/login';
};
