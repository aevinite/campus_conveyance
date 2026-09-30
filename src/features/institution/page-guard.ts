import 'server-only';
import { cache } from 'react';
import { requireRole } from '@/features/auth/guard';
import { resolveInstitutionId, getCampusApproval } from './repository';

/**
 * Per-page gate for the /institution panel. The (panel) layout shows the
 * "no campus / pending / disabled" screens, but Next can serve a page segment
 * without re-running its layout (crafted RSC request), so every page checks
 * again. Returns the campus id only for a linked, live (active, not deleted)
 * campus; pages render nothing otherwise — on a normal request the layout's
 * notice is what the user sees, so there is no redirect loop.
 */
export const requireActiveCampusPage = cache(async (): Promise<string | null> => {
  await requireRole('INSTITUTION_ADMIN', '/institution/login');
  const institutionId = await resolveInstitutionId();
  if (!institutionId) return null;
  const approval = await getCampusApproval(institutionId);
  if (!approval || approval.isDeleted || !approval.isActive) return null;
  return institutionId;
});
