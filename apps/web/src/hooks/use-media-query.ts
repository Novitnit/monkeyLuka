"use client";

import { useSyncExternalStore } from "react";

// Stable per-query subscribe so `useSyncExternalStore` doesn't resubscribe on
// every render.
const mediaSubscriptions = new Map<string, (onChange: () => void) => () => void>();

function subscribeFor(query: string) {
  let subscribe = mediaSubscriptions.get(query);
  if (!subscribe) {
    subscribe = (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    };
    mediaSubscriptions.set(query, subscribe);
  }
  return subscribe;
}

/**
 * Subscribes to a CSS media query, returning whether it currently matches.
 * Safe to use in client components; renders `false` on the server (and
 * corrects itself on hydration without a markup mismatch).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeFor(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}