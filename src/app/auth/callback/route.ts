import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  if (code) {
    const db = await createClient();
    await db.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}${next ?? '/login'}`);
}
