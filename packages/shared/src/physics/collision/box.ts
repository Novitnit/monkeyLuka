/**
 * Box (AABB) queries: the shared exact rect-vs-cell test, `isBoxSolid` for
 * "overlaps any solid", `isBoxInDeadZone` for the lethal 464 hazard-probe,
 * and `wallBeside` the wall-adjacency strip probe wall-cling uses.
 */

import {
  TILE_DEAD_ZONE,
  TILE_SIZE,
  TILE_SLOPE_SHALLOW,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
  TILE_STAIRS,
} from "../tiles";
import type { SolidGrid } from "../tiles";
import { DEAD_ZONE_BASE_ROW, maskForKind, maskRectRange } from "./masks";
import { cellOverlapRect, forEachOverlappedCell } from "./geometry";

/**
 * Conservative but exact test: does the AABB centered at (x, y) with half
 * extents (hw, hh) intersect the solid region of cell (tx, ty)? For solid
 * tiles any overlap suffices; for slopes the extreme corner of the overlap
 * rect decides, which is exact for axis-aligned boxes.
 */
export function aabbTouchesSolid(
  grid: SolidGrid,
  tx: number,
  ty: number,
  x: number,
  y: number,
  hw: number,
  hh: number,
): boolean {
  const kind = grid.kinds[ty * grid.width + tx] ?? 0;
  if (kind === 0) return false;

  const cell = cellOverlapRect(tx, ty, x, y, hw, hh);
  if (!cell) return false;
  const { ox0, ox1, oy0, oy1 } = cell;

  if (kind === TILE_SOLID) return true;
  if (kind === TILE_SLOPE_TL_BR) {
    // Solid where dy ≤ dx: reachable iff the lowest dy is ≤ the highest dx.
    return oy0 <= ox1;
  }
  if (kind === TILE_SLOPE_TR_BL) {
    // Solid where dx + dy ≤ TILE_SIZE: reachable iff the lowest corner is.
    return ox0 + oy0 <= TILE_SIZE;
  }
  if (kind === TILE_SLOPE_SHALLOW) {
    // Solid where dx + 2·dy ≥ 2·TILE_SIZE (the 2:1 ramp below the line
    // from the bottom-left corner to the right edge's midpoint): dx + 2·dy
    // is maximized at the top-right corner of the overlap, so reachable
    // iff that corner is solid.
    return ox1 + 2 * oy1 >= 2 * TILE_SIZE;
  }
  if (kind === TILE_STAIRS || kind === TILE_DEAD_ZONE) {
    // Pixel mask (STAIRS_MASK / DEAD_ZONE_MASK): the overlap rect
    // [ox0,ox1]×[oy0,oy1] touches solid iff any solid pixel (c, r) —
    // covering [c, c+1) × [r, r+1) — intersects it: columns
    // c ∈ [⌊ox0⌋, ⌈ox1⌉−1], rows likewise. This gives the walls/treads (or
    // the dead-zone base) via the mask and leaves the hollow interiors
    // open.
    const mask = maskForKind(kind);
    const range = maskRectRange(ox0, ox1, oy0, oy1);
    if (!range) return false;
    for (let r = range.r0; r <= range.r1; r++) {
      if (((mask[r] ?? 0) & range.cols) !== 0) return true;
    }
    return false;
  }
  // TILE_SLOPE_BR — solid where dx + dy ≥ TILE_SIZE: reachable iff the
  // highest corner is.
  return ox1 + oy1 >= TILE_SIZE;
}

/** Does the AABB overlap any solid region on the grid? */
export function isBoxSolid(
  grid: SolidGrid,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const hw = width / 2;
  const hh = height / 2;
  return forEachOverlappedCell(grid, x, y, hw, hh, (tx, ty) =>
    aabbTouchesSolid(grid, tx, ty, x, y, hw, hh),
  );
}

/**
 * Does the AABB overlap any solid region of a **dead-zone** cell (tile 464,
 * the hazard pit in DEAD_ZONE_MASK)? Answering "which kind", unlike
 * `isBoxSolid`'s boolean: other solids (walls, slopes, the stairs) are
 * ordinary geometry a player may stand on; the dead-zone mask is a lethal
 * hazard the web client watches for — it probes its own simulated position
 * with this every frame and returns the player to its checkpoint on touch
 * (via `PLAYER_CHECKPOINT_MESSAGE`, the same handler the debug R key uses;
 * the Colyseus server no longer probes the pits).
 */
export function isBoxInDeadZone(
  grid: SolidGrid,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const hw = width / 2;
  const hh = height / 2;
  return forEachOverlappedCell(grid, x, y, hw, hh, (tx, ty) =>
    grid.kinds[ty * grid.width + tx] === TILE_DEAD_ZONE &&
    aabbTouchesDeadZoneFloor(grid, tx, ty, x, y, hw, hh),
  );
}

/**
 * Does the AABB overlap the dead-zone pit's hazard floor (the mask's base
 * rows 13-15)? The shared pixel-mask overlap (`aabbTouchesSolid`) misses a
 * box at rest in a pit: the vertical resolver leaves its bottom exactly
 * flush with the base top, so the overlap rect reaches the base row but
 * never ENTERS it (oy1 == DEAD_ZONE_BASE_ROW, rows [⌊oy0⌋, ⌈oy1⌉−1] stop
 * at row 12) and the probe would never fire for a real player — the
 * checkpoint return never triggered. So the hazard probe grants the same
 * 1px support allowance the stairs seam uses: bottom within 1px above the
 * base top (or overlapping the base) counts as touching the pit. Flights
 * over the mouth at altitude (bottom well above the base), and bodies
 * standing on a floor beside the trench (the overlap rect doesn't even
 * exist vertically: the trench mouth is ~3 tiles below the floor) still
 * read as not touching.
 */
export function aabbTouchesDeadZoneFloor(
  grid: SolidGrid,
  tx: number,
  ty: number,
  x: number,
  y: number,
  hw: number,
  hh: number,
): boolean {
  const cell = cellOverlapRect(tx, ty, x, y, hw, hh);
  if (!cell) return false;
  return cell.oy1 >= DEAD_ZONE_BASE_ROW - 1;
}

/**
 * Is there solid geometry immediately beside the AABB in `dir` (+1 right,
 * -1 left)? Probes a thin strip just past the box's side edge, so a box
 * flush with a wall reads as "beside" it while a box a few px short of it
 * does not. Used by the wall-cling (grab) check in player.ts.
 */
export function wallBeside(
  grid: SolidGrid,
  x: number,
  y: number,
  hw: number,
  hh: number,
  dir: 1 | -1,
): boolean {
  const probe = 2;
  const cx = dir > 0 ? x + hw + probe / 2 : x - hw - probe / 2;
  const half = probe / 2;
  return forEachOverlappedCell(grid, cx, y, half, hh, (tx, ty) =>
    aabbTouchesSolid(grid, tx, ty, cx, y, half, hh),
  );
}