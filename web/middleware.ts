import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "./app/lib/allowlist";

/**
 * Runs before every matched request. Refreshing the session here — rather
 * than only in pages — is what keeps a long-lived phone tab from silently
 * expiring mid-approval.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();

  // A session existing only proves someone signed in — this Supabase
  // project has open signup, so it says nothing about *whose* session it
  // is. Every request must also clear the same allowlist check the login
  // form and the auth callback use, or a second account created directly
  // against the Supabase auth API would pass this gate with full
  // service-role read/write of the live database behind it.
  if (!data.user || !isAllowedEmail(data.user.email ?? "", process.env.ALLOWED_EMAIL ?? "")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except the login screen, the auth callback, Next's own
    // assets and the PWA files, which must be reachable signed out or the
    // installed app cannot boot to its own login screen.
    //
    // Each alternative is anchored to a full path segment (?:/|$) rather
    // than a bare prefix — "login" alone would also exclude a future route
    // like "/login-history" or "/auth/callback-debug", silently leaving it
    // reachable without auth. Fixed during Task 3 verification: confirmed
    // with curl that /loginish and /auth/callbackx bypassed the gate (404
    // instead of a redirect to /login) before this change.
    "/((?!login(?:/|$)|auth/callback(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|manifest\\.webmanifest$|icons/).*)",
  ],
};
