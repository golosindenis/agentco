import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAuthClient } from "../../lib/supabaseServer";

/**
 * Handles the emailed magic link, for when the code is clicked rather than
 * typed. The typed-code path never reaches here.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await getSupabaseAuthClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/", request.url));
}
