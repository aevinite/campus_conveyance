import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin sign in',
  description: 'Platform administration.',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
