import Link from 'next/link';
import {
  GraduationCap,
  BookOpen,
  ShieldCheck,
  Users,
  ChevronDown,
  ArrowRight,
  LifeBuoy,
  Sparkles,
} from 'lucide-react';
import { StatTile } from '@/components/ui/stat-tile';
import { trustHighlights, faqs } from '@/lib/marketing-content';
import type { PublicStats } from '@/lib/public-stats';

const nf = (n: number) => n.toLocaleString('en-IN');

/**
 * The pre-booking info block shown on the student & parent home ONLY while the
 * rider has no active pass — platform stats, trust/safety highlights, a short
 * FAQ, and a Help & Support entry. Once they book, the dashboard switches to the
 * focused pass/live-bus view, so this never becomes post-booking clutter.
 * Presentational server component; works on web and (compact) in the app.
 */
export function PreBookingInfo({
  role,
  stats,
  helpHref,
  compact = false,
}: {
  role: 'student' | 'parent';
  stats: PublicStats;
  helpHref: string;
  compact?: boolean;
}) {
  const subtitle =
    role === 'parent'
      ? 'Verified operators, live tracking and clear payments — so you always know how your child gets to campus.'
      : 'Verified operators, live tracking and clear payments for your everyday ride to campus.';
  const trust = compact ? trustHighlights.slice(0, 4) : trustHighlights;
  const faqItems = faqs.slice(0, compact ? 3 : 4);

  return (
    <div className="space-y-6">
      {/* Platform stats band */}
      <section className="space-y-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <Sparkles className="size-3.5" /> Why Campus Conveyance
          </p>
          <h2 className={`mt-1 font-bold tracking-tight ${compact ? 'text-lg' : 'text-xl sm:text-2xl'}`}>
            Everything for the daily campus commute
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={<GraduationCap className="size-[1.125rem]" />} label="Colleges" value={nf(stats.colleges)} />
          <StatTile icon={<BookOpen className="size-[1.125rem]" />} label="Schools" value={nf(stats.schools)} />
          <StatTile icon={<ShieldCheck className="size-[1.125rem]" />} label="Verified agencies" value={nf(stats.providers)} />
          <StatTile icon={<Users className="size-[1.125rem]" />} label="Riders onboard" value={nf(stats.users)} />
        </div>
      </section>

      {/* Trust & safety highlights */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {trust.map((t) => (
          <div key={t.title} className="rounded-2xl border border-border bg-card p-4">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <t.icon className="size-5" />
            </span>
            <h3 className="mt-2.5 text-sm font-semibold">{t.title}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{t.desc}</p>
          </div>
        ))}
      </section>

      {/* FAQ preview + Help & Support */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          <h3 className="text-base font-bold tracking-tight">Common questions</h3>
          {faqItems.map((f) => (
            <details
              key={f.question}
              className="group rounded-xl border border-border bg-card px-4 py-3"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                {f.question}
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.answer}</p>
            </details>
          ))}
        </div>

        {/* Help & Support card */}
        <Link
          href={helpHref}
          className="hover-lift flex flex-col justify-between gap-4 rounded-2xl border border-primary/30 bg-primary/[0.06] p-5"
        >
          <div>
            <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
              <LifeBuoy className="size-6" />
            </span>
            <h3 className="mt-3 text-base font-bold tracking-tight">Help &amp; Support</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Read the full FAQ or message our team — we&apos;re here if you get stuck.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            Get help <ArrowRight className="size-4" />
          </span>
        </Link>
      </section>
    </div>
  );
}
