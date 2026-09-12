import type { TaskKind } from "./types.js";

export const TASK_PROMPTS: Record<TaskKind, string> = {
  weekly_angles:
    "Propose 5 to 7 angles for this week's content. Use the divergence skill: " +
    "reject your own first drafts and reframe until the angles are ones only " +
    "this business could publish. Output the angles as a numbered list and " +
    "nothing else.",
  daily_draft:
    "Pick exactly one angle from the approved angle bank included below this " +
    "prompt, under the heading 'Approved angle bank', and write one post from " +
    "it. Do not invent an angle of your own and do not write about more than " +
    "one angle. Match the voice rules in your instructions exactly. Output " +
    "only the post text, with no preamble, no options and no commentary.",
  brief:
    "Write this morning's brief: what ran overnight, what is waiting on Denis, " +
    "and what failed. A section headed 'Facts gathered from the last 24 hours' " +
    "is appended below this prompt — it is the only source of truth for this " +
    "brief. Use only what is in it; do not invent, infer, or assume anything " +
    "beyond those facts. If every count in it is zero, say plainly that " +
    "nothing ran overnight rather than padding that out into a longer brief. " +
    "Keep it under 150 words.",
  wholesale_outreach:
    "Draft one first-contact wholesale message for The Solution, the mouth tape " +
    "brand, to a UAE retailer. Pick one realistic stockist type — pharmacy chain, " +
    "sleep or wellness retailer, concept store — and name it as the addressee so " +
    "the message is specific rather than a template. Never quote a price in a " +
    "first message: the aim is a reply, not a transaction. Do not claim a " +
    "certification, a stockist or a result the brand has not got. Keep it under " +
    "120 words. Output only the message, with no subject line, preamble or " +
    "commentary.",
};
