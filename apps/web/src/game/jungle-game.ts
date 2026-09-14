import type Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import type { JungleRoomState } from "@monkeyluka/shared";
import { buildJungleScene } from "./scene";
import type { TouchControlsState } from "./touch/touch-input";

/** A joined jungle room, typed with its synced state. */
export type JungleRoom = Room<unknown, JungleRoomState>;

/** Options for booting the jungle game. */
export interface JungleGameOptions {
  /**
   * Draw the collision-geometry debug lines (green vertical walls, blue
   * horizontal floors, orange slopes). Defaults to the NEXT_PUBLIC_DEBUG
   * flag — off unless it's "1"/"true" — and can be overridden here or at
   * runtime via `__jungleCollisionDebug.setEnabled(...)`.
   */
  collisionDebug?: boolean;
  /**
   * Draw the door-link debug lines (cyan, signpost → door per room
   * objectgroup name). Defaults to the NEXT_PUBLIC_DOOR_DEBUG flag — off
   * unless it's "1"/"true" — overridable at runtime via
   * `__jungleDoorDebug.setEnabled(...)`.
   */
  doorDebug?: boolean;
  /**
   * Draw the trap attack-radius debug boxes (red, one per marker — the
   * exact `isBoxTouchingTrapSpikeRun` kill AABB around each sweeping
   * spike). Defaults to the NEXT_PUBLIC_DEBUG flag — off unless it's
   * "1"/"true" — overridable at runtime via
   * `__jungleTrapSpikeRunDebug.setEnabled(...)`.
   */
  trapSpikeRunDebug?: boolean;
  /**
   * Sprite-sheet texture key for the Trap_Spike_Run movable traps.
   * Defaults to the built-in `Trap_Spike_Run.png` sheet (preloaded +
   * animated by the scene itself); pass a different key to swap in a
   * caller-loaded sheet instead (rendered as a static frame 0 — only the
   * built-in sheet has its 2×3 layout and idle animation registered).
   */
  trapSpikeRunTexture?: string;
  /**
   * Live on-screen control state for touch devices (see
   * `components/touch-controls.tsx` — the HUD writes here, the scene's
   * update loop merges it into the player input like the keyboard axes).
   * Pass the same instance you hand to the HUD. When omitted the game
   * accepts keyboard input only.
   */
  touchControls?: TouchControlsState;
}

/**
 * Boot the Phaser jungle client inside `parent` and return the game
 * instance. The scene itself lives in `scene/` (`scene/index.ts`); this wrapper only
 * handles the dynamic Phaser import (its bundle touches `window` at module
 * scope, so it must never load during server-side rendering — this function
 * only ever runs from a browser effect) and the game config.
 */
export async function createJungleGame(
  parent: HTMLElement,
  room: JungleRoom,
  options: JungleGameOptions = {},
): Promise<Phaser.Game> {
  const Phaser = await import("phaser");
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#0b0e14",
    width: 1280,
    height: 720,
    // Nearest-neighbor filtering + rounded pixels: without this, the default
    // linear filtering makes the tightly-packed 16px atlas cells (player
    // sheets, tilesets) bleed ~1px of the adjacent frame into each other at
    // the ~2.667x magnification, and sub-pixel tile placement shows seams
    // between neighbors. This is the documented "best setting for pixel-art
    // games": sets antialias=false and roundPixels=true too.
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: buildJungleScene(Phaser, room, options),
  });
}
