import { ForgotForm } from './forgot-form';

// Which login sent the user here — whitelisted so `?back=` can't be used as an
// open redirect. Defaults to the student login. Only the logins that actually
// link to THIS shared page are listed: student /login, /driver/login and
// /aevinite/login. Agency has its own /agency/forgot, so /agency/login never
// routes here and is deliberately omitted.
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
