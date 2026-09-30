import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Campus admin sign in',
  description: 'Sign in to oversee the routes, operators and riders serving your school or college.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
