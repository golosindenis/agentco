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
| How | The full editor, built into agentco (revised 2026-09-13, see below) |
| Where he opens it | Mac or laptop, so no mobile layout work |
| How images reach the phone | "Send" uploads them; the draft shows them on the phone |

Rejected: rendering the cover in every Look (A), rendering every Look in full
(C), a phone editor, a secret token in the link (anyone holding the link
could open private decks).

**Revision, 2026-09-13, after plan 1 shipped.** The first version hosted the
editor as its own Vercel project with its own sign-in. Denis rejected that:
the builder has to be integrated into the platform and the design picked
inside it. Also rejected: an iframe of a separately hosted editor (two
deploys, cross-domain sign-in inside a frame is fragile in Safari) and a
simplified Look picker without per-slide editing.

## Flow

1. On an approved `daily_draft`, Denis taps **Make carousel**. This queues a
   `carousel` task with `source_draft_id` set.
2. The Mac worker runs the Producer, which writes a deck as JSON in the
   builder's `SlideData` shape. `parseDeck` validates it.
3. The deck is saved to `carousels` with status `deck_ready`.
4. The draft shows **Carousel ready – Open in studio**, linking to
   `/carousels/<carousel id>` inside agentco.
5. On the Mac that page is the real editor, built into agentco, with the deck
   loaded. Denis picks Look, font and background in the editor. The editor
   has no text editing of its own, so wording is changed in the studio's
   Edit text panel, which saves the slides back to the deck after the same
   parseDeck checks (corrected 2026-09-13).
6. **Send** exports PNGs in the browser, uploads them to the private
   `carousels` Storage bucket, records the Look and settings, and marks the
   carousel `sent`.
7. On the phone the draft shows the images in a horizontal strip; a long
   press saves one to the camera roll.

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
  `queued`), failed (reason and retry), `deck_ready` (Open in studio, linking
  to `/carousels/<id>`), `sent` (a horizontal strip of the images via
  short-lived signed URLs; long press saves to the camera roll).

## Studio inside agentco (plan 2)

### Where the code lives

- The fork (`~/.claude/skills/threads-carousel`, branch
  `denis-customizations`, push to `denis` only, never `origin`) stays the
  source of the editor.
- `npm run sync-studio` (agentco) copies the fork's `src/app/CarouselApp.tsx`
  to `web/app/carousels/studio/app/CarouselApp.tsx` and `src/lib/*.ts` to
  `web/app/carousels/studio/lib/`, prepends a generated-file banner and
  `// @ts-nocheck`, and rewrites the one import from `../slides` to `../deck`.
  The vendored files are committed (Vercel builds agentco's repo only).
- A drift test compares the vendored files with a fresh transform of the
  fork and fails when they differ. It skips when the fork is not on disk.

### How the deck gets in

`web/app/carousels/studio/deck.ts` exports `SLIDES` and `WATERMARK` as `let`
bindings plus the `DEFAULT_*` constants, and a `setDeck(slides, watermark)`
function. ES module imports are live bindings, so the studio page calls
`setDeck` before it dynamically imports the editor, and the editor renders
the carousel's deck with no logic change.

### Two small fork changes

- A `useEffect` in `CarouselPage` publishes `window.__carouselStudio` with
  the slide count and types, `captureSlide`, and the current design settings
  (`lookId`, `fontId`, `surfaceId`, `accentId`, `purposeId`, `formatId`, the
  effective background). Nothing reads it when the builder runs locally.
- The MP4 button renders only when `NEXT_PUBLIC_HIDE_MP4` is not `"1"`.
  The sync script replaces that expression with `"1"` in agentco's copy, so
  no Vercel variable is needed; the ffmpeg routes are not vendored.

### Styling and fonts

The editor styles itself inline (198 inline style blocks, 24 class names,
none of them Tailwind utilities), so Tailwind is not brought in. The
builder's own rules (toolbar, slide card and Aurora motion classes) go into
`web/app/carousels/studio/studio.css`, without the Tailwind import or the
`body` reset. `web/app/carousels/layout.tsx` loads the builder's 14
`next/font/google` faces and applies their CSS variables to a wrapper, so
they load only on carousel pages.

### Login

None of its own: `/carousels/[id]` is an agentco page behind the existing
middleware and `currentUser()` allowlist.

### Server actions (`web/app/carousels/actions.ts`)

- `startCarouselUpload(carouselId, slideTypes)`: returns one signed upload
  URL per slide (upsert on, so a retry overwrites). Vercel's 4.5 MB request
  body limit rules out posting the PNGs through the function.
- `completeCarousel(carouselId, slideTypes, settings)`: lists the carousel's
  objects in the bucket; if any expected slide is missing it refuses and
  names it, otherwise writes `image_paths`, `look`, `settings`, `status
  sent`, `sent_at`.

Both call `requireAuthorizedUser()` first.

## Errors

| Failure | Result |
|---|---|
| Source draft missing or not approved | Task failed, reason logged, draft shows failure and retry |
| Output not a valid deck | `output_rejected` with the broken rule, nothing saved |
| Mac off when tapped | Task stays queued, draft shows "Waiting for your Mac", run-at-load picks it up |
| Signed out or not allowlisted | agentco's login redirect; the deck is never rendered |
| Unknown carousel id | 404, no local fallback |
| An upload fails | Stays `deck_ready`, editor names the slide, Send retryable, reuploads overwrite |

## Testing

agentco, Vitest, tests written first:

- `parseDeck`: one test per rule, and the real `attune-two-choices` deck passes.
- Worker `carousel`: source draft appended to the prompt; missing, unapproved
  or non-`daily_draft` source fails; backpressure skipped; writes `carousels`
  not `drafts`; streak unchanged.
- Watermark selection per subject.

Studio (plan 2):

- `transformEditor`, `transformLib`, `transformCss`: one test per rewrite,
  and a refusal when the fork no longer has the import or guard they rely on.
- Drift test: vendored files equal a fresh transform of the fork (skips when
  the fork is not on disk).
- `slidePath`, `expectedPaths`, `missingSlides`: pure, tested.
- `carouselView` now links to `/carousels/<id>`.
- The fork's own `next build` passes after its two changes; agentco's web
  typecheck and `next build` pass with the vendored editor.

## Proof of done, on production

1. Tap Make carousel on a real approved draft, on the phone.
2. The worker produces a valid deck and the draft shows Open in studio.
3. Open it on the Mac inside agentco; the real editor shows the deck.
4. Pick a Look never exported before (e.g. `vista`) and inspect the slides at
   full resolution, not thumbnails.
5. Send; the carousel row is `sent` with one image path per slide, and on
   the phone the draft shows the strip and a long press saves an image.
6. An image from agentco and a local fork export of the same deck and Look
   look identical, fonts included.

Not done until step 6 passes and Denis has seen it on his phone.

## Build order

1. agentco migration, `parseDeck`, Producer row and worker path. (Plan 1, shipped.)
2. Fork: studio bridge and MP4 guard.
3. agentco: sync script, vendored editor, deck module, drift test.
4. Storage bucket, upload and complete actions.
5. `/carousels/[id]` studio page, fonts and scoped CSS.
6. Draft page: Open in studio and the sent image strip.
7. End-to-end proof.
