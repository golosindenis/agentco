import type { Http } from "./types.js";

/** Confirm against the app dashboard's API version during Task 5 setup. */
export const GRAPH_VERSION = "v23.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const THREADS_BASE = "https://graph.threads.net/v1.0";

export class GraphError extends Error {
  constructor(message: string, readonly status: number, readonly code: number | null, readonly isAuth: boolean) {
    super(message);
    this.name = "GraphError";
  }
}

/** Meta's own message always travels with the failure. Code 190 is an invalid or expired token. */
export function parseGraphResponse(status: number, body: unknown): Record<string, unknown> {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const err = obj.error as { message?: string; code?: number; type?: string } | undefined;
  if (err || status >= 400) {
    const code = typeof err?.code === "number" ? err.code : null;
    const message = err?.message ?? `Meta returned ${status} with no error message`;
    throw new GraphError(message, status, code, code === 190);
  }
  return obj;
}

export const graphHttp: Http = async (url, opts = {}) => {
  const method = opts.method ?? "GET";
  const params = new URLSearchParams(opts.params ?? {});
  const res = method === "GET"
    ? await fetch(`${url}?${params}`)
    : await fetch(url, { method: "POST", body: params });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { error: { message: `Meta returned non JSON (${res.status}): ${text.slice(0, 300)}` } }; }
  return parseGraphResponse(res.status, body);
};
