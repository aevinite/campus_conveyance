'use client';
import { useState } from 'react';
import { School, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Kind } from '@/features/catalog/repository';

/**
 * Renders an institution's logo as a rounded tile. Falls back gracefully:
 * real logo image → the institution's initials → a school/college icon, so the
 * banner never shows a broken image.
 */
export function InstitutionLogo({
  name,
  kind,
  imageUrl,
  className,
  iconClassName,
}: {
  name: string;
  kind: Kind;
  imageUrl: string | null;
  className?: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  const Icon = kind === 'COLLEGE' ? GraduationCap : School;

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5',
        className,
      )}
    >
      {imageUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={`${name} logo`}
          onError={() => setFailed(true)}
          className="size-[70%] object-contain"
        />
      ) : initials ? (
        <span className="font-heading font-bold text-primary" style={{ fontSize: '38%' }}>
          {initials}
        </span>
      ) : (
        <Icon className={cn('text-primary', iconClassName)} />
      )}
    </span>
  );
}
