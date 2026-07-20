import { ForgotForm } from './forgot-form';

// Which login sent the user here — whitelisted so `?back=` can't be used as an
// open redirect. Defaults to the student login.
const ALLOWED_BACK = new Set(['/login', '/driver/login', '/aevinite/login']);

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string }>;
}) {
  const { back } = await searchParams;
  const backHref = back && ALLOWED_BACK.has(back) ? back : '/login';
  return <ForgotForm back={backHref} />;
}
