// Build the signup-confirmation link we email ourselves (audit #25).
//
// Instead of Supabase's action_link (which verifies on the Supabase domain and
// then bounces to /confirm with a live access/refresh token pair in the URL
// #hash — any page that sets those tokens signs the visitor into whoever minted
// them), we send a single-use `token_hash` straight to /confirm. The page
// redeems it with verifyOtp(), shows WHICH account was confirmed, and only then
// continues — it never calls setSession() on tokens found in a URL.
export function signupConfirmLink(
  site: string,
  properties: { hashed_token?: string | null; action_link?: string | null } | null | undefined,
): string {
  const hash = properties?.hashed_token;
  if (hash) {
    return `${site}/confirm?token_hash=${encodeURIComponent(hash)}&type=signup`;
  }
  // Should not happen (generateLink always returns hashed_token) — fall back to
  // Supabase's link; /confirm treats its #hash tokens as "confirmed, now sign in".
  return properties?.action_link ?? `${site}/login`;
}
