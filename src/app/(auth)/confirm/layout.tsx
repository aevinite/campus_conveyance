import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Confirming your account',
  description: 'Finishing sign-in for your Campus Conveyance account.',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
