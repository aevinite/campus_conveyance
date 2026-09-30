import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create a Campus Conveyance account to book a seat for your regular daily ride to school or college.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
