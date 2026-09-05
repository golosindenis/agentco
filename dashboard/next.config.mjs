import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The dashboard's cwd is dashboard/, but the one .env Denis fills in lives
// at the repo root (see the root README's setup step 2) and holds
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. `../src/db.ts` also calls
// `import "dotenv/config"`, which loads relative to *its* cwd and would
// silently find nothing here — loading it explicitly, once, up front, before
// Next (or src/db.ts) ever reads process.env is what makes the two projects
// share the one real .env without a second copy of the service role key
// anywhere. dotenv never overwrites a variable already present in
// process.env, so this is safe to run alongside src/db.ts's own load.
loadEnv({ path: path.resolve(__dirname, "../.env") });

/**
 * The dashboard is a separate Next.js project so it can use Next's own
 * module resolution ("bundler") instead of the worker's NodeNext — see the
 * root README and the dashboard build notes for why those two must not
 * share a tsconfig. `experimental.externalDir` is what lets this project's
 * webpack/Turbopack graph reach outside its own root into `../src`, which is
 * the one and only source of truth for queries, the ladder, costs, review
 * and health logic (do not reimplement any of it here).
 *
 * `../src` is written with NodeNext-style `.js`-suffixed relative imports
 * (e.g. `import { POSTABLE_KINDS } from "./types.js"`) even though the
 * files on disk are `.ts`. Node's NodeNext resolver maps that for the
 * worker; webpack/Turbopack do not do this by default, so both resolvers
 * below are given an explicit extension alias so a `.js` specifier also
 * matches a same-named `.ts`/`.tsx` file.
 */
const config = {
  // Silences Turbopack's "inferred workspace root" warning: the repo root
  // (one level up, where the root package-lock.json lives) is genuinely the
  // right root here, since externalDir reaches into ../src.
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  experimental: {
    externalDir: true,
  },
  // Turbopack (Next's dev/build default) does not yet implement the
  // ".js" specifier -> ".ts" file extension mapping this project needs
  // (`experimental.extensionAlias` shows as unimplemented for it — a "·"
  // rather than "✓" in the startup log), so both `dev` and `build` are
  // pinned to `--webpack` in package.json, and this callback is what
  // actually supplies the mapping.
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return webpackConfig;
  },
};

export default config;
