/**
 * Where to send Denis after signing in, from the `next` value the middleware
 * put on the login URL. Only agentco's own paths are allowed: a value that
 * could leave the site (a full URL, `//host`, `/\host`, a scheme) or loop
 * back to the login page falls back to the dashboard. Without this, a crafted
 * sign-in link could land a freshly authenticated session on someone else's
 * site.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/^\/login(?:[/?#]|$)/.test(value)) return "/";
  return value;
}
