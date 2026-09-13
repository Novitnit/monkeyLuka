/**
 * Slope "is the box supported by this cell" logic: a box riding a diagonal
 * surface (or resting on a mask's stepped/basin floor) must be allowed to
 * slide/climb along it instead of being treated as a wall contact. Only a
 * box genuinely *inside* the solid (deep side-hit or a bottom below the
 * cell) is a wall.
 */

import {
  TILE_DEAD_ZONE,
  TILE_SIZE,
  TILE_SLOPE_BR,
  TILE_SLOPE_SHALLOW,
  TILE_SLOPE_TL_BR,
  TILE_STAIRS,
} from "../tiles";
import { DEAD_ZONE_BASE_ROW, stairsTopRow } from "./masks";
import { SLOPE_RIDE_TOL, SLOPE_TOUCH_EPS } from "./geometry";

/**
 * Is an AABB centered at (x, y) supported by this slope cell — i.e. riding
 * it (bottom edge on or within `SLOPE_RIDE_TOL` of the surface), or resting
 * on the tile's fully-solid top lip (110/109)? See the file comment; a box
 * supported by a diagonal must be allowed to slide/climb along it instead
 * of being treated as a wall contact; only a box genuinely *inside* the
 * solid (deep side-hit or a bottom below the cell) is a wall. `dx0`/`dx1`
 * are the box's horizontal overlap with the cell and `dyBottom` its bottom
 * depth, all in cell-local px.
 */
export function slopeSupportsBox(
  kind: number,
  dx0: number,
  dx1: number,
  dyBottom: number,
): boolean {
  // 110 (dy ≤ dx) and 109 (dy ≤ TILE_SIZE − dx) have a solid top edge the
  // whole way across — a box resting on it is standing on the tile. 287 has
  // no flat lip (its face only reaches the top at the far-right corner), so
  // it is exempt like 262. Mask shapes (288, 464) resolve their own
  // stepped/basin surfaces in the branches below.
  if (
    kind !== TILE_SLOPE_BR &&
    kind !== TILE_SLOPE_SHALLOW &&
    kind !== TILE_STAIRS &&
    kind !== TILE_DEAD_ZONE &&
    dyBottom <= SLOPE_TOUCH_EPS
  ) {
    return true;
  }
  // A bottom below the cell means the box is under the tile, not riding it.
  if (dyBottom > TILE_SIZE) return false;
  // The surface depth across the box's span runs [minSurf, maxSurf]: 110
  // (`dy = dx`) deepens rightward (dx0 → dx1), 109/262 (`dy = 16 − dx`)
  // deepen leftward (16 − dx1 → 16 − dx0), and 287 (`dy = (16 − dx)/2`)
  // deepens leftward at half the rate ((16 − dx1)/2 → (16 − dx0)/2). The
  // box rides when its bottom
  // edge sits on that line somewhere along the span — a climber dips a
  // substep below the shallow end (dyBottom ≥ minSurf − SLOPE_RIDE_TOL)
  // before the vertical pass lifts it back, and a rider never sinks below
  // the deepest surface point. A box whose bottom is *below* that deepest
  // point (an overhang under-runner whose top clips the face from the
  // side) is a wall contact, not a ride.
  let minSurf: number;
  let maxSurf: number;
  if (kind === TILE_SLOPE_TL_BR) {
    minSurf = dx0;
    maxSurf = dx1;
  } else if (kind === TILE_SLOPE_SHALLOW) {
    minSurf = TILE_SIZE - dx1 / 2;
    maxSurf = TILE_SIZE - dx0 / 2;
  } else if (kind === TILE_STAIRS) {
    // 288 staircase: the surface is the stepped tread tops (topRow(c) =
    // 7 − ⌊c/2⌋ — deepest at the left, shallowest at the right). minSurf
    // is the rightmost tread under the span (the binding corner), maxSurf
    // the leftmost — the same ride-on-the-leading-corner band as 262/287:
    // a box on the steps rests on the rightmost tread and is lifted one
    // riser at a time as it advances, never wall-blocked mid-climb. The
    // upper allowance is one riser wider than 262/287's: a walker arriving
    // from a sealing 287 ramp sits at 287's apex (dy = 8) — 1px BELOW
    // 288's left foot (dy = 7) — and must be allowed onto the tread so the
    // vertical pass can settle it; without the extra pixel the horizontal
    // pass reads the left wall's top row as a face and the walker jams at
    // the seam (see discovery notes on the 287 → 288 ramp pair).
    const c0 = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor(dx0)));
    const c1 = Math.max(0, Math.min(TILE_SIZE - 1, Math.ceil(dx1) - 1));
    minSurf = stairsTopRow(c1);
    maxSurf = stairsTopRow(c0) + 1;
  } else if (kind === TILE_DEAD_ZONE) {
    // 464 hazard pit: an open basin — every column's surface is the base
    // (top row 13), so the support band is the 262-style deep surface: a
    // box standing on the basin floor rides (walks the trench freely, and
    // adjacent 464 cells read as one continuous floor), a rim-level walker
    // over the open mouth has no surface at its feet and drops in (never
    // wall-blocked: the mouth rows are open, so horizontal penetration
    // never even sees the cell).
    minSurf = DEAD_ZONE_BASE_ROW;
    maxSurf = DEAD_ZONE_BASE_ROW + 1;
  } else {
    minSurf = TILE_SIZE - dx1;
    maxSurf = TILE_SIZE - dx0;
  }
  return (
    dyBottom >= minSurf - SLOPE_RIDE_TOL &&
    dyBottom <= maxSurf + SLOPE_TOUCH_EPS
  );
}