'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { GoogleButton } from '@/components/auth/google-button';

/**
 * Shared login card so the student, agency and driver login pages all use the
 * exact same design. Browser autofill is disabled on the email/password fields
 * (autoComplete="off" on the form + "new-password" on the password input, which
 * is the combination Chromium/Firefox respect for suppressing saved-credential
 * autofill).
 *
 * Pass `googleAction` to show a "Continue with Google" button above the form.
 */
export function LoginCard({
  title,
  description,
  action,
  submitting,
  error,
  emailLabel = 'Email',
  passwordLabel = 'Password',
  submitLabel = 'Sign in',
  banner,
  footer,
  googleAction,
  backHref,
}: {
  title: string;
  description?: string;
  action: (formData: FormData) => void;
  submitting: boolean;
  error?: string;
  emailLabel?: string;
  passwordLabel?: string;
  submitLabel?: string;
  banner?: React.ReactNode;
  footer?: React.ReactNode;
  googleAction?: () => void | Promise<void>;
  backHref?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  // Keep the email as controlled state so a failed sign-in doesn't wipe it — on
  // submit React resets the (uncontrolled) form, which clears the password field
  // (what we want: retype the password), while the controlled email persists so
  // the user never has to re-enter it. (We can't securely tell a wrong email
  // from a wrong password — Supabase returns one generic error to avoid leaking
  // which emails are registered — so the email is always kept.)
  const [email, setEmail] = useState('');
  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader>
        {backHref && (
          <Link
            href={backHref}
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
              className: '-ml-2 mb-1 w-fit gap-1.5 text-muted-foreground hover:text-foreground',
            })}
          >
            <ArrowLeft className="size-4" />
            Back
          </Link>
        )}
        <CardTitle className="text-2xl">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {banner}
        {googleAction && (
          <>
            <GoogleButton serverAction={googleAction} />
            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">
                or continue with email
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        <form action={action} className="space-y-4" autoComplete="off">
          <div className="space-y-2">
            <Label htmlFor="email">{emailLabel}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{passwordLabel}</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : submitLabel}
          </Button>
          {footer}
        </form>
      </CardContent>
    </Card>
  );
}
