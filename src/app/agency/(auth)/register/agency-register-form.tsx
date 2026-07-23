'use client';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bus, Check, ChevronDown, GraduationCap, Search, ShieldCheck, X } from 'lucide-react';
import {
  agencyRegisterAction,
  sendAgencyEmailOtp,
  verifyAgencyEmailOtp,
  type FormState,
} from '@/features/agency/actions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/auth/password-input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type Institution = { id: string; name: string; kind: string };

function Field({
  name,
  label,
  type = 'text',
  required = true,
  placeholder,
  hint,
  full = false,
  autoComplete = 'off',
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  full?: boolean;
  autoComplete?: string;
}) {
  return (
    <div className={`space-y-1.5 ${full ? 'sm:col-span-2' : ''}`}>
      <Label htmlFor={name}>{label}</Label>
      {type === 'password' ? (
        <PasswordInput
          id={name}
          name={name}
          required={required}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
      ) : (
        <Input
          id={name}
          name={name}
          type={type}
          required={required}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-primary">
      {children}
    </p>
  );
}

/** Searchable multi-select dropdown for picking one or more colleges/schools. */
function CollegeMultiSelect({ institutions }: { institutions: Institution[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = institutions.filter((i) =>
    i.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selectedInsts = institutions.filter((i) => selected.includes(i.id));

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <div ref={ref} className="space-y-2">
      {/* Submitted with the form */}
      {selected.map((id) => (
        <input key={id} type="hidden" name="institutionIds" value={id} />
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-2xs transition-colors outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30"
        >
          <span className={selected.length ? '' : 'text-muted-foreground'}>
            {selected.length
              ? `${selected.length} selected`
              : 'Search and select colleges / schools…'}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a college or school name…"
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-56 overflow-y-auto p-1">
              {filtered.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No matches for “{query}”.
                </p>
              )}
              {filtered.map((inst) => {
                const isSel = selected.includes(inst.id);
                return (
                  <button
                    type="button"
                    key={inst.id}
                    onClick={() => toggle(inst.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                        isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                      }`}
                    >
                      {isSel && <Check className="size-3" />}
                    </span>
                    <GraduationCap className="size-4 text-muted-foreground" />
                    <span className="flex-1">{inst.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {inst.kind === 'COLLEGE' ? 'College' : 'School'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Chips of the current selection */}
      {selectedInsts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedInsts.map((inst) => (
            <span
              key={inst.id}
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary"
            >
              {inst.name}
              <button
                type="button"
                onClick={() => toggle(inst.id)}
                aria-label={`Remove ${inst.name}`}
                className="grid size-4 place-items-center rounded-full hover:bg-primary/20"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Email field with an inline "Verify" button (agency signup only). Sends a 6-digit
 * code, collects it, and — once confirmed — locks the address, drops a hidden
 * `emailVerifiedToken`, and tells the parent to unlock the rest of the form.
 */
function EmailVerifyField({
  onVerified,
  resetSignal = 0,
}: {
  onVerified: (v: boolean) => void;
  /** Bumped by the parent to force re-verification (e.g. the verified proof
   *  lapsed and submit was rejected). Keeps the typed email, drops the badge. */
  resetSignal?: number;
}) {
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sent' | 'verified'>('idle');
  const [token, setToken] = useState(''); // OTP challenge token
  const [verifiedToken, setVerifiedToken] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const emailValid = EMAIL_RE.test(email.trim());
  const verified = phase === 'verified';

  function resetVerification() {
    setPhase('idle');
    setToken('');
    setVerifiedToken('');
    setCode('');
    setMsg(null);
    setErr(null);
    onVerified(false);
  }

  // Parent asks us to re-verify (proof expired mid-form) → drop the badge and
  // surface why, without wiping the email they already typed.
  useEffect(() => {
    if (resetSignal > 0) {
      // Prop-driven reset (parent bumps resetSignal when the proof lapses) —
      // intentional, not a cascading-render hazard.
      /* eslint-disable react-hooks/set-state-in-effect */
      resetVerification();
      setErr('Your email verification expired — please verify again before submitting.');
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  function sendCode() {
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      const res = await sendAgencyEmailOtp(email.trim());
      if (res.error || !res.token) {
        setErr(res.error ?? 'Could not send the code. Please try again.');
        return;
      }
      setToken(res.token);
      setPhase('sent');
      setMsg('We emailed you a 6-digit code. Enter it below to verify.');
    });
  }

  function confirmCode() {
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      const res = await verifyAgencyEmailOtp(email.trim(), code.trim(), token);
      if (res.error || !res.verifiedToken) {
        setErr(res.error ?? 'Verification failed. Please try again.');
        return;
      }
      setVerifiedToken(res.verifiedToken);
      setPhase('verified');
      onVerified(true);
    });
  }

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor="email">Email</Label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="you@company.com"
          value={email}
          readOnly={verified}
          onChange={(e) => {
            setEmail(e.target.value);
            if (phase !== 'idle') resetVerification();
          }}
          className={verified ? 'border-success focus-visible:ring-success/40' : ''}
        />
        {verified ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm font-medium text-success">
              <ShieldCheck className="size-4" /> Verified
            </span>
            <button
              type="button"
              onClick={resetVerification}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Change
            </button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={sendCode}
            disabled={!emailValid || pending}
          >
            {pending && phase === 'idle'
              ? 'Sending…'
              : phase === 'sent'
                ? 'Resend code'
                : 'Verify'}
          </Button>
        )}
      </div>

      {/* Submitted with the form; the server re-checks this signature. */}
      {verified && <input type="hidden" name="emailVerifiedToken" value={verifiedToken} />}

      {phase === 'sent' && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center">
          <Input
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="tracking-[0.4em]"
          />
          <Button
            type="button"
            className="shrink-0"
            onClick={confirmCode}
            disabled={code.length !== 6 || pending}
          >
            {pending ? 'Checking…' : 'Confirm code'}
          </Button>
        </div>
      )}

      {verified ? (
        <p className="text-xs text-success">
          Email verified — you can now fill in the rest of the form.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Verify your email to unlock the rest of the form.
        </p>
      )}
      {msg && !verified && <p className="text-xs text-muted-foreground">{msg}</p>}
      {err && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </p>
      )}
    </div>
  );
}

export function AgencyRegisterForm({
  institutions,
}: {
  institutions: Institution[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    agencyRegisterAction,
    {},
  );
  const [verified, setVerified] = useState(false);
  // If submit is rejected because the email-verified proof lapsed, force the
  // email field to re-verify so the green badge can't sit there as a dead end.
  const [resetSignal, setResetSignal] = useState(0);
  useEffect(() => {
    if (state.error && /verify your email/i.test(state.error)) {
      // Reacting to a completed useActionState error — intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResetSignal((n) => n + 1);
    }
  }, [state]);
  return (
    <Card className="w-full max-w-4xl shadow-lg">
      <CardHeader>
        <Link
          href="/agency/login"
          className={buttonVariants({
            variant: 'ghost',
            size: 'sm',
            className:
              '-ml-2 mb-1 w-fit gap-1.5 text-muted-foreground hover:text-foreground',
          })}
        >
          <ArrowLeft className="size-4" />
          Back to login
        </Link>
        <CardTitle className="text-2xl">Apply as a Service Agency</CardTitle>
        <CardDescription>
          Fill in your business details. An admin reviews and approves your
          application before you can list buses and routes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-6" autoComplete="off">
          {/* Step 1 — verify email first */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SectionTitle>Account</SectionTitle>
            <EmailVerifyField onVerified={setVerified} resetSignal={resetSignal} />
          </div>

          {/* Step 2 — everything below unlocks only after the email is verified */}
          <fieldset disabled={!verified} className="m-0 space-y-6 border-0 p-0 disabled:opacity-55">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field name="name" label="Provider / Company name" />
              <Field name="contactPerson" label="Contact person name" hint="Full name of the person we should reach out to." />
              <Field name="password" label="Password" type="password" hint="At least 8 characters." autoComplete="new-password" />
              <Field name="phone" label="Phone" />
            </div>

          {/* Business / KYC */}
          <div className="grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-2">
            <SectionTitle>Business &amp; verification details</SectionTitle>
            <Field name="legalName" label="Registered legal name" />
            <Field name="registrationNo" label="Company registration no. (CIN / Udyam)" />
            <Field name="gstNumber" label="GST number" />
            <Field name="panNumber" label="PAN number" />
            <Field name="registeredAddress" label="Registered address" full />
            <Field name="permitDocUrl" label="Transport permit link (optional)" type="url" required={false} placeholder="https://…" />
            <Field name="fitnessDocUrl" label="Fitness certificate link (optional)" type="url" required={false} placeholder="https://…" />
          </div>

          {/* Service area & type */}
          <div className="space-y-4 border-t border-border pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Service area &amp; type
            </p>

            <div className="space-y-2">
              <Label>Colleges / schools you provide services to</Label>
              <p className="text-xs text-muted-foreground">
                Search and pick all that apply — you can choose multiple.
              </p>
              {institutions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No colleges available yet.
                </p>
              ) : (
                <CollegeMultiSelect institutions={institutions} />
              )}
            </div>

            <div className="space-y-2">
              <Label>Which services do you provide?</Label>
              <p className="text-xs text-muted-foreground">
                Pick bus, van, or both.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(['BUS', 'VAN'] as const).map((v) => (
                  <label
                    key={v}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <input
                      type="checkbox"
                      name="vehicleTypes"
                      value={v}
                      className="size-4 accent-primary"
                    />
                    <Bus className="size-4 text-muted-foreground" />
                    <span>{v === 'BUS' ? 'Bus' : 'Van'}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {state.error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Submitting…' : 'Submit application'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link
              href="/agency/login"
              className="font-medium text-primary transition-colors hover:text-primary/70"
            >
              Sign in
            </Link>
          </p>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
