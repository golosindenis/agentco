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
