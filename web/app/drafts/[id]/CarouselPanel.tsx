"use client";

import { useActionState } from "react";
import { requestCarousel, type ActionResult } from "../../actions";
import type { CarouselView, SentSummary } from "../../../../src/carousel.js";

const initial: ActionResult = { ok: true };

/**
 * Starts each download in turn. The URLs are signed with Storage's download
 * option, so each one saves under its own name; the gap keeps browsers from
 * dropping back-to-back downloads. Chrome asks once to allow multiple files.
 */
async function downloadAll(urls: string[]): Promise<void> {
  for (const url of urls) {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 600));
  }
}

export function CarouselPanel({ draftId, view, sent, images, downloads }: {
  draftId: string; view: CarouselView; sent: SentSummary | null; images: string[]; downloads: string[];
}) {
  const [result, action, pending] = useActionState(async () => {
    const fd = new FormData();
    fd.set("draftId", draftId);
    return requestCarousel(fd);
  }, initial);

  const button = (label: string) => (
    <form action={action}>
      <button type="submit" className="primary" disabled={pending}>
        {pending ? "Queuing…" : label}
      </button>
      {result.ok === false && <span className="hint"> {result.error}</span>}
    </form>
  );

  return (
    <section className="note-band">
      {view.state === "none" && button("Make carousel")}
      {view.state === "waiting" && <p>Carousel queued. Waiting for your Mac.</p>}
      {view.state === "failed" && (
        <>
          <p>Carousel failed: {view.reason}</p>
          {button("Try again")}
        </>
      )}
      {view.state === "deck_ready" && (
        <p>
          Carousel ready, {view.slideCount} slides. <a href={view.studioHref}>Open in studio</a>
        </p>
      )}
      {/* Driven by the newest SENT carousel, not the newest carousel, so a
          newer deck in progress shows above it instead of hiding it. */}
      {sent && (
        <>
          <p>
            Carousel sent, {sent.slideCount} slides.{" "}
            <button type="button" className="primary" onClick={() => downloadAll(downloads)} disabled={downloads.length === 0}>
              Download all
            </button>{" "}
            <a href={`/carousels/${sent.carouselId}`}>Reopen studio</a>
          </p>
          <p className="hint">Download all saves every slide. Or right click (Mac) or long press (phone) one image.</p>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollSnapType: "x mandatory" }}>
            {images.map((src, i) => (
              <img key={src} src={src} alt={`Slide ${i + 1}`} style={{ height: 320, width: "auto", flex: "0 0 auto", scrollSnapAlign: "start", borderRadius: 8 }} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
