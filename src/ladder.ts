import type { AgentState, Verdict } from "./types.js";

export const PROMOTE_AFTER = 5;
export const DEMOTE_ON_DECLINES = 2;
export const DECLINE_WINDOW = 5;

/**
 * Applies one verdict to an agent's standing.
 *
 * Demotion is checked before promotion because a decline can never also be a
 * promotion, and demotion is the safety mechanism — it wins ties.
 *
 * On demotion the history is cleared: without that, the same two declines sit
 * in the window and demote the agent again on the very next verdict.
 */
export function applyVerdict(state: AgentState, verdict: Verdict): AgentState {
  const recent = [...state.recent, verdict].slice(-DECLINE_WINDOW);

  if (verdict === "declined") {
    const declines = recent.filter((v) => v === "declined").length;
    if (declines >= DEMOTE_ON_DECLINES) {
      return {
        ...state,
        level: Math.max(1, state.level - 1),
        streak: 0,
        recent: [],
      };
    }
    return { ...state, streak: 0, recent };
  }

  if (verdict === "approved_with_edit") {
    return { ...state, streak: 0, recent };
  }

  const streak = state.streak + 1;
  if (streak >= PROMOTE_AFTER) {
    const ceiling = Math.min(4, state.maxLevel);
    return {
      ...state,
      level: Math.min(ceiling, state.level + 1),
      streak: 0,
      recent,
    };
  }
  return { ...state, streak, recent };
}
