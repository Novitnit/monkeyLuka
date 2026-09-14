/**
 * Player death: what happens when the player dies. The scene's update loop
 * detects lethal contacts (today: a body touching a dead-zone pit — see
 * `isBoxInDeadZone` — or a body touching a movable trap — see
 * `isBoxTouchingTrapSpikeRun`, both in update.ts) and calls `onDead` with the
 * cause. `onDead` runs the death behaviors for that cause, dispatched
 * per-cause so new lethal situations — and new behaviors for an existing
 * cause — can be added here without touching the update loop.
 */

import {
  PLAYER_CHECKPOINT_MESSAGE,
  PLAYER_DEATH_MESSAGE,
} from "@monkeyluka/shared";
import type { JungleRoom } from "./jungle-game";
import type { Player } from "./player/player";
import type { JungleSceneState } from "./scene/state";

/**
 * Why a player died. Each member is a distinct lethal situation the update
 * loop can hand to `onDead`; extend this union when the game grows a new
 * way to die (enemies, falls, ...).
 */
export type DeathCause = "dead-zone" | "trap";

/**
 * Kills the player with `cause` and runs the death behaviors. Called once
 * per death — the update loop's `dead` guard keeps it from re-firing while
 * a death is in progress.
 *
 * Today every cause shares one behavior: the player is teleported back to
 * its checkpoint, frozen where it landed (the `dead` flag gates movement
 * input, see update.ts) and the room is asked for a death question
 * (`PLAYER_DEATH_MESSAGE`). The teleport is part of the death, not the
 * revive: it lifts the body out of the hazard so the frozen player is
 * never still overlapping the lethal thing (the pit floor, a sweeping
 * trap) and can't be re-killed the instant it revives. The quest box's
 * death mode then runs the retry loop: a wrong answer freezes the player
 * for 3 seconds before a fresh question is requested; a correct answer
 * calls `revivePlayer`. The switch is the extension point — a new death
 * behavior — or a new cause — lands as a case here.
 */
export function onDead(
  player: Player,
  cause: DeathCause,
  room: JungleRoom,
  state: JungleSceneState,
): void {
  switch (cause) {
    case "dead-zone":
    case "trap":
      player.teleportTo(state.checkpoint.x, state.checkpoint.y);
      state.checkpointPending = true;
      room.send(PLAYER_CHECKPOINT_MESSAGE, {});
      state.dead = true;
      state.deathRequestAt = Date.now();
      room.send(PLAYER_DEATH_MESSAGE, {});
      return;
  }
}

export function revivePlayer(
  state: JungleSceneState,
): void {
  state.dead = false;
}
