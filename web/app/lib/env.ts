/**
 * Central validation for the environment variables this app needs at
 * runtime. Without this, a missing variable surfaces as an opaque crash
 * deep inside `@supabase/ssr`'s client constructor (e.g. "supabaseUrl is
 * required") with a generic 500 and no indication of which .env entry is
 * missing — for both of the places that build that client:
 *
 *  - `web/middleware.ts` (Edge runtime, runs before every matched request)
 *  - `web/app/lib/supabaseServer.ts` (Server Components and Server
 *    Actions, including the /login form's `sendCode`/`verifyCode`, which
 *    is why an unset var still breaks the one page middleware excludes)
 *
 * Both call sites read `process.env` directly rather than going through
 * Next's server-only config helpers, so this file is plain, Edge-safe
 * TypeScript with no Node-only APIs — it can be imported from either.
 */
function missing(name: string): never {
  throw new Error(
    `Missing required environment variable: ${name}. Set it in .env ` +
      `(see .env.example for what it should look like) before starting the server.`,
  );
}

/**
 * The two Supabase env vars every auth-aware Supabase client in this app needs.
 *
 * These are read with STATIC literal member access — `process.env.NEXT_PUBLIC_X`
 * — and that is load-bearing, not style. Next.js inlines `NEXT_PUBLIC_*`
 * variables into the bundle at BUILD time, and it can only do that when it can
 * see the literal name in the source. An earlier version of this file looked
 * them up dynamically (`process.env[name]` via a shared `requireEnv(name)`
 * helper), which defeated the inlining: the Edge bundle shipped a runtime
 * `process.env[...]` lookup instead of the value, resolved to undefined on
 * Vercel, threw here, and took down EVERY request with
 * MIDDLEWARE_INVOCATION_FAILED — including /login, so there was no way back in.
 * It worked locally only because the values were in the host process.env.
 *
 * If you add another variable here, spell it out the same way. Never reach for
 * a loop or a computed key.
 */
export function requireSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) missing("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, anonKey };
}
