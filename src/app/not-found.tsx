import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Logo } from '@/components/brand';
import { buttonVariants } from '@/components/ui/button';

// Branded 404 — replaces Next.js's bare default for any unmatched route.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo />
      <div className="max-w-md space-y-3">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Compass className="size-7" />
        </span>
        <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has moved. Let&apos;s get you back on route.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        <Link href="/" className={buttonVariants()}>
          Back to home
        </Link>
        <Link href="/login" className={buttonVariants({ variant: 'outline' })}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
