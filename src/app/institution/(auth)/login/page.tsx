import { InstitutionLoginForm } from './institution-login-form';

export default async function InstitutionLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string }>;
}) {
  const { pending } = await searchParams;
  return <InstitutionLoginForm pending={pending === '1'} />;
}
