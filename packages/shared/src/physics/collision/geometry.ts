/**
 * Shared query geometry: the box-vs-cell overlap rect, the cell-walk
 * iterator, and the two slope tolerance constants every query and both
 * penetration passes rely on. Every AABB-vs-grid test and both penetration
 * passes work on the same pieces — which pixel mask a mask-kind uses (see
 * masks.ts), the box's overlap rect with a cell, a clamped pixel range over
 * the mask, and the tile span the box walks — so those pieces live here once
 * instead of being recomputed per query.
 */

import { TILE_SIZE } from "../tiles";
import type { SolidGrid } from "../tiles";

/**
 * Tolerance for "the collider's bottom edge is on the slope surface" — a
 * box riding a diagonal is within a fraction of a pixel of the line between
 * vertical resolves, so the standing test must not be exact.
 */
export const SLOPE_TOUCH_EPS = 0.5;

/**
 * How far below the slope surface a box's bottom may be and still count as
 * *riding* the slope. A box climbing a 45° face embeds about one horizontal
 * substep of depth (≤ maxSubstep) before the vertical pass lifts it back
 * onto the line, so the standing test must accept that much slack or every
 * climb would be read as a wall hit and ejected. Also the max a falling box
 * can be inside a 110/109 cell and still count as landing on its flat lip
 * (a substep is at most this deep).
 */
export const SLOPE_RIDE_TOL = TILE_SIZE / 2;

/**
 * The AABB's overlap rect with cell (tx, ty), in cell-local px: the box
 * [x±hw, y±hh] clipped to the cell [left, left+16]×[top, top+16]. Null when
 * there is no overlap. ox0..oy1 keep the conventional names (ox = overlap x,
 * oy = overlap y); the raw (unclamped) bottom depth is derived as
 * `y + hh - top` by callers that need it.
 */
export function cellOverlapRect(
  tx: number,
  ty: number,
  x: number,
  y: number,
  hw: number,
  hh: number,
): { left: number; top: number; ox0: number; ox1: number; oy0: number; oy1: number } | null {
  const left = tx * TILE_SIZE;
  const top = ty * TILE_SIZE;
  const ox0 = Math.max(0, x - hw - left);
  const ox1 = Math.min(TILE_SIZE, x + hw - left);
  const oy0 = Math.max(0, y - hh - top);
  const oy1 = Math.min(TILE_SIZE, y + hh - top);
  if (ox1 <= ox0 || oy1 <= oy0) return null;
  return { left, top, ox0, ox1, oy0, oy1 };
}

/**
 * Visits every in-bounds cell the box [x±hw, y±hh] overlaps (tile span
 * clamped to the grid, out-of-bounds cells skipped). `visit` returns true
 * to stop the scan early (a query folding a max across cells returns false
 * and reads its own accumulator); the helper reports whether a visit
 * requested a stop. Shared by every AABB query so the span + bounds logic
 * lives once.
 */
export function forEachOverlappedCell(
  grid: SolidGrid,
  x: number,
  y: number,
  hw: number,
  hh: number,
  visit: (tx: number, ty: number) => boolean,
): boolean {
  const x0 = Math.floor((x - hw) / TILE_SIZE);
  const x1 = Math.floor((x + hw) / TILE_SIZE);
  const y0 = Math.floor((y - hh) / TILE_SIZE);
  const y1 = Math.floor((y + hh) / TILE_SIZE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
      if (visit(tx, ty)) return true;
    }
  }
  return false;
}