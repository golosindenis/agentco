"use client";

import { useState } from "react";
import { canPostTo, type ItemKind } from "../../../../src/posting/rules.js";
import type { AccountRow, Platform, PostRow } from "../../../../src/posting/types.js";
import type { PostSource } from "../../../../src/posting/plan.js";
import { cancelScheduledPost, retryFailedPost, schedulePosts } from "../../posting/actions";

const LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

function fmtDubai(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function PostPanel({ draftId, sources, accounts, posts, defaultCaption }: {
  draftId: string;
  sources: { label: string; source: PostSource }[];
  accounts: AccountRow[];
  posts: PostRow[];
  defaultCaption: string;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const source = sources[sourceIndex]?.source;
  if (!source) return null;

  async function submit(now: boolean) {
    setBusy(true);
    setMessage("");
    const selections = accounts.filter((a) => ticked[a.id]).map((a) => ({ accountId: a.id, platform: a.platform, caption: captions[a.id] ?? defaultCaption }));
    const r = await schedulePosts({ source: source!, selections, local: now ? null : local, draftId });
    setBusy(false);
    if (r.ok) { setTicked({}); setMessage(now ? "Posting now. It appears below within a minute." : "Scheduled."); }
    else setMessage(r.error);
  }

  return (
    <section className="note-band">
      <h2>Post</h2>
      {sources.length > 1 && (
        <div className="action-row">
          {sources.map((s, i) => (
            <label key={s.label}><input type="radio" checked={i === sourceIndex} onChange={() => setSourceIndex(i)} /> {s.label}</label>
          ))}
        </div>
      )}
      {accounts.length === 0 && <p className="hint">No accounts connected. <a href="/accounts">Connect accounts</a></p>}
      {accounts.map((a) => {
        const fit = canPostTo({ kind: source.itemKind as ItemKind, imageCount: source.imagePaths.length }, a.platform);
        const usable = a.status === "ready" && fit.ok;
        const why = a.status !== "ready" ? (a.reason ?? "Not ready") : fit.ok ? null : fit.reason;
        return (
          <div key={a.id} className="angle-pick">
            <label>
              <input type="checkbox" disabled={!usable} checked={!!ticked[a.id]} onChange={(e) => setTicked({ ...ticked, [a.id]: e.target.checked })} />
              <span>{a.handle} · {LABEL[a.platform]}</span>
            </label>
            {why && <div className="hint">{why}</div>}
            {ticked[a.id] && (
              <textarea rows={4} value={captions[a.id] ?? defaultCaption} onChange={(e) => setCaptions({ ...captions, [a.id]: e.target.value })} />
            )}
          </div>
        );
      })}
      <div className="action-row">
        <button type="button" className="primary" disabled={busy} onClick={() => submit(true)}>Post now</button>
        <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} aria-label="Schedule time, Dubai" />
        <button type="button" disabled={busy || !local} onClick={() => submit(false)}>Schedule (Dubai time)</button>
      </div>
      {message && <p className="hint">{message}</p>}

      {posts.length > 0 && (
        <ul className="feed">
          {posts.map((p) => {
            const account = accounts.find((a) => a.id === p.account_id);
            const who = `${account?.handle ?? "account"} · ${LABEL[p.platform]}`;
            return (
              <li key={p.id} className="feed-row">
                {who}:{" "}
                {p.status === "scheduled" && <>scheduled for {fmtDubai(p.scheduled_for)} <button type="button" onClick={() => cancelScheduledPost(p.id, draftId)}>Cancel</button></>}
                {p.status === "posting" && <>posting…</>}
                {p.status === "posted" && <>posted {p.permalink && <a href={p.permalink} target="_blank" rel="noopener">view</a>}</>}
                {p.status === "failed" && <>failed: {p.error} <button type="button" onClick={() => retryFailedPost(p.id, draftId)}>Retry</button></>}
                {p.status === "cancelled" && <>cancelled</>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
