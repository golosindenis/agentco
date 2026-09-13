"use client";

import { useActionState } from "react";
import { requestCarousel, type ActionResult } from "../../actions";
import type { CarouselView } from "../../../../src/carousel.js";

const initial: ActionResult = { ok: true };

export function CarouselPanel({ draftId, view }: { draftId: string; view: CarouselView }) {
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
          Carousel ready, {view.slideCount} slides.{" "}
          {view.editorHref ? <a href={view.editorHref}>Open editor</a> : "Editor not hosted yet."}
        </p>
      )}
      {view.state === "sent" && <p>Carousel sent, {view.slideCount} slides.</p>}
    </section>
  );
}
