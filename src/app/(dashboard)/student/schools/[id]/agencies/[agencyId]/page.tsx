import { redirect } from 'next/navigation';
import { requireRole } from '@/features/auth/guard';

// Legacy per-agency route page. The booking flow was redesigned into one flat
// list of every ride at a campus (/student/schools/[id]), so this drill-down is
// no longer part of the flow — but old bookmarks/links still hit it. Redirect
// them to the current page instead of rendering a stale parallel UI (which
// risked duplicate toasts / a second booking entry point).
export default async function LegacyAgencyRoutesPage({
  params,
}: {
  params: Promise<{ id: string; agencyId: string }>;
}) {
  await requireRole('STUDENT');
  const { id } = await params;
  redirect(`/student/schools/${id}`);
}
