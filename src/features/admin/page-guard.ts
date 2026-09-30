import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/features/auth/guard';
import { isActiveSuperAdmin } from './guard';

/**
 * Per-page gate for the /aevinite panel. The (panel) layout guard is not enough
 * on its own: Next can serve a page segment without re-running its layout (e.g.
 * a crafted RSC request), so every admin page calls this before reading data.
 * Wrong role → their own dashboard (requireRole); a demoted / removed admin
 * whose JWT still says SUPER_ADMIN → the admin login (DB check). Cached, so the
 * layout + page share one lookup per request.
 */
export const requireSuperAdminPage = cache(async (): Promise<void> => {
  await requireRole('SUPER_ADMIN', '/aevinite/login');
  if (!(await isActiveSuperAdmin())) redirect('/aevinite/login');
});
