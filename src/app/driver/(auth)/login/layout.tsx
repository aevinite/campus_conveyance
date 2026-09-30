import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Driver sign in',
  description: "Sign in to start your route, share your bus location and see today's riders.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
