export const ROLES = [
  'SUPER_ADMIN',
  'INSTITUTION_ADMIN',
  'STUDENT',
  'PARENT',
  'DRIVER',
  'AGENCY',
] as const;
export type Role = (typeof ROLES)[number];

export const DASHBOARD_BY_ROLE: Record<Role, string> = {
  SUPER_ADMIN: '/aevinite',
  INSTITUTION_ADMIN: '/institution',
  STUDENT: '/student',
  PARENT: '/parent',
  DRIVER: '/driver',
  AGENCY: '/agency',
};

export function dashboardFor(role: Role | undefined): string {
  return role ? DASHBOARD_BY_ROLE[role] : '/login';
}

// Canonical login screen per role — the single source of truth shared by the
// dashboard guards (requireRole loginPath) and post-reset redirects, so the two
// gates never disagree on where a given role signs in. Admin + institution
// admin both use the admin (aevinite) login.
export const LOGIN_BY_ROLE: Record<Role, string> = {
  SUPER_ADMIN: '/aevinite/login',
  INSTITUTION_ADMIN: '/aevinite/login',
  STUDENT: '/login',
  PARENT: '/login',
  DRIVER: '/driver/login',
  AGENCY: '/agency/login',
};

export function loginFor(role: Role | undefined): string {
  return role ? LOGIN_BY_ROLE[role] : '/login';
}

export function roleFromClaims(appMetadata: unknown): Role | undefined {
  const r = (appMetadata as { role?: string } | null)?.role;
  return ROLES.includes(r as Role) ? (r as Role) : undefined;
}
