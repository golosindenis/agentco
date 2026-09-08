/**
 * The pure predicate behind every authorization check in this app: does
 * this email match the one address allowed to use it? It does not, by
 * itself, stop anyone from creating a second Supabase user — this project
 * has open signup, so anyone can call the Supabase auth API directly and
 * get a perfectly valid session. The actual enforcement is that every
 * gated entry point (the `web/middleware.ts` request gate, the
 * `web/app/auth/callback/route.ts` magic-link callback, and
 * `currentUser()` in `web/app/lib/supabaseServer.ts`, which the Server
 * Actions in `web/app/actions.ts` funnel through) calls this function on
 * the session's own user and refuses to proceed when it returns false.
 * This module only supplies the comparison those call sites rely on.
 *
 * An unset allowed address denies everyone rather than allowing everyone —
 * a missing environment variable must fail closed.
 */
export function isAllowedEmail(email: string, allowed: string): boolean {
  const candidate = (email ?? "").trim().toLowerCase();
  const permitted = (allowed ?? "").trim().toLowerCase();
  if (!candidate || !permitted) return false;
  return candidate === permitted;
}
