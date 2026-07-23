import Link from 'next/link';
import { Compass } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

// Scoped 404 body for nested route groups. Unlike the root not-found (a full
// branded screen), this renders INSIDE the group's layout chrome, so each panel
// keeps its sidebar/header and offers a role-correct way back.
export function RouteNotFound({
  homeHref,
  homeLabel,
}: {
  homeHref: string;
  homeLabel: string;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="max-w-md space-y-3">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Compass className="size-7" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
      </div>
      <Link href={homeHref} className={buttonVariants()}>
        {homeLabel}
      </Link>
    </div>
  );
}
