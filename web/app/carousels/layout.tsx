import {
  Archivo, Bricolage_Grotesque, Dancing_Script, Fraunces, Hanken_Grotesk, Inter, JetBrains_Mono,
  Manrope, Oswald, Playfair_Display, Plus_Jakarta_Sans, Source_Serif_4, Space_Grotesk, Unbounded,
} from "next/font/google";
import "./studio/studio.css";

// The builder's 14 faces, mirroring the fork's src/app/layout.tsx, loaded
// only on carousel pages. Their CSS variables go on a wrapper instead of
// <body>, so the rest of agentco is untouched.
const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter" });
const playfair = Playfair_Display({ subsets: ["latin", "cyrillic"], style: ["normal", "italic"], variable: "--font-playfair" });
const unbounded = Unbounded({ subsets: ["latin", "cyrillic"], variable: "--font-unbounded", weight: ["400", "500", "700", "800", "900"] });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", weight: ["400", "500", "600", "700"] });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-jetbrains-mono", weight: ["400", "500", "700", "800"] });
const manrope = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-manrope", weight: ["500", "800"] });
const oswald = Oswald({ subsets: ["latin", "cyrillic"], variable: "--font-oswald", weight: ["400", "500", "600", "700"] });
const archivo = Archivo({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-archivo" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-bricolage" });
const fraunces = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], weight: ["400", "500", "600"], variable: "--font-fraunces" });
const sourceSerif = Source_Serif_4({ subsets: ["latin", "cyrillic"], style: ["normal", "italic"], weight: ["400", "500", "600"], variable: "--font-source-serif" });
const dancingScript = Dancing_Script({ subsets: ["latin"], weight: ["600"], variable: "--font-dancing-script" });
const hankenGrotesk = Hanken_Grotesk({ subsets: ["latin", "cyrillic-ext"], weight: ["400", "500", "600"], variable: "--font-hanken-grotesk" });
const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin", "cyrillic-ext"], weight: ["400", "500", "700"], variable: "--font-plus-jakarta" });

const fontVars = [
  inter, playfair, unbounded, spaceGrotesk, jetbrainsMono, manrope, oswald, archivo,
  bricolage, fraunces, sourceSerif, dancingScript, hankenGrotesk, plusJakartaSans,
].map((f) => f.variable).join(" ");

export default function CarouselsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`carousel-studio ${fontVars}`}
      style={{ minHeight: "100vh", background: "#171717", color: "#fff", fontFamily: "var(--font-inter), system-ui, sans-serif", WebkitFontSmoothing: "antialiased" }}
    >
      {children}
    </div>
  );
}
