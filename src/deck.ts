/**
 * Validates the Producer's output before anything is saved. The builder
 * renders whatever it is given, so a deck that breaks Denis's rules (a dash,
 * an italic phrase that is not in the line, a sticker slide) would only be
 * discovered in the editor. Every rule here comes from the carousel producer
 * spec; a rejection names the slide and the rule so the failed task says
 * exactly what to fix.
 */

export type DeckSlide = Record<string, unknown> & { type: string };
export type DeckResult = { ok: true; slides: DeckSlide[] } | { ok: false; reason: string };

const ALLOWED_TYPES = new Set(["hook", "body", "cta", "quote", "list", "stats", "comparison"]);

/** Fields of the builder's SlideData that a text only agent can fill. */
const ALLOWED_FIELDS = new Set([
  "type", "text", "subtext", "subHighlight", "italics", "title", "highlight",
  "author", "role", "stats", "items", "steps", "leftLabel", "leftItems",
  "rightLabel", "rightItems", "points", "label",
]);

const DASH = /[-–—]/;

export const MAX_HOOK_WORDS = 10;

function stripFence(body: string): string {
  const m = body.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return m ? m[1]! : body.trim();
}

function hasDash(value: unknown): boolean {
  if (typeof value === "string") return DASH.test(value);
  if (Array.isArray(value)) return value.some(hasDash);
  if (value && typeof value === "object") return Object.values(value).some(hasDash);
  return false;
}

export function parseDeck(body: string): DeckResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(body));
  } catch {
    return { ok: false, reason: "output is not valid JSON" };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "deck must be a JSON array of slides" };
  const n = parsed.length;
  if (n < 5 || n > 10) return { ok: false, reason: `deck has ${n} slides; needs 5 to 10` };

  for (let i = 0; i < n; i++) {
    const s = parsed[i] as Record<string, unknown> | null;
    const at = `slide ${i + 1}`;
    if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, reason: `${at} is not an object` };
    const type = String(s.type ?? "");
    if (i === 0 && type !== "hook") return { ok: false, reason: `${at} must be a hook` };
    if (i === n - 1 && type !== "cta") return { ok: false, reason: `${at} must be a cta` };
    if (!ALLOWED_TYPES.has(type)) return { ok: false, reason: `${at} has disallowed type ${type}` };
    if (type === "hook") {
      // A hook is set at display size; past 10 words it overflows the slide
      // (15 words ran off the vista look on 2026-09-13) and stops no scroll.
      const words = typeof s.text === "string" ? s.text.trim().split(/\s+/).filter(Boolean).length : 0;
      if (words > MAX_HOOK_WORDS) return { ok: false, reason: `${at} hook has ${words} words; max ${MAX_HOOK_WORDS}` };
    }
    for (const key of Object.keys(s)) {
      if (!ALLOWED_FIELDS.has(key)) return { ok: false, reason: `${at} has unknown field ${key}` };
    }
    const text = typeof s.text === "string" ? s.text.toLowerCase() : "";
    if (Array.isArray(s.italics)) {
      for (const phrase of s.italics) {
        if (typeof phrase !== "string" || !text.includes(phrase.toLowerCase())) {
          return { ok: false, reason: `${at} italics phrase "${String(phrase)}" is not in its text` };
        }
      }
    }
    if (typeof s.highlight === "string" && !text.includes(s.highlight.toLowerCase())) {
      return { ok: false, reason: `${at} highlight "${s.highlight}" is not in its text` };
    }
    if (hasDash(s)) return { ok: false, reason: `${at} contains a dash` };
  }
  return { ok: true, slides: parsed as DeckSlide[] };
}
