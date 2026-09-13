"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import {
  IconArrowUp,
  IconChevronLeft,
  IconChevronRight,
  IconQuestionCircle,
} from "@/components/icons";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * On-screen controls for touch devices: a bottom-left move pad (left/right)
 * and a bottom-right action cluster (interact + jump). Shown only when the
 * primary pointer is coarse (phones/tablets — the same check the GameGate
 * uses), anchored to the viewport with safe-area insets so notches and home
 * bars never cover them, and layered above the Phaser canvas. The container
 * is `pointer-events-none`: only the buttons themselves capture touches, so
 * taps everywhere else (e.g. the quest box's answer rows) still reach the
 * game.
 *
 * The buttons report presses through the `onMove`/`onJump`/`onInteract`
 * callbacks; the owner (play-screen.tsx) writes them into the shared
 * `TouchControlsState` the scene's update loop reads every frame (see
 * `game/touch/touch-input.ts`): movement is a held state (a thumb down on
 * the button), jump and interact are tap edges — one tap = one jump / one
 * interaction, mirroring the keyboard's `JustDown`. `setPointerCapture` on
 * the move buttons guarantees a finger sliding off the button still
 * releases the held state; `touch-none` stops the browser from
 * scrolling/zooming from a press.
 */
export function TouchControls({
  onMove,
  onJump,
  onInteract,
}: {
  /** A move button was pressed (down) or released (down=false). */
  onMove(key: "left" | "right", down: boolean): void;
  /** The jump button was tapped. */
  onJump(): void;
  /** The interact button was tapped. */
  onInteract(): void;
}) {
  const touchDevice = useMediaQuery("(pointer: coarse)");
  if (!touchDevice) return null;

  // Held movement: relay press/release to the owner. The press captures the
  // pointer so the matching release is delivered to this same button even if
  // the finger slid off it mid-press.
  const holdMove =
    (key: "left" | "right", down: boolean) =>
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (down) event.currentTarget.setPointerCapture(event.pointerId);
      onMove(key, down);
    };

  const moveButton = `pointer-events-auto grid size-16 touch-none select-none place-items-center rounded-2xl border border-white/10 bg-zinc-950/55 text-zinc-200 backdrop-blur-sm transition-colors active:border-amber-300/40 active:bg-amber-400/30 active:text-amber-100 compact:size-14`;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex select-none items-end justify-between pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-end gap-3">
        <button
          type="button"
          aria-label="Move left"
          onPointerDown={holdMove("left", true)}
          onPointerUp={holdMove("left", false)}
          onPointerCancel={holdMove("left", false)}
          className={moveButton}
        >
          <IconChevronLeft className="size-8" />
        </button>
        <button
          type="button"
          aria-label="Move right"
          onPointerDown={holdMove("right", true)}
          onPointerUp={holdMove("right", false)}
          onPointerCancel={holdMove("right", false)}
          className={moveButton}
        >
          <IconChevronRight className="size-8" />
        </button>
      </div>

      <div className="flex items-end gap-3">
        <button
          type="button"
          aria-label="Interact (talk to the signpost, answer the question)"
          onPointerDown={onInteract}
          className="pointer-events-auto grid size-14 touch-none select-none place-items-center rounded-2xl border border-white/10 bg-zinc-950/55 text-zinc-200 backdrop-blur-sm transition-colors active:border-emerald-300/40 active:bg-emerald-400/30 active:text-emerald-100 compact:size-12"
        >
          <IconQuestionCircle className="size-7" />
        </button>
        <button
          type="button"
          aria-label="Jump"
          onPointerDown={onJump}
          className="pointer-events-auto grid size-20 touch-none select-none place-items-center rounded-full border border-amber-300/30 bg-amber-400/20 text-amber-200 backdrop-blur-sm transition-colors active:border-amber-300/60 active:bg-amber-400/50 active:text-amber-100 compact:size-16"
        >
          <IconArrowUp className="size-9" />
        </button>
      </div>
    </div>
  );
}