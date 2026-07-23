'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { loginAction, type AuthState } from '@/features/auth/actions';
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

export default function AdminLoginPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    loginAction,
    {},
  );
  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl">Admin Login</CardTitle>
        <CardDescription>Aevinite control panel access.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4" autoComplete="off">
          <div className="space-y-2">
            <Label htmlFor="email">Admin email</Label>
            <Input id="email" name="email" type="email" autoComplete="off" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Admin password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              required
            />
          </div>
          {state.error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Signing in…' : 'Login'}
          </Button>
          <p className="text-center text-sm">
            <Link href="/forgot?back=/aevinite/login" className="font-medium text-primary transition-colors hover:text-primary/70">
              Forgot password?
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
