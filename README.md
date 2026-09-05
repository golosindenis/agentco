# agentco

Agents that do the work while Denis approves, and need less approval over time.

Three agents run on a schedule and write drafts into Supabase. Denis approves or
declines each one from a CLI. Every verdict moves that agent up or down a
four-level autonomy ladder, so an agent that proves itself needs less
supervision. Nothing publishes anything: drafts land in the database and stop.

| Agent | Job | Cadence |
|---|---|---|
| Strategist | Proposes the week's angles. Runs `divergence` so nothing reads like stock marketing. | Weekly |
| Writer | Turns one approved angle into a post in Denis's voice. | Daily |
| Chief of Staff | Writes the morning brief: what ran, what is waiting, what broke. | Daily |

## One-time setup

**1. The `claude` CLI must be logged in.** The worker spawns a headless
`claude` process for each agent run. That is a separate login from the Claude
Code desktop app — a spawned child does not inherit the app's session. Run
`claude` in a terminal, then `/login`, once. Without it every run fails with
`claude exited 1` and an empty stderr, which is not obvious from the logs.

Check it works:

```bash
printf 'reply with exactly: OK\n' | claude -p
```

**2. Install and configure:**

```bash
npm install
```

Copy `.env.example` to `.env` and fill in the Supabase URL and **service role**
key (not the anon key). `.env` is gitignored.

**3. Apply `supabase/migrations/0001_init.sql`** in the Supabase SQL editor, then
seed the agents:

```bash
npm run seed
```

## Daily use

```bash
npm run worker              # drains every due task, then exits. Run from cron.
npm run worker -- --dry-run # same, but writes to the *_dryrun tables. Nothing real.
npm run review              # walk the pending drafts: approve, edit, or decline
```

The worker is not a daemon. It drains what is due and exits, so cron owns the
schedule. There is no scheduler in this repo yet — tasks are queued by hand or
by whatever you point at it.

## The rules

Agents start at level 1 and draft only.

- **Promote** after 5 approvals in a row with no edit.
- **Demote** a level immediately on 2 declines within the last 5 verdicts.
- **Approving after an edit** resets the streak without changing the level.
- An agent stops producing at **3 drafts pending**, so review capacity throttles
  the system rather than a backlog building up with your name on it.
- A decline reason is written into that agent's instructions so the correction
  sticks, capped at **30 rules**. At the cap nothing is appended and you are told
  to consolidate; the full history always goes to the `feedback` table.

## Two things that will confuse you otherwise

**The Writer needs an approved angle bank.** A `daily_draft` task fails with a
clear reason when no approved `weekly_angles` draft exists. That is deliberate —
without it the Writer invents its own angle, which makes the Strategist
pointless. Run and approve a Strategist task first.

**The brief is not a draft.** It writes to its own `briefs` table, never enters
the approval queue, and is exempt from backpressure. You read it at the top of a
review session; you never approve it. That means the Chief of Staff never
receives a verdict and so never leaves level 1 — correct, since it takes no
autonomous action.

## Tests

```bash
npm test          # 88 tests
npm run typecheck
```

The ladder, backpressure, output assertion, worker loop and review logic run
with no database and no model calls. `tests/db.test.ts` runs against the live
database in `.env` — `vitest.config.ts` loads `.env` via `setupFiles`, without
which those tests silently skip forever even when credentials are present.

`src/cli.ts` has no tests. It is verified by reading and by use.

## Layout

| File | Responsibility |
|---|---|
| `supabase/migrations/0001_init.sql` | Schema, `claim_next_task()`, RLS |
| `src/types.ts` | Shared types. No logic. |
| `src/ladder.ts` | Pure. Verdict → new level/streak/history. |
| `src/capacity.ts` | Pure. Pending count → may this agent produce? |
| `src/output.ts` | Pure. Is this run's output usable? |
| `src/db.ts` | Every query. The only file that touches the network. |
| `src/runner.ts` | Spawns the headless agent. Timeout, output cap, kill escalation. |
| `src/worker.ts` | The loop that ties it together. |
| `src/review.ts` | Verdict recording and the feedback loop. |
| `src/cli.ts` | The review session. |
| `src/seed.ts` | Inserts the three v1 agents. |

## Security notes

RLS is on for every table with **no policies**, deliberately. The service role
bypasses RLS, so the worker and CLI are unaffected; everything else is denied by
default. Do not "fix" this by adding permissive policies.

`claim_next_task()` is revoked from `PUBLIC` and granted only to `service_role`.
Revoking from `anon` and `authenticated` alone is not enough — Postgres grants
execute to `PUBLIC` by default, and both roles still had access until `PUBLIC`
was revoked.

The spawned agent gets an explicit environment allowlist and runs from the OS
temp directory, so it never sees `SUPABASE_SERVICE_ROLE_KEY` and does not start
inside this repo. `HOME` is passed through deliberately, so the agent's skills
load — which also means it loads global Claude config and any configured MCP
servers. Restricting the child's tools is open work.
