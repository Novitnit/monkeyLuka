/**
 * Door entities: the 2×2 door blocks (gids 375/376 on the top row, 401/402
 * below) recognized as single door world objects with two states
 * (open/closed).
 *
 * A door's solidity follows its state: a CLOSED door is a solid block the
 * player cannot walk through. The collision grid bakes that in —
 * `buildTileGrid` folds the door gids into the single TILE_DOOR kind
 * (see FOLD_TO_DOOR in tiles.ts) — while this module is the entity model:
 * `buildDoorEntities` recognizes each non-overlapping 2×2 block as one
 * door with a `state` field. Doors are also NON-STICKY: the wall-cling
 * grab skips TILE_DOOR faces (see grabableWallBeside in box.ts), so a
 * player jumping into a closed door slides off instead of hanging. Nothing
 * toggles doors yet; when opening/closing arrives, the affected cells
 * must be flipped between TILE_DOOR and 0 (e.g. by rebuilding the grid)
 * to match the entity states.
 */

import type { CollisionLayerData } from "./tiles";
import {
  TILE_DOOR_BOTTOM_LEFT,
  TILE_DOOR_BOTTOM_RIGHT,
  TILE_DOOR_TOP_LEFT,
  TILE_DOOR_TOP_RIGHT,
} from "./tiles";

/** The four door gids that make up one 2×2 door block. */
export const DOOR_TILE_GIDS: readonly number[] = [
  TILE_DOOR_TOP_LEFT,
  TILE_DOOR_TOP_RIGHT,
  TILE_DOOR_BOTTOM_LEFT,
  TILE_DOOR_BOTTOM_RIGHT,
];

/** Whether a gid is one of the four door tiles. */
export function isDoorTileGid(gid: number): boolean {
  return DOOR_TILE_GIDS.includes(gid);
}

/** The two states a door entity can be in. */
export type DoorState = "open" | "closed";

/**
 * One door world object: a single recognized 2×2 block of door tiles.
 * Coordinates are tile-grid cells (the top-left tile of the block), the
 * same space as the collision grid; pixel bounds are
 * `tx*TILE_SIZE ... (tx+cols)*TILE_SIZE`.
 */
export interface DoorEntity {
  /** Grid column of the door's top-left tile. */
  tx: number;
  /** Grid row of the door's top-left tile. */
  ty: number;
  /** Door width in tiles (always 2 for a 2×2 block). */
  cols: number;
  /** Door height in tiles (always 2 for a 2×2 block). */
  rows: number;
  /** Open/closed state (doors start closed — nothing toggles them yet). */
  state: DoorState;
}

/**
 * Recognize every door in a collision layer. A door is a 2×2 block where
 * all four cells are door gids; each non-overlapping block becomes one
 * entity. The scan walks top-left to bottom-right, greedily claiming the
 * four cells of each door it finds, so flush-adjacent doors (sharing an
 * edge) are separate entities instead of four overlapping 2×2 readings.
 */
export function buildDoorEntities(layer: CollisionLayerData): DoorEntity[] {
  const entities: DoorEntity[] = [];
  // Cells already consumed by an earlier door (greedy non-overlap).
  const claimed = new Uint8Array(layer.width * layer.height);
  for (let ty = 0; ty + 1 < layer.height; ty++) {
    for (let tx = 0; tx + 1 < layer.width; tx++) {
      const i = ty * layer.width + tx;
      if (claimed[i] === 1) continue;
      if (
        isDoorTileGid(layer.gids[i] ?? 0) &&
        isDoorTileGid(layer.gids[i + 1] ?? 0) &&
        isDoorTileGid(layer.gids[i + layer.width] ?? 0) &&
        isDoorTileGid(layer.gids[i + layer.width + 1] ?? 0)
      ) {
        claimed[i] = 1;
        claimed[i + 1] = 1;
        claimed[i + layer.width] = 1;
        claimed[i + layer.width + 1] = 1;
        entities.push({ tx, ty, cols: 2, rows: 2, state: "closed" });
      }
    }
  }
  return entities;
}