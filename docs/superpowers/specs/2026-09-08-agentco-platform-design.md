# agentco platform — design

Date: 2026-09-08
Status: proposed, awaiting review
Supersedes the local dev-server dashboard in `dashboard/`.

## The problem

On 2026-09-06 Denis reviewed the working agent company and rejected the
structure on four counts: too manual, not a company, wrong interface, wrong
output. This spec addresses **the interface only**. A terminal and a localhost
Next dev server is not a product: it is unreachable from his phone, it requires
him to be at the Mac with a shell open, and in practice it means the approvals
that make the whole ladder work do not happen.

The engine is not in question. Queue, autonomy ladder, backpressure,
agents-as-rows and the decline-reason feedback loop all stay exactly as they
are.

## Scope

This is sub-project 1 of 4. The other three are named here so this one can be
read against them, and are explicitly **not** in scope:

| # | Sub-project | Why not now |
|---|---|---|
| 1 | **Platform** (this spec) | Needs nothing else to change |
| 2 | Cloud runner | Starts a metered API bill; decide after daily use is proven |
| 3 | Actions instead of drafts | Publishing needs autonomy nothing has earned yet |
| 4 | More departments | Adding agents before the review habit exists multiplies the wrong thing |

**The runner stays on the Mac.** Agents keep spawning as `claude` CLI processes
under the 07:00 LaunchAgent, billed to Denis's Claude subscription rather than a
metered API key. The platform reads and writes the same Supabase project. This
is the decision that keeps sub-project 1 independent, and it has one visible
consequence, addressed under "Honest staleness" below.

## Architecture

```
  Mac, 07:00 LaunchAgent          Vercel (Next.js App Router)
  ┌──────────────────┐            ┌────────────────────────┐
  │ worker.ts        │            │ RSC pages (read)       │
  │  → claude CLI    │            │ server actions (write) │
  └────────┬─────────┘            └───────────┬────────────┘
           │  service role                    │  service role
           │  (local .env)                    │  (Vercel env, server only)
           ▼                                  ▼
        ┌────────────────────────────────────────┐
        │  Supabase — agents, tasks, drafts,     │
        │  briefs, approvals, feedback, events   │
        └────────────────────────────────────────┘
```

Both writers use the service role key and RLS stays deny-all for `anon` and
`authenticated`. The key never reaches the browser: every read happens in a
server component, every write in a server action. There is no client-side
Supabase client and no `NEXT_PUBLIC_` Supabase variable.

### Repo layout

The app replaces `dashboard/` in place, as `app/` at the repo root, so it can
import `src/` directly rather than reaching up two levels:

```
  app/                       Next.js App Router (the platform)
  src/                       engine — unchanged, imported by both app and worker
  tests/                     existing suite plus new app tests
```

`src/` is the shared boundary. The platform adds **no** business logic of its
own: verdicts go through `recordVerdict`, health through `deriveHealth`, costs
through `totalsByAgent`. If the platform needs a rule, the rule belongs in
`src/` where the worker and the tests can see it too.

## Routes

| Route | Screen | Reads |
|---|---|---|
| `/login` | Email one-time code | — |
| `/` | Today (narrow) / Overview (wide) | `latestBrief`, `pendingDrafts`, `approvedUnpostedDrafts`, `getHealthFacts`, `listAgents`, `pendingDraftCountsByAgent`, `recentEvents` |
| `/drafts/[id]` | Draft review | draft body + its agent |
| `/org` | Departments and agents | `listAgents`, `pendingDraftCountsByAgent`, `lastEventTimeByAgent` |
| `/agents/[key]` | Agent detail | agent row, instructions, verdict history, per-agent events, `totalsByAgent` |
| `/activity` | Event log | `recentEvents` |

`/` is one route with two layouts, not two pages: the same data load renders the
phone Today stack below 900px and the desktop Overview above it. They show the
same facts at different densities, so splitting them into separate routes would
mean two things to keep in sync for no gain.

Departments are still a column, not an entity — the sidebar groups `listAgents`
by `department` and orders Marketing first. Adding a department means seeding an
agent with a new department string, nothing more.

### New queries needed

`src/db.ts` covers everything except the agent detail and draft review pages.
Five additions, following the existing shape:

- `getAgentByKey(key)` — agent row including `instructions`
- `verdictHistory(agentId, limit)` — `approvals` joined to that agent's drafts
- `eventsForAgent(agentId, limit)` — `events` filtered by agent
- `getDraftForReview(id)` — one draft with its agent and task kind
- `setAgentEnabled(agentId, enabled)` — the Pause control's only write

`AgentRow` in `src/types.ts` also gains the `can_publish` field, which the
column has always had and the type has never declared.

## Auth

Supabase Auth, email one-time code, one allowed address. `middleware.ts` gates
every route except `/login` and redirects unauthenticated requests there. A
server-side allowlist check rejects any email but Denis's, so an open signup
endpoint cannot create a second user.

Email OTP rather than a password because there is no password to leak, no
password manager entry to maintain, and no reset flow to build. On the free
Supabase tier this costs nothing.

## Interaction design

**Approve is a five-second decision.** The Today list carries Approve directly
on each card; the draft body is truncated to four lines. Opening the full draft
is the exception, not the path. On `/drafts/[id]` the action bar is sticky at
the bottom so Approve is always under the thumb. Every control is at least 44px.

**Three verdicts, matching `approvals.verdict`:** Approve, Edit and approve,
Decline. Declining requires a reason, because the reason is not commentary — it
is appended to the agent's instructions by `appendRule` and is the only way a
correction sticks. The agent detail page shows which rules arrived this way and
when, so the feedback loop is visible rather than implied.

**Nothing publishes.** Approving marks a draft ready and Denis copies it. The
draft review screen says so in as many words, so an approval is never mistaken
for a send. This changes in sub-project 3, not here.

**The instruction cap is shown, not enforced silently.** `MAX_RULES` is 30; the
agent page shows `n of 30`.

## Honest staleness

The Mac runs at 07:00 and is asleep the rest of the time. The platform is
always reachable; the work behind it is not. Two consequences, handled
explicitly rather than hidden:

- Every page shows when the last run happened and `deriveHealth`'s state. If
  nothing ran, the banner says `Nothing ran today`, which the existing health
  logic already derives.
- **No "Run now" button in v1.** The mockup drew one. It cannot work: a queued
  task sits until the LaunchAgent next fires, so the button would report success
  and produce nothing for up to a day. A control that lies about what it did is
  worse than an absent one. It arrives with the cloud runner in sub-project 2.

## Errors

- **Supabase unreachable** — the page renders the shell with an error band
  rather than a blank screen or a crash. An operations surface that fails
  invisibly defeats its purpose.
- **Verdict on an already-decided draft** — server action re-reads the draft's
  status and reports "already decided" instead of double-applying a ladder
  move. Two phones, or a phone and a CLI, can reach the same draft.
- **Verdict write fails** — the optimistic UI reverts and the card stays
  pending. Never show approved when nothing was written.
- **Decline with an empty reason** — refused client and server side.

## Testing

The existing 129 tests cover the engine and keep passing untouched. New tests,
following the existing vitest setup with `dotenv/config` in `setupFiles`:

- The three new `src/db.ts` queries, against the live test project as the
  existing db tests do
- Each server action: happy path, already-decided draft, empty decline reason,
  and that a decline appends exactly one rule and respects the 30 cap
- The middleware: unauthenticated request to each route redirects to `/login`;
  a non-allowlisted email is rejected
- One render smoke test per route with a stubbed data layer

Deliberately not tested: visual layout. That is what the design canvas is for.

## Deployment

Vercel, connected to the GitHub repo, previews on every branch and production
on `main`. Environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
are set server-side only.

The domain is not bought yet. Build and review against the Vercel preview URL;
point the domain at the project when it lands. Nothing in the app hardcodes a
host.

A web app manifest and icons ship in v1 so the platform can be added to the
iPhone home screen and open without browser chrome. This is cheap and it is the
difference between a site he visits and an app he opens.

## What this does not fix

Denis approved one draft and declined one in two days. This spec removes the
friction that plausibly explains that number: no shell, no Mac, no localhost.
It does not prove the habit. The measurable outcome that would justify
sub-project 2 is simple and should be checked before any metered bill is
started: **drafts reviewed within a day of being produced, over two weeks.**
If that stays near zero on a phone-first app, the problem was never the
interface, and more agents would be the wrong response.
