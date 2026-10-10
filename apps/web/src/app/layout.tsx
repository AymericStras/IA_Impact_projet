import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Semi_Condensed, Geist_Mono } from "next/font/google";
import "./globals.css";
import { fr } from "@/i18n/fr";

// « V3 — Occitanie en train » type: Barlow for text, Barlow Semi Condensed 800 for titles
// and big values. Self-hosted by next/font (no request to Google at runtime).
const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const barlowSemiCondensed = Barlow_Semi_Condensed({
  variable: "--font-barlow-semi-condensed",
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: fr.app.pageTitle,
  description: fr.app.pageDescription,
};

export const viewport: Viewport = {
  // Navy of the header (`--brand-navy` in globals.css): the browser chrome continues it.
  themeColor: "#0f2149",
  width: "device-width",
  initialScale: 1,
  // Lets the page extend under notches; the shell pads itself with safe-area insets.
  viewportFit: "cover",
  // Where supported, the on-screen keyboard resizes the layout so the composer stays visible.
  interactiveWidget: "resizes-content",
  // Zoom is never restricted (no maximumScale / userScalable).
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr"
      className={`${barlow.variable} ${barlowSemiCondensed.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
