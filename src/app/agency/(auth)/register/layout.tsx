import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Register your transport agency',
  description: 'List your buses and routes on Campus Conveyance and manage daily campus riders in one place.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
