import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDraftForReview } from "../../../../src/db.js";
import { DraftActions } from "./DraftActions";
import { fmtDateTime } from "../../format";
import { currentUser } from "../../lib/supabaseServer";
import { isValidUuid } from "../../lib/isValidUuid";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  // Same guard as the dashboard's page.tsx: the middleware matcher covers
  // this route already, but a Server Component that reads a single draft's
  // full body should not rest on routing config alone.
  const user = await currentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  // getDraftForReview passes `id` straight into a Postgres uuid-typed
  // filter. A malformed id (not a real draft, but not shaped like a uuid
  // either — e.g. someone editing the URL by hand) makes that query throw
  // "invalid input syntax for type uuid", which is a raw database error, not
  // a "not found". Checking shape first routes that case to the same
  // notFound() a well-formed-but-nonexistent id already gets, without
  // touching getDraftForReview itself. A well-formed id that fails because
  // the database is actually down still throws past this check, uncaught —
  // that must surface as a real error, not a false "this draft does not
  // exist" (the app has an error boundary for exactly that, in a later
  // task).
  if (!isValidUuid(id)) notFound();
  const draft = await getDraftForReview(id);
  if (!draft) notFound();

  return (
    <main className="draft-page">
      <header className="draft-page-head">
        <Link href="/" className="back">Back</Link>
        <div>
          <div className="draft-agent">{draft.agent_name}</div>
          <div className="draft-meta">
            {draft.kind} · {fmtDateTime(draft.created_at)} · level {draft.agent_level}
          </div>
        </div>
      </header>

      <article className="draft-full">{draft.body}</article>

      {draft.status === "pending" ? (
        <>
          <p className="note-band">Nothing publishes. Approving marks it ready for you to post.</p>
          <DraftActions draftId={draft.id} agentId={draft.agent_id} body={draft.body} />
        </>
      ) : (
        <p className="note-band">Already {draft.status}.</p>
      )}
    </main>
  );
}
