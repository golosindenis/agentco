import "server-only";
import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual } from "node:crypto";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function redirectUri(provider: "meta" | "threads"): string {
  return `${env("PUBLIC_BASE_URL")}/accounts/callback/${provider}`;
}

/** A random state kept in an httpOnly cookie, so a callback we did not start is refused. */
export async function newState(provider: string): Promise<string> {
  const state = randomBytes(24).toString("hex");
  (await cookies()).set(`oauth_${provider}`, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/accounts" });
  return state;
}

export async function stateMatches(provider: string, got: string | null): Promise<boolean> {
  const store = await cookies();
  const want = store.get(`oauth_${provider}`)?.value;
  store.delete(`oauth_${provider}`);
  if (!want || !got || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}
