# Agent Company — Design

**Date:** 2026-09-05
**Status:** Approved, ready for implementation planning

## Problem

Denis runs several businesses solo and cannot stay consistent at the two things that
compound: publishing content and reaching out to people. Both are daily, both need
judgment, and both stop entirely when he does not sit down to do them.

Hiring is the obvious answer and the wrong one at this revenue. The goal is a system of
agents that do the work while he approves, and that need less approval over time.

This spec covers **v1 only**: three agents, drafts only, nothing published automatically.

## What this is not

Not an agent framework. Not an orchestration engine. Not a product to sell yet — it is
dogfooded on Denis's own businesses first, with the org model kept generic enough that
productizing later does not require a rewrite.

Departments are a grouping in the UI and a permission scope. They are a column on the
agents table, not an architectural object. Modelling departments as real entities with
routing rules between them produces org-chart software instead of a work machine.

## Core mechanic: earned autonomy

Agents are staff. Staff earn trust through a track record; they are not granted it on
day one. This is the spine of the whole system.

| Level | Behaviour |
|---|---|
| 1 | Drafts only. Everything waits for approval. |
| 2 | Acts on work of a type already approved repeatedly; escalates anything new. |
| 3 | Acts, then reports in the morning brief. |
| 4 | Acts silently. Only failures surface. |

Every agent starts at level 1.

- **Promote** after 5 consecutive approvals with no edit.
- **Demote one level immediately** on 2 declines within the last 5 verdicts.
- **Approve-after-edit** counts as neither: it resets the promotion streak without
  triggering a demotion. It means the agent is close but not yet trusted.

Fast promotion is safe because demotion is fast.

**Policy override:** outreach agents are capped at level 2 permanently. Every first
message to a new human gets Denis's eyes. A bad post is embarrassing; a bad WhatsApp to
a retailer costs the account.

## Scope: v1 agents

| Agent | Job | Output |
|---|---|---|
| Strategist | Picks the week's angles. Runs weekly (Monday), not daily. Runs the `divergence` skill so output is not generic. | 5–7 angles per week |
| Writer | Turns an angle into a post/script/caption in Denis's voice. | Draft, queued for approval |
| Chief of Staff | Assembles the morning brief. Does no work of its own. | One brief per day |

Strategist and Writer are deliberately separate. Combined, a single agent rationalises a
weak angle because it has already started writing.

Deferred to v2: Researcher, Publisher, Producer, Competitor Analyst. Adding one is a row
plus a prompt, not a rebuild.

## Architecture

Three pieces, separated so any one can be replaced without touching the others.

### Memory — Supabase

| Table | Holds |
|---|---|
| `agents` | role, department, autonomy level, instructions, capability flags |
| `tasks` | the queue; schedule, state, claim lock, error |
| `drafts` | what an agent produced |
| `approvals` | verdict plus the one-line decline reason |
| `feedback` | full correction history |
| `events` | what ran, tokens used, what broke |

### Worker — Node process on Denis's Mac

Cron wakes it; it claims the next due task under a row lock, spawns a headless Claude
Code session with that agent's instructions and skills, writes the result back.

It contains no intelligence. It is a dispatcher, ~300 lines. That is what makes it
swappable for a cloud worker later with no schema change.

**Why local for v1:** Denis's existing skills (`my-content`, `divergence`,
`attune-viral-content`, `threads-carousel`) already encode the hard part. Porting them to
API code is a week of work before anything is learned, and running locally costs nothing
beyond the existing subscription. The Mac being asleep only delays a draft.

**Migration path:** when an agent reaches level 3 and has earned trust, port that one
agent to a cloud worker so it runs overnight. The rest stay local until they earn it.

### Face — Next.js dashboard on Vercel

The approval queue is the home screen, not a tab. Draft rendered as it will appear;
approve, decline with a one-line reason, or edit. Secondary: the morning brief, and each
agent's level and hit rate.

If clearing the queue takes more than 20 minutes a day, the system is failing regardless
of how good the agents are.

## Data flow

**Weekly cycle.** Monday 07:00: the Strategist proposes the week's angles. Denis approves
or declines them like any other draft, so a weak week is caught before seven posts are
written from it.

**Daily cycle.** 07:00: the Writer drafts from the approved angle bank. The Chief of Staff
assembles the brief. Denis clears the queue over coffee. The Strategist does not run.

**Task lifecycle:** `queued → claimed → running → drafted → pending_approval →
approved | declined`, with `failed` reachable from `running`.

Claiming takes a row lock, so a double-fired cron cannot run the same task twice.

**The feedback loop.** A decline reason is written into the target agent's instructions so
the correction sticks.

**Instruction cap — 30 rules per agent.** Hitting the cap forces consolidation: merge
duplicates, drop rules not violated in 30 days. Full history stays in `feedback`.

This is not optional. Attune's `CLAUDE.md` reached 434 KB (~108K tokens loaded every
session) by exactly this mechanism — appending corrections forever with nothing ever
removed. An agent's working memory stays small on purpose.

## Failure handling

**Backpressure.** Maximum 3 drafts pending approval per agent. At the cap the agent stops
producing until the queue is cleared.

This makes Denis's approval capacity throttle the system automatically, rather than the
system building a backlog he then avoids. An agent permanently at its cap is one that is
not trusted enough to promote — fix its instructions or turn it off.

**Turn caps.** Every run gets a fixed number of tool-calling turns, then must stop and
report with what it has. No infinite research spirals. `events` records tokens per run so
an expensive agent is visible rather than a surprise.

**Output assertion.** Every run must prove it produced something: a draft row exists, is
non-empty, and is not byte-identical to the previous draft. A run that "succeeds" with no
output is recorded as `failed`. Silent success is the failure mode that hides longest.

**Staleness.** The brief always renders, and explicitly says when nothing ran — a silent
morning must never be ambiguous between "nothing was due" and "the worker died".

**Blast radius.** No agent can publish, send, or spend until that capability is explicitly
enabled for it, independent of its autonomy level.

## Publishing

Rented, not built. Blotato (~$29/mo) wraps Instagram, Facebook, LinkedIn, X, TikTok,
YouTube, Threads, Pinterest and Bluesky behind one endpoint and ships an MCP server.

Building this is nine OAuth flows, Meta and TikTok app review, per-platform media rules,
and permanent maintenance — months of work a customer cannot see, in a commoditized
category. It sits behind a `publish(content, platforms)` adapter so it can be replaced if
volume ever justifies owning it.

Not wired in v1. No agent publishes anything yet.

## Testing

**Deterministic and unit tested, no model calls:** state machine transitions, promotion at
5, demotion at 2-in-5, edit resets the streak, backpressure at 3, claim lock under a
double-fired cron, output assertion rejecting an empty run.

**Not unit testable:** whether a draft sounds like Denis. That judgment is his, and the
approval rate is the metric. An agent still at level 1 after three weeks is visibly
failing without anyone defining a rubric.

**Dry-run mode** from day one: the full pipeline against a real agent, writing to a scratch
table, publishing nothing.

## Acceptance test

**In two weeks, has content gone out that Denis did not write?**

Not "is the dashboard nice". If the answer is no, adding more agents will not fix it, and
the project stops until the reason is understood.

## Known risks

**This is the most enjoyable thing Denis could build**, and his established pattern is
shipping complete products before getting real-user signal. The two-week test exists
specifically to interrupt that.

**Approval fatigue.** Helena (hirehelena.com) markets the same concept explicitly without a
dashboard — their positioning is that opening one is the failure mode. Denis chose the
dashboard knowingly. Backpressure is the mitigation; if the queue is still not cleared
daily by week three, the interface is wrong and notifications should be reconsidered.

**Category is contested.** Helena and Layers Growth MCP both shipped in early Sep 2026.
Neither builds a multi-department org with earned autonomy, which is the distinct part,
but the generic "AI runs your marketing" position is taken.
