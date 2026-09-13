-- Private bucket for finished carousel slides. No storage policies: only the
-- service role (src/db.ts) reads, lists and signs; the browser uploads
-- through short-lived signed upload URLs and views through signed URLs.
insert into storage.buckets (id, name, public)
values ('carousels', 'carousels', false)
on conflict (id) do nothing;
