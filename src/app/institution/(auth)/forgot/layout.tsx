import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Campus admin password reset',
  description: 'Reset the password for your school or college admin account.',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
