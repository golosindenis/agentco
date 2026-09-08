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
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in .env ` +
        `(see .env.example for what it should look like) before starting the server.`,
    );
  }
  return value;
}

/** The two Supabase env vars every auth-aware Supabase client in this app needs. */
export function requireSupabaseEnv(): { url: string; anonKey: string } {
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}
