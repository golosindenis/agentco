-- Nothing in this system publishes (see the README) — an approved draft used
-- to have no way back out of the database once Denis approved it in
-- `npm run review`. `posted_at` closes that gap: null means approved but not
-- yet posted by hand; it is set the moment `scripts/drafts.ts --posted`
-- retires one. The index supports `approvedUnpostedDrafts`'s query exactly:
-- filter by status and posted_at, then drain oldest first.
alter table drafts add column posted_at timestamptz;
create index drafts_unposted_idx on drafts (status, posted_at, created_at desc);
