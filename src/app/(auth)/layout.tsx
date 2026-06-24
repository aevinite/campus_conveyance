import { Logo } from '@/components/brand';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(55% 45% at 50% 0%, oklch(0.83 0.17 85 / 0.16), transparent 70%)',
        }}
      />
      <div className="mb-8">
        <Logo />
      </div>
      {children}
    </div>
  );
}
