import { NextResponse, type NextRequest } from "next/server";
import { GRAPH_BASE, graphHttp } from "../../../../../src/posting/graph.js";
import { pagesToAccounts, type MetaPage } from "../../../../../src/posting/accounts.js";
import { setAccountToken, upsertAccount } from "../../../../../src/posting/store.js";
import { currentUser } from "../../../lib/supabaseServer";
import { env, redirectUri, stateMatches } from "../../oauth";

function back(req: NextRequest, message: string) {
  const url = new URL("/accounts", req.url);
  url.searchParams.set("msg", message);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  if (!(await currentUser())) return new NextResponse("Not authorized", { status: 401 });
  const q = req.nextUrl.searchParams;
  if (!(await stateMatches("meta", q.get("state")))) return back(req, "Meta connection refused: state did not match. Try again.");
  if (q.get("error")) return back(req, `Meta connection cancelled: ${q.get("error_description") ?? q.get("error")}`);
  try {
    const short = await graphHttp(`${GRAPH_BASE}/oauth/access_token`, {
      params: { client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), redirect_uri: redirectUri("meta"), code: q.get("code") ?? "" },
    });
    const long = await graphHttp(`${GRAPH_BASE}/oauth/access_token`, {
      params: { grant_type: "fb_exchange_token", client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), fb_exchange_token: String(short.access_token) },
    });
    // Page tokens fetched with a long lived user token do not expire.
    const pages = await graphHttp(`${GRAPH_BASE}/me/accounts`, {
      params: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100", access_token: String(long.access_token) },
    });
    const mapped = pagesToAccounts((pages.data ?? []) as MetaPage[]);
    for (const m of mapped) {
      const id = await upsertAccount(m.account);
      await setAccountToken(id, m.token, null);
    }
    return back(req, `Connected ${mapped.filter((m) => m.account.status === "ready").length} Meta accounts.`);
  } catch (err) {
    return back(req, `Meta connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
