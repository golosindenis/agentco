"use server";

import { revalidatePath } from "next/cache";
import { carouselObjectPaths, createSlideUploadUrls, getCarousel, markCarouselSent } from "../../../src/db.js";
import { expectedPaths, missingSlides } from "../../../src/carouselFiles.js";
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
