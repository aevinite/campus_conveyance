import type { SupabaseClient, Session } from '@supabase/supabase-js';

// Establish a Supabase session from the auth material a magic link leaves in the
// URL. Depending on the flow it arrives either as a #hash fragment (implicit:
// access_token + refresh_token) or a ?code= param (PKCE) — both readable only in
// the browser. Shared by the email-confirmation and password-reset pages, which
// otherwise hand-duplicated this block. Throws if no valid session results.
//
// Client-only (reads window); call from a 'use client' component with a browser
// Supabase client created with { auth: { detectSessionInUrl: false } }.
export async function establishSessionFromUrl(supabase: SupabaseClient): Promise<Session> {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  const code = new URL(window.location.href).searchParams.get('code');

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    if (!data.session) throw new Error('missing session');
    return data.session;
  }
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    if (!data.session) throw new Error('missing session');
    return data.session;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('missing session');
  return data.session;
}
