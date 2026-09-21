export type PortalBrand = 'markee' | 'securityzone' | 'timetech';

const requestedBrand = (process.env.NEXT_PUBLIC_PORTAL_BRAND || 'securityzone').toLowerCase();
export const portalBrand: PortalBrand =
  requestedBrand === 'markee' ? 'markee'
    : requestedBrand === 'timetech' ? 'timetech'
    : 'securityzone';

const BRANDS: Record<PortalBrand, {
  key: PortalBrand;
  name: string;
  productName: string;
  subtitle: string;
  loginSubtitle: string;
  footer: string;
  logo: string;
}> = {
  markee: {
    key: 'markee',
    name: 'Markee',
    productName: 'Markee Work Portal',
    subtitle: 'Project & KPI Management',
    loginSubtitle: 'Đăng nhập hệ thống quản lý công việc Markee',
    footer: '© 2026 Markee Team',
    logo: '/markee-logo.png',
  },
  securityzone: {
    key: 'securityzone',
    name: 'SecurityZone',
    productName: 'SecurityZone KPI Portal',
    subtitle: 'Infrastructure · KPI Portal',
    loginSubtitle: 'Đăng nhập hệ thống giám sát SecurityZone',
    footer: '© 2026 SecurityZone Team',
    logo: '/logo.jpg',
  },
  timetech: {
    key: 'timetech',
    name: 'TimeTech',
    productName: 'TimeTech Work Portal',
    subtitle: 'Project & KPI Management',
    loginSubtitle: 'Đăng nhập hệ thống quản lý công việc TimeTech',
    footer: '© 2026 TimeTech Team',
    logo: '/timetech-logo.jpg',
  },
};

export const brand = BRANDS[portalBrand];
