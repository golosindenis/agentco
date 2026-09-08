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
