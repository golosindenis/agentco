-- Decline a carousel deck (docs/superpowers/specs/2026-09-15-decline-deck-design.md).
-- A deck Denis rejects before Send is kept, with his reason, so the next
-- Producer prompt can quote it and the draft page can count declines toward
-- the three-deck requeue cap. No foreign keys added.
alter table carousels drop constraint carousels_status_check;
alter table carousels add constraint carousels_status_check
  check (status in ('deck_ready','sent','declined'));
alter table carousels add column decline_reason text;
alter table carousels add column declined_at timestamptz;
