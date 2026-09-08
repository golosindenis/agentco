/**
 * Whether `value` has the shape of a UUID (any RFC 4122 version/variant —
 * this is a shape check, not a strict version validator).
 *
 * `web/app/drafts/[id]/page.tsx` calls this on the route's `[id]` param
 * before it ever reaches `getDraftForReview` (src/db.ts). Postgres rejects
 * a malformed uuid filter with "invalid input syntax for type uuid", which
 * `getDraftForReview` re-throws as-is — that's a raw database error, not a
 * "not found", and left unhandled it surfaces to the visitor as a 500 with
 * the driver's own error text. A well-formed but nonexistent id already
 * renders the page's `notFound()` case; validating shape first routes a
 * malformed id there too, so both wrong-id cases look the same to whoever
 * is clicking around.
 *
 * This is a shape check only, not a substitute for error handling: a
 * well-formed id that hits a genuine Supabase outage still throws past this
 * check, uncaught, into the route's error boundary — which is the correct
 * behavior, since "the database is down" is not the same fact as "this
 * draft does not exist" and must not be reported as one.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}
