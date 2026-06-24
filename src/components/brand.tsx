import Link from 'next/link';
import { Bus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({
  className,
  href = '/',
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link href={href} className={cn('flex items-center gap-2 font-semibold', className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Bus className="size-5" />
      </span>
      <span className="tracking-tight">
        Campus <span className="text-primary">Conveyance</span>
      </span>
    </Link>
  );
}
