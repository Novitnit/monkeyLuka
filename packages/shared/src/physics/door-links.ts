/**
 * Door-link groups — the room objectgroup layer that ties a showquest
 * interaction to the doors its answers will open.
 *
 * Each rectangle in the Tiled map's room objectgroup (`ROOM_OBJECT_GROUP_NAME`,
 * "room") is a named region. A tile entity belongs to a region when its
 * CENTER lies inside the object's rectangle: showquest interaction tiles
 * (the 315 signpost, action "showquest") and door blocks (2×2 of door gids)
 * are collected per object, and objects that share a NAME form one gate —
 * the showquest interactions and doors they contain, linked under that
 * shared name. The real map has a single room object named `room1` — a
 * whole-map bounds rect (0,0, 496×272, hidden in Tiled) containing the
 * signpost and the door by center — so the signpost and the door land in
 * one group directly, with no extra annotation objects.
 *
 * Containment rule: an entity is linked to a room object when the entity's
 * center is inside the object's rectangle (half-open bounds). An entity may
 * link into several groups when overlapping rectangles of different names
 * cover it; within a group, same-name duplicates collate (a shared center
 * can't double-count).
 *
 * Pure and engine-free: the web client groups for the debug overlay, and the
 * Colyseus room will group with the very same module when answer-grading
 * grows door-opening (the graded interaction tile resolves its group, whose
 * `doors` are the ones to open).
 */

import { interactionActionForGid } from "./interaction";
import type { InteractionGrid } from "./interaction";
import type { DoorEntity } from "./door";
import { TILE_SIZE } from "./tiles";

/** The Tiled objectgroup that holds the door-link room objects. */
export const ROOM_OBJECT_GROUP_NAME = "room";

/** One Tiled objectgroup object (rectangle), in map pixel coordinates. */
export interface RoomObject {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A showquest interaction tile linked into a group (tile-grid coords). */
export interface InteractionLink {
  tx: number;
  ty: number;
}

/**
 * One group of room objects that share the same name — the puzzle unit: the
 * `showquest` interactions and `doors` their rectangles contain (counts are
 * just the array lengths). `doors` carry the entity identity the future
 * door-opening logic toggles; `objects` are the raw source rectangles.
 */
export interface DoorLinkGroup {
  name: string;
  /** Every room object carrying this name, in map file order. */
  objects: RoomObject[];
  /** Showquest interaction tiles inside the union of those rectangles. */
  showquest: InteractionLink[];
  /** Door entities inside the union of those rectangles. */
  doors: DoorEntity[];
}

/** Whether a point lies inside a room object's rectangle (half-open bounds). */
export function roomObjectContains(
  obj: RoomObject,
  x: number,
  y: number,
): boolean {
  return (
    x >= obj.x &&
    x < obj.x + obj.width &&
    y >= obj.y &&
    y < obj.y + obj.height
  );
}

/** The pixel center of a showquest interaction tile (link anchor). */
export function interactionLinkCenter(
  link: InteractionLink,
): { x: number; y: number } {
  return {
    x: (link.tx + 0.5) * TILE_SIZE,
    y: (link.ty + 0.5) * TILE_SIZE,
  };
}

/** The pixel center of a door entity block (link anchor). */
export function doorEntityCenter(
  door: DoorEntity,
): { x: number; y: number } {
  return {
    x: (door.tx + door.cols / 2) * TILE_SIZE,
    y: (door.ty + door.rows / 2) * TILE_SIZE,
  };
}

/**
 * Group the room objectgroup's objects by name (first-appearance order) and
 * collect, per group, the showquest interaction tiles and door entities
 * whose centers lie inside any of the group's rectangles.
 */
export function groupRoomObjectsByName(
  objects: readonly RoomObject[],
  doors: readonly DoorEntity[],
  interactions: InteractionGrid,
): DoorLinkGroup[] {
  const groups: DoorLinkGroup[] = [];
  const byName = new Map<string, DoorLinkGroup>();
  for (const obj of objects) {
    let group = byName.get(obj.name);
    if (!group) {
      group = { name: obj.name, objects: [], showquest: [], doors: [] };
      byName.set(obj.name, group);
      groups.push(group);
    }
    group.objects.push(obj);
  }

  // Collect the linked showquest interactions per group, deduped (a shared
  // center can't double-count when same-name rectangles overlap).
  for (const group of groups) {
    const seenSignposts = new Set<string>();
    const seenDoors = new Set<string>();
    for (const obj of group.objects) {
      for (const door of doors) {
        const key = `${door.tx},${door.ty}`;
        if (seenDoors.has(key)) continue;
        const c = doorEntityCenter(door);
        if (!roomObjectContains(obj, c.x, c.y)) continue;
        seenDoors.add(key);
        group.doors.push(door);
      }
      for (let ty = 0; ty < interactions.height; ty++) {
        for (let tx = 0; tx < interactions.width; tx++) {
          const key = `${tx},${ty}`;
          if (seenSignposts.has(key)) continue;
          if (interactionActionForGid(interactions.gids[ty * interactions.width + tx] ?? 0) !== "showquest") {
            continue;
          }
          const c = interactionLinkCenter({ tx, ty });
          if (!roomObjectContains(obj, c.x, c.y)) continue;
          seenSignposts.add(key);
          group.showquest.push({ tx, ty });
        }
      }
    }
  }
  return groups;
}