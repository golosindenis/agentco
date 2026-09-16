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

- 2026-09-15 (e5557b7, e572e01…cbb7eb1) — agents spawn with skills disabled after
  the Writer copied a stale vault figure; Meta posting tasks 1-4 of 10 on
  `feature/meta-posting` (0007 applied), Meta app setup (Task 5) next.
- 2026-09-15 (feature/decline-deck) — Decline a deck before Send: required
  reason, opt-in rule, requeues until 3 declined decks per post then "needs a
  rethink". Worker quotes the last decline reason. `src/declineDeck.ts` pure
  and tested; 0006 applied, merged f79a270 and deployed. Untried on a real deck.
- 2026-09-13 (d6c8548…938de6f) — Carousel Producer and a studio inside agentco:
  Make carousel → Producer deck (10 word stop scroll hook) → `/carousels/[id]`
  with the vendored fork editor, Edit text, Send, Download all. Also RunAtLoad
  for the 07:00 run and `?next=` sign in return. Decline deck is designed only.
- 2026-09-12 (cecd5dd) — per-angle verdicts on an angle bank: untick to drop,
  survivors renumbered. A reason always records; a rule appends only when asked.
  `src/angles.ts` is pure and tested; `ladder.ts` unchanged.
- 2026-09-12 (121cabc) — a daily_draft now fails loudly when the approved angle
  bank has nothing for the day's subject, instead of improvising. Strategist
  learned the dash rule through a real decline; third bank came back clean.
## Hard-Won Rules

- **Agents must not see Denis's personal skills.** The spawned `claude` inherits
  HOME and so loaded `~/.claude/skills`; the Writer copied a stale "15 women"
  line from his my-content vault into two posts, and a rule against invented
  numbers could not stop it because the number was in context. Keep
  `--disable-slash-commands` in `buildArgs`.

- **Never add a second foreign key between two tables that already have one.**
  PostgREST then finds two relationships and refuses every embed across them
  ("more than one relationship was found"). `tasks.source_draft_id → drafts`
  did this on 2026-09-13 and broke the draft page and the Writer's angle bank
  query in production; only the live-DB tests caught it. Run `tests/db.test.ts`
  right after any migration that adds a foreign key.
- **launchd's StartCalendarInterval never catches up after power-off**, only
  after sleep. The 07:00 run silently skipped five mornings. `RunAtLoad` covers
  it because `schedule.ts` skips anything already queued today; keep both.
- **`web/app/carousels/studio/` is generated from the threads-carousel fork.**
  Change the fork (branch `denis-customizations`, push to `denis` only), then
  `npm run sync-studio`; the drift test fails on hand edits. When vendoring,
  grep for dynamic `import(` too: `jspdf` is loaded that way and broke the build.

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
