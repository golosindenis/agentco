import { NextResponse } from "next/server";
import { GRAPH_VERSION } from "../../../../../src/posting/graph.js";
import { currentUser } from "../../../lib/supabaseServer";
import { env, newState, redirectUri } from "../../oauth";

export async function GET() {
  if (!(await currentUser())) return new NextResponse("Not authorized", { status: 401 });
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", env("META_APP_ID"));
  url.searchParams.set("redirect_uri", redirectUri("meta"));
  url.searchParams.set("state", await newState("meta"));
  // Facebook Login for Business takes a configuration, never a scope list: the
  // permissions and the assets Denis can pick live in the configuration itself.
  // Sending scope instead fails with a misleading "domain isn't included in the
  // app's domains" error, which sent us chasing App Domains for an hour.
  url.searchParams.set("config_id", env("META_CONFIG_ID"));
  url.searchParams.set("response_type", "code");
  return NextResponse.redirect(url);
}
