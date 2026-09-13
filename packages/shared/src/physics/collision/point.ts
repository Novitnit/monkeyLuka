/**
 * Exact point-vs-tile test: is a world point inside any solid region?
 * Dispatches on tile kind — plain blocks, the analytic slope halves, and
 * the pixel masks (288 stairs / 289 stairs-mirror / 464 dead zone).
 */

import {
  TILE_DEAD_ZONE,
  TILE_DOOR,
  TILE_SIZE,
  TILE_SLOPE_SHALLOW,
  TILE_SLOPE_SHALLOW_MIRROR,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
  TILE_STAIRS,
  TILE_STAIRS_MIRROR,
} from "../tiles";
import type { SolidGrid } from "../tiles";
import { maskForKind } from "./masks";

function pointInTileSolid(
  grid: SolidGrid,
  tx: number,
  ty: number,
  x: number,
  y: number,
): boolean {
  const kind = grid.kinds[ty * grid.width + tx] ?? 0;
  if (kind === 0) return false;
  if (kind === TILE_SOLID || kind === TILE_DOOR) return true;
  const dx = x - tx * TILE_SIZE;
  const dy = y - ty * TILE_SIZE;
  if (kind === TILE_SLOPE_TL_BR) return dy <= dx;
  if (kind === TILE_SLOPE_TR_BL) return dx + dy <= TILE_SIZE;
  if (kind === TILE_SLOPE_SHALLOW) return dx + 2 * dy >= 2 * TILE_SIZE;
  if (kind === TILE_SLOPE_SHALLOW_MIRROR) return 2 * dy - dx >= TILE_SIZE;
  if (kind === TILE_STAIRS || kind === TILE_STAIRS_MIRROR || kind === TILE_DEAD_ZONE) {
    // Pixel mask (STAIRS_MASK / STAIRS_MIRROR_MASK / DEAD_ZONE_MASK): a
    // point is solid inside any solid pixel (16px per tile).
    const mask = maskForKind(kind);
    const col = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor(dx)));
    const row = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor(dy)));
    return ((mask[row] ?? 0) & (1 << col)) !== 0;
  }
  // TILE_SLOPE_BR — the mirror of 109, solid below the same line.
  return dx + dy >= TILE_SIZE;
}

/** Exact point test: is world point (x, y) inside any solid region? */
export function isPointSolid(grid: SolidGrid, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return false;
  return pointInTileSolid(grid, tx, ty, x, y);
}