import { isAppRequest } from '@/lib/app-context';
import { StudentLogin } from '@/components/auth/student-login';
import { AppLogin } from '@/components/auth/app-login';

export default async function LoginPage() {
  // Inside the native app, show the User / Agency chooser; in a browser, show the
  // normal user login form (the landing page already routes agencies/drivers to
  // their own portals there).
  const app = await isAppRequest();
  return app ? <AppLogin /> : <StudentLogin />;
}
