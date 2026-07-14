export type PortalBrand = 'markee' | 'securityzone';

const requestedBrand = (process.env.NEXT_PUBLIC_PORTAL_BRAND || 'securityzone').toLowerCase();
export const portalBrand: PortalBrand = requestedBrand === 'markee' ? 'markee' : 'securityzone';

export const brand = portalBrand === 'markee'
  ? {
      key: 'markee' as const,
      name: 'Markee',
      productName: 'Markee Work Portal',
      subtitle: 'Project & KPI Management',
      loginSubtitle: 'Đăng nhập hệ thống quản lý công việc Markee',
      footer: '© 2026 Markee Team',
      logo: '/markee-logo.png',
    }
  : {
      key: 'securityzone' as const,
      name: 'SecurityZone',
      productName: 'SecurityZone KPI Portal',
      subtitle: 'Infrastructure · KPI Portal',
      loginSubtitle: 'Đăng nhập hệ thống giám sát SecurityZone',
      footer: '© 2026 SecurityZone Team',
      logo: '/logo.jpg',
    };
