import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isAllowedEmail } from "./allowlist";
import { requireSupabaseEnv } from "./env";

/**
 * The AUTH client — anon key, carries the session cookie, and is the only
 * Supabase client in this app that a user's identity flows through. It is
 * never used to read operations data: that goes through `../../src/db.js`,
 * which holds the service role key and knows nothing about sessions.
 * Keeping the two apart is what stops a session bug from becoming a data
 * leak, and vice versa.
 */
export async function getSupabaseAuthClient() {
  const cookieStore = await cookies();
  // Validated up front so a missing var fails with a message naming it —
  // see web/app/lib/env.ts. This is the path a missing var takes on a real
  // deploy even for /login itself: the page is a client component and
  // renders fine, but its "Send code" button calls the sendCode Server
  // Action (web/app/login/actions.ts), which reaches this function and
  // would otherwise throw an opaque error from inside @supabase/ssr.
  const { url: supabaseUrl, anonKey: supabaseAnonKey } = requireSupabaseEnv();
  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, `cookies().set()` throws —
            // Server Components can't write response cookies. This fires
            // whenever `getUser()` triggers a token refresh (e.g. from the
            // in-page auth check in page.tsx), which is expected here. It's
            // safe to swallow because the middleware already refreshes the
            // session and writes it back on every matched request; this
            // client only needs `set` to exist so `getUser()` doesn't crash.
          }
        },
      },
    },
  );
}

/**
 * The signed-in AND allowed user, or null.
 *
 * This deliberately does not return every authenticated user — this app
 * has open Supabase signup, so "has a valid session" and "is Denis" are
 * different questions, and every caller here only ever wants the second
 * one (there is no legitimate use in this single-tenant app for "some
 * authenticated user, allowlist unchecked"). Folding the allowlist check
 * in here, rather than naming it `currentAllowedUser` and trusting every
 * call site to know the difference, means a future page or action that
 * reaches for "the current user" gets the authorized one by construction —
 * the same fail-closed instinct `isAllowedEmail` already applies to a
 * missing `ALLOWED_EMAIL`.
 */
export async function currentUser() {
  const supabase = await getSupabaseAuthClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? "";
  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL ?? "")) return null;
  return data.user;
}
