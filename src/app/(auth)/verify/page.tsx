import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function VerifyPage() {
  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader className="items-center text-center">
        <div className="mb-2 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <MailCheck className="size-6" />
        </div>
        <CardTitle className="text-xl">Check your email</CardTitle>
        <CardDescription>
          We sent you a confirmation link. Click it to verify your account, then
          come back and sign in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/login">
          <Button className="w-full">Go to sign in</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
