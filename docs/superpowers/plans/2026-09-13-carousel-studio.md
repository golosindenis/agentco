# Carousel Studio (Plan 2 of 2: editor inside agentco) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Denis opens a Producer deck at `/carousels/<id>` inside agentco, picks the design in his real carousel editor, presses Send, and sees the finished images on the draft page on his phone.

**Architecture:** The editor stays authored in the threads-carousel fork. A sync script vendors `CarouselApp.tsx`, `lib/*.ts` and the builder's CSS into `web/app/carousels/studio/`, rewriting one import so the editor reads a live-binding `deck.ts` module that the studio page fills before loading it. Two small fork changes expose a capture bridge and guard the MP4 button. Send captures PNGs in the browser, uploads them to a private Storage bucket through signed upload URLs, and a server action verifies every image before marking the carousel `sent`.

**Tech Stack:** Next.js 16 (webpack), React 19, TypeScript, Vitest, Supabase Storage, `html-to-image`, `next/font/google`, tsx.

Spec: `docs/superpowers/specs/2026-09-13-carousel-producer-design.md` (section "Studio inside agentco").

## Global Constraints

- Fork: `~/.claude/skills/threads-carousel`. Commit on `denis-customizations`; push to remote `denis` only, never `origin`.
- Vendored files are generated: never hand edit anything under `web/app/carousels/studio/app/` or `web/app/carousels/studio/lib/` or `studio.css`; change the fork, then `npm run sync-studio`.
- No Tailwind in agentco. No MP4 export in agentco; ffmpeg routes are not vendored.
- Every server action calls `currentUser()` and refuses when it returns null.
- The service role key never reaches the browser: Storage calls go through `src/db.ts`.
- Never run `npm run seed`.
- Verify from `~/agentco`: `npm test`, `npm run typecheck`; from `~/agentco/web`: `npm run typecheck`, `npm run build`.

---

### Task 1: Fork changes (bridge and MP4 guard)

**Files:**
- Modify: `~/.claude/skills/threads-carousel/template/src/app/CarouselApp.tsx` (after `captureSlide`, around line 3520; MP4 button around line 3707)

**Interfaces:**
- Produces: `window.__carouselStudio: { slideCount: number; slideTypes: string[]; capture: (index: number) => Promise<string | null>; settings: { lookId: string; fontId: string; surfaceId: string; accentId: string; purposeId: string; formatId: string; bgType: string } }`; the literal `process.env.NEXT_PUBLIC_HIDE_MP4` guarding the MP4 button.

- [ ] **Step 1: Add the bridge**

Replace:

```tsx
    [preset.bg, canvasW, canvasH]
  );

  const exportSlide = useCallback(
```

with:

```tsx
    [preset.bg, canvasW, canvasH]
  );

  // Lets a host page (agentco's studio) capture slides and read the chosen
  // design without forking this component further. Nothing reads it when
  // the builder runs on its own.
  useEffect(() => {
    (window as unknown as { __carouselStudio?: unknown }).__carouselStudio = {
      slideCount: SLIDES.length,
      slideTypes: SLIDES.map((s) => s.type),
      capture: captureSlide,
      settings: { lookId, fontId, surfaceId, accentId, purposeId, formatId, bgType: effectiveBg },
    };
  }, [captureSlide, lookId, fontId, surfaceId, accentId, purposeId, formatId, effectiveBg]);

  const exportSlide = useCallback(
```

- [ ] **Step 2: Guard the MP4 button**

Replace:

```tsx
            <button onClick={exportAnimated} disabled={exporting} style={{ padding: "8px 20px", minWidth: 120, minHeight: 36, borderRadius: 8, border: "none", background: exporting ? "#444" : "#EC4899", color: "#fff", cursor: exporting ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }} className="tb-btn">
              {exporting ? exportStatus : t.btnVideo}
            </button>
```

with:

```tsx
            {/* Hidden where ffmpeg is unavailable (agentco's studio sets this). */}
            {process.env.NEXT_PUBLIC_HIDE_MP4 !== "1" && (
              <button onClick={exportAnimated} disabled={exporting} style={{ padding: "8px 20px", minWidth: 120, minHeight: 36, borderRadius: 8, border: "none", background: exporting ? "#444" : "#EC4899", color: "#fff", cursor: exporting ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }} className="tb-btn">
                {exporting ? exportStatus : t.btnVideo}
              </button>
            )}
```

- [ ] **Step 3: Build the fork**

Run: `cd ~/.claude/skills/threads-carousel/template && npx next build`
Expected: build completes with no type errors.

- [ ] **Step 4: Commit and push to `denis`**

```bash
cd ~/.claude/skills/threads-carousel
git branch --show-current   # must print denis-customizations
git add template/src/app/CarouselApp.tsx
git commit -m "feat: studio capture bridge and MP4 guard for hosting in agentco"
git push denis denis-customizations
```

---

### Task 2: Sync script, vendored editor, deck module, drift test

**Files:**
- Create: `src/studioSync.ts`
- Create: `scripts/sync-studio.ts`
- Create: `tests/studioSync.test.ts`
- Create: `web/app/carousels/studio/deck.ts`
- Modify: `package.json` (add `sync-studio` script)
- Modify: `web/package.json` (add `html-to-image`)
- Generated: `web/app/carousels/studio/app/CarouselApp.tsx`, `web/app/carousels/studio/lib/*.ts`, `web/app/carousels/studio/studio.css`

**Interfaces:**
- Consumes: fork changes from Task 1.
- Produces: `transformEditor(src: string): string`, `transformLib(src: string): string`, `transformCss(src: string): string`, `FORK_SRC: string` (default fork `src` path); `web/app/carousels/studio/deck.ts` exporting `SLIDES`, `WATERMARK`, `DEFAULT_*`, `setDeck(slides: SlideData[], watermark: string): void`; default export of the vendored `CarouselApp.tsx` is the editor component.

- [ ] **Step 1: Write the failing tests**

`tests/studioSync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { FORK_SRC, STUDIO_DIR, transformCss, transformEditor, transformLib } from "../src/studioSync.js";

const editor = `"use client";\nimport { SLIDES, WATERMARK } from "../slides";\nconst hide = process.env.NEXT_PUBLIC_HIDE_MP4 !== "1";\n`;

describe("transformEditor", () => {
  it("points the slides import at the deck module", () => {
    const out = transformEditor(editor);
    expect(out).toContain(`from "../deck";`);
    expect(out).not.toContain(`from "../slides";`);
  });
  it("hard codes the MP4 guard so the button is always hidden in agentco", () => {
    expect(transformEditor(editor)).toContain(`const hide = "1" !== "1";`);
  });
  it("marks the file generated and unchecked", () => {
    const out = transformEditor(editor);
    expect(out.startsWith("// GENERATED by npm run sync-studio")).toBe(true);
    expect(out).toContain("// @ts-nocheck");
  });
  it("refuses a fork that no longer imports ../slides", () => {
    expect(() => transformEditor(editor.replace(`"../slides"`, `"../other"`))).toThrow(/\.\.\/slides/);
  });
  it("refuses a fork without the MP4 guard", () => {
    expect(() => transformEditor(editor.replace("process.env.NEXT_PUBLIC_HIDE_MP4", "x"))).toThrow(/NEXT_PUBLIC_HIDE_MP4/);
  });
});

describe("transformLib", () => {
  it("adds the banner and leaves the code alone", () => {
    expect(transformLib("export const a = 1;\n")).toMatch(/@ts-nocheck\nexport const a = 1;\n$/);
  });
});

describe("transformCss", () => {
  const css = `@import "tailwindcss";\n\nbody { margin: 0; }\n\n/* Toolbar buttons — x */\n.tb-btn { color: red; }\n`;
  it("keeps only the builder's own rules from the toolbar marker on", () => {
    const out = transformCss(css);
    expect(out).toContain(".tb-btn { color: red; }");
    expect(out).not.toContain("tailwindcss");
    expect(out).not.toContain("body {");
  });
  it("refuses CSS without the toolbar marker", () => {
    expect(() => transformCss("body{}")).toThrow(/Toolbar buttons/);
  });
});

describe.skipIf(!existsSync(FORK_SRC))("vendored studio matches the fork", () => {
  it("CarouselApp.tsx", () => {
    const fork = readFileSync(path.join(FORK_SRC, "app/CarouselApp.tsx"), "utf8");
    expect(readFileSync(path.join(STUDIO_DIR, "app/CarouselApp.tsx"), "utf8")).toBe(transformEditor(fork));
  });
  it("lib files", () => {
    for (const f of readdirSync(path.join(FORK_SRC, "lib")).filter((n) => n.endsWith(".ts"))) {
      const fork = readFileSync(path.join(FORK_SRC, "lib", f), "utf8");
      expect(readFileSync(path.join(STUDIO_DIR, "lib", f), "utf8"), f).toBe(transformLib(fork));
    }
  });
  it("studio.css", () => {
    const fork = readFileSync(path.join(FORK_SRC, "app/globals.css"), "utf8");
    expect(readFileSync(path.join(STUDIO_DIR, "studio.css"), "utf8")).toBe(transformCss(fork));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/studioSync.test.ts`
Expected: FAIL, cannot resolve `../src/studioSync.js`.

- [ ] **Step 3: Implement the transforms**

`src/studioSync.ts`:

```ts
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The carousel editor is authored in Denis's threads-carousel fork and
 * vendored into agentco, because Vercel builds agentco's repo only. These
 * transforms are the whole difference between the two copies, so the drift
 * test can prove the vendored files are exactly the fork, transformed.
 */

export const FORK_SRC = process.env.CAROUSEL_FORK_SRC
  ?? path.join(homedir(), ".claude/skills/threads-carousel/template/src");

export const STUDIO_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../web/app/carousels/studio",
);

const BANNER =
  "// GENERATED by npm run sync-studio from the threads-carousel fork. Do not edit here.\n" +
  "// @ts-nocheck\n";

const SLIDES_IMPORT = /from "\.\.\/slides";/;
const MP4_GUARD = "process.env.NEXT_PUBLIC_HIDE_MP4";
const CSS_MARKER = "/* Toolbar buttons";

export function transformEditor(src: string): string {
  if (!SLIDES_IMPORT.test(src)) {
    throw new Error('CarouselApp.tsx no longer imports "../slides"; update sync-studio');
  }
  if (!src.includes(MP4_GUARD)) {
    throw new Error("CarouselApp.tsx has no NEXT_PUBLIC_HIDE_MP4 guard; apply the fork change first");
  }
  return BANNER + src.replace(SLIDES_IMPORT, 'from "../deck";').replaceAll(MP4_GUARD, '"1"');
}

export function transformLib(src: string): string {
  return BANNER + src;
}

export function transformCss(src: string): string {
  const at = src.indexOf(CSS_MARKER);
  if (at === -1) throw new Error("globals.css has no /* Toolbar buttons marker; update sync-studio");
  return "/* GENERATED by npm run sync-studio from the threads-carousel fork. Do not edit here. */\n" + src.slice(at);
}
```

Note: `"use client"` stays valid after the banner, because comments may precede a directive.

- [ ] **Step 4: Run to verify the unit tests pass**

Run: `npx vitest run tests/studioSync.test.ts`
Expected: the `transformEditor`, `transformLib` and `transformCss` tests PASS; the drift describe FAILS (vendored files do not exist yet).

- [ ] **Step 5: Write the sync script**

`scripts/sync-studio.ts`:

```ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FORK_SRC, STUDIO_DIR, transformCss, transformEditor, transformLib } from "../src/studioSync.js";

mkdirSync(path.join(STUDIO_DIR, "app"), { recursive: true });
mkdirSync(path.join(STUDIO_DIR, "lib"), { recursive: true });

const editor = readFileSync(path.join(FORK_SRC, "app/CarouselApp.tsx"), "utf8");
writeFileSync(path.join(STUDIO_DIR, "app/CarouselApp.tsx"), transformEditor(editor));

const libs = readdirSync(path.join(FORK_SRC, "lib")).filter((n) => n.endsWith(".ts"));
for (const f of libs) {
  writeFileSync(path.join(STUDIO_DIR, "lib", f), transformLib(readFileSync(path.join(FORK_SRC, "lib", f), "utf8")));
}

const css = readFileSync(path.join(FORK_SRC, "app/globals.css"), "utf8");
writeFileSync(path.join(STUDIO_DIR, "studio.css"), transformCss(css));

console.log(`synced CarouselApp.tsx, ${libs.length} lib files and studio.css from ${FORK_SRC}`);
```

In root `package.json` `"scripts"`, add:

```json
    "sync-studio": "tsx scripts/sync-studio.ts",
```

- [ ] **Step 6: Add the deck module**

`web/app/carousels/studio/deck.ts`:

```ts
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
```

- [ ] **Step 7: Install the dependency and sync**

```bash
cd ~/agentco/web && npm install html-to-image@^1.11.11
cd ~/agentco && npm run sync-studio
```

Expected: `synced CarouselApp.tsx, 5 lib files and studio.css from …`.

- [ ] **Step 8: Verify**

Run: `cd ~/agentco && npm test && npm run typecheck && cd web && npm run typecheck`
Expected: all tests pass including the drift tests; both typechecks clean (vendored files are `@ts-nocheck`).

- [ ] **Step 9: Commit**

```bash
cd ~/agentco
git add src/studioSync.ts scripts/sync-studio.ts tests/studioSync.test.ts package.json web/package.json web/package-lock.json web/app/carousels/studio
git commit -m "feat(studio): vendor the carousel editor from the fork with a drift test"
```

---

### Task 3: Storage bucket, file paths, upload and complete actions

**Files:**
- Create: `supabase/migrations/0004_carousel_images.sql`
- Create: `src/carouselFiles.ts`
- Test: `tests/carouselFiles.test.ts`
- Modify: `src/db.ts` (append)
- Create: `web/app/carousels/actions.ts`

**Interfaces:**
- Consumes: `CarouselRow` (plan 1), `currentUser()` (`web/app/lib/supabaseServer.ts`).
- Produces: `slidePath(carouselId: string, index: number, type: string): string`; `expectedPaths(carouselId: string, slideTypes: string[]): string[]`; `missingSlides(expected: string[], present: string[]): number[]`; db: `getCarousel(id): Promise<CarouselRow | null>`, `createSlideUploadUrls(paths: string[]): Promise<{ path: string; signedUrl: string }[]>`, `carouselObjectPaths(carouselId: string): Promise<string[]>`, `markCarouselSent(id: string, paths: string[], settings: Record<string, string>): Promise<void>`, `signedImageUrls(paths: string[]): Promise<string[]>`; actions: `startCarouselUpload(carouselId: string, slideTypes: string[]): Promise<UploadPlan>`, `completeCarousel(carouselId: string, slideTypes: string[], settings: Record<string, string>): Promise<StudioResult>`.

- [ ] **Step 1: Write the failing test**

`tests/carouselFiles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { expectedPaths, missingSlides, slidePath } from "../src/carouselFiles.js";

describe("carousel image paths", () => {
  it("names a slide by carousel, two digit position and type", () => {
    expect(slidePath("c1", 0, "hook")).toBe("c1/01-hook.png");
    expect(slidePath("c1", 9, "cta")).toBe("c1/10-cta.png");
  });
  it("lists every expected path in slide order", () => {
    expect(expectedPaths("c1", ["hook", "body", "cta"])).toEqual(["c1/01-hook.png", "c1/02-body.png", "c1/03-cta.png"]);
  });
  it("reports missing slides by 1 based number", () => {
    const expected = expectedPaths("c1", ["hook", "body", "cta"]);
    expect(missingSlides(expected, ["c1/01-hook.png", "c1/03-cta.png"])).toEqual([2]);
    expect(missingSlides(expected, expected)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/carouselFiles.test.ts`
Expected: FAIL, cannot resolve `../src/carouselFiles.js`.

- [ ] **Step 3: Implement**

`src/carouselFiles.ts`:

```ts
/** Where a carousel's slide images live in the private `carousels` bucket. */
export function slidePath(carouselId: string, index: number, type: string): string {
  return `${carouselId}/${String(index + 1).padStart(2, "0")}-${type}.png`;
}

export function expectedPaths(carouselId: string, slideTypes: string[]): string[] {
  return slideTypes.map((type, i) => slidePath(carouselId, i, type));
}

/** 1 based numbers of slides whose image is not in the bucket. */
export function missingSlides(expected: string[], present: string[]): number[] {
  const have = new Set(present);
  return expected.flatMap((p, i) => (have.has(p) ? [] : [i + 1]));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/carouselFiles.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Migration**

`supabase/migrations/0004_carousel_images.sql`:

```sql
-- Private bucket for finished carousel slides. No storage policies: only the
-- service role (src/db.ts) reads, lists and signs; the browser uploads
-- through short-lived signed upload URLs and views through signed URLs.
insert into storage.buckets (id, name, public)
values ('carousels', 'carousels', false)
on conflict (id) do nothing;
```

Apply it to project `kaniwythbumchzokzyas` (Supabase MCP `apply_migration`, name `carousel_images`), then verify:

```sql
select id, public from storage.buckets where id = 'carousels';
```

Expected: one row, `public` false. Then run `npx vitest run tests/db.test.ts`; expected: all pass (this migration adds no foreign key).

- [ ] **Step 6: Database functions** (append to `src/db.ts`)

```ts
const CAROUSEL_BUCKET = "carousels";

export async function getCarousel(id: string): Promise<CarouselRow | null> {
  const { data, error } = await supabase.from("carousels").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getCarousel(${id}): ${error.message}`);
  return (data as CarouselRow | null) ?? null;
}

/** One signed upload URL per path. Upsert, so retrying a failed Send overwrites. */
export async function createSlideUploadUrls(paths: string[]): Promise<{ path: string; signedUrl: string }[]> {
  const out: { path: string; signedUrl: string }[] = [];
  for (const p of paths) {
    const { data, error } = await supabase.storage.from(CAROUSEL_BUCKET).createSignedUploadUrl(p, { upsert: true });
    if (error || !data) throw new Error(`createSignedUploadUrl(${p}): ${error?.message ?? "no data"}`);
    out.push({ path: p, signedUrl: data.signedUrl });
  }
  return out;
}

export async function carouselObjectPaths(carouselId: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(CAROUSEL_BUCKET).list(carouselId, { limit: 100 });
  if (error) throw new Error(`list carousel ${carouselId}: ${error.message}`);
  return (data ?? []).map((o) => `${carouselId}/${o.name}`);
}

export async function markCarouselSent(
  id: string, paths: string[], settings: Record<string, string>,
): Promise<void> {
  const { error } = await supabase.from("carousels").update({
    status: "sent", image_paths: paths, look: settings.lookId ?? null, settings, sent_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error(`markCarouselSent(${id}): ${error.message}`);
}

/** Viewable URLs for the phone, valid for an hour. */
export async function signedImageUrls(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await supabase.storage.from(CAROUSEL_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new Error(`signedImageUrls: ${error.message}`);
  return (data ?? []).map((d) => d.signedUrl ?? "").filter(Boolean);
}
```

- [ ] **Step 7: Server actions**

`web/app/carousels/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { carouselObjectPaths, createSlideUploadUrls, getCarousel, markCarouselSent } from "../../../src/db.js";
import { expectedPaths, missingSlides } from "../../../src/carouselFiles.js";
import { currentUser } from "../lib/supabaseServer";

export type UploadPlan = { ok: true; uploads: { path: string; signedUrl: string }[] } | { ok: false; error: string };
export type StudioResult = { ok: true } | { ok: false; error: string };

/**
 * Checks the caller and that the slide types sent from the editor match the
 * saved deck, so a stale tab cannot upload a different number of slides.
 */
async function authorizedCarousel(carouselId: string, slideTypes: string[]) {
  if (!(await currentUser())) return { error: "Not authorized." } as const;
  const carousel = await getCarousel(carouselId);
  if (!carousel) return { error: "Carousel not found." } as const;
  if (slideTypes.length !== carousel.slides.length) {
    return { error: `The editor has ${slideTypes.length} slides but the deck has ${carousel.slides.length}. Reload the studio.` } as const;
  }
  return { carousel } as const;
}

export async function startCarouselUpload(carouselId: string, slideTypes: string[]): Promise<UploadPlan> {
  try {
    const found = await authorizedCarousel(carouselId, slideTypes);
    if ("error" in found) return { ok: false, error: found.error };
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
    if ("error" in found) return { ok: false, error: found.error };
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
```

- [ ] **Step 8: Verify**

Run: `cd ~/agentco && npm test && npm run typecheck && cd web && npm run typecheck`
Expected: all pass, both typechecks clean.

- [ ] **Step 9: Commit**

```bash
cd ~/agentco
git add supabase/migrations/0004_carousel_images.sql src/carouselFiles.ts tests/carouselFiles.test.ts src/db.ts web/app/carousels/actions.ts
git commit -m "feat(studio): private image bucket, signed uploads and verified completion"
```

---

### Task 4: The studio page

**Files:**
- Create: `web/app/carousels/layout.tsx`
- Create: `web/app/carousels/[id]/page.tsx`
- Create: `web/app/carousels/[id]/Studio.tsx`

**Interfaces:**
- Consumes: `setDeck` and the vendored editor (Task 2); `startCarouselUpload`, `completeCarousel`, `getCarousel` (Task 3); `window.__carouselStudio` (Task 1).
- Produces: route `/carousels/[id]`.

- [ ] **Step 1: Fonts and CSS layout**

`web/app/carousels/layout.tsx`:

```tsx
import {
  Archivo, Bricolage_Grotesque, Dancing_Script, Fraunces, Hanken_Grotesk, Inter, JetBrains_Mono,
  Manrope, Oswald, Playfair_Display, Plus_Jakarta_Sans, Source_Serif_4, Space_Grotesk, Unbounded,
} from "next/font/google";
import "./studio/studio.css";

// The builder's 14 faces, mirroring the fork's src/app/layout.tsx, loaded
// only on carousel pages. Their CSS variables go on a wrapper instead of
// <body>, so the rest of agentco is untouched.
const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter" });
const playfair = Playfair_Display({ subsets: ["latin", "cyrillic"], style: ["normal", "italic"], variable: "--font-playfair" });
const unbounded = Unbounded({ subsets: ["latin", "cyrillic"], variable: "--font-unbounded", weight: ["400", "500", "700", "800", "900"] });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", weight: ["400", "500", "600", "700"] });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-jetbrains-mono", weight: ["400", "500", "700", "800"] });
const manrope = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-manrope", weight: ["500", "800"] });
const oswald = Oswald({ subsets: ["latin", "cyrillic"], variable: "--font-oswald", weight: ["400", "500", "600", "700"] });
const archivo = Archivo({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-archivo" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-bricolage" });
const fraunces = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], weight: ["400", "500", "600"], variable: "--font-fraunces" });
const sourceSerif = Source_Serif_4({ subsets: ["latin", "cyrillic"], style: ["normal", "italic"], weight: ["400", "500", "600"], variable: "--font-source-serif" });
const dancingScript = Dancing_Script({ subsets: ["latin"], weight: ["600"], variable: "--font-dancing-script" });
const hankenGrotesk = Hanken_Grotesk({ subsets: ["latin", "cyrillic-ext"], weight: ["400", "500", "600"], variable: "--font-hanken-grotesk" });
const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin", "cyrillic-ext"], weight: ["400", "500", "700"], variable: "--font-plus-jakarta" });

const fontVars = [
  inter, playfair, unbounded, spaceGrotesk, jetbrainsMono, manrope, oswald, archivo,
  bricolage, fraunces, sourceSerif, dancingScript, hankenGrotesk, plusJakartaSans,
].map((f) => f.variable).join(" ");

export default function CarouselsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`carousel-studio ${fontVars}`}
      style={{ minHeight: "100vh", background: "#171717", color: "#fff", fontFamily: "var(--font-inter), system-ui, sans-serif", WebkitFontSmoothing: "antialiased" }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: The page**

`web/app/carousels/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getCarousel } from "../../../../src/db.js";
import { currentUser } from "../../lib/supabaseServer";
import { isValidUuid } from "../../lib/isValidUuid";
import { Studio } from "./Studio";

export const dynamic = "force-dynamic";

export default async function CarouselStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const carousel = await getCarousel(id);
  // Never fall back to a local deck: a missing carousel must not render
  // something that could be exported by mistake.
  if (!carousel) notFound();

  return (
    <Studio
      carouselId={carousel.id}
      draftId={carousel.source_draft_id}
      slides={carousel.slides}
      watermark={carousel.watermark}
      alreadySent={carousel.status === "sent"}
    />
  );
}
```

- [ ] **Step 3: The client studio**

`web/app/carousels/[id]/Studio.tsx`:

```tsx
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
```

- [ ] **Step 4: Verify the build**

Run: `cd ~/agentco/web && npm run typecheck && npm run build`
Expected: typecheck clean; build succeeds and lists `ƒ /carousels/[id]`.

- [ ] **Step 5: Verify the server side locally**

The editor renders only in the browser, so locally this proves auth, lookup and the page shell; the editor itself is proven in the browser in Task 6. Get the plan 1 carousel id:

```sql
select id from carousels order by created_at desc limit 1;
```

Start the dev server in the background (`cd ~/agentco/web && npm run dev`), then:

```bash
cd ~/agentco
node scripts/dev-session.mjs > /tmp/agentco-cookie.txt
curl -s -o /tmp/studio.html -w "%{http_code}\n" -H "Cookie: $(cat /tmp/agentco-cookie.txt)" http://localhost:3000/carousels/<carousel id>
grep -c "Back to draft\|Loading studio" /tmp/studio.html
curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: $(cat /tmp/agentco-cookie.txt)" http://localhost:3000/carousels/00000000-0000-0000-0000-000000000000
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/carousels/<carousel id>
```

Expected: `200`; a count of at least 1; `404` for the unknown id; a redirect status (`307`) with no cookie. Stop the dev server and delete `/tmp/agentco-cookie.txt`.

- [ ] **Step 6: Commit**

```bash
cd ~/agentco
git add web/app/carousels/layout.tsx "web/app/carousels/[id]/page.tsx" "web/app/carousels/[id]/Studio.tsx"
git commit -m "feat(studio): /carousels/[id] opens the real editor inside agentco with Send"
```

---

### Task 5: Draft page links to the studio and shows sent images

**Files:**
- Modify: `src/carousel.ts`
- Modify: `tests/carousel.test.ts`
- Modify: `web/app/drafts/[id]/CarouselPanel.tsx`
- Modify: `web/app/drafts/[id]/page.tsx`

**Interfaces:**
- Consumes: `signedImageUrls` (Task 3).
- Produces: `carouselView(task, carousel): CarouselView` (the `editorUrl` parameter is removed); `deck_ready` carries `studioHref: string`; `sent` carries `carouselId: string`; `CarouselPanel` takes `images: string[]`.

- [ ] **Step 1: Update the tests**

In `tests/carousel.test.ts`, replace the three tests from `"shows the deck with an editor link when configured"` through `"reports sent carousels"` with:

```ts
  it("links a ready deck to its studio page", () => {
    expect(carouselView({ state: "done", error: null, created_at: "2026-09-14T08:00:00.000Z" }, carousel))
      .toEqual({ state: "deck_ready", slideCount: 5, studioHref: "/carousels/c1" });
  });
  it("reports sent carousels with their id", () => {
    expect(carouselView({ state: "done", error: null, created_at: "2026-09-14T08:00:00.000Z" }, { ...carousel, status: "sent" }))
      .toEqual({ state: "sent", slideCount: 5, carouselId: "c1" });
  });
```

and remove the third argument (`""`) from the remaining `carouselView(...)` calls in that file.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/carousel.test.ts`
Expected: FAIL on the two new tests.

- [ ] **Step 3: Update the view model**

In `src/carousel.ts` replace the `CarouselView` type and `carouselView` function with:

```ts
export type CarouselView =
  | { state: "none" }
  | { state: "waiting" }
  | { state: "failed"; reason: string }
  | { state: "deck_ready"; slideCount: number; studioHref: string }
  | { state: "sent"; slideCount: number; carouselId: string };

/**
 * What the draft page shows about its carousel, from the newest carousel task
 * and the newest carousel row. A task that is queued or running always wins,
 * and a failure wins when it is newer than the deck: a retry must not be
 * hidden behind an older deck.
 */
export function carouselView(task: CarouselTaskState | null, carousel: CarouselRow | null): CarouselView {
  if (task && (task.state === "queued" || task.state === "running")) return { state: "waiting" };
  if (task && task.state === "failed" && (!carousel || task.created_at > carousel.created_at)) {
    return { state: "failed", reason: task.error ?? "unknown error" };
  }
  if (!carousel) return { state: "none" };
  const slideCount = carousel.slides.length;
  if (carousel.status === "sent") return { state: "sent", slideCount, carouselId: carousel.id };
  return { state: "deck_ready", slideCount, studioHref: `/carousels/${carousel.id}` };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/carousel.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the panel**

In `web/app/drafts/[id]/CarouselPanel.tsx`, change the signature to:

```tsx
export function CarouselPanel({ draftId, view, images }: { draftId: string; view: CarouselView; images: string[] }) {
```

and replace the `deck_ready` and `sent` blocks with:

```tsx
      {view.state === "deck_ready" && (
        <p>
          Carousel ready, {view.slideCount} slides. <a href={view.studioHref}>Open in studio</a>
        </p>
      )}
      {view.state === "sent" && (
        <>
          <p>
            Carousel sent, {view.slideCount} slides. Long press an image to save it.{" "}
            <a href={`/carousels/${view.carouselId}`}>Reopen studio</a>
          </p>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollSnapType: "x mandatory" }}>
            {images.map((src, i) => (
              <img key={src} src={src} alt={`Slide ${i + 1}`} style={{ height: 320, width: "auto", flex: "0 0 auto", scrollSnapAlign: "start", borderRadius: 8 }} />
            ))}
          </div>
        </>
      )}
```

- [ ] **Step 6: Update the draft page**

In `web/app/drafts/[id]/page.tsx`, add `signedImageUrls` to the `src/db.js` import, and after

```tsx
  const carousel = canCarousel ? await carouselStatusForDraft(draft.id) : null;
```

add:

```tsx
  const images = carousel?.carousel?.status === "sent"
    ? await signedImageUrls(carousel.carousel.image_paths ?? [])
    : [];
```

Replace the panel render with:

```tsx
            <CarouselPanel
              draftId={draft.id}
              view={carouselView(carousel.task, carousel.carousel)}
              images={images}
            />
```

- [ ] **Step 7: Verify**

Run: `cd ~/agentco && npm test && npm run typecheck && cd web && npm run typecheck && npm run build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
cd ~/agentco
git add src/carousel.ts tests/carousel.test.ts "web/app/drafts/[id]/CarouselPanel.tsx" "web/app/drafts/[id]/page.tsx"
git commit -m "feat(studio): Open in studio link and sent image strip on the draft page"
```

---

### Task 6: Prove it on production

**Files:** `docs/build-log.md` (append in Step 6).

- [ ] **Step 1: Deploy**

```bash
cd ~/agentco && git push
cd web && vercel ls agentco | sed -n '4,5p'
```

Expected: newest Production deployment `● Ready`.

- [ ] **Step 2: Open the studio on the Mac**

Open `agentco-golosindenis-projects.vercel.app/drafts/f541f99d-5ecc-49b0-94e8-9bbdbbaedd9b`, tap **Open in studio**. Expected: the editor with the 9 Producer slides inside agentco, no MP4 button, no second sign in.

- [ ] **Step 3: Pick a Look and Send**

Pick `vista` (never exported before), inspect a slide at full size, press **Send**. Expected: "Sent. It is on the draft page on your phone." Verify:

```sql
select status, look, array_length(image_paths, 1) as images, sent_at from carousels order by created_at desc limit 1;
select count(*) from storage.objects where bucket_id = 'carousels';
```

Expected: `sent`, `vista`, 9, a timestamp; 9 objects.

- [ ] **Step 4: Phone**

On the phone, reload the draft page. Expected: "Carousel sent, 9 slides" and a horizontal strip of 9 images; long press saves one to Photos.

- [ ] **Step 5: Parity**

Export the same deck under `vista` from the local fork (`cd ~/.claude/skills/threads-carousel/template && npm run dev`, put the 9 slides in a temporary deck file, pick vista, PNG). Compare slide 1 side by side with the image from agentco. Expected: same typography, fonts, background and footer. Delete the temporary deck file.

- [ ] **Step 6: Record it**

Append a dated section to `docs/build-log.md`: what shipped, the production checks above, and anything that differed. Commit and push:

```bash
git add docs/build-log.md
git commit -m "docs: carousel studio verified on production"
git push
```
