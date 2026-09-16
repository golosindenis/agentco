import { NextResponse } from "next/server";
import { GRAPH_VERSION } from "../../../../../src/posting/graph.js";
import { currentUser } from "../../../lib/supabaseServer";
import { env, newState, redirectUri } from "../../oauth";

const SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "instagram_basic", "instagram_content_publish", "business_management"];

export async function GET() {
  if (!(await currentUser())) return new NextResponse("Not authorized", { status: 401 });
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", env("META_APP_ID"));
  url.searchParams.set("redirect_uri", redirectUri("meta"));
  url.searchParams.set("state", await newState("meta"));
  url.searchParams.set("scope", SCOPES.join(","));
  return NextResponse.redirect(url);
}
