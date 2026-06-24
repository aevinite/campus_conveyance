'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Bus, GraduationCap, ShieldCheck, Building2, ArrowRight } from 'lucide-react';
import { Logo } from '@/components/brand';

const roles = [
  {
    key: 'user',
    title: 'Student / User',
    desc: 'Find your campus, book a seat on a bus or van, and manage your trips.',
    icon: GraduationCap,
    href: '/login',
    cta: 'Continue as User',
    primary: true,
  },
  {
    key: 'agency',
    title: 'Agency',
    desc: 'Service providers: list your buses and vans, routes and seats.',
    icon: Bus,
    href: '/login',
    cta: 'Agency portal',
    primary: false,
  },
  {
    key: 'admin',
    title: 'Admin',
    desc: 'Manage campuses, agencies, students and the platform.',
    icon: ShieldCheck,
    href: '/login',
    cta: 'Admin portal',
    primary: false,
  },
];

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* warm amber glow backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 50% at 50% -10%, oklch(0.83 0.17 85 / 0.18), transparent 70%), radial-gradient(40% 40% at 90% 10%, oklch(0.7 0.15 60 / 0.12), transparent 70%)',
        }}
      />
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Logo />
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
          Sign in
        </Link>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="max-w-3xl space-y-5"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
            <Building2 className="size-3.5 text-primary" /> For schools &amp; colleges
          </span>
          <h1 className="text-balance text-5xl font-bold tracking-tight sm:text-7xl">
            Safe Travel,
            <br />
            The <span className="text-primary">Campus Conveyance.</span>
          </h1>
          <p className="mx-auto max-w-xl text-pretty text-lg text-muted-foreground">
            Book and track school and college transport in one place — buses and
            vans, live seat availability, secure payments.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut', delay: 0.12 }}
          className="mt-12 grid w-full max-w-4xl gap-5 sm:grid-cols-3"
        >
          {roles.map((r) => (
            <Link
              key={r.key}
              href={r.href}
              className={`group flex flex-col items-start gap-3 rounded-2xl border p-6 text-left transition-all hover:-translate-y-1 ${
                r.primary
                  ? 'border-primary/40 bg-primary/10 hover:bg-primary/15'
                  : 'border-border bg-card/60 hover:bg-card'
              }`}
            >
              <span
                className={`grid size-11 place-items-center rounded-xl ${
                  r.primary
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-foreground'
                }`}
              >
                <r.icon className="size-6" />
              </span>
              <h2 className="text-lg font-semibold">{r.title}</h2>
              <p className="text-sm text-muted-foreground">{r.desc}</p>
              <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-medium text-primary">
                {r.cta}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </motion.div>
      </section>
    </main>
  );
}
