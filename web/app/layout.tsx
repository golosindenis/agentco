import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "agentco — control room",
  description: "Local operations dashboard for the agentco engine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
