"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";
import { setDeck } from "../studio/deck";
import { completeCarousel, saveCarouselSlides, startCarouselUpload } from "../actions";
import { editSlide, italicsFromLines, italicsToLines, type EditableField } from "../../../../src/slideEdit.js";

type Bridge = {
  slideCount: number;
  slideTypes: string[];
  capture: (index: number) => Promise<string | null>;
  settings: Record<string, string>;
};

type Slide = Record<string, unknown> & { type: string };

const field = { width: "100%", background: "#0a0a0a", color: "#fff", border: "1px solid #333", borderRadius: 6, padding: "6px 8px", font: "inherit", fontSize: 14 } as const;
const button = (enabled: boolean, colour: string) => ({ padding: "8px 20px", borderRadius: 8, border: "none", background: enabled ? colour : "#444", color: "#fff", fontWeight: 600, cursor: enabled ? "pointer" : "not-allowed" }) as const;

export function Studio({ carouselId, draftId, slides, watermark, alreadySent }: {
  carouselId: string; draftId: string; slides: unknown[]; watermark: string; alreadySent: boolean;
}) {
  const [Editor, setEditor] = useState<ComponentType | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(alreadySent ? "Already sent. Sending again replaces the images." : "");
  // The slides the editor is showing, and the text panel's working copy.
  const [saved, setSaved] = useState<Slide[]>(slides as Slide[]);
  const [edited, setEdited] = useState<Slide[]>(slides as Slide[]);
  const [showText, setShowText] = useState(false);
  const [textChangedSinceSend, setTextChangedSinceSend] = useState(false);
  const dirty = JSON.stringify(saved) !== JSON.stringify(edited);

  useEffect(() => {
    // setDeck must run before the editor module is evaluated and rendered:
    // the editor reads SLIDES and WATERMARK from ../studio/deck.
    setDeck(slides as never, watermark);
    let alive = true;
    import("../studio/app/CarouselApp").then((m) => { if (alive) setEditor(() => m.default); });
    return () => { alive = false; };
  }, [slides, watermark]);

  function change(index: number, name: EditableField, value: string | string[]) {
    setEdited((current) => editSlide(current, index, name, value) as Slide[]);
  }

  async function saveText() {
    setBusy(true);
    try {
      const result = await saveCarouselSlides(carouselId, edited);
      if (!result.ok) throw new Error(result.error);
      // The editor reads SLIDES on every render, so updating the deck and
      // re-rendering redraws the slides without remounting the editor,
      // which keeps the Look and font Denis already picked.
      setDeck(edited as never, watermark);
      setSaved(edited);
      if (alreadySent) setTextChangedSinceSend(true);
      setStatus(alreadySent ? "Text saved. Press Send to replace the sent images." : "Text saved.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (dirty) { setStatus("Save the text first, so the images match the saved deck."); return; }
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
      setTextChangedSinceSend(false);
      setStatus("Sent. It is on the draft page.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = !busy && !!Editor;

  return (
    <>
      <div style={{ position: "sticky", top: 0, zIndex: 50, display: "flex", gap: 16, alignItems: "center", padding: "10px 20px", background: "#0a0a0a", borderBottom: "1px solid #262626" }}>
        <Link href={`/drafts/${draftId}`} style={{ color: "#a3a3a3" }}>Back to draft</Link>
        <button onClick={() => setShowText((v) => !v)} className="tb-btn" style={button(true, "#334155")}>
          {showText ? "Hide text" : "Edit text"}
        </button>
        <button onClick={send} disabled={!ready} className="tb-btn" style={button(ready, "#22C55E")}>
          {busy ? "Working…" : "Send"}
        </button>
        <span style={{ color: "#d4d4d4", fontSize: 14 }}>
          {status}{textChangedSinceSend && !status.includes("Send") ? " Text changed since the last Send." : ""}
        </span>
      </div>

      {showText && (
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #262626", background: "#111", display: "grid", gap: 14 }}>
          {edited.map((slide, i) => (
            <div key={i} style={{ display: "grid", gap: 6, gridTemplateColumns: "90px 1fr 1fr 1fr", alignItems: "start" }}>
              <div style={{ color: "#a3a3a3", fontSize: 13, paddingTop: 8 }}>{String(i + 1).padStart(2, "0")} {slide.type}</div>
              <label style={{ fontSize: 12, color: "#a3a3a3" }}>Text
                <textarea rows={3} style={field} value={String(slide.text ?? "")} onChange={(e) => change(i, "text", e.target.value)} />
              </label>
              <label style={{ fontSize: 12, color: "#a3a3a3" }}>Subtext
                <textarea rows={3} style={field} value={String(slide.subtext ?? "")} onChange={(e) => change(i, "subtext", e.target.value)} />
              </label>
              <label style={{ fontSize: 12, color: "#a3a3a3" }}>Italic phrases, one per line
                <textarea rows={3} style={field} value={italicsToLines(slide.italics as string[] | undefined)} onChange={(e) => change(i, "italics", italicsFromLines(e.target.value))} />
              </label>
            </div>
          ))}
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={saveText} disabled={!ready || !dirty} className="tb-btn" style={button(ready && dirty, "#6366F1")}>Save text</button>
            <button onClick={() => setEdited(saved)} disabled={!dirty} className="tb-btn" style={button(dirty, "#444")}>Discard changes</button>
            <span style={{ color: "#a3a3a3", fontSize: 13 }}>Checked like the Producer: hook 10 words max, no dashes, italic phrases must appear in their text.</span>
          </div>
        </div>
      )}

      {Editor ? <Editor /> : <p style={{ padding: 20 }}>Loading studio…</p>}
    </>
  );
}
