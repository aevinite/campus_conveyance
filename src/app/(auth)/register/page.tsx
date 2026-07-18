'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { registerAction, type AuthState } from '@/features/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/auth/password-input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
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
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>Book seats and track rides in minutes.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" name="fullName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="off" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">I am a</Label>
            <SelectMenu
              id="role"
              name="role"
              defaultValue="STUDENT"
              options={[
                { value: 'STUDENT', label: 'Student' },
                { value: 'PARENT', label: 'Parent' },
              ]}
            />
          </div>
          {state.error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
