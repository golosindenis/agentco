"use client";

/**
 * Every page here is a live read of the operations database. When that read
 * fails, the honest thing to show is "the database did not answer" — a blank
 * screen would read as "nothing is happening", which is the one wrong
 * conclusion this app must never let Denis draw.
 *
 * `drafts/[id]/page.tsx` deliberately lets a real database failure throw
 * past its own notFound() check (see the comment there) specifically so it
 * lands here instead of being misread as "this draft does not exist" — this
 * boundary is the other half of that decision, so it must actually show the
 * failure, not swallow it behind a generic message.
 *
 * In a production build, Next strips the real message off of a Server
 * Component render error before it reaches a Client Component boundary like
 * this one — `error.message` becomes the generic "An error occurred in the
 * Server Components render. The specific message is omitted in production
 * builds to avoid leaking sensitive details. A digest property is included
 * on this error instance which may provide additional context." — and
 * attaches a `digest` instead, which is what shows up next to the matching
 * line in the server logs. In dev, `error.message` is the real thrown
 * message (e.g. "recentEvents failed: ..."), and there is no digest. Both
 * cases are rendered below so the band is still useful either way: the
 * production case leans on the digest as the thing to go grep the logs for.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="wrap">
      <div className="health something_failed">
        <div className="headline-row">
          <span className="dot" />
          <span className="state-label">Cannot read</span>
          <span className="headline">The database did not answer</span>
        </div>
        <ul className="evidence">
          <li>{error.message}</li>
          {error.digest && <li>Reference: {error.digest}</li>}
        </ul>
        <p className="note">
          This says nothing about whether your agents ran. It says this app could not
          find out.
        </p>
        <button type="button" onClick={reset} className="primary retry-btn">Try again</button>
      </div>
    </main>
  );
}
