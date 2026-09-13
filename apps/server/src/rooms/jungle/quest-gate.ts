/**
 * The quest gate: tracks which interaction tiles have been answered
 * correctly and flips a door group's doors open when every showquest
 * interaction linked to them is done.
 *
 * Room-level puzzle progress, shared by all players in the room: a correct
 * answer marks the signpost tile it came from as completed (it can't be
 * asked again), and each door-link group (see `groupRoomObjectsByName` in
 * @monkeyluka/shared) opens its doors the moment all of the group's
 * showquest interactions are completed. Doors never close again — opening
 * is permanent for the room's lifetime.
 *
 * Pure and engine-free (no grid, no schema): it only owns the completed
 * set and flips the shared `DoorEntity.state` fields. The room mirrors an
 * opened door into its validation grid (clearDoorFromGrid) and the synced
 * `JungleState.doors` schema. A door may belong to several groups (its
 * rectangle inside more than one same-name object); the first group that
 * completes opens it — union semantics across overlapping groups would
 * need every containing group done, but the real map has one group, so
 * per-group is what counts.
 */

import type { DoorEntity, DoorLinkGroup } from "@monkeyluka/shared";

/** Identity of an interaction tile (grid cell), the room-group link key. */
function interactionKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

export class QuestGate {
  /** Interaction tiles answered correctly, keyed by interactionKey. */
  private readonly completed = new Set<string>();

  constructor(private readonly groups: readonly DoorLinkGroup[]) {}

  /** Whether the interaction tile (tx, ty) has already been answered correctly. */
  isCompleted(tx: number, ty: number): boolean {
    return this.completed.has(interactionKey(tx, ty));
  }

  /**
   * Record that the interaction tile was answered correctly. Re-completing
   * a tile is a no-op. Returns the doors this completion just opened (their
   * `state` is already "open" — the caller mirrors them into its grids and
   * schema); empty when nothing new opened.
   */
  markCompleted(tx: number, ty: number): DoorEntity[] {
    const key = interactionKey(tx, ty);
    if (this.completed.has(key)) return [];
    this.completed.add(key);

    const opened: DoorEntity[] = [];
    for (const group of this.groups) {
      // A group with no showquests has nothing to gate its doors — they
      // must never open (an empty `every` would be vacuously true and open
      // them at the first unrelated correct answer).
      if (group.showquest.length === 0) continue;
      const allAnswered = group.showquest.every((link) =>
        this.completed.has(interactionKey(link.tx, link.ty)),
      );
      if (!allAnswered) continue;
      for (const door of group.doors) {
        if (door.state === "open") continue;
        door.state = "open";
        opened.push(door);
      }
    }
    return opened;
  }
}