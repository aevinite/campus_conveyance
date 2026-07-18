import { AgencyLoginForm } from './agency-login-form';

export default async function AgencyLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string }>;
}) {
  const { pending } = await searchParams;
  return <AgencyLoginForm pending={pending === '1'} />;
}
