import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "agentco",
  description: "The control room for Denis's agent company.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "agentco", statusBarStyle: "black-translucent" },
  // iOS ignores the manifest's `icons` array when adding to the home screen
  // and reads <link rel="apple-touch-icon"> instead. Without this the home
  // screen icon is a screenshot of whatever page was open — for a signed-out
  // phone, the login form.
  icons: { apple: "/icons/icon-192.png" },
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
