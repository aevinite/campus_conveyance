'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Ban, Loader2, Navigation, RotateCcw, Users } from 'lucide-react';
import {
  resetStopAction,
  setNextStopAction,
  skipStopAction,
} from '@/features/driver/actions';
import type { DriverRouteStop } from '@/features/driver/repository';
import { cn } from '@/lib/utils';

type Action = 'next' | 'skip' | 'reset';

/**
 * Ordered pickup-slot list for one bus/route on the driver's "Route progress"
 * page. Per stop the driver can tap "Heading here next" (marks it the current
 * target and tells riders the bus is on the way) or "Skip stop" (won't stop
 * here today — riders are redirected to the next stop in order). Either can be
 * undone. Optimism is left to the RSC refresh the actions trigger.
 */
export function RouteProgressControl({ stops }: { stops: DriverRouteStop[] }) {
  const [pending, startTransition] = useTransition();
  // Which stop+action is mid-flight, so only that button spins.
  const [busy, setBusy] = useState<string | null>(null);

  function run(action: Action, stop: DriverRouteStop) {
    setBusy(`${stop.stop_id}:${action}`);
    startTransition(async () => {
      const routeId = stop.route_id;
      const name = stop.stop_name || 'this stop';
      const res =
        action === 'next'
          ? await setNextStopAction(routeId, stop.stop_id)
          : action === 'skip'
            ? await skipStopAction(routeId, stop.stop_id)
            : await resetStopAction(routeId, stop.stop_id);
      setBusy(null);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (action === 'next') {
        toast.success(`Heading to ${name} next. Riders there notified.`);
      } else if (action === 'skip') {
        toast.success(
          res.nextStop
            ? `Skipped ${name}. Riders redirected to ${res.nextStop}.`
            : `Skipped ${name}. Riders notified (no later stop on this route).`,
        );
      } else {
        toast.success(`${name} reset.`);
      }
    });
  }

  return (
    <ol className="space-y-2.5">
      {stops.map((s) => {
        const isNext = s.status === 'NEXT';
        const isSkipped = s.status === 'SKIPPED';
        const busyNext = busy === `${s.stop_id}:next`;
        const busySkip = busy === `${s.stop_id}:skip`;
        const busyReset = busy === `${s.stop_id}:reset`;
        return (
          <li
            key={s.stop_id}
            className={cn(
              'flex flex-col gap-3 rounded-2xl border p-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between',
              isNext
                ? 'border-primary bg-primary/5'
                : isSkipped
                  ? 'border-destructive/30 bg-destructive/5'
                  : 'border-border bg-card',
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold tnum',
                  isNext
                    ? 'bg-primary text-primary-foreground'
                    : isSkipped
                      ? 'bg-destructive/15 text-destructive'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {s.sequence}
              </span>
              <div className="min-w-0 space-y-1">
                <p
                  className={cn(
                    'truncate font-medium',
                    isSkipped && 'text-muted-foreground line-through',
                  )}
                >
                  {s.stop_name || 'Unnamed stop'}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" />
                    <span className="tnum">{s.rider_count}</span> rider
                    {s.rider_count === 1 ? '' : 's'}
                  </span>
                  {isNext && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                      <Navigation className="size-3" /> Heading here next
                    </span>
                  )}
                  {isSkipped && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">
                      <Ban className="size-3" /> Skipped today
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              {isNext || isSkipped ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run('reset', s)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/40 disabled:opacity-60"
                >
                  {busyReset ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  Undo
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run('next', s)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:opacity-60"
                  >
                    {busyNext ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Navigation className="size-3.5" />
                    )}
                    Heading here next
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run('skip', s)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-destructive/40 bg-card px-3 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                  >
                    {busySkip ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Ban className="size-3.5" />
                    )}
                    Skip stop
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
