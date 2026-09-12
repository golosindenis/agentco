# Build log

What exists, why it is shaped this way, and what is unresolved. Written for
whoever picks this up next, including a future session with no memory of the
build.

## Status as of 2026-09-06

Working, in production, and **rejected as a product structure by Denis on
2026-09-06.** Read the "Where this goes next" section before building on it.

### What runs today

Three agents — Strategist (weekly angles), Writer (daily post), Chief of Staff
(morning brief) — spawned as headless `claude` CLI processes by a LaunchAgent at
07:00 local. Drafts land in Supabase. Denis approves or declines from a CLI or a
local dashboard. Every verdict moves that agent along a four-level autonomy
ladder. **Nothing publishes**: he copies approved text and posts it by hand.

Free Supabase project (org `agentco`, free plan, $0/month). 129 tests. Repo at
`~/agentco`, GitHub `golosindenis/agentco`, private.

### Decisions that are not obvious from the code

- **Agents earn autonomy, they are not granted it.** Promote after 5 clean
  approvals, demote on 2 declines in the last 5, an edit resets the streak.
  Fast promotion is safe because demotion is fast.
- **Backpressure at 3 pending drafts per agent.** Denis's review capacity
  throttles the system, rather than a backlog accumulating that he then avoids.
- **A capacity-skipped task is dropped, not requeued.** Requeueing would rebuild
  exactly the backlog backpressure exists to prevent. Tomorrow makes a new one.
- **Departments are a UI grouping and a column, not an architectural object.**
  Modelling them as real entities produces org-chart software, not a work machine.
- **The brief is read-only, in its own table.** Never approved, exempt from
  backpressure. Consequence: the Chief of Staff never receives a verdict and so
  never leaves level 1. Correct, since it takes no autonomous action.
- **Instructions are capped at 30 rules**, and a decline reason is written into
  them so corrections stick. Uncapped, this becomes the 434 KB CLAUDE.md problem.
- **Publishing is rented, not built** (Blotato has an MCP server). Nine OAuth
  flows and platform app review is months of invisible, commoditized work.

### Things that only failed on contact with reality

Recorded because each cost real time and none was visible from reading code.

- The `claude` CLI needs its **own** `/login`. A spawned child does not inherit
  the desktop app's session. Failure mode: `claude exited 1`, empty stderr.
- **macOS TCC blocks LaunchAgents from `~/Desktop`, `~/Documents`, `~/Downloads`.**
  Exit 126, "Operation not permitted", silently, every morning. This is why the
  repo lives at `~/agentco`.
- Revoking a function from `anon`/`authenticated` does nothing while `PUBLIC`
  still holds the grant.
- Vitest does not load `.env` on its own, so a credential-guarded test suite
  skips forever even when credentials exist.
- The Strategist and Writer were **never actually connected** — approved angles
  were written and read by nothing, so the two-agent split was decorative. Caught
  only by a whole-branch review, not by any per-task review.
- The spawned agent inherited the **service role key and every configured MCP
  server**, because `spawn` passes `process.env` by default.
- A run costs **$0.21-0.29**, most of it fixed overhead: Claude Code re-creates
  ~32k tokens of cached system prompt on every spawn. Cost barely scales with how
  much the agent writes, so fewer longer runs beat more short ones.

## Where this goes next

On 2026-09-06 Denis reviewed the working system and said the structure is wrong.
Asked which part, he selected **all four**:

1. **Too manual.** He still runs commands, approves, copies text, posts it, marks
   it posted. It saved writing and nothing else.
2. **Not a company.** Three agents in one department. No sales, finance, product
   or support. Nothing talks to anything else.
3. **Wrong interface.** A terminal and a localhost dev server is not a product.
   He wants an always-on app, reachable from his phone.
4. **Wrong output.** Drafts are not outcomes. He wants things published and sent,
   with him approving rather than executing.

Three of those change the foundation rather than adding to it:

- **Always-on kills the local runner.** Agents spawn the `claude` CLI on his Mac,
  which only works while it is awake and is why the UI is a dev server. Cloud
  means rewriting the runner against the API, which moves cost from his
  subscription to a metered bill.
- **Actions instead of drafts changes the risk model.** An agent that posts or
  sends needs supervision the ladder was designed for but nothing has yet earned.
- **A real interface implies auth, a domain and phone access**, and approving on
  a phone has to take five seconds, which is a different design from a dashboard.

**The unresolved question, asked and not yet answered:** what monthly API budget
he is willing to carry. Measured at $0.21-0.29 per run, a five-department org
running daily is roughly $150/month. That number decides how many agents can
exist and how often they run, so it precedes the redesign.

The engine — queue, ladder, backpressure, agents-as-rows, the feedback loop — is
sound and worth keeping. What surrounds it is what he is rejecting.

## 2026-09-08 — the platform, and a bug in the core mechanic

Two branches merged to `main` and pushed. A third piece — the Vercel deploy —
is unfinished and failing; read "Where this is stuck" before touching it.

### The platform (`feat/platform`, merged as 0676b45)

The interface rejection from 2026-09-06, addressed on its own. `dashboard/`
moved to `web/` and became an auth-gated app: `/` (phone Today + desktop
Overview from one data load), `/drafts/[id]`, `/org`, `/agents/[key]`,
`/activity`. 158 tests. Spec and plan in `docs/superpowers/`.

The engine gained only four read queries, `setAgentEnabled`, and a
`can_publish` field the column always had. Agents still run as `claude` CLI
processes under the 07:00 LaunchAgent. There is deliberately **no "Run now"
button**: a queued task would sit until morning, so the control would report
success and produce nothing.

Built task-by-task with a fresh subagent and a reviewer per task. What the
reviews caught, recorded because each was a real defect in the written plan:

- **The auth gate authenticated but did not authorize.** The middleware
  checked that a session existed, never whose. The Supabase project has open
  signup, so any second user's valid session passed and got service-role
  read/write of production. `/auth/callback` was worse — it minted sessions
  with no allowlist check at all. Closed on all four paths in.
- **A fail-open matcher**: bare-prefix exclusions meant `/loginish` and
  `/auth/callbackx` skipped middleware entirely. Now segment-anchored.
- **The edit textarea was `name="body"` while the action reads `editedBody`**,
  so every "Edit and approve" would have silently submitted nothing.
- **The live-database tests were vacuous** — deleting the `.eq()` agent filter
  or the `.limit()` would have failed neither. Now plant a second disposable
  agent and assert exclusion; proven by deliberate breaks.
- **The tests created ENABLED agents with immediately-due tasks.** If the 07:00
  job had fired mid-run, the worker would have spawned a real agent for a fake
  row and spent real money. Test agents are now disabled.
- **"$0.0000" shown for unmeasured cost, third recurrence in this repo.** The
  Strategist has runs but no costed runs; the page said it was free. Now "not
  measured", matching what OverviewView already said.
- **The desktop layout was a dead end** — it showed a pending count with no way
  to approve, because the verdict controls lived only in the phone view.
- **The installed phone app rendered under the status bar**, edge to edge, with
  no horizontal padding on the one screen used daily.

Verification needed a signed-in session, which needs an inbox. Hence
`scripts/dev-session.mjs`: mints a real session cookie via the admin API and an
OTP for `ALLOWED_EMAIL`, no email sent, no second user. Without it every screen
would have shipped unlooked-at. Denis's Supabase auth user now exists.

Also renamed the department Growth → Marketing in `src/seed.ts` and in the live
rows. **`npm run seed` upserts instructions wholesale and would erase every
rule the ladder has learned** — documented in the README, not fixed.

### The verdict bug (`fix/verdict-status-divergence`, merged as a959693)

`recordVerdict` writes the draft's status LAST by design, so a mid-way failure
leaves it pending and recoverable, with a `hasApproval` gate making the retry
safe. But the final `setDraftStatus` used the just-submitted verdict
unconditionally. A second, DIFFERENT verdict on an already-decided draft
therefore flipped `drafts.status` while recording nothing — no approval row, no
ladder move, and on a decline no feedback row and no instruction rule. The
typed correction vanished while the UI promised it became a standing rule.

Now converges on the verdict actually recorded. `hasApproval` became
`recordedVerdict` returning `Verdict | null`; `VerdictResult` carries
`alreadyDecided`. Retry semantics unchanged. Proven by reverting the one-line
fix and watching the new tests fail.

Review then caught that the fix applied its own honesty principle to only half
the cases: the CLI still printed "Recorded." on a same-verdict retry, with
ladder numbers from `loadState` rather than an advanced state.

**Still open, structural, needs a decision:** the gate keys on the FIRST side
effect, so a throw between `insertApproval` and `saveState` permanently loses
the feedback row, the rule and the ladder move — the retry does only the status
write. The real fix is per-step idempotence plus a `unique (draft_id)`
constraint on `approvals`. Documented in the code, not implemented.

### Where this is stuck — the Vercel deploy

Project created: team `golosindenis' projects` (Hobby), root directory `web`,
all five environment variables set. Three distinct failures so far, in order:

1. **Build failed** — `Module not found: '@supabase/supabase-js'` from
   `../src/db.ts`, despite `web/package.json` listing it. Root Directory is
   `web`, so Vercel installs only `web/node_modules`; `src/` sits outside it and
   Node resolves that file's imports from the repo root's `node_modules`, which
   was never installed. Invisible locally because the engine's own install has
   already populated the root. Fixed by `web/vercel.json` with
   `installCommand: "npm install --prefix .. && npm install"`, reproduced and
   verified on a clean clone. (d0d3b1b)
2. **Dynamic env lookup defeated inlining** — `requireSupabaseEnv()` read
   `process.env[name]` with a computed key through a shared helper. Next only
   inlines `NEXT_PUBLIC_*` on static literal access, so the Edge bundle shipped
   a runtime lookup. Verified by grepping the built bundle: before, the value
   was absent and `process.env[` remained; after, inlined, no dynamic lookup.
   A real bug — but NOT the crash. (bf43059)
3. **ESM / CommonJS mismatch** — the runtime log named it exactly: "Failed to
   load the ES module: /var/task/web/middleware.js. Make sure to set
   "type": "module" in the nearest package.json". The repo root declares
   `"type": "module"` so Next emits ESM, but `web/package.json` declared no
   type, so Node loaded it as CommonJS and rejected the first `import`.
   Invisible locally because `next start` loads middleware through Next's own
   runtime, not as a bare Node module. Added `"type": "module"`. (bb41511)

**As of the end of the session the site still returns
MIDDLEWARE_INVOCATION_FAILED.** Unknown whether bb41511 had finished deploying
when that was last checked. **Start tomorrow by confirming bb41511 is Ready,
then reading the runtime log** — it has named the cause exactly once already
and is worth more than any inference.

Two settings also still unchanged, both required before a phone login works:

- **Supabase Site URL still points at localhost.** `signInWithOtp` passes no
  `emailRedirectTo`, so the emailed link follows it. Authentication > URL
  Configuration; add `<domain>/auth/callback` as a redirect too.
- **Supabase signup is still open** (`disable_signup: false`, verified live).
  The app rejects a non-allowed user, but the project still lets anyone create
  one. The app-layer allowlist is currently the only thing standing there.
- **Vercel Authentication (SSO) is on**, which is why external checks bounce to
  `vercel.com/sso-api` while a logged-in browser passes. It will block the
  phone test and the magic-link email. Recommended off for Production, since
  the app's own single-address gate is the real control.

## 2026-09-12 — the deploy, solved

The three fixes of 2026-09-08 were each a real bug and none of them was *the*
bug. The cause was one project setting nobody could see from the code.

First, SSO had to go. Deployment Protection redirects at the edge *before* the
function runs, so no invocation ever happened, no runtime log was ever written,
and `vercel logs` tailed an empty stream. The advice in the last entry — "read
the runtime log, it has named the cause exactly once" — was unfollowable for
that reason. `vercel project protection disable agentco --sso`.

With it off, production answered honestly for the first time: `/login` →
**404 NOT_FOUND**, `/` and `/org` → **500 MIDDLEWARE_INVOCATION_FAILED**. A
404 on a route that exists locally is not an auth problem or a bundling
problem. It means the route was never deployed.

`vercel inspect` on that deployment, in one line:

    Builds
      ┌ .        [0ms]
      └── λ middleware (338.39KB)

The entire production deployment was a single middleware lambda. No pages, no
routes, no static assets. `vercel project inspect` explained why:

    Framework Preset    Other
    Build Command       `npm run vercel-build` or `npm run build`
    Output Directory    `public` if it exists, or `.`

The project was created as a generic "Other" project. Vercel never ran the Next
builder at all — it detected `middleware.ts`, compiled that one file as a
standalone edge function, and shipped it. Which is exactly the observed
behaviour: every route 404s because no route was built, and the middleware
crashes because it was compiled outside the pipeline that gives it its runtime.

Two things are worth keeping from how this went wrong. The locally-pulled
`project.json` reported `framework: 'nextjs'` while the dashboard said "Other" —
the pulled settings lie, and the dashboard is what builds. And the symptom
(MIDDLEWARE_INVOCATION_FAILED) pointed at the middleware so insistently that
three sessions of correct middleware fixes went out before anyone asked the
cheaper question: what is actually *in* the deployment?

Fix: `"framework": "nextjs"` in `web/vercel.json`, so the preset lives in the
repo and a dashboard setting cannot decide it again. Verified on a preview
before merging — 25 output items instead of 1, `/login` 200 rendering its email
form, `/`, `/org`, `/activity` 307 to `/login`, `/manifest.webmanifest` 200
signed out so the PWA can still boot, and `/loginish` correctly gated, which
re-proves the anchored matcher. Merged (a431c02); production matches.

A CLI `vercel deploy` still fails here, and that is expected rather than
broken: it uploads only the root directory (`web`), so the
`npm install --prefix ..` in the install command has no `..`. Git-integration
builds clone the whole repo and work. Deploy through git.

### Still open before a phone login works

Unchanged from the last entry, both on Supabase, neither reachable from code:

- **Site URL still points at localhost.** `signInWithOtp` passes no
  `emailRedirectTo`, so the magic link follows it and a phone tap lands on a
  dead localhost. Authentication > URL Configuration; set it to the production
  URL and add `<url>/auth/callback` as a redirect.
- **Signup is still open** (`disable_signup: false`). The app's single-address
  allowlist is the only control; a second account created directly against the
  Supabase auth API is refused by the app but still exists.
