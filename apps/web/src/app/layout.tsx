import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { fr } from "@/i18n/fr";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: fr.app.pageTitle,
  description: fr.app.pageDescription,
};

export const viewport: Viewport = {
  themeColor: "#f7f8fa",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
