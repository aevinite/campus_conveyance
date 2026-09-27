'use client';
import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { forgotAction, type AuthState } from '@/features/auth/actions';
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

// Campus-scoped "forgot password". Reuses the shared forgotAction (looks the
// account up by email, role-agnostic, mails a recovery link via Gmail), but keeps
// the wording + back link inside the school/college login flow.
export default function InstitutionForgotPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(forgotAction, {});

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.message) toast.success(state.message);
  }, [state]);

  return (
    <Card className="w-full max-w-sm shadow-lg">
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
          Back
        </Link>
        <CardTitle className="text-2xl">Reset campus password</CardTitle>
        <CardDescription>
          Enter your campus email and we&apos;ll send you a link to set a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.message ? (
          <div className="space-y-4">
            <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
              {state.message} Check your inbox (and spam) for the reset link — it opens a page where you
              can choose a new password.
            </p>
            <Link href="/institution/login" className={buttonVariants({ className: 'w-full' })}>
              Back to campus login
            </Link>
          </div>
        ) : (
          <form action={action} className="space-y-4" autoComplete="off">
            <div className="space-y-2">
              <Label htmlFor="email">Campus email</Label>
              <Input id="email" name="email" type="email" autoComplete="off" required />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Sending…' : 'Send reset link'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Remembered it?{' '}
              <Link
                href="/institution/login"
                className="font-medium text-primary transition-colors hover:text-primary/70"
              >
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
