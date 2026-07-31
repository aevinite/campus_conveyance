'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { registerAction, type AuthState } from '@/features/auth/actions';
import { Button } from '@/components/ui/button';
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

export default function RegisterPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    registerAction,
    {},
  );
  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl">Create your account</CardTitle>
        <CardDescription>Reserve your seat and track your daily ride to campus.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            {/* defaultValue is fed from the action's returned `values` so React's
                automatic form reset restores what was typed instead of blanking
                the field on an error. */}
            <Input id="fullName" name="fullName" defaultValue={state.values?.fullName} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            {/* Only this field is cleared when the email is already registered
                (the action returns an empty email); it keeps the value on any
                other error. */}
            <Input id="email" name="email" type="email" autoComplete="off" defaultValue={state.values?.email} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={8}
              defaultValue={state.values?.password}
              required
            />
          </div>
          <div className="space-y-2">
            {/* Native radios, not the JS SelectMenu: this is the account-type
                gate, so it must submit the chosen value even if the client bundle
                is slow to hydrate — a custom widget would otherwise silently
                submit its default (registering a Parent as a Student). Reliable
                for keyboard, screen readers and automated tests too. */}
            <span className="text-sm font-medium">I am a</span>
            <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-2">
              {[
                { value: 'STUDENT', label: 'Student' },
                { value: 'PARENT', label: 'Parent' },
              ].map((o) => (
                <label key={o.value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="role"
                    value={o.value}
                    defaultChecked={(state.values?.role ?? 'STUDENT') === o.value}
                    className="peer sr-only"
                  />
                  <span className="flex items-center justify-center rounded-lg border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/40 peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50">
                    {o.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
          {state.error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Creating…' : 'Create account'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-primary transition-colors hover:text-primary/70">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
