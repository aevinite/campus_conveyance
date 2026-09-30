import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Operator sign in',
  description: 'Sign in to manage your buses, routes, drivers and riders on Campus Conveyance.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
