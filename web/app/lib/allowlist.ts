/**
 * Supabase's OTP endpoint will happily create a user for any address that
 * asks. This is the gate that stops that: a second account must never be
 * able to exist, because every route behind the login reads and writes the
 * live operations database with the service role.
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
