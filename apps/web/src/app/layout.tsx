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
