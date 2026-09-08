# agentco

Denis's businesses run as a small company of agents. Three today — Strategist
and Writer (Marketing), Chief of Staff (Office) — spawned as headless `claude`
CLI processes by a 07:00 LaunchAgent, writing drafts to Supabase. Denis
approves, edits or declines; each verdict moves that agent along a four-level
autonomy ladder, and a decline's reason is appended to that agent's standing
instructions so the correction sticks. **Nothing publishes.**

- **Engine:** `src/` — queue, ladder, backpressure, verdicts. Node, ESM, vitest.
- **App:** `web/` — Next.js, auth-gated, deployed to Vercel with root directory
  `web`. `npm run web` for local dev.
- **Full history:** `docs/build-log.md`. Narrative, decisions, and everything
  that only failed on contact with reality. Read it before rebuilding anything.

## Recent Changes

<!-- Keep to FIVE lines. Adding one means deleting the oldest. Story goes in
     docs/build-log.md, which is read on demand and never loaded into context. -->

- 2026-09-08 (bb41511, bf43059, d0d3b1b) — Vercel deploy attempts: root-dependency
  install, static `NEXT_PUBLIC_*` reads, `web/` declared ESM. **Site still returns
  MIDDLEWARE_INVOCATION_FAILED; unfinished.**
- 2026-09-08 (a959693) — engine: `recordVerdict` now converges a retried verdict on
  the outcome actually recorded, instead of flipping the draft's status and
  discarding the decline reason.
- 2026-09-08 (0676b45) — the hosted phone-first app merged: five routes, auth gate on
  every one, 158 tests. Replaces the local `dashboard/`.

## Hard-Won Rules

- **`npm run seed` is not idempotent.** It upserts `instructions` wholesale and
  will erase every rule the ladder has learned from Denis's declines. Run it
  once, against a fresh database, and never again on a live system.
- **The app must never gain a "Run now" button** while the runner is the 07:00
  LaunchAgent. A queued task sits until morning, so the control would report
  success and produce nothing. It arrives with the cloud runner, not before.
- **Anything reachable from `web/middleware.ts` must read `NEXT_PUBLIC_*` with
  static literal access** (`process.env.NEXT_PUBLIC_X`), never a computed key.
  Next only inlines on literal access; a dynamic lookup ships a runtime
  `process.env[...]` into the Edge bundle that resolves to undefined on Vercel
  and takes down every route including `/login`.
- **`web/package.json` must keep `"type": "module"`.** The repo root declares it,
  so Next emits an ESM middleware bundle; without a matching declaration Node
  loads the deployed file as CommonJS and rejects its first `import`.
- **Unmeasured cost is not zero.** An agent with runs but no costed runs must
  read "not measured", never `$0.0000`. This has regressed three times.
- **A test that writes to Supabase writes to PRODUCTION.** Insert agents
  `enabled: false` so the worker cannot claim their tasks, delete `events`
  explicitly (`agent_id` is ON DELETE SET NULL, it does not cascade), and clean
  up by captured id.
