"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";
import { setDeck } from "../studio/deck";
import { completeCarousel, startCarouselUpload } from "../actions";

type Bridge = {
  slideCount: number;
  slideTypes: string[];
  capture: (index: number) => Promise<string | null>;
  settings: Record<string, string>;
};

export function Studio({ carouselId, draftId, slides, watermark, alreadySent }: {
  carouselId: string; draftId: string; slides: unknown[]; watermark: string; alreadySent: boolean;
}) {
  const [Editor, setEditor] = useState<ComponentType | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(alreadySent ? "Already sent. Sending again replaces the images." : "");

  useEffect(() => {
    // setDeck must run before the editor module is evaluated and rendered:
    // the editor reads SLIDES and WATERMARK from ../studio/deck.
    setDeck(slides as never, watermark);
    let alive = true;
    import("../studio/app/CarouselApp").then((m) => { if (alive) setEditor(() => m.default); });
    return () => { alive = false; };
  }, [slides, watermark]);

  async function send() {
    const bridge = (window as unknown as { __carouselStudio?: Bridge }).__carouselStudio;
    if (!bridge) { setStatus("The editor is still loading."); return; }
    setBusy(true);
    try {
      const plan = await startCarouselUpload(carouselId, bridge.slideTypes);
      if (!plan.ok) throw new Error(plan.error);
      for (let i = 0; i < plan.uploads.length; i++) {
        setStatus(`Uploading slide ${i + 1} of ${plan.uploads.length}`);
        const dataUrl = await bridge.capture(i);
        if (!dataUrl) throw new Error(`Slide ${i + 1} could not be captured.`);
        const blob = await (await fetch(dataUrl)).blob();
        const res = await fetch(plan.uploads[i]!.signedUrl, {
          method: "PUT", headers: { "Content-Type": "image/png", "x-upsert": "true" }, body: blob,
        });
        if (!res.ok) throw new Error(`Slide ${i + 1} upload failed (${res.status}). Press Send again.`);
      }
      const done = await completeCarousel(carouselId, bridge.slideTypes, bridge.settings);
      if (!done.ok) throw new Error(done.error);
      setStatus("Sent. It is on the draft page on your phone.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ position: "sticky", top: 0, zIndex: 50, display: "flex", gap: 16, alignItems: "center", padding: "10px 20px", background: "#0a0a0a", borderBottom: "1px solid #262626" }}>
        <Link href={`/drafts/${draftId}`} style={{ color: "#a3a3a3" }}>Back to draft</Link>
        <button
          onClick={send}
          disabled={busy || !Editor}
          className="tb-btn"
          style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: busy || !Editor ? "#444" : "#22C55E", color: "#fff", fontWeight: 600, cursor: busy || !Editor ? "not-allowed" : "pointer" }}
        >
          {busy ? "Sending…" : "Send"}
        </button>
        <span style={{ color: "#d4d4d4", fontSize: 14 }}>{status}</span>
      </div>
      {Editor ? <Editor /> : <p style={{ padding: 20 }}>Loading studio…</p>}
    </>
  );
}
