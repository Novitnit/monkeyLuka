"use client";

import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { IconFullscreen, IconRotate } from "@/components/icons";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Hard gate for touch devices: the app only renders once it can actually be
 * played — viewport is landscape AND the app is full-screen (or a PWA
 * running standalone). Desktop / fine-pointer users pass straight through.
 * Browsers can't enter fullscreen without a user gesture, so the gate
 * blocks with instructions + a button instead of forcing silently.
 *
 * iOS is special: Safari on iPhone/iPad has no `requestFullscreen()` at all,
 * so the only full-screen path is an installed Home Screen app (the
 * standalone PWA unlocked by `(display-mode: standalone)` here). iOS users
 * who aren't installed get Add-to-Home-Screen steps instead of the
 * desktop full-screen button.
 */
export function GameGate({ children }: { children: ReactNode }) {
  const touchDevice = useMediaQuery("(pointer: coarse)");
  const portrait = useMediaQuery("(orientation: portrait)");
  const standalone = useMediaQuery("(display-mode: standalone)");
  const fullscreenActive = useFullscreen();
  const [entering, setEntering] = useState(false);

  const fullscreenAvailable =
    typeof document !== "undefined" &&
    "requestFullscreen" in document.documentElement;

  // iOS Safari on iPhone/iPad exposes no fullscreen API — the Home Screen
  // app (the manifest's standalone display mode) is the only full-screen
  // path. iPadOS 13+ hides its iPad in the UA (Mac desktop UA + touchscreen),
  // hence the maxTouchPoints clause; the feature-detect above still wins for
  // any platform that does implement requestFullscreen.
  const isIOS =
    typeof navigator !== "undefined" &&
    (/iP(hone|od|ad)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  // iOS Safari + not installed: nothing the gate can do programmatically —
  // guide the player through Add to Home Screen (the unlock is the
  // `standalone` media query flipping true once launched from the icon).
  const needsInstall = isIOS && !fullscreenAvailable && !standalone;

  // Entering fullscreen is a user gesture; orientation lock only works once
  // fullscreen is granted (and only where the platform supports it).
  const enterFullscreen = useCallback(async () => {
    if (!document.documentElement.requestFullscreen) return;
    setEntering(true);
    try {
      await document.documentElement.requestFullscreen();
      // Some TS libs omit lock(); feature-detect it at runtime.
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (orientation: string) => Promise<void>;
      };
      if (orientation.lock) {
        try {
          await orientation.lock("landscape");
        } catch {
          // No orientation lock (e.g. iOS) — the rotate overlay covers it.
        }
      }
    } catch {
      // Fullscreen denied — stay blocked so the game can't run half-broken.
    } finally {
      setEntering(false);
    }
  }, []);

  const unlocked =
    !touchDevice || (!portrait && (fullscreenActive || standalone));
  if (unlocked) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background px-8 text-center compact:gap-5 compact:px-6">
      <div
        className={`grid size-20 place-items-center rounded-3xl border border-white/10 bg-white/[0.05] compact:size-14 compact:rounded-2xl ${
          portrait ? "animate-bob" : ""
        }`}
      >
        <IconRotate
          className={`size-9 text-amber-300 compact:size-7 ${
            portrait ? "" : "rotate-90"
          }`}
        />
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50 compact:text-lg">
          {portrait
            ? "Rotate your device"
            : needsInstall
              ? "Add monkeyLuka to your Home Screen"
              : "Enter full-screen to play"}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-zinc-400 compact:mt-1.5 compact:max-w-xs compact:text-[13px] compact:leading-snug">
          {portrait
            ? "monkeyLuka is played in landscape. Flip your phone sideways — the game unlocks once you're horizontal and full-screen."
            : needsInstall
              ? "iPhone and iPad Safari has no full-screen mode, so monkeyLuka runs full-screen as a Home Screen app — no notch, no browser bar."
              : "The game runs in full-screen to hide the browser UI. Tap below to go full-screen, then play."}
        </p>
        {needsInstall && (
          <ol className="mx-auto mt-3 max-w-sm space-y-1.5 text-left text-sm leading-relaxed text-zinc-400 compact:mt-2 compact:max-w-xs compact:text-[13px] compact:leading-snug">
            <li>1. Tap the Share button (square with an up arrow) in Safari.</li>
            <li>2. Choose “Add to Home Screen”, then tap “Add”.</li>
            <li>
              3. Open monkeyLuka from your Home Screen — it launches
              full-screen in landscape.
            </li>
          </ol>
        )}
      </div>

      {fullscreenAvailable ? (
        <button
          type="button"
          onClick={enterFullscreen}
          disabled={entering}
          className="inline-flex items-center justify-center gap-2 rounded-2xl compact:rounded-xl compact:px-6 compact:py-2.5 compact:text-sm bg-linear-to-b from-amber-300 to-amber-500 px-8 py-4 text-lg font-extrabold tracking-wide text-zinc-950 shadow-[0_18px_50px_-14px_rgba(251,191,36,0.55)] ring-1 ring-inset ring-amber-200/50 transition duration-200 hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-70"
        >
          <IconFullscreen className="size-5 text-zinc-900 compact:size-4" />
          {entering ? "Entering…" : "Enter full-screen"}
        </button>
      ) : needsInstall ? (
        <p className="text-sm text-zinc-500 compact:text-xs">
          The game unlocks automatically once it's opened from the Home Screen.
        </p>
      ) : (
        <p className="text-sm text-zinc-500 compact:text-xs">
          {"Your browser doesn't support full-screen — use the fullscreen option in your browser's menu, then rotate your device."}
        </p>
      )}
    </div>
  );
}