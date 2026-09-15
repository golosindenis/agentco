import { describe, it, expect, vi } from "vitest";
import { declineCarousel, type DeclineDeps } from "../src/declineDeck.js";

const deps = (over: Partial<DeclineDeps> = {}): DeclineDeps => ({
  markDeclined: vi.fn(async () => ({ sourceDraftId: "d9" })),
  producerId: vi.fn(async () => "p1"),
  insertFeedback: vi.fn(async () => {}),
  loadInstructions: vi.fn(async () => "Rule one"),
  saveInstructions: vi.fn(async () => {}),
  countDeclined: vi.fn(async () => 1),
  queueCarousel: vi.fn(async () => {}),
  ...over,
});

describe("declineCarousel", () => {
  it("refuses an empty reason and touches nothing", async () => {
    const d = deps();
    expect(await declineCarousel(d, "c1", "   ", false)).toEqual({ ok: false, error: "Give a reason for declining." });
    expect(d.markDeclined).not.toHaveBeenCalled();
  });

  it("marks the deck, saves feedback, and queues a new deck", async () => {
    const d = deps();
    const r = await declineCarousel(d, "c1", "  hook is a question  ", false);
    expect(d.markDeclined).toHaveBeenCalledWith("c1", "hook is a question");
    expect(d.insertFeedback).toHaveBeenCalledWith("p1", "hook is a question");
    expect(d.saveInstructions).not.toHaveBeenCalled();
    expect(d.queueCarousel).toHaveBeenCalledWith("d9");
    expect(r).toEqual({ ok: true, sourceDraftId: "d9", ruleAppended: false, atRuleCap: false, requeued: true, declinedCount: 1 });
  });

  it("appends a rule only when asked", async () => {
    const d = deps();
    const r = await declineCarousel(d, "c1", "hook is a question", true);
    expect(d.saveInstructions).toHaveBeenCalledWith("p1", "Rule one\nhook is a question");
    expect(r).toMatchObject({ ok: true, ruleAppended: true });
  });

  it("still declines at the rule cap, without a rule", async () => {
    const full = Array.from({ length: 30 }, (_, i) => `rule ${i}`).join("\n");
    const d = deps({ loadInstructions: vi.fn(async () => full) });
    const r = await declineCarousel(d, "c1", "new rule", true);
    expect(d.saveInstructions).not.toHaveBeenCalled();
    expect(d.insertFeedback).toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, ruleAppended: false, atRuleCap: true, requeued: true });
  });

  it("stops queuing after the third declined deck for a post", async () => {
    const d = deps({ countDeclined: vi.fn(async () => 3) });
    const r = await declineCarousel(d, "c1", "still weak", false);
    expect(d.queueCarousel).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, requeued: false, declinedCount: 3 });
  });

  it("does nothing when the deck was already sent or declined", async () => {
    const d = deps({ markDeclined: vi.fn(async () => null) });
    expect(await declineCarousel(d, "c1", "x", true)).toEqual({ ok: false, error: "This deck was already sent or declined. Reload the page." });
    expect(d.insertFeedback).not.toHaveBeenCalled();
    expect(d.queueCarousel).not.toHaveBeenCalled();
  });

  it("keeps the decline when queuing the next deck fails", async () => {
    const d = deps({ queueCarousel: vi.fn(async () => { throw new Error("A carousel for this draft is already on its way."); }) });
    const r = await declineCarousel(d, "c1", "x", false);
    expect(r).toMatchObject({ ok: true, requeued: false, requeueError: "A carousel for this draft is already on its way." });
  });
});
