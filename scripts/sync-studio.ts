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
