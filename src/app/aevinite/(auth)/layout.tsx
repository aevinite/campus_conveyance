import { AuthShell } from '@/components/auth/auth-shell';

export default function AdminAuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthShell>{children}</AuthShell>;
}
