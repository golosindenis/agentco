/**
 * The last mile: nothing in this system publishes (see the README).
 * Approved drafts sit in Postgres with no way back out until now — this is
 * how Denis reads the text he approved so he can paste it somewhere
 * himself, and marks it posted once he has.
 *
 *   npx tsx scripts/drafts.ts              # list everything waiting to post
 *   npx tsx scripts/drafts.ts --posted <shortid>  # retire one
 *   npm run drafts
 *   npm run drafts -- --posted a1b2c3d4
 *
 * Each listed draft's body is printed on its own, with nothing wrapped
 * around it, so a plain terminal select-and-copy gets exactly the post text
 * and no decoration.
 */
import { approvedUnpostedDrafts, markPosted } from "../src/db.js";
import { shortId, resolveShortId } from "../src/drafts.js";

const RULE = "─".repeat(64);

function timeAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

async function printQueue(): Promise<void> {
  const drafts = await approvedUnpostedDrafts();

  if (drafts.length === 0) {
    console.log("Nothing is waiting to be posted.");
    return;
  }

  for (const d of drafts) {
    console.log(RULE);
    console.log(`${d.agent}  ·  ${shortId(d.id)}  ·  approved ${timeAgo(d.createdAt)}`);
    console.log(RULE);
    console.log("");
    console.log(d.body);
    console.log("");
  }

  console.log(`${drafts.length} draft(s) waiting to post.`);
  console.log("Retire one: npm run drafts -- --posted <shortid>");
}

async function markOnePosted(shortIdArg: string): Promise<void> {
  const drafts = await approvedUnpostedDrafts();
  const result = resolveShortId(shortIdArg, drafts.map((d) => d.id));

  if (!result.ok) {
    console.error(result.reason);
    process.exit(1);
  }

  const draft = drafts.find((d) => d.id === result.id)!;
  await markPosted(result.id);
  console.log(`Retired ${draft.agent}'s draft ${shortId(draft.id)}.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const postedIdx = args.indexOf("--posted");

  if (postedIdx === -1) {
    await printQueue();
    return;
  }

  const shortIdArg = args[postedIdx + 1];
  if (!shortIdArg) {
    console.error("usage: tsx scripts/drafts.ts --posted <shortid>");
    process.exit(1);
  }
  await markOnePosted(shortIdArg);
}

main().catch((e) => { console.error(e); process.exit(1); });
