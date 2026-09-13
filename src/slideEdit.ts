/**
 * Pure helpers behind the studio's text panel. The panel edits wording only:
 * the fields below, on slides whose count, order and types never change, so
 * the editor, Send and the saved deck stay in step. Validation of the result
 * is parseDeck's job, not this module's.
 */

export type EditableField = "text" | "subtext" | "italics";

type SlideLike = Record<string, unknown>;

/**
 * Returns a new slides array with one field changed on one slide. Other
 * slides keep their identity. An emptied optional field is removed rather
 * than saved as "" or [], so the builder does not render an empty line.
 */
export function editSlide<T extends SlideLike>(
  slides: T[], index: number, field: EditableField, value: string | string[],
): T[] {
  return slides.map((slide, i) => {
    if (i !== index) return slide;
    const next: SlideLike = { ...slide };
    const empty = Array.isArray(value) ? value.length === 0 : value.trim() === "";
    if (empty && field !== "text") {
      delete next[field];
    } else {
      next[field] = value;
    }
    return next as T;
  });
}

/** One italic phrase per line, trimmed, blank lines dropped. */
export function italicsFromLines(lines: string): string[] {
  return lines.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function italicsToLines(italics: string[] | undefined): string {
  return (italics ?? []).join("\n");
}

/** Same number of slides, in the same order, with the same types. */
export function sameShape(before: { type?: unknown }[], after: { type?: unknown }[]): boolean {
  return before.length === after.length && before.every((s, i) => s.type === after[i]?.type);
}
