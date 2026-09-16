import { NextResponse, type NextRequest } from "next/server";
import { publishDue } from "../../../../src/posting/publish.js";
import { graphHttp } from "../../../../src/posting/graph.js";
import { publishFacebook } from "../../../../src/posting/facebook.js";
import { publishInstagram } from "../../../../src/posting/instagram.js";
import { publishThreads } from "../../../../src/posting/threads.js";
import { needsThreadsRefresh } from "../../../../src/posting/accounts.js";
import {
  claimDuePosts, failStuckPosts, getAccount, getAccountToken, listAccounts, markAccountReconnect,
  markPostFailed, markPostPosted, setAccountToken, signPostImages,
} from "../../../../src/posting/store.js";
import { cronSecretMatches } from "./cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function refreshThreadsTokens(now: Date): Promise<string[]> {
  const problems: string[] = [];
  for (const a of await listAccounts()) {
    if (a.platform !== "threads" || a.status !== "ready" || !needsThreadsRefresh(a.token_expires_at, now)) continue;
    try {
      const token = await getAccountToken(a.id);
      if (!token) continue;
      const r = await graphHttp("https://graph.threads.net/refresh_access_token", { params: { grant_type: "th_refresh_token", access_token: token } });
      await setAccountToken(a.id, String(r.access_token), new Date(now.getTime() + Number(r.expires_in ?? 5_184_000) * 1000));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markAccountReconnect(a.id, `Threads token refresh failed: ${message}`);
      problems.push(`${a.handle}: ${message}`);
    }
  }
  return problems;
}

export async function POST(req: NextRequest) {
  if (!cronSecretMatches(req.headers.get("x-cron-secret"), process.env.CRON_SECRET)) {
    return new NextResponse("Not authorized", { status: 401 });
  }
  const now = new Date();
  const result = await publishDue({
    failStuck: failStuckPosts,
    claimDue: claimDuePosts,
    getAccount,
    getToken: getAccountToken,
    signImages: signPostImages,
    markPosted: markPostPosted,
    markFailed: markPostFailed,
    markAccountReconnect,
    publishers: { facebook: publishFacebook, instagram: publishInstagram, threads: publishThreads },
    http: graphHttp,
  }, now);
  const refreshProblems = await refreshThreadsTokens(now);
  return NextResponse.json({ ...result, refreshProblems });
}
