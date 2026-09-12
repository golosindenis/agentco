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

- 2026-09-12 (731e74e) — the Marketing department got a content strategy:
  `src/subjects.ts` rotates the daily draft over Attune / Denis / agentco by
  weekday with per-subject voice, and The Solution got its own Friday
  `wholesale_outreach` kind. Scheduler installed and firing.
- 2026-09-12 (6b4cf3d) — `/org` shows whether drafts are reviewed within a day
  (trailing 14d) plus median time to review. `src/cadence.ts` is pure and tested;
  `rate` is null, not 0, when nothing is eligible.
- 2026-09-12 (af34694, bb02d13, e74a227) — **login works from his phone.** Custom
  SMTP via Resend was the unlock: Supabase locks email templates on the built-in
  mailer, so `{{ .Token }}` could not be added until SMTP existed. Signup now
  disabled; `shouldCreateUser` flipped to false.
- 2026-09-12 (a431c02) — **the site is up.** The Vercel project's Framework Preset
  was "Other", so the Next builder never ran and the deploy was one lone middleware
  lambda. `vercel.json` now declares `"framework": "nextjs"`. SSO protection off.

- 2026-09-08 (a959693) — engine: `recordVerdict` now converges a retried verdict on
  the outcome actually recorded, instead of flipping the draft's status and
  discarding the decline reason.

## Hard-Won Rules

- **The Vercel project's Framework Preset must stay Next.js.** It was created as
  "Other", which silently skips the Next builder entirely: the deploy succeeds,
  reports Ready, and contains nothing but a standalone `middleware` lambda. Every
  route 404s and the middleware crashes with MIDDLEWARE_INVOCATION_FAILED. Three
  correct fixes were shipped against that symptom before anyone looked at
  `vercel inspect`, whose build list names the problem in one line. `vercel.json`
  now pins the preset so a dashboard setting cannot decide this again.
- **A failure path must carry the child's stderr out with it.** `runAgent`'s
  timeout reported only its own duration, so four real timeouts across
  2026-09-07/08 left nothing to investigate — the stderr that would have named
  the cause was collected and dropped. Any new bail-out in `runner.ts` must do
  what `interpretRun` already does and include what the child said.
- **Signup is disabled on the Supabase project; keep `shouldCreateUser: false`.**
  Flipping it back cannot create anyone — it only swaps the allowlist's own
  "That address cannot sign in." for Supabase's "Signups not allowed for this
  instance", which tells a stranger how the project is configured.
- **The Magic Link email template must contain `{{ .Token }}`.** Login is a typed
  six-digit code — `signInWithOtp` then `verifyOtp`, never a redirect — but
  Supabase's default template ships only `{{ .ConfirmationURL }}`, so the email
  arrives with a link and the form has nothing to type into. Do not "fix" this by
  switching to the link instead: the code is requested server-side, so the PKCE
  verifier cookie lives in whichever browser asked, and a link tapped in phone
  mail cannot exchange it. The typed code is what makes this work cross-device,
  and `web/app/auth/callback/route.ts` is a fallback for the same-browser case
  only. Site URL is therefore irrelevant to login, despite what earlier notes said.
- **Deployment Protection (SSO) hides every runtime failure.** It 302s requests at
  the edge before the function runs, so nothing is invoked and the runtime log
  stays empty forever. Turn it off before debugging anything in production.

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
