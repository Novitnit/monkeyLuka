import type { MetadataRoute } from "next";

/**
 * Web app manifest — makes monkeyLuka installable on phones/tablets.
 * iOS is the key audience: Safari has no `requestFullscreen()` on iPhone,
 * so "Add to Home Screen" is the only way to unlock a full-screen,
 * landscape-locked game (the GameGate checks `display-mode: standalone`).
 * `orientation: "landscape"` auto-locks an installed PWA to the landscape
 * the game is designed for (unlocked in browser Safari, where the rotate
 * overlay guides the player instead). The PNG icons below are also what
 * Android/Chrome and iOS home screens use; the `apple-icon` convention in
 * `app/` serves the 180×180 apple-touch-icon to iOS.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "monkeyLuka",
    short_name: "monkeyLuka",
    description: "A monkey-powered multiplayer game.",
    start_url: "/play",
    scope: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: "#0a0e17",
    theme_color: "#0a0e17",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}