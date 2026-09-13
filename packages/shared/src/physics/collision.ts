/**
 * Collision queries over a `SolidGrid`: exact point tests, exact
 * rect-vs-tile tests (a slope's solid half is a triangle), and the
 * axis-separated penetration helpers `stepPlayer` uses to resolve motion
 * without tunneling. Engine-free — plain math over the tile grid.
 */

import {
  TILE_SIZE,
  TILE_DEAD_ZONE,
  TILE_SLOPE_BR,
  TILE_SLOPE_SHALLOW,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
  TILE_STAIRS,
} from "./tiles";
import type { SolidGrid } from "./tiles";

/**
 * Bitmask rows of the TILE_STAIRS (288) staircase, row-major from the
 * cell's top; bit c (0..15, LSB = column 0) marks that pixel column solid
 * in the row. Rows 0-7 carry one 2px tread each, stepping down from the
 * top-right (cols 14-15) to the bottom-left (cols 0-1); column 15 is a
 * full-height right wall, column 0 a wall from row 7 down; row 15 is the
 * fully solid base. Everything between a tread and the base is OPEN — the
 * inferred hollow interior.
 */
const STAIRS_MASK: readonly number[] = [
  0xc000, 0xb000, 0x8c00, 0x8300, // rows 0-3: treads 14-15, 12-13, 10-11, 8-9
  0x80c0, 0x8030, 0x800c, 0x8003, // rows 4-7: treads 6-7, 4-5, 2-3, 0-1
  0x8001, 0x8001, 0x8001, 0x8001, // rows 8-11: left wall + right wall only
  0x8001, 0x8001, 0x8001, 0xffff, // rows 12-14: walls; row 15: full base
];

/**
 * Bitmask rows of the TILE_DEAD_ZONE (464) hazard pit, row-major from the
 * cell's top; bit c marks pixel column c solid, exactly like STAIRS_MASK
 * (bit 0 = col 0, bit 15 = col 15). Rows 13-15 are the fully solid base —
 * the basin floor; everything above it (rows 0-12) is OPEN: the cell's
 * mouth and interior are a hole a player walks into and falls to the
 * bottom of. There are deliberately NO side walls or rim lips — the pit is
 * an open basin, so adjacent 464 cells merge into one continuous trench
 * with no 1px seam snags (a rim lip at col 0/15 would sit under a player
 * resting at a cell seam and trip the anti-cheat's buried-in-geometry
 * probes, and would add nothing: the top is already walk-off-able). The
 * solid neighbors beside each pit run (57 walls, the world edge) are what
 * stop lateral escape — the mask itself only catches falls.
 */
const DEAD_ZONE_MASK: readonly number[] = [
  ...new Array<number>(13).fill(0x0000), // rows 0-12: open mouth + interior
  0xffff, 0xffff, 0xffff, // rows 13-15: solid base
];

/** Top row of the dead-zone mask's solid base (rows 13-15 = the basin floor). */
const DEAD_ZONE_BASE_ROW = 13;

/**
 * Topmost solid pixel row at column `c` of the stairs mask (0..15): the
 * treads' tops step up one row every two columns, from row 7 at the left
 * (cols 0-1) to row 0 at the right (cols 14-15). The box's landing /
 * support surface sits at that row (the tread's top edge).
 */
function stairsTopRow(c: number): number {
  return 7 - Math.floor(c / 2);
}

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
  if (kind === TILE_SLOPE_SHALLOW) return dx + 2 * dy >= 2 * TILE_SIZE;
  if (kind === TILE_STAIRS || kind === TILE_DEAD_ZONE) {
    // Pixel mask (STAIRS_MASK / DEAD_ZONE_MASK): a point is solid inside
    // any solid pixel (16px per tile).
    const mask = kind === TILE_STAIRS ? STAIRS_MASK : DEAD_ZONE_MASK;
    const col = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor(dx)));
    const row = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor(dy)));
    return ((mask[row] ?? 0) & (1 << col)) !== 0;
  }
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
    const mask = kind === TILE_STAIRS ? STAIRS_MASK : DEAD_ZONE_MASK;
    const c0 = Math.max(0, Math.floor(ox0));
    const c1 = Math.min(TILE_SIZE - 1, Math.ceil(ox1) - 1);
    const r0 = Math.max(0, Math.floor(oy0));
    const r1 = Math.min(TILE_SIZE - 1, Math.ceil(oy1) - 1);
    if (c1 < c0 || r1 < r0) return false;
    const cols = ((1 << (c1 - c0 + 1)) - 1) << c0;
    for (let r = r0; r <= r1; r++) {
      if (((mask[r] ?? 0) & cols) !== 0) return true;
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
  const x0 = Math.floor((x - hw) / TILE_SIZE);
  const x1 = Math.floor((x + hw) / TILE_SIZE);
  const y0 = Math.floor((y - hh) / TILE_SIZE);
  const y1 = Math.floor((y + hh) / TILE_SIZE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
      if (grid.kinds[ty * grid.width + tx] !== TILE_DEAD_ZONE) continue;
      if (aabbTouchesDeadZoneFloor(grid, tx, ty, x, y, hw, hh)) return true;
    }
  }
  return false;
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
function aabbTouchesDeadZoneFloor(
  grid: SolidGrid,
  tx: number,
  ty: number,
  x: number,
  y: number,
  hw: number,
  hh: number,
): boolean {
  const left = tx * TILE_SIZE;
  const top = ty * TILE_SIZE;
  const ox0 = Math.max(0, x - hw - left);
  const ox1 = Math.min(TILE_SIZE, x + hw - left);
  const oy0 = Math.max(0, y - hh - top);
  const oy1 = Math.min(TILE_SIZE, y + hh - top);
  if (ox1 <= ox0 || oy1 <= oy0) return false;
  return oy1 >= DEAD_ZONE_BASE_ROW - 1;
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
      // 287 (dx + 2·dy ≥ 32): 262 at half the rise — the face is at
      // 32 − 2·dyBottom, clamped to the tile's left edge once the box's
      // bottom is below the cell (the base row is fully solid there), or
      // the shove-back would overshoot the shallow face; left-moving meets
      // the solid right column below the apex — the back side.
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
      } else if (kind === TILE_SLOPE_SHALLOW) {
        // 287 (dx + 2·dy ≥ 32): the wedge face runs dx = 32 − 2·dy — at
        // the box's deepest row it is half as far left as 262's. A
        // right-mover meets it there (`32 − 2·dyBottom`); when the box's
        // bottom is below the cell (the base row is fully solid there) the
        // contact is clamped to the tile's left edge or the push would
        // shove a low box ~24px back from a shallow face. A left-mover
        // meets the back side — the solid right column below the apex
        // (dy ≥ 8), the same right column 262 has from its top — so it is
        // pushed back the full-cell distance, like 262.
        pen =
          dir > 0
            ? Math.max(
                0,
                dx1 - Math.max(0, 2 * TILE_SIZE - 2 * dyBottom),
              )
            : Math.max(0, TILE_SIZE - dx0);
      } else if (kind === TILE_STAIRS || kind === TILE_DEAD_ZONE) {
        // 288 staircase / 464 hazard pit — pixel masks, not a single face:
        // the box meets the shape at the nearest solid pixel column in the
        // rows its leading edge spans (right-mover: the leftmost solid
        // column, left-mover: the rightmost), and the deepest overlapped
        // row wins. A wall face and a tread face resolve by the same
        // nearest-column rule; a box riding the stepped/basin surface was
        // exempted above.
        const mask = kind === TILE_STAIRS ? STAIRS_MASK : DEAD_ZONE_MASK;
        const col0 = Math.max(0, Math.floor(dx0));
        const col1 = Math.min(TILE_SIZE - 1, Math.ceil(dx1) - 1);
        const row0 = Math.max(0, Math.floor(dyTop));
        const row1 = Math.min(TILE_SIZE - 1, Math.ceil(dyBottom) - 1);
        const cols = ((1 << (col1 - col0 + 1)) - 1) << col0;
        for (let r = row0; r <= row1; r++) {
          const bits = (mask[r] ?? 0) & cols;
          if (bits === 0) continue;
          let c = dir > 0 ? col0 : col1;
          if (dir > 0) {
            while (((bits >> c) & 1) === 0) c++;
            const penRow = Math.max(0, x + hw - (left + c));
            if (penRow > maxPen) maxPen = penRow;
          } else {
            while (((bits >> c) & 1) === 0) c--;
            const penRow = Math.max(0, left + c + 1 - (x - hw));
            if (penRow > maxPen) maxPen = penRow;
          }
        }
        pen = 0; // rows already folded into maxPen; keep the shared check inert
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
 * sample it. 287 is 262 at half the rise: the landing surface is its own
 * 2:1 line (sampled at the shallowest extent), while its underside is flat
 * — the wedge reaches the cell's bottom edge at every column, so a rising
 * box contacts the cell bottom, never the sloped face.
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
      } else if (kind === TILE_SLOPE_SHALLOW) {
        // 287 (dx + 2·dy ≥ 32): the solid hangs below the 2:1 line that
        // runs from the cell's bottom-left corner (0, 16) to the right
        // edge's midpoint (16, 8), so its landing surface IS that line,
        // sampled at the box's shallowest extent (rightmost/edgeMax) — the
        // same ride-on-the-leading-corner rule as 262 (sampling the deepest
        // point would bury the box under the rising slope). The underside,
        // however, is flat: the wedge fills the cell down to its bottom
        // edge at every column (dx + 2·16 ≥ 32 always), so a box rising
        // from below (ceiling) contacts the cell's bottom edge, never the
        // sloped face. The back side is the fully-solid right column below
        // the apex (dx = 16, dy ≥ 8), which 262 already gets from its top.
        // `dir > 0` skips boxes whose bottom is below the CELL (like 262):
        // the base row is solid the whole way across (dx + 2·16 ≥ 32 for
        // every dx), so the foot sits flush with the cell's bottom edge — a
        // floor-level walker at the foot IS at the ramp's base and is
        // lifted onto the face as it advances (a ground-level walk-on ramp,
        // not a step to hop onto). Riders and climbers sit at or below the
        // surface with at most a substep of dip, well inside the tolerance.
        if (dir > 0 && bottomRel > TILE_SIZE + SLOPE_TOUCH_EPS) continue;
        surfaceY = dir > 0 ? top + TILE_SIZE - edgeMax / 2 : top + TILE_SIZE;
      } else if (kind === TILE_STAIRS || kind === TILE_DEAD_ZONE) {
        // 288 staircase / 464 hazard pit — pixel-mask landing: 288 binds
        // the topmost tread under the moving edge — the shallowest point
        // of the stepped surface, sampled at the box's rightmost column
        // (topRow(c) = 7 − ⌊c/2⌋), the same ride-on-the-leading-corner
        // rule as 262/287. 464 binds the mask's shallowest top row under
        // the edge's whole span: a box straddling a lip (cols 0/15) rests
        // on the rim (row 0), a box fully over the open interior sinks to
        // the base (row 13). Both undersides are flat — the base row is
        // solid at every column, so a rising box contacts the cell's
        // bottom edge, never the treads or the lips' undersides.
        // `dir > 0` skips boxes whose bottom is below the cell (an
        // overhang under-runner), like 262/287.
        if (dir > 0 && bottomRel > TILE_SIZE + SLOPE_TOUCH_EPS) continue;
        if (dir > 0) {
          if (kind === TILE_STAIRS) {
            const c1 = Math.max(
              0,
              Math.min(TILE_SIZE - 1, Math.ceil(edgeMax) - 1),
            );
            surfaceY = top + stairsTopRow(c1);
          } else {
            // 464 hazard pit: bind the DEEPEST solid top row under the
            // edge — the basin floor (the base at DEAD_ZONE_BASE_ROW). The
            // 262/287 "shallowest surface under the span" rule is right
            // for climbing a ramp, but wrong for a hole: the pit's mouth
            // is entirely open (no rim lips), so the only landing surface
            // is the base itself; a dropping box must sink to it rather
            // than stopping at the mouth's edge (flooring the edge
            // columns reads as a shallow surface and caught every fall at
            // a cell seam).
            surfaceY = top + DEAD_ZONE_BASE_ROW;
          }
        } else {
          surfaceY = top + TILE_SIZE;
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