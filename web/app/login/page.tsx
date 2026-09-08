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
