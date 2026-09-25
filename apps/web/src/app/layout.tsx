import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { GameGate } from "@/components/game-gate";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "monkeyLuka",
    template: "%s · monkeyLuka",
  },
  description: "A monkey-powered multiplayer game.",
  // iOS standalone (Add to Home Screen): no browser chrome, title on the
  // home-screen icon, and a transparent status bar so the canvas runs
  // edge-to-edge under the notch/home indicator (paired with the
  // `viewportFit: "cover"` viewport above). See app/manifest.ts + the
  // apple-icon.png convention for the rest of the install path.
  appleWebApp: {
    capable: true,
    title: "monkeyLuka",
    statusBarStyle: "black-translucent",
  },
  other: {
    // Next renders `appleWebApp.capable` under the modern unprefixed name
    // (mobile-web-app-capable); classic iOS standalone also reads Apple's
    // legacy prefixed meta, so keep both.
    "apple-mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        {/* Touch devices: the whole app blocks until the viewport is
            landscape and full-screen — starting from the Main page. */}
        <GameGate>{children}</GameGate>
      </body>
    </html>
  );
}
