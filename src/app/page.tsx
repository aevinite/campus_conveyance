'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import {
  Bus,
  GraduationCap,
  User,
  ArrowRight,
  MapPin,
  Shield,
  Bell,
  Calendar,
  Users,
  CreditCard,
  Route,
  Van,
  ClipboardCheck,
  UserCheck,
  UserCircle,
  BarChart3,
  BookOpen,
  MessageSquare,
  ChevronDown,
  Menu,
  X,
  Building2,
  Sparkles,
} from 'lucide-react';
import { Logo } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { submitContactAction } from '@/features/contact/actions';

const roles = [
  {
    key: 'user',
    title: 'Student',
    desc: 'Find your campus, reserve a seat, and manage your daily commute.',
    icon: GraduationCap,
    href: '/login',
  },
  {
    key: 'agency',
    title: 'Agency',
    desc: 'List your buses and vans, routes and available seats.',
    icon: Bus,
    href: '/agency/login',
  },
  {
    key: 'driver',
    title: 'Driver',
    desc: 'See your route, check your riders, and update your status.',
    icon: User,
    href: '/driver/login',
  },
];

// Live stats band — values come from the database via /api/public-stats and
// refresh on a 2-minute poll, so a newly-added provider, user, or institution
// is reflected without a manual reload.
type StatKey = 'providers' | 'users' | 'colleges' | 'schools';
const STAT_ITEMS: { key: StatKey; label: string; icon: typeof Bus }[] = [
  { key: 'providers', label: 'Service providers', icon: Building2 },
  { key: 'users', label: 'Trusted users', icon: Users },
  { key: 'colleges', label: 'Colleges', icon: GraduationCap },
  { key: 'schools', label: 'Schools', icon: BookOpen },
];

const whyChooseUs = [
  { icon: MapPin, title: 'Live Vehicle Tracking', desc: 'Track buses and vans in real time on every route.' },
  { icon: Shield, title: 'Safe Transportation', desc: 'Verified drivers and continuously monitored routes.' },
  { icon: Bell, title: 'Instant Notifications', desc: 'Arrival, delay, and route alerts as they happen.' },
  { icon: Calendar, title: 'Easy Booking', desc: 'Reserve a seat for your daily route in a few steps.' },
  { icon: Users, title: 'Parent Transparency', desc: 'Parents can monitor student travel status live.' },
  { icon: CreditCard, title: 'Secure Payments', desc: 'A safe and reliable payment experience.' },
];

const howItWorks = [
  { step: 1, title: 'Register', desc: 'Create your free student account.' },
  { step: 2, title: 'Pick your campus', desc: 'Select your school or college.' },
  { step: 3, title: 'Choose transport', desc: 'Browse available buses and vans.' },
  { step: 4, title: 'Reserve a seat', desc: 'Reserve your seat on the route.' },
  { step: 5, title: 'Track live', desc: 'Follow your vehicle in real time.' },
  { step: 6, title: 'Travel safely', desc: 'Arrive on time, every time.' },
];

const features = [
  { title: 'Route Management', icon: Route, desc: 'Plan and manage transport routes efficiently.' },
  { title: 'Bus Tracking', icon: Bus, desc: 'Real-time tracking of the entire fleet.' },
  { title: 'Van Tracking', icon: Van, desc: 'Monitor van locations and routes live.' },
  { title: 'Live Trip Stages', icon: ClipboardCheck, desc: 'Drivers mark each journey stage — students and parents follow along.' },
  { title: 'Driver Management', icon: UserCheck, desc: 'Manage driver profiles and schedules.' },
  { title: 'Parent Dashboard', icon: UserCircle, desc: "Parents follow their child's journey." },
  { title: 'Student Dashboard', icon: GraduationCap, desc: 'Students manage bookings and rides.' },
  { title: 'Ride Notifications', icon: Bell, desc: 'Timely updates on bookings, approvals, and trip progress.' },
  { title: 'Provider Reports', icon: BarChart3, desc: 'Agencies and admins track bookings and revenue at a glance.' },
  { title: 'Booking Management', icon: BookOpen, desc: 'Simplify seat booking and reservations.' },
];

const faqs = [
  { question: 'How can students book transportation?', answer: 'Students register an account, select their school or college, choose a verified bus or van, pick their pickup stop, and reserve a seat on the route for their daily commute.' },
  { question: 'Can parents track buses?', answer: "Yes, parents can monitor their child's travel status and track buses in real time through the parent dashboard." },
  { question: 'Are drivers verified?', answer: 'Absolutely — all drivers are thoroughly verified and routes are continuously monitored for safety.' },
  { question: 'How are payments handled?', answer: 'Payments are processed through a safe and reliable payment system, ensuring secure transactions.' },
  { question: 'Is live tracking available?', answer: 'Yes, real-time live tracking is available for all buses and vans on the platform.' },
  { question: 'Can schools manage routes?', answer: 'Yes, schools and colleges manage routes, vehicles, and all transportation operations through the admin panel.' },
];

const navLinks = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'features', label: 'Features' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'contact', label: 'Contact' },
];

const Reveal = ({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) => (
  <m.div
    initial={{ opacity: 0, y: 16 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-80px' }}
    transition={{ duration: 0.5, ease: 'easeOut', delay }}
  >
    {children}
  </m.div>
);

const Section = ({ id, children, className = '' }: { id?: string; children: React.ReactNode; className?: string }) => (
  <section id={id} className={`py-20 md:py-28 ${className}`}>
    <div className="mx-auto max-w-6xl px-6 sm:px-10">{children}</div>
  </section>
);

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary shadow-xs">
    <Sparkles className="size-3.5" />
    {children}
  </span>
);

const SectionHeading = ({ title, subtitle, eyebrow }: { title: string; subtitle?: string; eyebrow?: string }) => (
  <div className="mx-auto mb-14 max-w-2xl text-center">
    {eyebrow && <div className="mb-4 flex justify-center"><Eyebrow>{eyebrow}</Eyebrow></div>}
    <h2 className="text-3xl font-bold tracking-tight md:text-4xl lg:text-[2.75rem]">{title}</h2>
    {subtitle && <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">{subtitle}</p>}
  </div>
);

export default function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);
  const [scrolled, setScrolled] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', organization: '', message: '' });
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [formSending, setFormSending] = useState(false);
  const [counts, setCounts] = useState<Record<StatKey, number> | null>(null);
  // The post-submit "reset the form" timer — tracked so a second submit doesn't
  // stack timers and an unmount before it fires can't setState on a dead component.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Clear the pending reset timer on unmount.
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  // Database counts for the stats band. The endpoint is cached 60s (browser +
  // server via Cache-Control/revalidate), so we DON'T force `no-store` — the
  // poll is mostly served from the browser cache. The 2-minute poll PAUSES while
  // the tab is hidden (a backgrounded/forgotten marketing tab would otherwise
  // keep polling forever) and refreshes once when it becomes visible again.
  useEffect(() => {
    let active = true;
    let loading = false; // in-flight dedup: don't stack overlapping polls
    let interval: ReturnType<typeof setInterval> | null = null;
    const ac = new AbortController();
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const res = await fetch('/api/public-stats', { signal: ac.signal });
        if (!res.ok) return;
        const data = (await res.json()) as Record<StatKey, number>;
        if (active) setCounts(data);
      } catch {
        // Network hiccup / aborted on unmount — keep the last known values.
      } finally {
        loading = false;
      }
    };
    const start = () => {
      if (interval == null) interval = setInterval(load, 120000);
    };
    const stop = () => {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void load();
        start();
      }
    };
    load();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      stop();
      ac.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formSending) return; // re-entry guard: ignore a submit already in flight
    if (!formData.name || !formData.email || !formData.message) {
      toast.error('Please fill in all required fields.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      toast.error('Please enter a valid email address.');
      return;
    }
    if (formData.phone && !/^\d{10,15}$/.test(formData.phone.replace(/\D/g, ''))) {
      toast.error('Please enter a valid phone number.');
      return;
    }
    setFormSending(true);
    try {
      const result = await submitContactAction(formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setFormSubmitted(true);
      toast.success('Thank you for contacting Campus Conveyance. Our team will get back to you shortly.');
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        setFormData({ name: '', email: '', phone: '', organization: '', message: '' });
        setFormSubmitted(false);
        resetTimer.current = null;
      }, 5000);
    } catch {
      toast.error('Could not send your message right now — please try again.');
    } finally {
      setFormSending(false);
    }
  };

  const handleSmoothScroll = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileMenuOpen(false);
  };

  return (
    <LazyMotion features={domAnimation}>
    <main className="relative flex min-h-screen flex-col">
      {/* Ambient background */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 45% at 50% 0%, color-mix(in oklch, var(--primary) 14%, transparent), transparent 70%), radial-gradient(40% 40% at 100% 10%, color-mix(in oklch, var(--chart-5) 10%, transparent), transparent 60%)',
        }}
      />
      <div aria-hidden className="bg-grid pointer-events-none fixed inset-0 -z-10 opacity-[0.35] [mask-image:radial-gradient(70%_50%_at_50%_0%,black,transparent)]" />

      {/* Header */}
      <header
        className={`dark fixed inset-x-0 top-0 z-50 border-b text-foreground transition-all duration-300 ${
          scrolled ? 'border-white/10 bg-background/85 shadow-lg backdrop-blur-xl' : 'border-transparent bg-background/30 backdrop-blur-sm'
        }`}
      >
        <div className="mx-auto max-w-6xl px-6 sm:px-10">
          <div className="flex items-center justify-between py-3.5">
            <Logo />
            <nav className="hidden items-center gap-1 md:flex">
              {navLinks.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={(e) => handleSmoothScroll(e, l.id)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link href="/login" className="hidden sm:block">
                <Button size="sm" className="gap-1.5">
                  Get Started <ArrowRight className="size-4" />
                </Button>
              </Link>
              <button
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle menu"
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>

          {mobileMenuOpen && (
            <m.nav
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.25 }}
              className="flex flex-col gap-1 overflow-hidden pb-4 md:hidden"
            >
              {navLinks.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={(e) => handleSmoothScroll(e, l.id)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {l.label}
                </a>
              ))}
              <Link href="/login" className="mt-1">
                <Button className="w-full gap-1.5">
                  Get Started <ArrowRight className="size-4" />
                </Button>
              </Link>
            </m.nav>
          )}
        </div>
      </header>

      {/* Hero — premium dark "ink" band with electric-yellow accents */}
      <section id="home" className="dark relative isolate overflow-hidden bg-background pt-28 pb-16 text-foreground md:pt-36 md:pb-24">
        <div aria-hidden className="bg-aurora pointer-events-none absolute inset-0 -z-10 opacity-95" />
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-[0.1] [mask-image:radial-gradient(75%_60%_at_50%_0%,black,transparent)]" />
        <div aria-hidden className="bg-lanes pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 opacity-[0.15]" />
        <div className="mx-auto max-w-6xl px-6 sm:px-10">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="text-center lg:text-left">
              <Reveal>
                <div className="mb-6 flex justify-center lg:justify-start">
                  <Eyebrow>For schools &amp; colleges</Eyebrow>
                </div>
              </Reveal>
              <Reveal delay={0.05}>
                <h1 className="text-balance text-4xl font-bold leading-[1.02] tracking-tight md:text-5xl lg:text-[4rem]">
                  The daily campus <br className="hidden sm:block" />
                  commute, <span className="text-gradient">fully managed</span>
                </h1>
              </Reveal>
              <Reveal delay={0.1}>
                <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg lg:mx-0">
                  Campus Conveyance connects students, parents, institutions, and transport agencies on one secure platform — reserve a seat, track your bus live, and travel safely to campus every day.
                </p>
              </Reveal>
              <Reveal delay={0.15}>
                <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center lg:justify-start">
                  <Link href="/login" className="w-full sm:w-auto">
                    <Button size="lg" className="w-full gap-2 shadow-lg shadow-primary/20 sm:w-auto">
                      Get Started <ArrowRight className="size-5" />
                    </Button>
                  </Link>
                  <a href="#features" onClick={(e) => handleSmoothScroll(e, 'features')} className="w-full sm:w-auto">
                    <Button size="lg" variant="outline" className="w-full sm:w-auto">
                      Explore features
                    </Button>
                  </a>
                </div>
              </Reveal>
            </div>

            {/* Sign-in role picker */}
            <Reveal delay={0.2}>
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-xl backdrop-blur-md sm:p-7">
                <div className="mb-5 flex items-center gap-2">
                  <span className="brand-gradient h-4 w-1.5 rounded-full" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sign in to your portal</p>
                </div>
                <div className="space-y-3">
                  {roles.map((role) => (
                    <Link
                      key={role.key}
                      href={role.href}
                      className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all duration-200 hover:border-primary/50 hover:bg-white/[0.07] hover:shadow-md"
                    >
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <role.icon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{role.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{role.desc}</p>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
                    </Link>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>

          {/* Stats band */}
          <Reveal delay={0.1}>
            <div className="mt-16 grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
              {STAT_ITEMS.map((s) => (
                <div
                  key={s.key}
                  className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white/[0.07] sm:p-6"
                >
                  <div className="mb-4 grid size-10 place-items-center rounded-xl bg-primary/15 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground sm:size-11">
                    <s.icon className="size-5" />
                  </div>
                  <p className="text-gradient tnum font-heading text-3xl font-bold tracking-tight sm:text-4xl">
                    {counts ? counts[s.key].toLocaleString('en-IN') : '—'}
                  </p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:text-sm">{s.label}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Why Choose Us */}
      <Section className="scroll-mt-20">
        <SectionHeading
          eyebrow="Why us"
          title="Everything you need to move a campus"
          subtitle="A complete toolkit for safe, transparent, and effortless student transportation."
        />
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {whyChooseUs.map((item, i) => (
            <Reveal key={item.title} delay={i * 0.06}>
              <div className="group h-full rounded-2xl border border-border bg-card p-6 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                <div className="mb-5 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <item.icon className="size-6" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{item.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* How It Works */}
      <Section id="how-it-works" className="scroll-mt-20 border-y border-border bg-muted/30">
        <SectionHeading eyebrow="How it works" title="From sign-up to safe arrival" subtitle="Six simple steps from account to a reserved seat on your daily route." />
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {howItWorks.map((step, i) => (
            <Reveal key={step.step} delay={i * 0.06}>
              <div className="relative h-full rounded-2xl border border-border bg-card p-6 shadow-xs">
                <span className="font-heading text-5xl font-bold leading-none text-primary/15">{String(step.step).padStart(2, '0')}</span>
                <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* Features */}
      <Section id="features" className="scroll-mt-20">
        <SectionHeading eyebrow="Platform" title="Powerful features, one platform" subtitle="Purpose-built tools for students, parents, drivers, agencies, and institutions." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {features.map((feature, i) => (
            <Reveal key={feature.title} delay={(i % 5) * 0.05}>
              <div className="group flex h-full flex-col items-center rounded-2xl border border-border bg-card p-6 text-center shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                <div className="mb-4 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <feature.icon className="size-6" />
                </div>
                <p className="text-sm font-semibold">{feature.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{feature.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* About */}
      <Section id="about" className="scroll-mt-20 border-y border-border bg-muted/30">
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Eyebrow>About</Eyebrow>
            <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">A modern transport ecosystem</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Campus Conveyance is a smart transportation management platform built to simplify and modernize school and college transportation.
            </p>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Our mission is to give students, parents, institutions, and transport agencies a secure, reliable, and technology-driven transportation ecosystem — with seamless booking, live tracking, route management, notifications, and full operational transparency.
            </p>
          </div>
          <div className="rounded-3xl border border-border bg-card p-7 shadow-sm md:p-9">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Building2 className="size-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Developed by</p>
                <p className="font-heading text-xl font-bold tracking-tight">AEVINITE</p>
              </div>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              AEVINITE is a technology company focused on building innovative digital solutions that solve real-world problems through modern software, automation, and intelligent systems.
            </p>
            <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-semibold text-primary">
                Mission: Building technology that creates efficiency, safety, and convenience.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* Contact */}
      <Section id="contact" className="scroll-mt-20">
        <SectionHeading eyebrow="Contact" title="Let's get you moving" subtitle="Have a question or want a demo? Send us a message." />
        <Reveal>
          <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-card p-7 shadow-sm md:p-10">
            {formSubmitted ? (
              <div className="py-10 text-center">
                <div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <MessageSquare className="size-8" />
                </div>
                <h3 className="text-2xl font-bold">Thank you!</h3>
                <p className="mt-2 text-muted-foreground">
                  Thank you for contacting Campus Conveyance. Our team will get back to you shortly.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full name *</Label>
                    <Input id="name" name="name" value={formData.name} onChange={handleInputChange} placeholder="Your full name" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email address *</Label>
                    <Input id="email" name="email" type="email" value={formData.email} onChange={handleInputChange} placeholder="your@email.com" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone number</Label>
                    <Input id="phone" name="phone" value={formData.phone} onChange={handleInputChange} placeholder="Your phone number" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="organization">Organization</Label>
                    <Input id="organization" name="organization" value={formData.organization} onChange={handleInputChange} placeholder="School, college, or company" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">Message *</Label>
                  <Textarea id="message" name="message" value={formData.message} onChange={handleInputChange} placeholder="How can we help you?" rows={5} required />
                </div>
                <Button type="submit" size="lg" className="w-full gap-2 sm:w-auto" disabled={formSending}>
                  {formSending ? 'Sending…' : 'Send message'} <ArrowRight className="size-5" />
                </Button>
              </form>
            )}
          </div>
        </Reveal>
      </Section>

      {/* FAQ */}
      <Section id="faq" className="scroll-mt-20 border-t border-border bg-muted/30">
        <SectionHeading eyebrow="FAQ" title="Frequently asked questions" />
        <div className="mx-auto max-w-3xl space-y-3">
          {faqs.map((faq, i) => {
            const open = expandedFaq === i;
            return (
              <Reveal key={faq.question} delay={i * 0.04}>
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold transition-colors hover:bg-muted/50"
                    onClick={() => setExpandedFaq(open ? null : i)}
                    aria-expanded={open}
                    aria-controls={`faq-panel-${i}`}
                  >
                    <span className="text-sm md:text-base">{faq.question}</span>
                    <ChevronDown className={`size-5 shrink-0 text-primary transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                  </button>
                  <m.div
                    id={`faq-panel-${i}`}
                    role="region"
                    // The answer stays in the DOM for the height animation, so hide
                    // it from assistive tech while collapsed — otherwise a screen
                    // reader announces every answer regardless of open state.
                    aria-hidden={!open}
                    initial={false}
                    animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{faq.answer}</p>
                  </m.div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* CTA — dark ink panel with an electric-yellow edge */}
      <Section className="pb-8">
        <div className="dark relative isolate overflow-hidden rounded-3xl bg-background px-6 py-14 text-center text-foreground shadow-xl ring-1 ring-white/10 sm:px-8 md:py-16">
          <div aria-hidden className="bg-aurora pointer-events-none absolute inset-0 -z-10 opacity-80" />
          <div aria-hidden className="bg-lanes pointer-events-none absolute inset-0 -z-10 opacity-[0.15]" />
          <div aria-hidden className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-1" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight md:text-4xl lg:text-[2.75rem]">
              Ready to travel <span className="text-gradient">smarter?</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Join the students and institutions already commuting with Campus Conveyance.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/login" className="w-full sm:w-auto">
                <Button size="lg" className="w-full gap-2 shadow-lg shadow-primary/20 sm:w-auto">
                  Get Started <ArrowRight className="size-5" />
                </Button>
              </Link>
              <a href="#contact" onClick={(e) => handleSmoothScroll(e, 'contact')} className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  Contact us
                </Button>
              </a>
            </div>
          </div>
        </div>
      </Section>

      {/* Footer — dark ink to bookend the page */}
      <footer className="dark relative border-t border-white/10 bg-background text-foreground">
        <div aria-hidden className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-80" />
        <div className="mx-auto max-w-6xl px-6 py-14 sm:px-10">
          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-1">
              <Logo />
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
                Smart transportation management platform for schools and colleges.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold">Company</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                <li><a href="#about" onClick={(e) => handleSmoothScroll(e, 'about')} className="transition-colors hover:text-foreground">About Us</a></li>
                <li><a href="#contact" onClick={(e) => handleSmoothScroll(e, 'contact')} className="transition-colors hover:text-foreground">Contact Us</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold">Platform</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                <li><Link href="/login" className="transition-colors hover:text-foreground">Student Portal</Link></li>
                <li><Link href="/agency/login" className="transition-colors hover:text-foreground">Agency Portal</Link></li>
                <li><Link href="/driver/login" className="transition-colors hover:text-foreground">Driver Portal</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold">Support</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                <li><a href="#faq" onClick={(e) => handleSmoothScroll(e, 'faq')} className="transition-colors hover:text-foreground">FAQs</a></li>
                <li><a href="#contact" onClick={(e) => handleSmoothScroll(e, 'contact')} className="transition-colors hover:text-foreground">Help Center</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 border-t border-border pt-6 text-center text-sm text-muted-foreground">
            © 2026 Campus Conveyance. Developed by AEVINITE.
          </div>
        </div>
      </footer>
    </main>
    </LazyMotion>
  );
}
