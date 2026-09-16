import { NextResponse, type NextRequest } from "next/server";
import { THREADS_BASE, graphHttp } from "../../../../../src/posting/graph.js";
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
  if (!(await stateMatches("threads", q.get("state")))) return back(req, "Threads connection refused: state did not match. Try again.");
  if (q.get("error")) return back(req, `Threads connection cancelled: ${q.get("error_description") ?? q.get("error")}`);
  try {
    const short = await graphHttp("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      params: {
        client_id: env("THREADS_APP_ID"), client_secret: env("THREADS_APP_SECRET"),
        grant_type: "authorization_code", redirect_uri: redirectUri("threads"), code: q.get("code") ?? "",
      },
    });
    const long = await graphHttp("https://graph.threads.net/access_token", {
      params: { grant_type: "th_exchange_token", client_secret: env("THREADS_APP_SECRET"), access_token: String(short.access_token) },
    });
    const token = String(long.access_token);
    const me = await graphHttp(`${THREADS_BASE}/me`, { params: { fields: "id,username", access_token: token } });
    const id = await upsertAccount({ platform: "threads", handle: `@${String(me.username)}`, external_id: String(me.id), status: "ready", reason: null });
    await setAccountToken(id, token, new Date(Date.now() + Number(long.expires_in ?? 5_184_000) * 1000));
    return back(req, `Connected Threads @${String(me.username)}.`);
  } catch (err) {
    return back(req, `Threads connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
