/**
 * Player death: what happens when the player dies. The scene's update loop
 * detects lethal contacts (today: a body touching a dead-zone pit — see
 * `isBoxInDeadZone` in update.ts) and calls `onDead` with the cause.
 * `onDead` runs the death behaviors for that cause, dispatched per-cause so
 * new lethal situations — and new behaviors for an existing cause — can be
 * added here without touching the update loop.
 */

import { PLAYER_CHECKPOINT_MESSAGE } from "@monkeyluka/shared";
import type { JungleRoom } from "./jungle-game";
import type { Player } from "./player/player";
import type { JungleSceneState } from "./scene/state";

/**
 * Why a player died. Each member is a distinct lethal situation the update
 * loop can hand to `onDead`; extend this union when the game grows a new
 * way to die (enemies, falls, ...).
 */
export type DeathCause = "dead-zone";

/**
 * Kills the player with `cause` and runs the death behaviors. Called once
 * per death — the update loop's `checkpointPending` guard keeps it from
 * re-firing while a return is already in flight.
 *
 * Today every cause shares one behavior: return to the checkpoint through
 * `PLAYER_CHECKPOINT_MESSAGE`, the exact flow the debug R key uses
 * (teleport locally, freeze reconciliation until the server confirms, and
 * let the room re-baseline at the spawn so the jump isn't a teleport
 * violation). The switch is the extension point: a new death behavior —
 * or a new cause — lands as a case here.
 */
export function onDead(
  player: Player,
  cause: DeathCause,
  room: JungleRoom,
  state: JungleSceneState,
): void {
  switch (cause) {
    case "dead-zone":
      player.teleportTo(state.checkpoint.x, state.checkpoint.y);
      state.checkpointPending = true;
      room.send(PLAYER_CHECKPOINT_MESSAGE, {});
      return;
  }
}