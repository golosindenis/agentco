import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAuthClient } from "../../lib/supabaseServer";
import { isAllowedEmail } from "../../lib/allowlist";

/**
 * Handles the emailed magic link, for when the code is clicked rather than
 * typed. The typed-code path never reaches here.
 *
 * This route is exempt from `web/middleware.ts` (it has to be, to complete
 * sign-in before a session cookie exists), so it is its own gate. Exchanging
 * the code mints a real, valid session cookie for whoever the code belongs
 * to — since this Supabase project has open signup, that can be anyone who
 * requested a magic link against the Supabase auth API directly, not only
 * `ALLOWED_EMAIL`. If the resulting session isn't the allowed address, the
 * session is torn down before this route hands anything back to the
 * browser, rather than letting an unreviewed cookie stand and relying on
 * the next request hitting the middleware gate.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await getSupabaseAuthClient();

  if (code) {
    const { data } = await supabase.auth.exchangeCodeForSession(code);
    const email = data.user?.email ?? "";
    if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL ?? "")) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return NextResponse.redirect(new URL("/", request.url));
}
