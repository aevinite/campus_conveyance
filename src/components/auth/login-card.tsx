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

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

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
            <form action={googleAction}>
              <Button
                type="submit"
                variant="outline"
                className="w-full gap-2"
              >
                <GoogleIcon />
                Continue with Google
              </Button>
            </form>
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
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
