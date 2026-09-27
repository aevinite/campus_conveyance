'use client';
import { useActionState, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, GraduationCap, School, ShieldCheck } from 'lucide-react';
import {
  institutionRegisterAction,
  sendInstitutionEmailOtp,
  verifyInstitutionEmailOtp,
  type FormState,
} from '@/features/institution/auth-actions';
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
        <PasswordInput id={name} name={name} required={required} placeholder={placeholder} autoComplete={autoComplete} />
      ) : (
        <Input id={name} name={name} type={type} required={required} placeholder={placeholder} autoComplete={autoComplete} />
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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Email field with an inline "Verify" button. Sends a 6-digit code, collects it,
 * and — once confirmed — locks the address, drops a hidden `emailVerifiedToken`,
 * and tells the parent to unlock the rest of the form. Identical UX to the agency
 * signup (shared OTP backend).
 */
function EmailVerifyField({
  onVerified,
  resetSignal = 0,
}: {
  onVerified: (v: boolean) => void;
  resetSignal?: number;
}) {
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sent' | 'verified'>('idle');
  const [token, setToken] = useState('');
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

  useEffect(() => {
    if (resetSignal > 0) {
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
      const res = await sendInstitutionEmailOtp(email.trim());
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
      const res = await verifyInstitutionEmailOtp(email.trim(), code.trim(), token);
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
      <Label htmlFor="email">Campus email</Label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="admin@yourcampus.edu"
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
          <Button type="button" variant="outline" className="shrink-0" onClick={sendCode} disabled={!emailValid || pending}>
            {pending && phase === 'idle' ? 'Sending…' : phase === 'sent' ? 'Resend code' : 'Verify'}
          </Button>
        )}
      </div>

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
          <Button type="button" className="shrink-0" onClick={confirmCode} disabled={code.length !== 6 || pending}>
            {pending ? 'Checking…' : 'Confirm code'}
          </Button>
        </div>
      )}

      {verified ? (
        <p className="text-xs text-success">Email verified — you can now fill in the rest of the form.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Verify your email to unlock the rest of the form.</p>
      )}
      {msg && !verified && <p className="text-xs text-muted-foreground">{msg}</p>}
      {err && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </p>
      )}
    </div>
  );
}

export function InstitutionRegisterForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    institutionRegisterAction,
    {},
  );
  const [verified, setVerified] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  useEffect(() => {
    if (state.error && /verify your email/i.test(state.error)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResetSignal((n) => n + 1);
    }
  }, [state]);

  return (
    <Card className="w-full max-w-2xl shadow-lg">
      <CardHeader>
        <Link
          href="/institution/login"
          className={buttonVariants({
            variant: 'ghost',
            size: 'sm',
            className: '-ml-2 mb-1 w-fit gap-1.5 text-muted-foreground hover:text-foreground',
          })}
        >
          <ArrowLeft className="size-4" />
          Back to login
        </Link>
        <CardTitle className="text-2xl">Register your School / College</CardTitle>
        <CardDescription>
          Create your campus account. An admin reviews and approves your campus before it
          goes live for agencies and students.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-6" autoComplete="off">
          {/* Step 1 — verify email first */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SectionTitle>Account</SectionTitle>
            <EmailVerifyField onVerified={setVerified} resetSignal={resetSignal} />
          </div>

          {/* Step 2 — unlocks only after the email is verified */}
          <fieldset disabled={!verified} className="m-0 space-y-6 border-0 p-0 disabled:opacity-55">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SectionTitle>Campus details</SectionTitle>
              <Field name="name" label="School / College name" full placeholder="e.g. LJ University" />

              <div className="space-y-1.5 sm:col-span-2">
                <Label>Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: 'SCHOOL', label: 'School', Icon: School },
                    { v: 'COLLEGE', label: 'College / University', Icon: GraduationCap },
                  ] as const).map(({ v, label, Icon }, i) => (
                    <label
                      key={v}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                    >
                      <input
                        type="radio"
                        name="kind"
                        value={v}
                        defaultChecked={i === 0}
                        className="size-4 accent-primary"
                      />
                      <Icon className="size-4 text-muted-foreground" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <Field name="contactPerson" label="Contact person name" hint="Who we should reach out to for this campus." />
              <Field name="phone" label="Phone" />
              <Field name="city" label="City" required={false} placeholder="e.g. Ahmedabad" />
              <Field name="area" label="Area / locality" required={false} placeholder="e.g. Bopal" />
              <Field name="password" label="Password" type="password" hint="At least 8 characters." autoComplete="new-password" />
              <Field name="imageUrl" label="Logo / photo link (optional)" type="url" required={false} placeholder="https://…" />

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="description">Short description (optional)</Label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  placeholder="A line or two about your campus."
                  className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-2xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30"
                />
              </div>
            </div>

            {state.error && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Submitting…' : 'Create campus account'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/institution/login" className="font-medium text-primary transition-colors hover:text-primary/70">
                Sign in
              </Link>
            </p>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
