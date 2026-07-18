import { AuthShell } from '@/components/auth/auth-shell';

export default function DriverAuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthShell>{children}</AuthShell>;
}
