import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Operator password reset',
  description: 'Reset the password for your transport agency account.',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
