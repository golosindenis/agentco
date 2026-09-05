import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Loads .env into process.env before any test runs. Without this,
    // tests/db.test.ts's credential guard reads an empty process.env and
    // skips the live integration tests forever, even with .env present —
    // src/db.ts loads dotenv itself, but the guard exists precisely to
    // avoid importing src/db.ts before it has decided whether to skip.
    setupFiles: ["dotenv/config"],
  },
});
