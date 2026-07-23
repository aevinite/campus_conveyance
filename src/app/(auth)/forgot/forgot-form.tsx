'use client';
import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { forgotAction, type AuthState } from '@/features/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// `back` is the login page to return to — passed by whichever login sent the
// user here (student /login, /driver/login, /aevinite/login) so "Back to sign
// in" returns them to their own login, not always the student one.
export function ForgotForm({ back }: { back: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    forgotAction,
    {},
  );

  // Show the outcome as a popup toast: an error (e.g. "This email is not
  // registered.") or the success confirmation. Runs once per submission.
  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.message) toast.success(state.message);
  }, [state]);

  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you a reset link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="off" required />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Sending…' : 'Send reset link'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Remembered it?{' '}
            <Link href={back} className="font-medium text-primary transition-colors hover:text-primary/70">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
