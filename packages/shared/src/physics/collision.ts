/**
 * Collision queries over a `SolidGrid`: exact point tests, exact
 * rect-vs-tile tests (a slope's solid half is a triangle), and the
 * axis-separated penetration helpers `stepPlayer` uses to resolve motion
 * without tunneling. Engine-free — plain math over the tile grid.
 */

import {
  TILE_SIZE,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
} from "./tiles";
import type { SolidGrid } from "./tiles";

/** Exact point test: is world point (x, y) inside any solid region? */
export function isPointSolid(grid: SolidGrid, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return false;
  return pointInTileSolid(grid, tx, ty, x, y);
}

function pointInTileSolid(
  grid: SolidGrid,
  tx: number,
  ty: number,
  x: number,
  y: number,
): boolean {
  const kind = grid.kinds[ty * grid.width + tx] ?? 0;
  if (kind === 0) return false;
  if (kind === TILE_SOLID) return true;
  const dx = x - tx * TILE_SIZE;
  const dy = y - ty * TILE_SIZE;
  if (kind === TILE_SLOPE_TL_BR) return dy <= dx;
  // TILE_SLOPE_TR_BL
  return dx + dy <= TILE_SIZE;
}

/**
 * Conservative but exact test: does the AABB centered at (x, y) with half
 * extents (hw, hh) intersect the solid region of cell (tx, ty)? For solid
 * tiles any overlap suffices; for slopes the extreme corner of the overlap
 * rect decides, which is exact for axis-aligned boxes.
 */
function aabbTouchesSolid(
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

  const left = tx * TILE_SIZE;
  const top = ty * TILE_SIZE;
  const ox0 = Math.max(0, x - hw - left);
  const ox1 = Math.min(TILE_SIZE, x + hw - left);
  const oy0 = Math.max(0, y - hh - top);
  const oy1 = Math.min(TILE_SIZE, y + hh - top);
  if (ox1 <= ox0 || oy1 <= oy0) return false;

  if (kind === TILE_SOLID) return true;
  if (kind === TILE_SLOPE_TL_BR) {
    // Solid where dy ≤ dx: reachable iff the lowest dy is ≤ the highest dx.
    return oy0 <= ox1;
  }
  // TILE_SLOPE_TR_BL — solid where dx + dy ≤ TILE_SIZE.
  return ox0 + oy0 <= TILE_SIZE;
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
  const x0 = Math.floor((x - hw) / TILE_SIZE);
  const x1 = Math.floor((x + hw) / TILE_SIZE);
  const y0 = Math.floor((y - hh) / TILE_SIZE);
  const y1 = Math.floor((y + hh) / TILE_SIZE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
      if (aabbTouchesSolid(grid, tx, ty, x, y, hw, hh)) return true;
    }
  }
  return false;
}

/**
 * How far an AABB centered at (x, y) pokes into solid ground along the
 * horizontal axis, moving in `dir` (+1 right, -1 left). 0 when not blocked.
 * Only cells in front of the motion count; the max over all of them wins so
 * stepped walls stop at the deepest face.
 */
export function horizontalPenetration(
  grid: SolidGrid,
  x: number,
  y: number,
  hw: number,
  hh: number,
  dir: 1 | -1,
): number {
  const x0 = Math.floor((x - hw) / TILE_SIZE);
  const x1 = Math.floor((x + hw) / TILE_SIZE);
  const y0 = Math.floor((y - hh) / TILE_SIZE);
  const y1 = Math.floor((y + hh) / TILE_SIZE);
  let maxPen = 0;

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
      if (!aabbTouchesSolid(grid, tx, ty, x, y, hw, hh)) continue;
      const left = tx * TILE_SIZE;
      const pen = dir > 0 ? x + hw - left : left + TILE_SIZE - (x - hw);
      if (pen > maxPen) maxPen = pen;
    }
  }
  return maxPen;
}

/**
 * Vertical analog of horizontalPenetration. Slopes contribute their diagonal
 * surface: for 110 the surface rises rightward (surface y = top + dx, deepest
 * at the max x of the moving edge), for 109 it falls rightward (surface y =
 * top + TILE_SIZE - dx, deepest at the min x). The moving edge (bottom while
 * falling, top while rising) drives the contact, so landing on a slope is an
 * exact stop against the line.
 */
export function verticalPenetration(
  grid: SolidGrid,
  x: number,
  y: number,
  hw: number,
  hh: number,
  dir: 1 | -1,
): number {
  const x0 = Math.floor((x - hw) / TILE_SIZE);
  const x1 = Math.floor((x + hw) / TILE_SIZE);
  const y0 = Math.floor((y - hh) / TILE_SIZE);
  const y1 = Math.floor((y + hh) / TILE_SIZE);
  let maxPen = 0;

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
      const kind = grid.kinds[ty * grid.width + tx] ?? 0;
      if (kind === 0) continue;
      if (!aabbTouchesSolid(grid, tx, ty, x, y, hw, hh)) continue;

      const left = tx * TILE_SIZE;
      const top = ty * TILE_SIZE;

      if (kind === TILE_SOLID) {
        const pen = dir > 0 ? y + hh - top : top + TILE_SIZE - (y - hh);
        if (pen > maxPen) maxPen = pen;
        continue;
      }

      // Slope: the moving edge's span within the cell decides the contact.
      const edgeMin = Math.max(0, Math.min(TILE_SIZE, x - hw - left));
      const edgeMax = Math.max(0, Math.min(TILE_SIZE, x + hw - left));
      if (edgeMax <= edgeMin) continue;

      // Surface height (top of the solid half) along the moving edge.
      let surfaceY: number;
      if (kind === TILE_SLOPE_TL_BR) {
        // Solid where dy ≤ dx → deepest at the largest dx of the edge.
        surfaceY = top + edgeMax;
      } else {
        // Solid where dx + dy ≤ TILE_SIZE → deepest at the smallest dx.
        surfaceY = top + TILE_SIZE - edgeMin;
      }

      const pen = dir > 0 ? y + hh - surfaceY : surfaceY - (y - hh);
      if (pen > maxPen) maxPen = pen;
    }
  }
  return maxPen;
}