import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to manage your daily campus bus pass, see your bus live and check your pickup stop.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
