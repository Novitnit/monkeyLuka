/**
 * Collision queries over a `SolidGrid`: exact point tests, exact
 * rect-vs-tile tests (a slope's solid half is a triangle), and the
 * axis-separated penetration helpers `stepPlayer` uses to resolve motion
 * without tunneling. Engine-free — plain math over the tile grid.
 */

import {
  TILE_SIZE,
  TILE_SLOPE_BR,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
} from "./tiles";
import type { SolidGrid } from "./tiles";

/**
 * Tolerance for "the collider's bottom edge is on the slope surface" — a
 * box riding a diagonal is within a fraction of a pixel of the line between
 * vertical resolves, so the standing test must not be exact.
 */
const SLOPE_TOUCH_EPS = 0.5;

/**
 * How far below the slope surface a box's bottom may be and still count as
 * *riding* the slope. A box climbing a 45° face embeds about one horizontal
 * substep of depth (≤ maxSubstep) before the vertical pass lifts it back
 * onto the line, so the standing test must accept that much slack or every
 * climb would be read as a wall hit and ejected. Also the max a falling box
 * can be inside a 110/109 cell and still count as landing on its flat lip
 * (a substep is at most this deep).
 */
const SLOPE_RIDE_TOL = TILE_SIZE / 2;

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
  if (kind === TILE_SLOPE_TR_BL) return dx + dy <= TILE_SIZE;
  // TILE_SLOPE_BR — the mirror of 109, solid below the same line.
  return dx + dy >= TILE_SIZE;
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
  if (kind === TILE_SLOPE_TR_BL) {
    // Solid where dx + dy ≤ TILE_SIZE: reachable iff the lowest corner is.
    return ox0 + oy0 <= TILE_SIZE;
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
  const x0 = Math.floor((cx - half) / TILE_SIZE);
  const x1 = Math.floor((cx + half) / TILE_SIZE);
  const y0 = Math.floor((y - hh) / TILE_SIZE);
  const y1 = Math.floor((y + hh) / TILE_SIZE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
      if (aabbTouchesSolid(grid, tx, ty, cx, y, half, hh)) return true;
    }
  }
  return false;
}

/**
 * Is an AABB centered at (x, y) supported by this slope cell — i.e. riding
 * it (bottom edge on or within `SLOPE_RIDE_TOL` of the surface), or resting
 * on the tile's fully-solid top lip (110/109)? A box supported by a
 * diagonal must be allowed to slide/climb along it instead of being treated
 * as a wall contact; only a box genuinely *inside* the solid (deep side-hit
 * or a bottom below the cell) is a wall. `dx0`/`dx1` are the box's
 * horizontal overlap with the cell and `dyBottom` its bottom depth, all in
 * cell-local px.
 */
function slopeSupportsBox(
  kind: number,
  dx0: number,
  dx1: number,
  dyBottom: number,
): boolean {
  // 110 (dy ≤ dx) and 109 (dy ≤ TILE_SIZE − dx) have a solid top edge the
  // whole way across — a box resting on it is standing on the tile.
  if (kind !== TILE_SLOPE_BR && dyBottom <= SLOPE_TOUCH_EPS) return true;
  // A bottom below the cell means the box is under the tile, not riding it.
  if (dyBottom > TILE_SIZE) return false;
  // The surface depth across the box's span runs [minSurf, maxSurf]: 110
  // (`dy = dx`) deepens rightward (dx0 → dx1), 109/262 (`dy = 16 − dx`)
  // deepen leftward (16 − dx1 → 16 − dx0). The box rides when its bottom
  // edge sits on that line somewhere along the span — a climber dips a
  // substep below the shallow end (dyBottom ≥ minSurf − SLOPE_RIDE_TOL)
  // before the vertical pass lifts it back, and a rider never sinks below
  // the deepest surface point. A box whose bottom is *below* that deepest
  // point (an overhang under-runner whose top clips the face from the
  // side) is a wall contact, not a ride.
  const minSurf = kind === TILE_SLOPE_TL_BR ? dx0 : TILE_SIZE - dx1;
  const maxSurf = kind === TILE_SLOPE_TL_BR ? dx1 : TILE_SIZE - dx0;
  return (
    dyBottom >= minSurf - SLOPE_RIDE_TOL &&
    dyBottom <= maxSurf + SLOPE_TOUCH_EPS
  );
}

/**
 * How far an AABB centered at (x, y) pokes into solid ground along the
 * horizontal axis, moving in `dir` (+1 right, -1 left). 0 when not blocked.
 * Only cells in front of the motion count; the max over all of them wins so
 * stepped walls stop at the deepest face.
 *
 * Slopes are resolved against their solid triangle, not the whole cell: the
 * penetration is measured to the diagonal face at the collider's vertical
 * span, and a box supported by the surface (standing on it) is not a wall —
 * it slides along the slope, with the vertical pass owning that contact.
 * This keeps walking *into* a diagonal from ejecting the player to the cell
 * boundary (the symptom if the full-cell pen of a solid tile is used).
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
      const kind = grid.kinds[ty * grid.width + tx] ?? 0;
      if (kind === 0) continue;
      if (!aabbTouchesSolid(grid, tx, ty, x, y, hw, hh)) continue;
      const left = tx * TILE_SIZE;
      const top = ty * TILE_SIZE;

      if (kind === TILE_SOLID) {
        const pen = dir > 0 ? x + hw - left : left + TILE_SIZE - (x - hw);
        if (pen > maxPen) maxPen = pen;
        continue;
      }

      // Slope cell. Work in cell-local coords: dx0/dx1 are the box's
      // horizontal span clamped to the cell, dyTop/dyBottom its vertical
      // span (relative to the cell's top, clamped into the cell; the raw
      // bottom depth is kept unclamped so a box *under* the tile is not
      // mistaken for a rider).
      const dx0 = Math.max(0, Math.min(TILE_SIZE, x - hw - left));
      const dx1 = Math.max(0, Math.min(TILE_SIZE, x + hw - left));
      const dyTop = Math.max(0, Math.min(TILE_SIZE, y - hh - top));
      const dyBottom = Math.max(0, Math.min(TILE_SIZE, y + hh - top));
      const dyBottomRaw = y + hh - top;
      if (dx1 <= dx0 || dyBottom <= dyTop) continue;

      // Box riding the slope surface → let the vertical pass own the
      // contact; horizontal motion slides along the diagonal.
      if (slopeSupportsBox(kind, dx0, dx1, dyBottomRaw)) continue;

      // Penetration up to the diagonal face, per shape and direction.
      // 110 (dy ≤ dx): the face runs TL→BR — a right-moving box meets it at
      // its leftmost extent (dyTop; the solid top edge reaches the cell's
      // left), a left-moving box meets the fully-solid right column.
      // 109 (dy ≤ 16−dx): the cap's left column is fully solid — a
      // right-moving box is a wall at the cell's left edge; a left-moving
      // box meets the cap's rightmost extent (16 − dyTop).
      // 262 (dy ≥ 16−dx, mirror): a right-moving box meets the wedge face
      // at 16 − dyBottom; a left-moving box meets the solid right column.
      let pen: number;
      if (kind === TILE_SLOPE_TL_BR) {
        pen =
          dir > 0
            ? Math.max(0, dx1 - dyTop)
            : Math.max(0, TILE_SIZE - dx0);
      } else if (kind === TILE_SLOPE_TR_BL) {
        pen =
          dir > 0
            ? dx1
            : Math.max(0, TILE_SIZE - dyTop - dx0);
      } else {
        pen =
          dir > 0
            ? Math.max(0, dx1 - (TILE_SIZE - dyBottom))
            : Math.max(0, TILE_SIZE - dx0);
      }
      if (pen > maxPen) maxPen = pen;
    }
  }
  return maxPen;
}

/**
 * Vertical analog of horizontalPenetration. For 110/109 the tile's solid
 * is a corner bracket whose **top edge is solid across the full cell** — a
 * box falling onto one lands on that flat lip (like a solid tile), so
 * `dir > 0` (falling) resolves against `top`; the hypotenuse only matters
 * as the underside (a ceiling or a side face), where 110's surface rises
 * rightward (surface y = top + dx, deepest at the max x of the moving
 * edge) and 109's falls rightward (surface y = top + TILE_SIZE − dx,
 * deepest at the min x). 262 is the mirror — the solid hangs below the
 * same TR→BL line, so its landing surface IS the line and both directions
 * sample it.
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

      // Surface height (top of the solid) along the moving edge, and the
      // box bottom's depth into the cell (unclamped — a bottom below the
      // cell means the box is under the tile, not landing on it).
      const bottomRel = y + hh - top;
      let surfaceY: number;
      if (kind === TILE_SLOPE_TL_BR) {
        // 110: solid where dy ≤ dx → deepest at the largest dx of the edge.
        surfaceY = top + edgeMax;
        if (dir > 0) {
          // 110 landing: the bracket's top edge is solid the whole way
          // across, so a falling box contacts it before the hypotenuse —
          // rest on the tile's top like a solid tile. Only a box genuinely
          // falling onto the lip (bottom within a substep of the cell top)
          // is lifted; an overhang under-runner whose top pokes into the
          // bracket must not be hoisted onto the lip.
          if (bottomRel <= SLOPE_RIDE_TOL + SLOPE_TOUCH_EPS) {
            surfaceY = top;
          } else {
            continue;
          }
        }
      } else if (kind === TILE_SLOPE_TR_BL) {
        // 109: same TR→BL line, solid above it → deepest at the smallest dx.
        surfaceY = top + TILE_SIZE - edgeMin;
        if (dir > 0) {
          // 109 landing: the bracket's top edge is solid the whole way
          // across, so a falling box contacts it before the hypotenuse —
          // rest on the tile's top like a solid tile. Only a box genuinely
          // falling onto the lip (bottom within a substep of the cell top)
          // is lifted; an overhang under-runner whose top pokes into the
          // bracket must not be hoisted onto the lip.
          if (bottomRel <= SLOPE_RIDE_TOL + SLOPE_TOUCH_EPS) {
            surfaceY = top;
          } else {
            continue;
          }
        }
      } else {
        // 262 (mirror of 109): the solid hangs BELOW the same TR→BL line,
        // so its landing surface IS the line — sampled at the box's
        // rightmost extent, the line's shallowest point under the span. A
        // right-moving climber rides with its bottom-right corner on the
        // surface and never embeds; sampling the deepest point (edgeMin)
        // left the box half-buried under the rising slope, jamming it
        // against the next solid tile where the anti-cheat flagged the
        // buried position as a teleport. `dir > 0` also skips a box whose
        // bottom is below the tile (an overhang under-runner); the epsilon
        // covers the grounded walker's gravity dip (≈0.13px) so a box at the
        // ramp's foot — bottom exactly at the cell's bottom edge, where the
        // surface starts — still reads as landing on it.
        if (dir > 0 && bottomRel > TILE_SIZE + SLOPE_TOUCH_EPS) continue;
        surfaceY = top + TILE_SIZE - edgeMax;
      }

      const pen = dir > 0 ? y + hh - surfaceY : surfaceY - (y - hh);
      if (pen > maxPen) maxPen = pen;
    }
  }
  return maxPen;
}