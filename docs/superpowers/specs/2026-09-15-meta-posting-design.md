# Posting to Meta with a weekly shot list — design

Approved by Denis 2026-09-15. First of three platform builds he put ahead of
content work: **posting** (this), then a video editor, then an AI avatar.
Content roles and what posts are about come after all three.

## Why

agentco drafts, Denis approves, and then he posts every piece by hand. He
wants the platform to run the business: review each piece, then have it go
out. Photos are the other gap: Instagram needs an image, and he wants to know
a week ahead which photos to take so real photos match the posts.

## Decisions Denis made

- Posting first; video editor and avatar are separate later specs.
- **Meta first:** Instagram, Facebook Pages, Threads. LinkedIn and X are the
  very next build and reuse the Post panel and `posts` table.
- **Direct Meta API**, no paid posting service. Posting sits behind one
  internal interface so a service can plug in later for TikTok or X.
- **Denis picks the time:** post now or schedule per account. Scheduled posts
  go out from the cloud with the Mac off.
- **Accounts:** @becoming_denis, @attune, @thesolutiontape. The Solution is
  connected and available in the Post panel only: no daily posts or shot list
  for it until the content work.
- **Weekly shot list:** a week ahead, the platform tells him which photo to
  take for each day's post. He uploads; the post carries his photo.
- Nothing posts without Denis ticking an account and pressing a button.
  Approve still means approved; posting is a separate, deliberate step.

## What Denis sees

### Accounts page (`/accounts`)

- Connect Meta (Facebook Login) and Connect Threads (Threads login).
- A readiness check per account, with the reason when not ready, e.g.
  "Instagram is a personal account, switch it to Creator" or "not linked to
  a Facebook Page".
- "Reconnect needed" when a token has stopped working.

### This week's photos (dashboard card)

One row per day of the coming week: subject, the angle it serves, the shot
brief (scene, framing, orientation), and an upload slot. Shows uploaded,
missing, or used.

### Post panel (draft page)

Shown after Approve on a daily post, or after Send on a carousel.

- One tickbox per account and platform, e.g. "@attune · Instagram". Anything
  a platform cannot take is greyed out with the reason.
- Caption per platform, prefilled with the post text, editable.
- **Post now**, or **Schedule** with date and time in Asia/Dubai.
- Per row afterwards: *scheduled for …* with Cancel, *posted* with a link to
  the live post, or *failed* with Meta's reason and Retry.

### What can go where

| Approved item | Instagram | Facebook Page | Threads |
|---|---|---|---|
| Text post, no photo | no, needs an image | yes | yes |
| Text post with photo | yes | yes | yes |
| Sent carousel | yes, up to 10 slides | yes | yes, up to 20 |

A carousel with more slides than a platform allows is greyed out for that
platform with the limit shown, never silently cut.

## How it works

### 1. Shot list

- Trigger: approving a `weekly_angles` draft queues a `shot_list` task for
  the Strategist, run by the Mac worker like every other task.
- Prompt input: the approved bank and the next seven days of the rota from
  `src/subjects.ts`, skipping The Solution.
- Output: a JSON array, one entry per day `{date, subject, angle, shot}`,
  validated by a pure `parseShotList` (seven entries, known subjects, no
  empty shot). Stored in `shot_lists` (week start, entries jsonb). Never in
  `drafts`, never counts toward backpressure, never moves the ladder.
- Rules in the task prompt: only scenes Denis can actually photograph
  himself; no stock, no staged client moments, no other people's faces
  unless he adds them.

### 2. Photos

- Private Storage bucket `photos`, path `<date>/<file>`. Upload from the card
  via signed upload URLs, the same pattern as carousel slides.
- `photos` table: date, storage path, created_at.
- The worker, writing a `daily_draft`, sets `drafts.photo_path` from that
  day's photo when one exists. The draft page shows it with Swap and Remove
  before approving. `photo_path` is a plain column, **not a foreign key**
  (see Hard-Won Rules on second FKs).

### 3. Accounts and tokens

- Denis creates one Meta developer app (step by step instructions provided).
  The app stays in development mode: he is its admin and posts only to his
  own accounts, which needs no app review.
- Scopes: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`,
  `instagram_basic`, `instagram_content_publish`, `business_management`;
  Threads: `threads_basic`, `threads_content_publish`.
- `social_accounts` table: platform, handle, external id, status
  (`ready`, `not_ready`, `reconnect_needed`), reason, and a Vault secret id.
  Tokens live in `supabase_vault`, readable only by service_role, never sent
  to the browser.
- Page tokens are long lived. Threads tokens last 60 days and are refreshed
  by the scheduler when under 7 days remain.
- Readiness check reads the Instagram account type and its linked Page
  before any tickbox is enabled.

### 4. Posting

- Post or Schedule inserts one `posts` row per ticked account and platform:
  source (draft id or carousel id), account, platform, caption, image paths,
  `scheduled_for`, status (`scheduled`, `posting`, `posted`, `failed`,
  `cancelled`), external post id, permalink, error, attempts.
- `pg_cron` runs every minute and calls `POST /api/publish-due` through
  `pg_net` with a shared secret header. The route claims due rows with a
  single conditional update from `scheduled` to `posting`, so an overlapping
  run or a retry cannot post a row twice.
- Publisher interface `publish(post, token) → {externalId, permalink}`, one
  implementation per platform:
  - Facebook: `/{page-id}/photos` or `/{page-id}/feed`; multi image via
    unpublished photos then a feed post with `attached_media`.
  - Instagram: create container (or carousel children then parent), poll
    status until `FINISHED`, then `media_publish`.
  - Threads: create container(s), then `threads_publish`.
- Images reach Meta as signed Storage URLs valid for one hour.
- Post now uses the same path with `scheduled_for = now()`.

### 5. Failures

- Meta's error message is saved on the row and shown beside Retry.
- An auth error marks the account `reconnect_needed` and fails its rows with
  that reason instead of retrying forever.
- A row stuck in `posting` for over 15 minutes is marked failed with
  "publish did not complete", never silently retried (Meta may have posted).
- Instagram's 25 posts per 24 hours per account is checked when scheduling.
- A failure path carries Meta's response text out with it, never only a
  status code.

## Testing

- Unit, pure: `canPostTo` (item type × platform × slide count), caption
  limits, `isDue`, `parseShotList`, rota to seven day plan.
- Publishers against recorded Meta responses, including the container
  processing wait and error envelopes.
- Live DB tests after each migration; any test writing to Supabase follows
  the production test rules in `CLAUDE.md`.
- **Proof on production:** one real post to each ready account, once with
  Post now and once scheduled five minutes ahead with the Mac off; a shot
  list produced from a real approved bank; a real uploaded photo carried onto
  a daily post and published to Instagram.

## Not in this build

LinkedIn and X (next build), TikTok, YouTube, video editing, AI avatar,
automatic posting without a button, analytics on posted content, and any
change to what posts are about.

## Build order

1. Migration: `social_accounts`, `posts`, `shot_lists`, `photos`,
   `drafts.photo_path`, `photos` bucket, `pg_cron` and `pg_net`.
2. Meta app setup guide for Denis; Accounts page, both logins, Vault storage,
   readiness check.
3. Publishers and `/api/publish-due`, proven with Post now on one account.
4. Post panel on the draft page, scheduling, cancel, retry.
5. Shot list task, dashboard card, photo upload, photo onto daily drafts.
6. End-to-end proof on production.
