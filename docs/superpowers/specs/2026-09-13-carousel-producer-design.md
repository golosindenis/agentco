# Carousel Producer — design

Date: 2026-09-13. Status: approved in brainstorming, awaiting spec review.

## Why

Denis's 2026-09-06 rejection included "wrong output": drafts are not outcomes.
Of the three deferred capabilities (Publisher, Producer, Researcher) he chose
the Producer first. It turns an approved post into a finished carousel made
in his own builder, never a basic template, and it publishes nothing, so it
needs no autonomy the ladder has not earned.

Two constraints shaped everything:

- agentco agents are text only: `claude --print` in a temp dir, no browser,
  no files.
- The builder (`~/.claude/skills/threads-carousel`, a fork) makes images only
  in a browser: a deck is `src/decks/<name>.ts` exporting `SLIDES`, selected
  by a static import in `src/slides.ts`, exported with `html-to-image`.

## Decisions Denis made

| Question | Choice |
|---|---|
| What triggers a carousel | A "Make carousel" button on an approved draft |
| Who picks the design | Denis, in the real editor, not pre-rendered previews |
| How | Host the full editor (option B) |
| Where he opens it | Mac or laptop, so no mobile layout work |
| How images reach the phone | "Send to agentco" uploads them; the draft shows them on the phone |

Rejected: rendering the cover in every Look (A), rendering every Look in full
(C), a phone editor, a secret token in the link (anyone holding the link
could open private decks).

## Flow

1. On an approved `daily_draft`, Denis taps **Make carousel**. This queues a
   `carousel` task with `source_draft_id` set.
2. The Mac worker runs the Producer, which writes a deck as JSON in the
   builder's `SlideData` shape. `parseDeck` validates it.
3. The deck is saved to `carousels` with status `deck_ready`.
4. The draft shows **Carousel ready – open editor**, linking to
   `<editor host>/c/<carousel id>`.
5. On the Mac the link opens the real editor with the deck loaded. Denis
   picks Look, font and background and edits slides as today.
6. **Send to agentco** exports PNGs in the browser, uploads them to the
   private `carousels` Storage bucket, records the Look and settings, and
   marks the carousel `sent`.
7. On the phone the draft shows a swipeable carousel with save to camera roll.

Out of scope: hosted MP4 export, approve or decline on a carousel, any
publishing.

## agentco changes

### Database (migration only, never `npm run seed`)

- `tasks.source_draft_id uuid null references drafts(id) on delete cascade`.
  `tasks.kind` has no check constraint; `TaskKind` in `src/types.ts` gains
  `"carousel"`. `carousel` is not added to `POSTABLE_KINDS`.
- Agent row: `key producer`, `display_name Producer`, department Marketing,
  level 1, `can_publish false`, enabled.
- Table `carousels`: `id uuid pk`, `task_id uuid references tasks`,
  `source_draft_id uuid not null references drafts`, `slides jsonb not null`,
  `watermark text not null`, `status text check (status in ('deck_ready','sent'))
  default 'deck_ready'`, `look text null`, `settings jsonb null`,
  `image_paths text[] null`, `created_at timestamptz default now()`,
  `sent_at timestamptz null`. RLS on, no anon or authenticated grants
  (service role only, revoke from PUBLIC as with the existing functions).
- Private Storage bucket `carousels`. Object path
  `<carousel id>/<nn>-<slide type>.png`.

### Producer instructions

Deck format, plus Denis's carousel rules: no dashes of any kind; never invent
anecdotes, statistics or testimonials; never describe Attune coaches as AI;
quiet editorial copy with no badges, stickers or emoji slides; keep the
source draft's wording, cutting rather than rewriting. The instructions embed
`decks/attune-two-choices.ts` as the pattern: short statement line, one
italic phrase lifted verbatim from it, a supporting `subtext` sentence.

### Worker

`carousel` is handled like `daily_draft` and `brief` are today:

- Load the source draft. If it is missing, not `approved`, or not a
  `daily_draft`, finish the task `failed` with the reason and log it.
- Append the draft body and its subject voice to the prompt.
- Skip the backpressure check (carousels are on request, not pending review).
- Validate with `parseDeck`. On failure log `output_rejected` with the rule
  broken and fail the task. Nothing partial is saved.
- Insert into `carousels`, never `drafts`. The ladder streak is untouched.
- Log `carousel_created` with the same usage telemetry as `draft_created`.

A second tap creates a new deck; the UI shows the newest per draft.

### `src/deck.ts` — `parseDeck(body)`

Pure, no database. Rejects unless:

- the body is a JSON array of 5 to 10 slides;
- the first slide is `hook` and the last is `cta`;
- every type is one of `hook body cta quote list stats comparison`
  (`image` needs files the agent cannot supply; `emoji` and `number` are
  the sticker style Denis rejected);
- every `italics` entry and `highlight` appears verbatim, case-insensitively,
  in that slide's `text`;
- no string anywhere contains `-`, `–` or `—`;
- no key outside `SlideData` is present.

Returns `{ ok: true, slides }` or `{ ok: false, reason }` naming the slide and rule.

### Watermark

Chosen by the source draft's subject and stored on the row: `attune` and
`denis` use `@becoming_denis`; `agentco` uses `@becomingdenis`.

### Web app

- **Make carousel** server action on approved `daily_draft`s, through
  `currentUser()` and the allowlist.
- Draft states shown: queued ("Waiting for your Mac" while the task is
  `queued`), failed (reason and retry), `deck_ready` (editor link), `sent`
  (swipeable images via short-lived signed URLs, save to camera roll).

## Builder changes (fork)

Commit on `denis-customizations`, push to `denis` only, never `origin`.

- `CarouselApp.tsx` imports `SLIDES`, `WATERMARK` and the `DEFAULT_*`
  constants at module level and derives `CANVAS_W`/`CANVAS_H` there. These
  become a `deck` prop (slides, watermark, defaults). Rendering, Looks and
  export code are otherwise untouched.
- `page.tsx` with no id passes the deck from `slides.ts`, so local use is
  unchanged. Route `/c/[id]` fetches `GET /api/deck/<id>` and passes that.
  A missing id shows "Carousel not found"; it never falls back to the local
  deck.
- `HOSTED=1` hides the MP4 control and makes `/api/frames` and `/api/encode`
  return 404.
- A **Send to agentco** control, shown only when a carousel id is loaded.

### Hosting

Separate Vercel project (the builder is Next 15, agentco web is Next 16):
repo `golosindenis/threads-carousel-denis`, branch `denis-customizations`,
root `template`, Framework Preset explicitly **Next.js** (the agentco
four-day deploy failure was this setting). Fonts come from `next/font/google`
and are bundled at build, so exports do not depend on Google at runtime.

### Login

Its own sign-in page, because agentco's session cookie cannot cross domains:
same Supabase project, same six-digit email code, same allowlist check
against Denis's address, enforced in middleware and in every API route.

### API routes (server only, service role key never sent to the browser)

- `GET /api/deck/<id>`: allowlisted session required; returns slides,
  watermark and status.
- `POST /api/deck/<id>/send` with `{ slideCount }`: returns one signed upload
  URL per slide. Vercel's 4.5 MB request body limit rules out posting 7
  PNGs at 2160×2700 through the function.
- `POST /api/deck/<id>/complete` with `{ look, settings }`: verifies every
  expected object exists in the bucket, then writes `image_paths`, `look`,
  `settings`, `status sent`, `sent_at`. If any object is missing it refuses
  and names the slide.

## Errors

| Failure | Result |
|---|---|
| Source draft missing or not approved | Task failed, reason logged, draft shows failure and retry |
| Output not a valid deck | `output_rejected` with the broken rule, nothing saved |
| Mac off when tapped | Task stays queued, draft shows "Waiting for your Mac", run-at-load picks it up |
| Signed out or not allowlisted | Sign-in page or "not allowed"; the deck is never sent |
| Unknown carousel id | "Carousel not found", no local fallback |
| An upload fails | Stays `deck_ready`, editor names the slide, Send retryable, reuploads overwrite |

## Testing

agentco, Vitest, tests written first:

- `parseDeck`: one test per rule, and the real `attune-two-choices` deck passes.
- Worker `carousel`: source draft appended to the prompt; missing, unapproved
  or non-`daily_draft` source fails; backpressure skipped; writes `carousels`
  not `drafts`; streak unchanged.
- Watermark selection per subject.

Builder (no test tooling exists):

- `tsc --noEmit` and `next build` pass locally and on Vercel.
- Regression: export an existing local deck before and after the prop change;
  the PNGs must match pixel for pixel.
- Vitest added to the builder as a dev dependency, scoped to the three API
  routes only: allowlist refusal, not found, and `complete` refusing while
  any image is missing. The editor itself stays untested beyond the
  regression export.

## Proof of done, on production

1. Tap Make carousel on a real approved draft, on the phone.
2. The worker produces a valid deck and the draft shows the editor link.
3. Open it on the Mac and sign in with the six-digit code.
4. Pick a Look never exported before (e.g. `vista`), export, and inspect at
   full resolution, not thumbnails.
5. Send to agentco; on the phone the carousel appears, swipes, and saves to
   the camera roll.
6. A hosted PNG and a local export of the same deck and Look look identical,
   fonts included.

Not done until step 6 passes and Denis has seen it on his phone.

## Build order

1. agentco migration, `parseDeck`, Producer row and worker path.
2. Builder deck-prop change with the regression export.
3. Hosting, login, deck API.
4. Send and complete routes, and the phone view in agentco.
5. End-to-end proof.
