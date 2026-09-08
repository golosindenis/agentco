"use client";

import { useState } from "react";

/**
 * The only client-side interactivity this dashboard needs for "ready to
 * post": a clipboard write. No data fetching, no shared state — just a
 * button that copies the text already rendered on the page by the server.
 */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard API can be denied (permissions, non-secure context).
          // The body is already selectable text in a <pre>-like block, so a
          // manual select-and-copy still works even if this silently fails.
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
