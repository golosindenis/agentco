# agentco Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the local dev-server dashboard into a hosted, phone-first web app Denis can open anywhere and approve drafts from in five seconds.

**Architecture:** The Next.js app moves from `dashboard/` to `web/`, keeps its own `package.json`, and is deployed to Vercel with Root Directory set to `web`. It imports the engine at `../src` exactly as it does today. Every read happens in a server component and every write in a server action, both using the service role key; there is no client-side Supabase client. Supabase Auth email OTP gates every route.

**Tech Stack:** Next.js 16 (App Router, webpack), React 19, `@supabase/supabase-js`, `@supabase/ssr`, TypeScript, vitest.

## Global Constraints

- **The engine is not modified.** `src/` gains three read-only query functions and nothing else. No business logic lives in `web/`.
- **Service role key is server-only.** Never a `NEXT_PUBLIC_` variable, never imported into a `"use client"` file.
- **RLS stays deny-all** for `anon` and `authenticated`. No policies are added.
- **No "Run now" control.** The runner is the 07:00 LaunchAgent; a queued task would sit up to a day. Deferred to the cloud-runner sub-project.
- **Departments are a column, not an entity.** Group `listAgents()` by `agent.department` in the view. Marketing sorts first.
- **Hit targets are at least 44px** in any control reachable on the phone screens.
- **Existing 129 tests must keep passing** after every task.
- **Palette is the existing one** in `dashboard/app/globals.css`. Dark tokens: bg `#161512`, raised `#1e1c19`, sunken `#100f0d`, border `#33302a`, border-strong `#4a453b`, text `#ece8e0`, dim `#a49c8d`, faint `#766f63`, accent `#7fbfa4`, accent-bg `#1c2b26`, warn `#e0ac54` on `#332711`, bad `#e0847e` on `#331d1a`.

**Amendment to the spec.** The spec called for "one render smoke test per route with a stubbed data layer". React Server Components do not render cleanly under vitest without a Next test harness, and adding one is more machinery than this earns. Instead: page data-shaping is extracted into pure functions under `web/app/lib/` and those are unit tested, while route rendering is verified by `next build` (which type-checks every page) plus the deploy in Task 8. Everything else in the spec stands.

---

### Task 1: Move the app to `web/` and prove it still builds

The current app lives in `dashboard/` and has only ever run under `next dev`. Before anything is added, it must move to its deployment location and survive a production build — that build is the risk in this whole plan, because the app imports `../src` from outside its own package root.

**Files:**
- Move: `dashboard/` → `web/` (all files, git mv)
- Modify: `package.json` (root) — the `dashboard` script
- Modify: `web/app/page.tsx` — import paths
- Create: `web/.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: the app at `web/`, buildable with `npm --prefix web run build`. All later tasks put files under `web/`.

- [ ] **Step 1: Move the directory**

```bash
cd ~/agentco
git mv dashboard web
```

- [ ] **Step 2: Fix the import depth**

`web/app/page.tsx` line 1-10 imports `"../../src/db.js"`. The depth from `web/app/` to `src/` is identical to `dashboard/app/`, so these do not change. Verify rather than assume:

```bash
cd ~/agentco && grep -rn '\.\./\.\./src' web/app/ | head
```

Expected: several matches, all reading `../../src/<file>.js`. If any read a different depth, correct them to `../../src/`.

- [ ] **Step 3: Rename the package and update the root script**

In `web/package.json`, change the `name` field:

```json
  "name": "agentco-web",
```

In the root `package.json`, replace the `dashboard` script:

```json
    "web": "npm --prefix web run dev",
    "web:build": "npm --prefix web run build",
```

- [ ] **Step 4: Add a .gitignore for the app**

Create `web/.gitignore`:

```
.next/
node_modules/
```

- [ ] **Step 5: Run a production build — this is the real test**

```bash
cd ~/agentco && npm --prefix web run build
```

Expected: `✓ Compiled successfully`, followed by a route list including `/`. 

If it fails with a module-resolution error on `../../src/`, the cause is Next refusing to compile files outside the package root. Fix by adding to `web/next.config.js` (create it if absent):

```js
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  outputFileTracingRoot: path.join(dir, ".."),
};
```

Then re-run the build. Do not proceed until it compiles.

- [ ] **Step 6: Confirm the engine tests still pass**

```bash
cd ~/agentco && npm test
```

Expected: all existing tests pass, same count as before the move.

- [ ] **Step 7: Commit**

```bash
cd ~/agentco
git add -A
git commit -m "refactor: move the dashboard to web/ as the deployable app"
```

---

### Task 2: Engine queries for the agent detail page

`src/db.ts` covers every screen except agent detail, which needs the agent by its stable key, its verdict history and its own event stream.

**Files:**
- Modify: `src/db.ts` (append three functions)
- Test: `tests/db.test.ts` (append three tests)

**Interfaces:**
- Consumes: `supabase` from `src/db.ts`, `AgentRow` from `src/types.ts`
- Produces:
  - `getAgentByKey(key: string): Promise<AgentRow | null>`
  - `verdictHistory(agentId: string, limit: number): Promise<{ verdict: string; reason: string | null; created_at: string }[]>`
  - `eventsForAgent(agentId: string, limit: number): Promise<{ kind: string; detail: Record<string, unknown>; created_at: string }[]>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/db.test.ts`, inside the existing credential-guarded `describe` block, and add the three names to the module-level `let` declarations at the top of the file the same way the existing ones are declared:

```ts
let getAgentByKey: typeof import("../src/db.js")["getAgentByKey"];
let verdictHistory: typeof import("../src/db.js")["verdictHistory"];
let eventsForAgent: typeof import("../src/db.js")["eventsForAgent"];
```

assign them in the same `beforeAll` that assigns the others, then add:

```ts
it("finds an agent by its stable key and returns its instructions", async () => {
  const agent = await getAgentByKey("writer");
  expect(agent).not.toBeNull();
  expect(agent!.display_name).toBe("Writer");
  expect(typeof agent!.instructions).toBe("string");
});

it("returns null for a key that does not exist", async () => {
  expect(await getAgentByKey("no_such_agent")).toBeNull();
});

it("returns verdict history newest first, capped at the limit", async () => {
  const agent = await getAgentByKey("writer");
  const rows = await verdictHistory(agent!.id, 3);
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBeLessThanOrEqual(3);
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i - 1].created_at >= rows[i].created_at).toBe(true);
  }
});

it("returns that agent's events newest first, capped at the limit", async () => {
  const agent = await getAgentByKey("writer");
  const rows = await eventsForAgent(agent!.id, 5);
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBeLessThanOrEqual(5);
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i - 1].created_at >= rows[i].created_at).toBe(true);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ~/agentco && npx vitest run tests/db.test.ts
```

Expected: FAIL — `getAgentByKey is not a function`. If instead the whole block SKIPS, `.env` is missing `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`; fill them in before continuing, because these are live integration tests by design.

- [ ] **Step 3: Implement the three queries**

Append to `src/db.ts`:

```ts
/** One agent by its stable key, or null when there is no such agent. */
export async function getAgentByKey(key: string): Promise<AgentRow | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`getAgentByKey(${key}): ${error.message}`);
  return (data as AgentRow) ?? null;
}

/**
 * This agent's verdicts, newest first. The approvals table has no agent_id —
 * a verdict belongs to a draft, and the draft belongs to the agent — so the
 * filter goes through the embedded drafts row rather than a column here.
 */
export async function verdictHistory(
  agentId: string,
  limit: number,
): Promise<{ verdict: string; reason: string | null; created_at: string }[]> {
  const { data, error } = await supabase
    .from("approvals")
    .select("verdict, reason, created_at, drafts!inner(agent_id)")
    .eq("drafts.agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`verdictHistory(${agentId}): ${error.message}`);
  return (data ?? []).map((r: any) => ({
    verdict: r.verdict,
    reason: r.reason,
    created_at: r.created_at,
  }));
}

/** This agent's events, newest first. */
export async function eventsForAgent(
  agentId: string,
  limit: number,
): Promise<{ kind: string; detail: Record<string, unknown>; created_at: string }[]> {
  const { data, error } = await supabase
    .from("events")
    .select("kind, detail, created_at")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`eventsForAgent(${agentId}): ${error.message}`);
  return (data ?? []) as { kind: string; detail: Record<string, unknown>; created_at: string }[];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/agentco && npx vitest run tests/db.test.ts
```

Expected: PASS, including the four new tests.

- [ ] **Step 5: Add the missing `can_publish` field to `AgentRow`**

The `agents` table has a `can_publish` column but `AgentRow` in `src/types.ts`
does not declare it, so `select("*")` returns it and TypeScript does not know.
The agent detail page in Task 6 reads it. Add it after `turn_cap`:

```ts
  turn_cap: number;
  can_publish: boolean;
  enabled: boolean;
```

Then confirm nothing else breaks:

```bash
cd ~/agentco && npm run typecheck && npm test
```

Expected: no type errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
cd ~/agentco
git add src/db.ts src/types.ts tests/db.test.ts
git commit -m "feat(db): agent-by-key, verdict history and per-agent events"
```

---

### Task 3: Auth — email one-time code, one allowed address

Everything behind the login is Denis's operations data. This task gates every route before any new screen is built, so no screen is ever briefly public.

**Files:**
- Create: `web/app/lib/allowlist.ts`
- Create: `web/app/lib/supabaseServer.ts`
- Create: `web/middleware.ts`
- Create: `web/app/login/page.tsx`
- Create: `web/app/login/actions.ts`
- Create: `web/app/auth/callback/route.ts`
- Test: `tests/allowlist.test.ts`
- Modify: `web/package.json` (add `@supabase/ssr`)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `isAllowedEmail(email: string, allowed: string): boolean`
  - `getSupabaseAuthClient()` — a request-scoped auth client for server components
  - middleware that redirects unauthenticated requests to `/login`

- [ ] **Step 1: Write the failing test for the allowlist**

Create `tests/allowlist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isAllowedEmail } from "../web/app/lib/allowlist.js";

describe("isAllowedEmail", () => {
  it("accepts the configured address", () => {
    expect(isAllowedEmail("denis@example.com", "denis@example.com")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isAllowedEmail("  Denis@Example.com ", "denis@example.com")).toBe(true);
  });

  it("rejects any other address", () => {
    expect(isAllowedEmail("someone@else.com", "denis@example.com")).toBe(false);
  });

  it("rejects everything when no address is configured", () => {
    expect(isAllowedEmail("denis@example.com", "")).toBe(false);
    expect(isAllowedEmail("denis@example.com", undefined as unknown as string)).toBe(false);
  });

  it("rejects an empty submission", () => {
    expect(isAllowedEmail("", "denis@example.com")).toBe(false);
    expect(isAllowedEmail("   ", "denis@example.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd ~/agentco && npx vitest run tests/allowlist.test.ts
```

Expected: FAIL — cannot resolve `../web/app/lib/allowlist.js`.

- [ ] **Step 3: Implement the allowlist**

Create `web/app/lib/allowlist.ts`:

```ts
/**
 * Supabase's OTP endpoint will happily create a user for any address that
 * asks. This is the gate that stops that: a second account must never be
 * able to exist, because every route behind the login reads and writes the
 * live operations database with the service role.
 *
 * An unset allowed address denies everyone rather than allowing everyone —
 * a missing environment variable must fail closed.
 */
export function isAllowedEmail(email: string, allowed: string): boolean {
  const candidate = (email ?? "").trim().toLowerCase();
  const permitted = (allowed ?? "").trim().toLowerCase();
  if (!candidate || !permitted) return false;
  return candidate === permitted;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd ~/agentco && npx vitest run tests/allowlist.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Install the SSR auth helper**

```bash
cd ~/agentco && npm --prefix web install @supabase/ssr
```

- [ ] **Step 6: Add the request-scoped auth client**

Create `web/app/lib/supabaseServer.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * The AUTH client — anon key, carries the session cookie, and is the only
 * Supabase client in this app that a user's identity flows through. It is
 * never used to read operations data: that goes through `../../src/db.js`,
 * which holds the service role key and knows nothing about sessions.
 * Keeping the two apart is what stops a session bug from becoming a data
 * leak, and vice versa.
 */
export async function getSupabaseAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );
}

/** The signed-in user, or null. */
export async function currentUser() {
  const supabase = await getSupabaseAuthClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
```

- [ ] **Step 7: Add the middleware gate**

Create `web/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every matched request. Refreshing the session here — rather
 * than only in pages — is what keeps a long-lived phone tab from silently
 * expiring mid-approval.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except the login screen, the auth callback, Next's own
    // assets and the PWA files, which must be reachable signed out or the
    // installed app cannot boot to its own login screen.
    "/((?!login|auth/callback|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)",
  ],
};
```

- [ ] **Step 8: Add the login screen and its action**

Create `web/app/login/actions.ts`:

```ts
"use server";

import { getSupabaseAuthClient } from "../lib/supabaseServer";
import { isAllowedEmail } from "../lib/allowlist";

export type LoginResult = { ok: true; sent: boolean } | { ok: false; error: string };

export async function sendCode(_prev: LoginResult, formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "");

  // Checked here and not only in the form, because a form is not a gate.
  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL ?? "")) {
    return { ok: false, error: "That address cannot sign in." };
  }

  const supabase = await getSupabaseAuthClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, sent: true };
}

export async function verifyCode(_prev: LoginResult, formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "");
  const token = String(formData.get("token") ?? "").trim();

  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL ?? "")) {
    return { ok: false, error: "That address cannot sign in." };
  }
  if (!token) return { ok: false, error: "Enter the code from your email." };

  const supabase = await getSupabaseAuthClient();
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token,
    type: "email",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, sent: true };
}
```

Create `web/app/login/page.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { sendCode, verifyCode, type LoginResult } from "./actions";

const initial: LoginResult = { ok: true, sent: false };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sendState, sendAction, sending] = useActionState(sendCode, initial);
  const [verifyState, verifyAction, verifying] = useActionState(
    async (prev: LoginResult, fd: FormData) => {
      fd.set("email", email);
      const result = await verifyCode(prev, fd);
      if (result.ok) router.replace("/");
      return result;
    },
    initial,
  );

  const codeSent = sendState.ok && sendState.sent;

  return (
    <main className="login">
      <h1>agentco</h1>

      {!codeSent ? (
        <form action={sendAction} className="login-form">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="primary" disabled={sending}>
            {sending ? "Sending…" : "Send code"}
          </button>
          {!sendState.ok && <p className="err">{sendState.error}</p>}
        </form>
      ) : (
        <form action={verifyAction} className="login-form">
          <p className="hint">A six digit code is on its way to {email}.</p>
          <label htmlFor="token">Code</label>
          <input
            id="token"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
          <button type="submit" className="primary" disabled={verifying}>
            {verifying ? "Checking…" : "Sign in"}
          </button>
          {!verifyState.ok && <p className="err">{verifyState.error}</p>}
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 9: Add the callback route**

Create `web/app/auth/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAuthClient } from "../../lib/supabaseServer";

/**
 * Handles the emailed magic link, for when the code is clicked rather than
 * typed. The typed-code path never reaches here.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await getSupabaseAuthClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/", request.url));
}
```

- [ ] **Step 10: Add the login styles**

Append to `web/app/globals.css`:

```css
/* ---- login ---- */

.login {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  padding: 24px;
}

.login h1 {
  font-size: 19px;
  font-weight: 700;
  margin: 0;
}

.login-form {
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.login-form label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  font-weight: 700;
}

.login-form input {
  min-height: 44px;
}

.login-form button {
  min-height: 44px;
  font-size: 14px;
}

.login-form .hint {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0;
}

.login .err {
  color: var(--bad);
  font-size: 13px;
  margin: 0;
}
```

- [ ] **Step 11: Set the environment variables**

Add to `~/agentco/.env` (the anon key is safe in the browser; the service role key already in this file is not, and stays server-only):

```bash
NEXT_PUBLIC_SUPABASE_URL=<same value as SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase project settings → API → anon public>
ALLOWED_EMAIL=golosindenis@gmail.com
```

- [ ] **Step 12: Verify the gate by hand**

```bash
cd ~/agentco && npm --prefix web run dev
```

Then check three things:
1. Visiting `http://localhost:3000/` redirects to `/login`.
2. Submitting an address that is not `ALLOWED_EMAIL` shows "That address cannot sign in." and sends no email.
3. Submitting the allowed address delivers a code; entering it lands on `/`.

- [ ] **Step 13: Run the full suite and build**

```bash
cd ~/agentco && npm test && npm --prefix web run build
```

Expected: all tests pass; build compiles.

- [ ] **Step 14: Commit**

```bash
cd ~/agentco
git add -A
git commit -m "feat(web): gate every route behind a single-address email code login"
```

---

### Task 4: Split `/` into Today and Overview

Today's `page.tsx` is one 12KB file that renders everything. It becomes a data loader plus two layout components, chosen by CSS at 900px, so the phone gets the approval stack and the desktop gets the operations view from a single data load.

**Files:**
- Create: `web/app/lib/viewModel.ts`
- Create: `web/app/TodayView.tsx`
- Create: `web/app/OverviewView.tsx`
- Create: `web/app/Sidebar.tsx`
- Create: `web/app/BottomNav.tsx`
- Modify: `web/app/page.tsx` (becomes the loader)
- Modify: `web/app/globals.css`
- Test: `tests/viewModel.test.ts`

**Interfaces:**
- Consumes: `listAgents`, `pendingDraftCountsByAgent`, `getHealthFacts`, `latestBrief`, `pendingDrafts`, `approvedUnpostedDrafts`, `recentEvents` from `src/db.ts`; `deriveHealth` from `src/health.ts`
- Produces:
  - `groupByDepartment(agents: AgentRow[]): { department: string; agents: AgentRow[] }[]` — Marketing first, then alphabetical
  - `truncateLines(body: string, lines: number): string`
  - `<TodayView>`, `<OverviewView>`, `<Sidebar>`, `<BottomNav>`

- [ ] **Step 1: Write the failing tests for the view model**

Create `tests/viewModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupByDepartment, truncateLines } from "../web/app/lib/viewModel.js";

const agent = (key: string, department: string) =>
  ({ key, department, display_name: key }) as any;

describe("groupByDepartment", () => {
  it("puts Marketing first regardless of input order", () => {
    const groups = groupByDepartment([
      agent("cos", "Office"),
      agent("writer", "Marketing"),
    ]);
    expect(groups.map((g) => g.department)).toEqual(["Marketing", "Office"]);
  });

  it("orders the remaining departments alphabetically", () => {
    const groups = groupByDepartment([
      agent("c", "Support"),
      agent("a", "Finance"),
      agent("b", "Marketing"),
    ]);
    expect(groups.map((g) => g.department)).toEqual(["Marketing", "Finance", "Support"]);
  });

  it("keeps every agent, grouped under its own department", () => {
    const groups = groupByDepartment([
      agent("strategist", "Marketing"),
      agent("writer", "Marketing"),
      agent("cos", "Office"),
    ]);
    expect(groups[0].agents.map((a) => a.key)).toEqual(["strategist", "writer"]);
    expect(groups[1].agents.map((a) => a.key)).toEqual(["cos"]);
  });

  it("returns nothing for no agents", () => {
    expect(groupByDepartment([])).toEqual([]);
  });
});

describe("truncateLines", () => {
  it("returns a short body untouched", () => {
    expect(truncateLines("one\ntwo", 4)).toBe("one\ntwo");
  });

  it("cuts to the line limit and marks the cut", () => {
    expect(truncateLines("1\n2\n3\n4\n5", 3)).toBe("1\n2\n3…");
  });

  it("treats a blank body as empty", () => {
    expect(truncateLines("", 4)).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd ~/agentco && npx vitest run tests/viewModel.test.ts
```

Expected: FAIL — cannot resolve `../web/app/lib/viewModel.js`.

- [ ] **Step 3: Implement the view model**

Create `web/app/lib/viewModel.ts`:

```ts
import type { AgentRow } from "../../../src/types.js";

/**
 * Marketing sorts first because it is where the work Denis actually reviews
 * comes from; everything else is alphabetical so adding a department never
 * reshuffles the ones above it.
 */
const FIRST_DEPARTMENT = "Marketing";

export function groupByDepartment(
  agents: AgentRow[],
): { department: string; agents: AgentRow[] }[] {
  const byDept = new Map<string, AgentRow[]>();
  for (const a of agents) {
    const list = byDept.get(a.department) ?? [];
    list.push(a);
    byDept.set(a.department, list);
  }
  return [...byDept.entries()]
    .map(([department, list]) => ({ department, agents: list }))
    .sort((x, y) => {
      if (x.department === FIRST_DEPARTMENT) return -1;
      if (y.department === FIRST_DEPARTMENT) return 1;
      return x.department.localeCompare(y.department);
    });
}

/** First `lines` lines of a draft, with an ellipsis when anything was cut. */
export function truncateLines(body: string, lines: number): string {
  if (!body) return "";
  const all = body.split("\n");
  if (all.length <= lines) return body;
  return all.slice(0, lines).join("\n") + "…";
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd ~/agentco && npx vitest run tests/viewModel.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Build the navigation components**

Create `web/app/BottomNav.tsx`:

```tsx
import Link from "next/link";

const ITEMS = [
  { href: "/", label: "Today" },
  { href: "/org", label: "Org" },
  { href: "/activity", label: "Activity" },
];

export function BottomNav({ active }: { active: string }) {
  return (
    <nav className="bottom-nav">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={item.href === active ? "nav-item on" : "nav-item"}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
```

Create `web/app/Sidebar.tsx`:

```tsx
import Link from "next/link";
import type { AgentRow } from "../../src/types.js";
import { groupByDepartment } from "./lib/viewModel";

export function Sidebar({
  agents,
  pendingCounts,
  active,
}: {
  agents: AgentRow[];
  pendingCounts: Record<string, number>;
  active: string;
}) {
  const pendingTotal = Object.values(pendingCounts).reduce((a, b) => a + b, 0);
  const groups = groupByDepartment(agents);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">agentco</div>
      </div>

      <nav className="sidebar-nav">
        <Link href="/" className={active === "/" ? "side-item on" : "side-item"}>
          Overview
        </Link>
        <Link href="/activity" className={active === "/activity" ? "side-item on" : "side-item"}>
          Activity
        </Link>
        {pendingTotal > 0 && <span className="side-count">{pendingTotal} waiting</span>}
      </nav>

      {groups.map((group) => (
        <div className="sidebar-section" key={group.department}>
          <div className="sidebar-section-head">
            <span>{group.department}</span>
            <span className="num">{group.agents.length}</span>
          </div>
          <div className="sidebar-section-items">
            {group.agents.map((a) => (
              <Link
                key={a.key}
                href={`/agents/${a.key}`}
                className={active === `/agents/${a.key}` ? "side-item on" : "side-item"}
              >
                <span>{a.display_name}</span>
                {pendingCounts[a.id] > 0 && (
                  <span className="side-pending">{pendingCounts[a.id]}</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 6: Extract the two views**

Create `web/app/TodayView.tsx` and `web/app/OverviewView.tsx` by moving the existing JSX out of `web/app/page.tsx`:

- `TodayView` renders, in order: the health pill, the brief box, the pending drafts as cards (each showing `truncateLines(body, 4)`, an `Approve` form using the existing `VerdictForms` approve path, and a `Read` link to `/drafts/<id>`), the approved-unposted list, and `<BottomNav active="/" />`.
- `OverviewView` renders the existing health banner, the existing `.cost-summary` stat cards, the agent rows, and the recent-events feed — the markup already in `page.tsx` today, unchanged apart from being wrapped in a component that takes its data as props.

Both take plain props; neither fetches. Copy the class names from `globals.css` rather than inventing new ones.

- [ ] **Step 7: Turn `page.tsx` into a loader**

Replace the body of `web/app/page.tsx` so it keeps its existing `Promise.all` data load and `export const dynamic = "force-dynamic"`, then renders:

```tsx
  return (
    <div className="shell">
      <Sidebar agents={agents} pendingCounts={pendingCounts} active="/" />
      <div className="shell-main">
        <div className="only-narrow">
          <TodayView
            health={health}
            brief={brief}
            pending={pending}
            toPost={toPost}
          />
        </div>
        <div className="only-wide">
          <OverviewView
            health={health}
            agents={agents}
            pendingCounts={pendingCounts}
            agentTotals={agentTotals}
            recent={recent}
          />
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 8: Add the responsive shell styles**

Append to `web/app/globals.css`:

```css
/* ---- app shell ---- */

.shell { display: flex; min-height: 100dvh; }
.shell-main { flex: 1; min-width: 0; }

/* The phone and desktop screens show the same facts at different densities.
   Both render; CSS picks one. Rendering both is cheap here because the data
   is loaded once and shared, and it avoids a layout shift on first paint
   that a JS width check would cause. */
.only-narrow { display: block; }
.only-wide { display: none; }
.sidebar { display: none; }

@media (min-width: 900px) {
  .only-narrow { display: none; }
  .only-wide { display: block; }
  .sidebar { display: flex; }
}

.sidebar {
  width: 224px;
  flex: none;
  flex-direction: column;
  gap: 26px;
  padding: 22px 14px;
  background: var(--bg-raised);
  border-right: 1px solid var(--border);
}

.sidebar .brand { font-size: 15px; font-weight: 700; padding: 0 8px; }
.sidebar-nav { display: flex; flex-direction: column; gap: 2px; }
.sidebar-section { display: flex; flex-direction: column; gap: 6px; }

.sidebar-section-head {
  display: flex;
  justify-content: space-between;
  padding: 0 10px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.sidebar-section-head .num { font-family: var(--mono); color: var(--border-strong); }
.sidebar-section-items { display: flex; flex-direction: column; gap: 1px; }

.side-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-dim);
  text-decoration: none;
}

.side-item.on { background: var(--accent-bg); color: var(--accent); font-weight: 650; }

.side-pending {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 9px;
  background: var(--warn-bg);
  color: var(--warn);
}

/* ---- bottom nav (phone) ---- */

.bottom-nav {
  position: sticky;
  bottom: 0;
  display: flex;
  border-top: 1px solid var(--border);
  background: var(--bg-raised);
  padding-bottom: env(safe-area-inset-bottom);
}

.nav-item {
  flex: 1;
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-faint);
  text-decoration: none;
}

.nav-item.on { color: var(--accent); font-weight: 700; }

@media (min-width: 900px) { .bottom-nav { display: none; } }
```

- [ ] **Step 9: Verify both layouts by hand**

```bash
cd ~/agentco && npm --prefix web run dev
```

At a 390px viewport: brief, then pending cards each with a 44px-tall Approve. At 1440px: sidebar with Marketing above Office, health banner, stat cards, agent rows, event feed.

- [ ] **Step 10: Run tests and build**

```bash
cd ~/agentco && npm test && npm --prefix web run build
```

- [ ] **Step 11: Commit**

```bash
cd ~/agentco
git add -A
git commit -m "feat(web): responsive Today and Overview over one data load"
```

---

### Task 5: The draft review screen

The screen where the five-second decision actually happens: the full draft, and an action bar pinned under the thumb.

**Files:**
- Create: `web/app/drafts/[id]/page.tsx`
- Create: `web/app/drafts/[id]/DraftActions.tsx`
- Modify: `src/db.ts` (add `getDraftForReview`)
- Modify: `web/app/globals.css`
- Test: `tests/db.test.ts` (append one test)

**Interfaces:**
- Consumes: `approveDraft`, `approveDraftWithEdit`, `declineDraft`, `ActionResult` from `web/app/actions.ts` (all already exist)
- Produces: `getDraftForReview(id: string): Promise<{ id: string; body: string; status: string; created_at: string; agent_id: string; agent_name: string; agent_level: number; kind: string } | null>`

- [ ] **Step 1: Write the failing test**

Append to the credential-guarded block in `tests/db.test.ts`, declaring `getDraftForReview` alongside the others:

```ts
it("loads one draft with the agent and task it belongs to", async () => {
  const list = await pendingDrafts();
  if (list.length === 0) return; // nothing pending is a valid state, not a failure
  const row = await getDraftForReview(list[0].id);
  expect(row).not.toBeNull();
  expect(row!.id).toBe(list[0].id);
  expect(typeof row!.body).toBe("string");
  expect(typeof row!.agent_name).toBe("string");
});

it("returns null for a draft id that does not exist", async () => {
  expect(
    await getDraftForReview("00000000-0000-0000-0000-000000000000"),
  ).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd ~/agentco && npx vitest run tests/db.test.ts
```

Expected: FAIL — `getDraftForReview is not a function`.

- [ ] **Step 3: Implement the query**

Append to `src/db.ts`:

```ts
/** One draft with everything the review screen shows about it. */
export async function getDraftForReview(id: string): Promise<{
  id: string;
  body: string;
  status: string;
  created_at: string;
  agent_id: string;
  agent_name: string;
  agent_level: number;
  kind: string;
} | null> {
  const { data, error } = await supabase
    .from("drafts")
    .select("id, body, status, created_at, agent_id, agents(display_name, level), tasks(kind)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getDraftForReview(${id}): ${error.message}`);
  if (!data) return null;
  const row = data as any;
  return {
    id: row.id,
    body: row.body,
    status: row.status,
    created_at: row.created_at,
    agent_id: row.agent_id,
    agent_name: row.agents?.display_name ?? "Unknown",
    agent_level: row.agents?.level ?? 1,
    kind: row.tasks?.kind ?? "",
  };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd ~/agentco && npx vitest run tests/db.test.ts
```

Expected: PASS.

- [ ] **Step 5: Build the action bar**

Create `web/app/drafts/[id]/DraftActions.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  approveDraft,
  approveDraftWithEdit,
  declineDraft,
  type ActionResult,
} from "../../actions";

const initial: ActionResult = { ok: true };

/**
 * Approve is the whole point of this screen, so it is one full-width tap
 * with nothing to read first. Edit and Decline expand in place rather than
 * navigating, because leaving the draft to type a reason means losing sight
 * of the thing being judged.
 */
export function DraftActions({ draftId, agentId, body }: { draftId: string; agentId: string; body: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "edit" | "decline">(null);

  const done = (result: ActionResult) => {
    if (result.ok) router.push("/");
    return result;
  };

  const [approveState, approveAction, approving] = useActionState(async () => {
    const fd = new FormData();
    fd.set("draftId", draftId);
    fd.set("agentId", agentId);
    return done(await approveDraft(fd));
  }, initial);

  const [editState, editAction, editing] = useActionState(
    async (_p: ActionResult, fd: FormData) => {
      fd.set("draftId", draftId);
      fd.set("agentId", agentId);
      return done(await approveDraftWithEdit(fd));
    },
    initial,
  );

  const [declineState, declineAction, declining] = useActionState(
    async (_p: ActionResult, fd: FormData) => {
      fd.set("draftId", draftId);
      fd.set("agentId", agentId);
      return done(await declineDraft(fd));
    },
    initial,
  );

  const error =
    (!approveState.ok && approveState.error) ||
    (!editState.ok && editState.error) ||
    (!declineState.ok && declineState.error) ||
    null;

  return (
    <div className="action-bar">
      {error && <p className="err">{error}</p>}

      {open === null && (
        <>
          <form action={approveAction}>
            <button type="submit" className="primary tall" disabled={approving}>
              {approving ? "Approving…" : "Approve"}
            </button>
          </form>
          <div className="action-row">
            <button type="button" onClick={() => setOpen("edit")}>Edit and approve</button>
            <button type="button" className="danger" onClick={() => setOpen("decline")}>Decline</button>
          </div>
        </>
      )}

      {open === "edit" && (
        <form action={editAction} className="inline-form">
          <textarea name="body" rows={10} defaultValue={body} required />
          <div className="action-row">
            <button type="button" onClick={() => setOpen(null)}>Cancel</button>
            <button type="submit" className="primary" disabled={editing}>
              {editing ? "Saving…" : "Approve edit"}
            </button>
          </div>
        </form>
      )}

      {open === "decline" && (
        <form action={declineAction} className="inline-form">
          <label htmlFor="reason">Why</label>
          <input id="reason" name="reason" type="text" required />
          <p className="hint">This becomes a standing rule for the agent.</p>
          <div className="action-row">
            <button type="button" onClick={() => setOpen(null)}>Cancel</button>
            <button type="submit" className="danger" disabled={declining}>
              {declining ? "Declining…" : "Decline"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Build the page**

Create `web/app/drafts/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDraftForReview } from "../../../../src/db.js";
import { DraftActions } from "./DraftActions";
import { fmtDateTime } from "../../format";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getDraftForReview(id);
  if (!draft) notFound();

  return (
    <main className="draft-page">
      <header className="draft-page-head">
        <Link href="/" className="back">Back</Link>
        <div>
          <div className="draft-agent">{draft.agent_name}</div>
          <div className="draft-meta">
            {draft.kind} · {fmtDateTime(draft.created_at)} · level {draft.agent_level}
          </div>
        </div>
      </header>

      <article className="draft-full">{draft.body}</article>

      {draft.status === "pending" ? (
        <>
          <p className="note-band">Nothing publishes. Approving marks it ready for you to post.</p>
          <DraftActions draftId={draft.id} agentId={draft.agent_id} body={draft.body} />
        </>
      ) : (
        <p className="note-band">Already {draft.status}.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Add the styles**

Append to `web/app/globals.css`:

```css
/* ---- draft review ---- */

.draft-page { display: flex; flex-direction: column; min-height: 100dvh; }

.draft-page-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border-bottom: 1px solid var(--border);
}

.draft-page-head .back {
  color: var(--text-dim);
  text-decoration: none;
  font-size: 13px;
  min-height: 44px;
  display: flex;
  align-items: center;
}

.draft-agent { font-size: 16px; font-weight: 650; }
.draft-meta { font-size: 11.5px; color: var(--text-faint); font-family: var(--mono); }

.draft-full {
  margin: 18px;
  padding: 16px 17px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14.5px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.note-band {
  margin: 0 18px 18px;
  padding: 11px 14px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-dim);
}

.action-bar {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  padding: 14px 18px calc(22px + env(safe-area-inset-bottom));
  background: var(--bg-raised);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-bar button { min-height: 46px; width: 100%; }
.action-bar button.tall { min-height: 50px; font-size: 15px; }
.action-row { display: flex; gap: 10px; }
```

- [ ] **Step 8: Verify by hand**

With `npm --prefix web run dev` running, open a pending draft from Today at a 390px viewport. Approve returns to `/` and the draft leaves the list. Decline with an empty reason is refused. Decline with a reason returns to `/` and the reason appears on that agent's instructions (checked in Task 6).

- [ ] **Step 9: Run tests and build**

```bash
cd ~/agentco && npm test && npm --prefix web run build
```

- [ ] **Step 10: Commit**

```bash
cd ~/agentco
git add -A
git commit -m "feat(web): draft review screen with a thumb-reachable action bar"
```

---

### Task 6: Org and agent detail

Where Denis sees whether the company is actually earning autonomy, and where the decline-to-rule loop becomes visible.

**Files:**
- Create: `web/app/org/page.tsx`
- Create: `web/app/agents/[key]/page.tsx`
- Create: `web/app/AgentLadder.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Consumes: `getAgentByKey`, `verdictHistory`, `eventsForAgent` (Task 2); `listAgents`, `pendingDraftCountsByAgent`, `listRunEvents`; `groupByDepartment` (Task 4); `MAX_RULES`, `countRules` from `src/review.ts`; `PROMOTE_AFTER` from `src/ladder.ts`; `MAX_PENDING_DRAFTS` from `src/capacity.ts`; `totalsByAgent` from `src/costs.ts`
- Produces: `<AgentLadder level={n} maxLevel={n} />`; `setAgentEnabled(agentId: string, enabled: boolean): Promise<void>`; `toggleAgentPaused(formData: FormData): Promise<ActionResult>`

- [ ] **Step 1: Build the shared ladder component**

Create `web/app/AgentLadder.tsx`:

```tsx
/** Four segments, filled to the agent's current level. Also used on Overview. */
export function AgentLadder({ level, maxLevel }: { level: number; maxLevel: number }) {
  return (
    <div className="ladder" aria-label={`Level ${level} of ${maxLevel}`}>
      {Array.from({ length: maxLevel }, (_, i) => (
        <div key={i} className={i < level ? "seg filled" : "seg"} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build the org page**

Create `web/app/org/page.tsx`:

```tsx
import Link from "next/link";
import { listAgents, pendingDraftCountsByAgent } from "../../../src/db.js";
import { MAX_PENDING_DRAFTS } from "../../../src/capacity.js";
import { groupByDepartment } from "../lib/viewModel";
import { AgentLadder } from "../AgentLadder";
import { Sidebar } from "../Sidebar";
import { BottomNav } from "../BottomNav";

export const dynamic = "force-dynamic";

export default async function OrgPage() {
  const [agents, pendingCounts] = await Promise.all([
    listAgents(),
    pendingDraftCountsByAgent(),
  ]);
  const groups = groupByDepartment(agents);

  return (
    <div className="shell">
      <Sidebar agents={agents} pendingCounts={pendingCounts} active="/org" />
      <div className="shell-main">
        <main className="wrap">
          <div className="top">
            <h1>Org</h1>
            <span className="sub">
              {agents.length} agents · {groups.length} departments
            </span>
          </div>

          {groups.map((group) => (
            <section className="block" key={group.department}>
              <h2>
                {group.department} <span className="count">{group.agents.length}</span>
              </h2>
              <div className="agents">
                {group.agents.map((a) => {
                  const pending = pendingCounts[a.id] ?? 0;
                  const atCap = pending >= MAX_PENDING_DRAFTS;
                  return (
                    <Link
                      href={`/agents/${a.key}`}
                      key={a.id}
                      className={atCap ? "agent-card blocked" : "agent-card"}
                    >
                      <div className="head">
                        <div>
                          <div className="name">{a.display_name}</div>
                          <div className="dept">{a.department}</div>
                        </div>
                        <span className={atCap ? "pending-pill at-cap" : "pending-pill"}>
                          {pending} / {MAX_PENDING_DRAFTS}
                        </span>
                      </div>
                      <AgentLadder level={a.level} maxLevel={a.max_level} />
                      <div className="meta-row">
                        <span>
                          Level <strong>{a.level}</strong> of {a.max_level}
                        </span>
                        <span>streak {a.streak}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </main>
        <BottomNav active="/org" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build the agent detail page**

Create `web/app/agents/[key]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import {
  getAgentByKey,
  verdictHistory,
  eventsForAgent,
  listAgents,
  pendingDraftCountsByAgent,
  listRunEvents,
} from "../../../../src/db.js";
import { countRules, MAX_RULES } from "../../../../src/review.js";
import { PROMOTE_AFTER } from "../../../../src/ladder.js";
import { MAX_PENDING_DRAFTS } from "../../../../src/capacity.js";
import { totalsByAgent } from "../../../../src/costs.js";
import { AgentLadder } from "../../AgentLadder";
import { Sidebar } from "../../Sidebar";
import { BottomNav } from "../../BottomNav";
import { money, fmtDateTime } from "../../format";
import { summarizeDetail } from "../../eventDetail";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const agent = await getAgentByKey(key);
  if (!agent) notFound();

  const [agents, pendingCounts, verdicts, events, runEvents] = await Promise.all([
    listAgents(),
    pendingDraftCountsByAgent(),
    verdictHistory(agent.id, 10),
    eventsForAgent(agent.id, 12),
    listRunEvents(),
  ]);

  const rules = agent.instructions.split("\n").filter((r) => r.trim().length > 0);
  const pending = pendingCounts[agent.id] ?? 0;
  const totals = totalsByAgent(runEvents).find((t) => t.agent === agent.display_name);

  return (
    <div className="shell">
      <Sidebar agents={agents} pendingCounts={pendingCounts} active={`/agents/${key}`} />
      <div className="shell-main">
        <main className="wrap">
          <div className="top">
            <div>
              <h1>{agent.display_name}</h1>
              <span className="sub">
                {agent.department} · {agent.turn_cap} turn cap
                {agent.enabled ? "" : " · paused"}
              </span>
            </div>
            <span className="sub">Next run 07:00</span>
          </div>

          <div className="cost-summary">
            <div className="stat">
              <div className="stat-label">Autonomy</div>
              <AgentLadder level={agent.level} maxLevel={agent.max_level} />
              <div className="stat-sub">
                Level {agent.level} · {agent.can_publish ? "may publish" : "drafts only"}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Streak</div>
              <div className="stat-value">
                {agent.streak} <span className="of">of {PROMOTE_AFTER}</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Pending</div>
              <div className="stat-value">
                {pending} <span className="of">of {MAX_PENDING_DRAFTS}</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Cost, month</div>
              <div className="stat-value">{totals ? money(totals.totalUsd) : "—"}</div>
            </div>
          </div>

          <section className="block">
            <h2>
              Instructions <span className="count">{countRules(agent.instructions)} of {MAX_RULES}</span>
            </h2>
            <div className="feed">
              {rules.map((rule, i) => (
                <div className="rule-row" key={i}>
                  <span className="rule-num">{i + 1}</span>
                  <span>{rule}</span>
                </div>
              ))}
            </div>
            <p className="note">
              Declining an agent writes your reason in here, so the correction sticks.
            </p>
          </section>

          <section className="block">
            <h2>Verdict history</h2>
            <table className="data">
              <thead>
                <tr><th>When</th><th>Verdict</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {verdicts.map((v, i) => (
                  <tr key={i}>
                    <td>{fmtDateTime(v.created_at)}</td>
                    <td>{v.verdict}</td>
                    <td>{v.reason ?? "—"}</td>
                  </tr>
                ))}
                {verdicts.length === 0 && (
                  <tr><td colSpan={3} className="empty">No verdicts yet.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="block">
            <h2>Event log</h2>
            <div className="feed">
              {events.map((e, i) => (
                <div className="feed-row" key={i}>
                  <span className="time">{fmtDateTime(e.created_at)}</span>
                  <span className="kind">{e.kind}</span>
                  <span className="detail">{summarizeDetail(e.kind, e.detail)}</span>
                </div>
              ))}
              {events.length === 0 && <div className="empty">Nothing logged yet.</div>}
            </div>
          </section>
        </main>
        <BottomNav active="/org" />
      </div>
    </div>
  );
}
```

If `summarizeDetail` in `web/app/eventDetail.ts` has a different signature, call it as that file defines it rather than changing the file.

- [ ] **Step 4: Add the styles**

Append to `web/app/globals.css`:

```css
.rule-row {
  display: grid;
  grid-template-columns: 26px 1fr;
  gap: 12px;
  padding: 10px 15px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  line-height: 1.55;
}

.rule-row:last-child { border-bottom: none; }
.rule-num { font-family: var(--mono); font-size: 11.5px; color: var(--text-faint); }
.stat .stat-sub { font-size: 11px; color: var(--text-faint); margin-top: 6px; }
.stat-value .of { font-size: 13px; color: var(--text-faint); font-weight: 500; }
.agent-card { text-decoration: none; color: inherit; }
```

- [ ] **Step 5: Add the Pause control**

Pause is the one agent-level control that works with the runner on the Mac:
it sets `agents.enabled = false`, and `claim_next_task` already refuses to
hand work to a disabled agent, so it takes effect at the next run without the
Mac needing to be awake now.

Append to `src/db.ts`:

```ts
/** Enable or pause an agent. A paused agent is skipped by claim_next_task. */
export async function setAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from("agents")
    .update({ enabled })
    .eq("id", agentId);
  if (error) throw new Error(`setAgentEnabled(${agentId}): ${error.message}`);
}
```

Append to `web/app/actions.ts`, following the shape of the actions already in
that file:

```ts
export async function toggleAgentPaused(formData: FormData): Promise<ActionResult> {
  const agentId = String(formData.get("agentId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (!agentId) return { ok: false, error: "Missing agent." };
  try {
    const { setAgentEnabled } = await import("../../src/db.js");
    await setAgentEnabled(agentId, enabled);
    revalidatePath(`/agents`);
    revalidatePath(`/org`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

If `web/app/actions.ts` does not already import `revalidatePath`, add
`import { revalidatePath } from "next/cache";` at the top.

Create `web/app/agents/[key]/PauseButton.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { toggleAgentPaused, type ActionResult } from "../../actions";

const initial: ActionResult = { ok: true };

export function PauseButton({ agentId, enabled }: { agentId: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(async () => {
    const fd = new FormData();
    fd.set("agentId", agentId);
    fd.set("enabled", String(!enabled));
    return toggleAgentPaused(fd);
  }, initial);

  return (
    <form action={action}>
      <button type="submit" className="ghost" disabled={pending}>
        {pending ? "Saving…" : enabled ? "Pause" : "Resume"}
      </button>
      {!state.ok && <span className="err">{state.error}</span>}
    </form>
  );
}
```

In `web/app/agents/[key]/page.tsx`, import it and replace the
`<span className="sub">Next run 07:00</span>` in the header with:

```tsx
            <div className="head-actions">
              <span className="sub">{agent.enabled ? "Next run 07:00" : "Paused"}</span>
              <PauseButton agentId={agent.id} enabled={agent.enabled} />
            </div>
```

Add to `web/app/globals.css`:

```css
.head-actions { display: flex; align-items: center; gap: 12px; }
.head-actions button { min-height: 34px; }
```

- [ ] **Step 6: Verify by hand**

With the dev server running: `/org` groups agents with Marketing first; clicking one opens `/agents/<key>`; the instruction count matches `countRules`; a rule added by the Task 5 decline appears at the bottom of the list. Pausing an agent flips the button to Resume and the header to "Paused"; confirm the row changed with:

```bash
cd ~/agentco && npm run review -- agents
```

Resume it again before moving on, or tomorrow's 07:00 run will skip it.

- [ ] **Step 7: Run tests and build**

```bash
cd ~/agentco && npm test && npm --prefix web run build
```

- [ ] **Step 8: Commit**

```bash
cd ~/agentco
git add -A
git commit -m "feat(web): org and agent detail, pause control, feedback loop made visible"
```

---

### Task 7: Activity log and the unreachable-database band

An operations surface that fails invisibly is worse than useless. This task adds the last route and makes a Supabase outage render as a band rather than a blank page.

**Files:**
- Create: `web/app/activity/page.tsx`
- Create: `web/app/error.tsx`
- Create: `web/app/not-found.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Consumes: `recentEvents`, `listAgents`, `pendingDraftCountsByAgent`
- Produces: nothing later tasks depend on

- [ ] **Step 1: Build the activity page**

Create `web/app/activity/page.tsx`:

```tsx
import { recentEvents, listAgents, pendingDraftCountsByAgent } from "../../../src/db.js";
import { Sidebar } from "../Sidebar";
import { BottomNav } from "../BottomNav";
import { fmtDateTime } from "../format";
import { summarizeDetail, detailTone } from "../eventDetail";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const [events, agents, pendingCounts] = await Promise.all([
    recentEvents(60),
    listAgents(),
    pendingDraftCountsByAgent(),
  ]);

  return (
    <div className="shell">
      <Sidebar agents={agents} pendingCounts={pendingCounts} active="/activity" />
      <div className="shell-main">
        <main className="wrap">
          <div className="top">
            <h1>Activity</h1>
            <span className="sub">Last {events.length} events</span>
          </div>
          <div className="feed">
            {events.map((e: any, i: number) => (
              <div className="feed-row" key={i}>
                <span className="time">{fmtDateTime(e.created_at)}</span>
                <span className="agent">{e.agent ?? "—"}</span>
                <span className={`kind ${detailTone(e.kind)}`}>{e.kind}</span>
                <span className="detail">{summarizeDetail(e.kind, e.detail)}</span>
              </div>
            ))}
            {events.length === 0 && <div className="empty">Nothing logged yet.</div>}
          </div>
        </main>
        <BottomNav active="/activity" />
      </div>
    </div>
  );
}
```

Match the shapes `recentEvents` actually returns and the exact signatures in `web/app/eventDetail.ts`; do not change that file.

- [ ] **Step 2: Add the error boundary**

Create `web/app/error.tsx`:

```tsx
"use client";

/**
 * Every page here is a live read of the operations database. When that read
 * fails, the honest thing to show is "the database did not answer" — a blank
 * screen would read as "nothing is happening", which is the one wrong
 * conclusion this app must never let Denis draw.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="wrap">
      <div className="health something_failed">
        <div className="headline-row">
          <div className="dot" />
          <span className="state-label">Cannot read</span>
          <span className="headline">The database did not answer</span>
        </div>
        <ul className="evidence">
          <li>{error.message}</li>
        </ul>
        <p className="note">
          This says nothing about whether your agents ran. It says this app could not
          find out.
        </p>
        <button type="button" onClick={reset} className="primary">Try again</button>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Add the not-found page**

Create `web/app/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap">
      <div className="top"><h1>Not here</h1></div>
      <p className="note">That draft or agent does not exist.</p>
      <Link href="/" className="btn">Back to today</Link>
    </main>
  );
}
```

- [ ] **Step 4: Verify the error band by hand**

Stop the dev server, set a deliberately wrong key, and restart:

```bash
cd ~/agentco && SUPABASE_SERVICE_ROLE_KEY=broken npm --prefix web run dev
```

Load `/`. Expected: the red band reading "The database did not answer", not a stack trace and not a blank page. Restore the real key and restart before continuing.

- [ ] **Step 5: Run tests and build**

```bash
cd ~/agentco && npm test && npm --prefix web run build
```

- [ ] **Step 6: Commit**

```bash
cd ~/agentco
git add -A
git commit -m "feat(web): activity log, plus an honest band when the database is unreachable"
```

---

### Task 8: Home-screen install and deploy

The last step is what makes it an app he opens rather than a site he visits.

**Files:**
- Create: `web/app/manifest.webmanifest`
- Create: `web/public/icons/icon-192.png`
- Create: `web/public/icons/icon-512.png`
- Modify: `web/app/layout.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: a working app from Tasks 1-7
- Produces: a deployed URL

- [ ] **Step 1: Generate the icons**

A plain mark on the app's own background, generated locally so no asset pipeline is added:

```bash
cd ~/agentco && mkdir -p web/public/icons && python3 - <<'PY'
import struct, zlib

def png(path, size, bg, fg):
    px = bytearray()
    inset = size // 4
    for y in range(size):
        px.append(0)
        for x in range(size):
            inside = inset <= x < size - inset and inset <= y < size - inset
            px.extend(fg if inside else bg)
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    open(path, "wb").write(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(px), 9))
        + chunk(b"IEND", b"")
    )

for size in (192, 512):
    png(f"web/public/icons/icon-{size}.png", size, (0x16, 0x15, 0x12), (0x7F, 0xBF, 0xA4))
print("icons written")
PY
```

- [ ] **Step 2: Add the manifest**

Create `web/app/manifest.webmanifest`:

```json
{
  "name": "agentco",
  "short_name": "agentco",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#161512",
  "theme_color": "#161512",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 3: Link it from the layout**

Replace `web/app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "agentco",
  description: "The control room for Denis's agent company.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "agentco", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#161512",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Deploy to Vercel**

Create the project against the GitHub repo `golosindenis/agentco`, then set:

- **Root Directory:** `web`
- **Include files outside the root directory:** on — the app imports `../src`, and the build fails without it
- **Environment variables** (all Production and Preview):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `ALLOWED_EMAIL`

Confirm none of the first two are prefixed `NEXT_PUBLIC_`. Then deploy.

- [ ] **Step 5: Add the deployed URL to Supabase Auth**

In Supabase → Authentication → URL Configuration, add the Vercel URL as a Site URL and `<url>/auth/callback` as a redirect URL. Without this the emailed link bounces to localhost.

- [ ] **Step 6: Verify on the phone**

On the iPhone: open the deployed URL, sign in with the emailed code, add to home screen, open from the home screen and confirm it launches without browser chrome and lands on Today. Approve one real pending draft and confirm it leaves the list.

- [ ] **Step 7: Update the README**

In `README.md`, replace the `dashboard` section with the deployed URL, the `npm run web` command, and one line stating that the runner is still the 07:00 LaunchAgent on the Mac, so the app shows what that run produced and never triggers one.

- [ ] **Step 8: Run tests and build one last time**

```bash
cd ~/agentco && npm test && npm --prefix web run build
```

- [ ] **Step 9: Commit**

```bash
cd ~/agentco
git add -A
git commit -m "feat(web): home-screen install and Vercel deployment"
```

---

## After this plan

The measurement named in the spec starts now: **drafts reviewed within a day of being produced, over two weeks.** Do not start the cloud-runner sub-project until that number is known. If it stays near zero on a phone-first app, the interface was never the problem and more agents would be the wrong response.
