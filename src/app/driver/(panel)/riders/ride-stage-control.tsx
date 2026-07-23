'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { markRideStageAction } from '@/features/driver/actions';
import { cn } from '@/lib/utils';

const STAGES = [
  { key: 'BOARDED', label: 'Boarded', done: 'Boarded' },
  { key: 'REACHED', label: 'Reached', done: 'Reached' },
  { key: 'GOT_OFF', label: 'Got off', done: 'Got off' },
] as const;

/**
 * Per-rider journey control on the driver's "My Riders" list. One tap records a
 * stage (boarded → reached → got off); the RPC notifies the student + parents.
 * Stages up to and including the current one render as "done"; the next stage is
 * the primary action. Any stage can be re-tapped to correct a mistake.
 */
export function RideStageControl({
  bookingId,
  studentName,
  currentStage,
}: {
  bookingId: string;
  studentName: string;
  currentStage: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const currentIndex = STAGES.findIndex((s) => s.key === currentStage);

  function mark(stage: string, label: string) {
    setBusyStage(stage);
    startTransition(async () => {
      const res = await markRideStageAction(bookingId, stage);
      setBusyStage(null);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${studentName || 'Rider'} — ${label} recorded. Family notified.`);
      // No router.refresh(): markRideStageAction already revalidatePath's
      // /driver/riders, which refreshes the RSC — a second refresh was redundant.
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {STAGES.map((s, i) => {
        const done = currentIndex >= 0 && i <= currentIndex;
        const isNext = i === currentIndex + 1 || (currentIndex < 0 && i === 0);
        const isBusy = pending && busyStage === s.key;
        return (
          <button
            key={s.key}
            type="button"
            disabled={pending}
            onClick={() => mark(s.key, s.label)}
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
              done
                ? 'border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]'
                : isNext
                  ? 'border-primary bg-primary text-primary-foreground shadow-xs hover:bg-primary/90'
                  : 'border-border bg-card text-muted-foreground hover:bg-secondary/40',
            )}
            title={done ? `Marked ${s.done} — tap to re-send` : `Mark ${s.label}`}
          >
            {isBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : done ? (
              <Check className="size-3.5" />
            ) : null}
            {done ? s.done : s.label}
          </button>
        );
      })}
    </div>
  );
}
