/**
 * `buildJungleScene` — the single-scene config for the jungle room.
 * Previously one 360-line file, now assembled from focused pieces:
 *
 * - `create.ts`  — asset load + world build + player spawn + keyboard
 * - `update.ts`  — input → local prediction → ~20 Hz reports → snapshot
 *                  reconciliation → room-locked camera → remote easing
 * - `state.ts`   — the mutable world shared between create and update
 * - `constants.ts` — asset locations and the report cadence
 * - `debug.ts`   — NEXT_PUBLIC_DEBUG gates + window debug handles
 */

import type Phaser from "phaser";
import type { JungleGameOptions, JungleRoom } from "../jungle-game";
import { createSceneCreate } from "./create";
import { createSceneUpdate } from "./update";
import { createJungleSceneState } from "./state";

/**
 * Builds the single-scene config for the jungle room. `phaser` is the
 * runtime namespace returned by `await import("phaser")` in
 * `createJungleGame`.
 *
 * Networking model: collision is client-side — the client simulates locally
 * with the shared physics and renders that immediately. It streams its input
 * plus the predicted state to the server (`PLAYER_INPUT_MESSAGE`); the
 * server validates the reported trajectory and broadcasts accepted state in
 * `JungleState`. The local player reconciles against that broadcast (a
 * rejected report visibly stops it) and remote players render straight from it.
 */
export function buildJungleScene(
  phaser: typeof Phaser,
  room: JungleRoom,
  options: JungleGameOptions,
): Phaser.Types.Scenes.CreateSceneFromObjectConfig {
  // Scene-scoped state shared between create() and update().
  const state = createJungleSceneState();
  return {
    create: createSceneCreate(phaser, room, options, state),
    update: createSceneUpdate(phaser, room, state),
  };
}