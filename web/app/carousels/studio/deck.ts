import type { AccentId, BgType, FontId, FormatId, LookId, PurposeId, SlideData, SurfaceId } from "./lib/types";

/**
 * Stands in for the fork's `src/slides.ts`. The vendored editor imports
 * SLIDES and WATERMARK from here; ES module imports are live bindings, so
 * the studio page calls setDeck before importing the editor and the editor
 * renders that carousel's deck. Defaults match Denis's Attune decks.
 */
export let SLIDES: SlideData[] = [];
export let WATERMARK = "";

export const DEFAULT_FONT: FontId = "editorial";
export const DEFAULT_SURFACE: SurfaceId = "dark";
export const DEFAULT_ACCENT: AccentId = "amber";
export const DEFAULT_PURPOSE: PurposeId = "carousel";
export const DEFAULT_BG: BgType = "bloom";
export const DEFAULT_FORMAT: FormatId = "threads-4x5";
export const DEFAULT_LOOK: LookId = "swiss";

export function setDeck(slides: SlideData[], watermark: string): void {
  SLIDES = slides;
  WATERMARK = watermark;
}
