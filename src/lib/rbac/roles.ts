export const ROLES = [
  'SUPER_ADMIN',
  'INSTITUTION_ADMIN',
  'STUDENT',
  'PARENT',
  'DRIVER',
] as const;
export type Role = (typeof ROLES)[number];

export const DASHBOARD_BY_ROLE: Record<Role, string> = {
  SUPER_ADMIN: '/super-admin',
  INSTITUTION_ADMIN: '/institution',
  STUDENT: '/student',
  PARENT: '/parent',
  DRIVER: '/driver',
};

export function dashboardFor(role: Role | undefined): string {
  return role ? DASHBOARD_BY_ROLE[role] : '/login';
}

export function roleFromClaims(appMetadata: unknown): Role | undefined {
  const r = (appMetadata as { role?: string } | null)?.role;
  return ROLES.includes(r as Role) ? (r as Role) : undefined;
}
