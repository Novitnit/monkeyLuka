import type Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import type { JungleRoomState } from "@monkeyluka/shared";
import { buildJungleScene } from "./jungle-scene";

/** A joined jungle room, typed with its synced state. */
export type JungleRoom = Room<unknown, JungleRoomState>;

/** Options for booting the jungle game. */
export interface JungleGameOptions {
  /**
   * Draw the collision-geometry debug lines (green vertical walls, blue
   * horizontal floors, orange slopes). Default true — disable via
   * `__jungleCollisionDebug.setEnabled(false)` or pass false here.
   */
  collisionDebug?: boolean;
}

/**
 * Boot the Phaser jungle client inside `parent` and return the game
 * instance. The scene itself lives in `jungle-scene.ts`; this wrapper only
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
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: buildJungleScene(Phaser, room, options),
  });
}
