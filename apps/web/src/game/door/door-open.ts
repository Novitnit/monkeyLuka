/**
 * Client-side door opening: applies doors the room has opened (synced in
 * `JungleState.doors`, the same state channel as players) to the local
 * world. A door opening — every showquest interaction linked to it answered
 * correctly — makes the doorway passable: the shared `clearDoorFromGrid`
 * removes the door's four cells from the client's prediction grid (the
 * exact mirror of what the room does to its validation grid). The door's
 * tile art keeps rendering as usual; only the door's PURPLE debug-collision
 * perimeter is dropped (`CollisionDebug.hideDoor` — each door's lines live
 * on their own graphics, see collision-debug.ts), because those lines
 * describe the closed door's solid block and would be a lie once the
 * doorway is open.
 *
 * Called every frame from the scene's update loop (cheap: only doors not
 * yet applied are touched, tracked in `state.openDoors`). Because the door
 * state comes from the synced schema — not a one-shot broadcast — a player
 * who joins after a door opened still finds it passable.
 */

import { clearDoorFromGrid } from "@monkeyluka/shared";
import type { JungleRoom } from "../jungle-game";
import type { JungleSceneState } from "../scene/state";

/**
 * Reconcile the synced door state into the local world: for every door the
 * room has opened that this client hasn't applied yet, clear its collision
 * cells and drop its debug perimeter. No-op until the world (grid + debug
 * overlay) is built, and after the schema state has arrived (it may lag the
 * join).
 */
export function syncOpenDoors(
  room: JungleRoom,
  state: JungleSceneState,
): void {
  const doors = room.state?.doors;
  const grid = state.grid;
  const collisionDebug = state.collisionDebug;
  if (!doors || !grid || !collisionDebug) return;

  for (const [key, info] of doors) {
    if (info.state !== "open" || state.openDoors.has(key)) continue;
    state.openDoors.add(key);
    clearDoorFromGrid(grid, info.tx, info.ty);
    // The purple perimeter is the closed door's collision outline; hide it
    // so the debug overlay stops drawing collision at the passable doorway.
    collisionDebug.hideDoor(info.tx, info.ty);
  }
}