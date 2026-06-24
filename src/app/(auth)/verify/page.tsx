import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function VerifyPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          We sent you a confirmation link. Click it to verify your account, then
          come back and sign in.
        </p>
        <Link href="/login" className="underline">
          Go to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
