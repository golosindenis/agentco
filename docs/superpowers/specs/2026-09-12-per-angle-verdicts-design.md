# Per-angle verdicts — design

**Date:** 2026-09-12
**Status:** approved, not yet implemented

## Why this exists

A `weekly_angles` bank is one draft row with one verdict, so "approve these six,
reject that one" cannot be expressed. On 2026-09-12 Denis approved a bank and
said he had declined one angle — an invented claim about him coaching his own
family. The database recorded a plain `approved` with the angle still in the
body, and the next day's rota was a Denis day where that was the only [Denis]
angle. It had to be edited out of production by hand, and the correction taught
the ladder nothing.

Two distinct gaps, and the second is the substantive one:

1. Editing a seven-angle bank means retyping it in a textarea, on a phone.
2. `approved_with_edit` carries no reason. `recordVerdict` writes a feedback row
   and appends a rule only when the verdict is `declined`, so an edit fixes the
   artifact and the agent learns nothing.

## What changes

### Detection, not configuration

If a draft body parses as two or more numbered angles, the review screen shows
the per-angle list. Anything else — a `daily_draft` post, a `wholesale_outreach`
message — keeps the existing textarea. Nothing is added to the `drafts` table
and there is no flag that can disagree with the body it describes.

### `src/angles.ts` — pure, no database

```ts
export type Angle = { n: number; tag: string | null; text: string };
export function parseAngles(body: string): Angle[] | null;  // null when not a bank
export function formatAngles(angles: Angle[]): string;      // renumbered 1..n
```

Same shape as `costs.ts` and `subjects.ts`: arithmetic and parsing separated
from anything that touches Supabase, so every edge case is testable without a
database. `parseAngles` returns `null` rather than an empty array for prose, so
a caller cannot mistake "not a bank" for "a bank with no angles".

### Three outcomes from one form

| action | verdict | body |
|---|---|---|
| keep everything | `approved` | unchanged |
| drop some | `approved_with_edit` | kept angles, renumbered |
| drop all | `declined` (reason required) | unchanged |

`ladder.ts` does not change. It already gives `approved_with_edit` the right
treatment: streak resets so there is no promotion credit, but it does not count
toward demotion. That is exactly "this was nearly right".

### Learning: reason always, rule on request

Each dropped angle gets a reason box and a **make this a rule** checkbox.

- A reason always writes a feedback row.
- A rule is appended to the agent's instructions **only** when the box is ticked.

Denis chose this over always-append because the Strategist is already at 13
rules of a `MAX_RULES` cap of 30, with two of them saying the same thing, and
most dropped angles are weak rather than rule-breaking. The cap is a scarce
resource and should hold corrections that generalise.

This requires one change in `recordVerdict`: rule-appending is currently
hardwired to `verdict === "declined"`. It becomes

```
(verdict === "declined" && reason) || (makeRule && reason)
```

The decline path keeps its current behaviour exactly — that loop was proven
working on 2026-09-12 and must not be disturbed. `appendRule`'s existing dedupe
and cap checks are reused untouched, so `ruleAppended` / `ruleCount` continue to
report what actually happened rather than what was attempted.

## Testing

Parser:
- round-trips a real bank unchanged
- returns `null` for prose, for a single angle, and for an empty body
- preserves `[Tag]` markers through a drop and renumber
- renumbers `1..n` after dropping from the middle

Verdict:
- `makeRule: true` with a reason appends a rule on `approved_with_edit`
- `makeRule: false` with a reason writes feedback and appends NO rule
- a decline with a reason still appends a rule with no `makeRule` passed
- dropping every angle without a reason is refused

## Out of scope

Angles as their own table. It is the more correct model and it is a migration,
a worker change and a UI rewrite to reach an outcome this design reaches with a
parser and one boolean.
