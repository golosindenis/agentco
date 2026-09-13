"use server";

import { revalidatePath } from "next/cache";
import { carouselObjectPaths, createSlideUploadUrls, getCarousel, markCarouselSent, updateCarouselSlides } from "../../../src/db.js";
import { expectedPaths, missingSlides } from "../../../src/carouselFiles.js";
import { parseDeck } from "../../../src/deck.js";
import { sameShape } from "../../../src/slideEdit.js";
import type { CarouselRow } from "../../../src/types.js";
import { currentUser } from "../lib/supabaseServer";

export type UploadPlan = { ok: true; uploads: { path: string; signedUrl: string }[] } | { ok: false; error: string };
export type StudioResult = { ok: true } | { ok: false; error: string };

type Found = { ok: true; carousel: CarouselRow } | { ok: false; error: string };

/**
 * Checks the caller and that the slide types sent from the editor match the
 * saved deck, so a stale tab cannot upload a different number of slides.
 */
async function authorizedCarousel(carouselId: string, slideTypes: string[]): Promise<Found> {
  if (!(await currentUser())) return { ok: false, error: "Not authorized." };
  const carousel = await getCarousel(carouselId);
  if (!carousel) return { ok: false, error: "Carousel not found." };
  if (slideTypes.length !== carousel.slides.length) {
    return { ok: false, error: `The editor has ${slideTypes.length} slides but the deck has ${carousel.slides.length}. Reload the studio.` };
  }
  return { ok: true, carousel };
}

/**
 * Saves slide text edited in the studio. The edit may change wording only:
 * the same slides in the same order with the same types, so Send and the
 * editor stay in step. The result must pass the same parseDeck rules the
 * Producer's output does, so a hand edit cannot save an overflowing hook or
 * a dash either.
 */
export async function saveCarouselSlides(carouselId: string, slides: Record<string, unknown>[]): Promise<StudioResult> {
  try {
    if (!(await currentUser())) return { ok: false, error: "Not authorized." };
    const carousel = await getCarousel(carouselId);
    if (!carousel) return { ok: false, error: "Carousel not found." };
    if (!sameShape(carousel.slides as { type?: unknown }[], slides)) {
      return { ok: false, error: "Slides were added, removed or retyped. Reload the studio." };
    }
    const check = parseDeck(JSON.stringify(slides));
    if (!check.ok) return { ok: false, error: `Not saved: ${check.reason}.` };
    await updateCarouselSlides(carouselId, check.slides);
    revalidatePath(`/carousels/${carouselId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function startCarouselUpload(carouselId: string, slideTypes: string[]): Promise<UploadPlan> {
  try {
    const found = await authorizedCarousel(carouselId, slideTypes);
    if (!found.ok) return { ok: false, error: found.error };
    return { ok: true, uploads: await createSlideUploadUrls(expectedPaths(carouselId, slideTypes)) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function completeCarousel(
  carouselId: string, slideTypes: string[], settings: Record<string, string>,
): Promise<StudioResult> {
  try {
    const found = await authorizedCarousel(carouselId, slideTypes);
    if (!found.ok) return { ok: false, error: found.error };
    const expected = expectedPaths(carouselId, slideTypes);
    const missing = missingSlides(expected, await carouselObjectPaths(carouselId));
    if (missing.length > 0) {
      return { ok: false, error: `Slide ${missing.join(", ")} did not upload. Press Send again.` };
    }
    await markCarouselSent(carouselId, expected, settings);
    revalidatePath(`/drafts/${found.carousel.source_draft_id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
