import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Register your school or college',
  description: 'Bring your campus onto Campus Conveyance to see which operators serve it and who rides each day.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
