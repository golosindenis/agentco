import Link from "next/link";
import { redirect } from "next/navigation";
import { listAccounts } from "../../../src/posting/store.js";
import { currentUser } from "../lib/supabaseServer";

export const dynamic = "force-dynamic";

const LABEL = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" } as const;
const STATUS = { ready: "Ready", not_ready: "Not ready", reconnect_needed: "Reconnect needed" } as const;

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const { msg } = await searchParams;
  const accounts = await listAccounts();

  return (
    <main className="wrap">
      <Link href="/" className="back">Back</Link>
      <h1>Accounts</h1>
      {msg && <p className="note-band">{msg}</p>}
      <p className="hint">Posting only happens when you tick an account and press Post now or Schedule.</p>
      <div className="action-row">
        <a className="primary" href="/accounts/connect/meta">Connect Meta (Facebook and Instagram)</a>
        <a className="primary" href="/accounts/connect/threads">Connect Threads</a>
      </div>
      {accounts.length === 0 && <p className="empty">No accounts connected yet.</p>}
      <ul className="feed">
        {accounts.map((a) => (
          <li key={a.id} className="feed-row">
            <strong>{LABEL[a.platform]}</strong> {a.handle} · {STATUS[a.status]}
            {a.reason && <div className="hint">{a.reason}</div>}
          </li>
        ))}
      </ul>
    </main>
  );
}
