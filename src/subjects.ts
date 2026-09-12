/**
 * Which business the Writer's daily draft is for, and the voice it must use.
 *
 * This is the content strategy, in the only form that changes what gets
 * produced: a fixed rota plus a per-subject voice rule appended to the task
 * prompt. It lives in code rather than in the Writer's instructions so it is
 * versioned, reviewable in a diff, and testable — and so that editing it
 * never risks the rules the ladder has learned from Denis's declines, which
 * live in the database.
 *
 * The rota is deterministic rather than left to the Writer's judgement
 * because the Writer has no memory between runs: asked to "pick one", it
 * would drift toward whatever the angle bank listed first and quietly starve
 * the rest. A weekday rota guarantees coverage without the agent needing to
 * remember anything.
 *
 * The Solution is deliberately absent. Its work is outbound wholesale
 * outreach to named buyers, not audience content — a different task kind
 * (`wholesale_outreach`), not a different subject for the same daily post.
 */

export type SubjectKey = "attune" | "denis" | "agentco";

export type Subject = {
  label: string;
  /** Appended to the daily_draft prompt. Tells the Writer whose voice to use. */
  voice: string;
};

export const SUBJECTS: Record<SubjectKey, Subject> = {
  attune: {
    label: "Attune",
    voice:
      "Write for Attune, the hormone intelligent fitness app for women. Follow the " +
      "attune-viral-content voice: specific, plain, written for a woman who is tired " +
      "of being told to eat less and move more. Never describe any Attune coach as AI. " +
      "Never invent a user story, a testimonial or a statistic.",
  },
  denis: {
    label: "Denis personally",
    voice:
      "Write in Denis's own voice for his personal accounts, @becoming_denis on " +
      "Instagram and @becomingdenis on X. Follow the my-content skill. Build in " +
      "public to other founders: what is actually being built, what broke, what was " +
      "learned. First person. Never invent an anecdote he has not lived.",
  },
  agentco: {
    label: "agentco",
    voice:
      "Write about building the agent company itself, for founders watching the build " +
      "in public. The material is real and generated daily by the system, so draw on " +
      "what it actually did rather than on what such a system could theoretically do. " +
      "Never invent a result the system has not produced.",
  },
};

/**
 * Attune gets three slots to agentco's one: it is the full time commitment
 * and the one with a funding deadline behind it. Sunday through Saturday,
 * using the LOCAL day — a late catch up run must post the subject for the
 * day Denis is living in, not the UTC day.
 */
const ROTA: SubjectKey[] = [
  "denis", // Sun
  "attune", // Mon
  "denis", // Tue
  "agentco", // Wed
  "attune", // Thu
  "denis", // Fri
  "attune", // Sat
];

export function subjectFor(date: Date): SubjectKey {
  return ROTA[date.getDay()]!;
}
