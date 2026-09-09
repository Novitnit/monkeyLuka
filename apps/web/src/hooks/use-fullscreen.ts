"use client";

import { useSyncExternalStore } from "react";

function subscribeFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

/**
 * Whether the document is currently in full-screen mode. Safe to use in
 * client components; renders `false` on the server.
 */
export function useFullscreen(): boolean {
  return useSyncExternalStore(
    subscribeFullscreen,
    () => Boolean(document.fullscreenElement),
    () => false,
  );
}