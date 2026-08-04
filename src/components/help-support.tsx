import Link from 'next/link';
import {
  LifeBuoy,
  ChevronDown,
  Ticket,
  History,
  UserRound,
  MessageSquare,
  ArrowRight,
  MapPin,
  CreditCard,
  Users,
} from 'lucide-react';
import { faqs } from '@/lib/marketing-content';
import { SupportContactForm } from '@/components/support-contact-form';

type QuickLink = { href: string; label: string; icon: typeof Ticket };

/**
 * Help & Support page content, shared by /student/help and /parent/help. Full
 * FAQ, a "message us" form (reuses the landing contact action), and quick links.
 * Presentational server component; the contact form is the one client island.
 */
export function HelpSupport({
  role,
  name = '',
  email = '',
}: {
  role: 'student' | 'parent';
  name?: string;
  email?: string;
}) {
  const base = role === 'parent' ? '/parent' : '/student';
  const quickLinks: QuickLink[] =
    role === 'parent'
      ? [
          { href: '/parent', label: 'Your children & bookings', icon: Users },
          { href: '/parent/history', label: 'Booking history', icon: History },
          { href: '/parent/profile', label: 'Profile & settings', icon: UserRound },
        ]
      : [
          { href: '/student/bookings', label: 'My bookings', icon: Ticket },
          { href: '/student/history', label: 'Booking history', icon: History },
          { href: '/student/profile', label: 'Profile & settings', icon: UserRound },
        ];

  const tips = [
    { icon: MapPin, title: 'Live tracking', body: 'The live bus map appears on your home while the driver is online for your ride.' },
    { icon: CreditCard, title: 'Payments & refunds', body: `Pay by UPI within the payment window to confirm a seat. Cancel from ${role === 'parent' ? "your child's booking" : 'My bookings'} — if you already paid, request a refund while cancelling.` },
    role === 'parent'
      ? { icon: Users, title: 'Linking a child', body: 'Add a managed child, or link an existing student account with the 6-digit code from their profile.' }
      : { icon: Users, title: 'Parent access', body: 'Share the 6-digit code from your profile so a parent can follow your daily commute.' },
  ];

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <LifeBuoy className="size-6" />
        </span>
        <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Help &amp; Support</h1>
        <p className="mt-1 text-muted-foreground">
          Answers to common questions, and a direct line to our team.
        </p>
      </header>

      {/* Quick help tips */}
      <section className="grid gap-3 sm:grid-cols-3">
        {tips.map((t) => (
          <div key={t.title} className="rounded-2xl border border-border bg-card p-4">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <t.icon className="size-5" />
            </span>
            <h3 className="mt-2.5 text-sm font-semibold">{t.title}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{t.body}</p>
          </div>
        ))}
      </section>

      {/* Quick links */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold tracking-tight">Jump to</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {quickLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="hover-lift flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-foreground">
                <l.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium">{l.label}</span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold tracking-tight">Frequently asked</h2>
        <div className="space-y-2">
          {faqs.map((f) => (
            <details key={f.question} className="group rounded-xl border border-border bg-card px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                {f.question}
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.answer}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <MessageSquare className="size-5 text-primary" /> Still need help?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Send us a message and we&apos;ll reply to your email.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <SupportContactForm defaultName={name} defaultEmail={email} />
        </div>
      </section>

      <div>
        <Link
          href={base}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/70"
        >
          <ArrowRight className="size-4 rotate-180" /> Back to dashboard
        </Link>
      </div>
    </div>
  );
}
