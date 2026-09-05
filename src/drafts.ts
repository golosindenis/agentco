/**
 * Pure helpers for turning a full draft id into something Denis can type,
 * and back again. No network, no clock — kept separate from src/db.ts's
 * fetch so this logic is unit-testable (see scripts/drafts.ts for the CLI
 * that wires it to the database).
 */

/** The first 8 characters of a uuid — short enough to read and type, long
 * enough that a collision within one queue of unposted drafts is very rare. */
export function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

export type ResolveResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

/**
 * Matches a user-typed short id against a list of full ids by prefix,
 * case-insensitively. An exact full-length id is just a prefix of itself, so
 * it resolves the same way as any other unique prefix — no special case
 * needed.
 *
 * Never silently picks the first of several matches: retiring the wrong
 * draft loses real work Denis approved, with no way to tell after the fact
 * which one got marked posted by mistake. So "no match" and "ambiguous
 * match" are both reported, each with its own reason, and neither one
 * returns an id.
 */
export function resolveShortId(shortIdArg: string, ids: string[]): ResolveResult {
  const needle = shortIdArg.trim().toLowerCase();
  const matches = ids.filter((id) => id.toLowerCase().startsWith(needle));

  if (matches.length === 0) {
    return { ok: false, reason: `no draft matches "${shortIdArg}"` };
  }
  if (matches.length > 1) {
    const shown = matches.map((id) => shortId(id)).join(", ");
    return {
      ok: false,
      reason: `"${shortIdArg}" is ambiguous — it matches ${matches.length} drafts (${shown}). Type more of the id.`,
    };
  }
  return { ok: true, id: matches[0]! };
}
