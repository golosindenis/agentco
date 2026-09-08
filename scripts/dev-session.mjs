/**
 * Mints a real signed-in session cookie for local verification, without
 * sending an email. Uses the admin API to generate an OTP for ALLOWED_EMAIL
 * (Denis's own address — this never creates a second user), verifies it, and
 * prints a Cookie header for curl.
 *
 * Local development only. Never run this against a deployed environment.
 *
 *   node scripts/dev-session.mjs > /tmp/agentco-cookie.txt
 *   curl -H "Cookie: $(cat /tmp/agentco-cookie.txt)" http://localhost:3000/
 */
import "dotenv/config";

const url = process.env.SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.ALLOWED_EMAIL;

if (!url || !service || !anon || !email) {
  console.error("Missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, ALLOWED_EMAIL");
  process.exit(1);
}

const link = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email }),
});
const linkJson = await link.json();
if (!link.ok) {
  console.error("generate_link failed", link.status, linkJson);
  process.exit(1);
}

const verify = await fetch(`${url}/auth/v1/verify`, {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "email", email, token: linkJson.email_otp }),
});
const session = await verify.json();
if (!verify.ok) {
  console.error("verify failed", verify.status, session);
  process.exit(1);
}

const ref = new URL(url).hostname.split(".")[0];
const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
process.stdout.write(`sb-${ref}-auth-token=${value}`);
