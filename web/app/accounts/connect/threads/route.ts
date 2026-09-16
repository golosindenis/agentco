import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/supabaseServer";
import { env, newState, redirectUri } from "../../oauth";

export async function GET() {
  if (!(await currentUser())) return new NextResponse("Not authorized", { status: 401 });
  const url = new URL("https://threads.net/oauth/authorize");
  url.searchParams.set("client_id", env("THREADS_APP_ID"));
  url.searchParams.set("redirect_uri", redirectUri("threads"));
  url.searchParams.set("scope", "threads_basic,threads_content_publish");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", await newState("threads"));
  return NextResponse.redirect(url);
}
