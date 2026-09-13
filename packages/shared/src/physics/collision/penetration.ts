/**
 * Axis-separated penetration helpers: how far an AABB pokes into solid
 * ground along one axis, resolving the collision for `stepPlayer`. Slopes
 * are resolved against their solid triangle / pixel mask, not the whole
 * cell, and a box riding a surface is exempted so motion slides along the
 * diagonal instead of ejecting the player to the cell boundary.
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
import {
  DEAD_ZONE_BASE_ROW,
  maskForKind,
  maskRectRange,
  stairsTopRow,
} from "./masks";
import {
  SLOPE_RIDE_TOL,
  SLOPE_TOUCH_EPS,
  cellOverlapRect,
  forEachOverlappedCell,
} from "./geometry";
import { slopeSupportsBox } from "./support";
import { aabbTouchesSolid } from "./box";

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

  forEachOverlappedCell(grid, x, y, hw, hh, (tx, ty) => {
    const kind = grid.kinds[ty * grid.width + tx] ?? 0;
    if (kind === 0) return false;
    if (!aabbTouchesSolid(grid, tx, ty, x, y, hw, hh)) return false;
    const cell = cellOverlapRect(tx, ty, x, y, hw, hh);
    if (!cell) return false;
    const { left, top } = cell;

    if (kind === TILE_SOLID) {
      const pen = dir > 0 ? x + hw - left : left + TILE_SIZE - (x - hw);
      if (pen > maxPen) maxPen = pen;
      return false;
    }

    // Slope cell. Work in cell-local coords: dx0/dx1 are the box's
    // horizontal span clamped to the cell (cell.ox0/ox1), dyTop/dyBottom
    // its vertical span (cell.oy0/oy1 — relative to the cell's top,
    // clamped into the cell; the raw bottom depth is kept unclamped so a
    // box *under* the tile is not mistaken for a rider). cellOverlapRect
    // already guaranteed a non-empty span.
    const dx0 = cell.ox0;
    const dx1 = cell.ox1;
    const dyTop = cell.oy0;
    const dyBottom = cell.oy1;
    const dyBottomRaw = y + hh - top;

    // Box riding the slope surface → let the vertical pass own the
    // contact; horizontal motion slides along the diagonal.
    if (slopeSupportsBox(kind, dx0, dx1, dyBottomRaw)) return false;

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
      const mask = maskForKind(kind);
      const range = maskRectRange(dx0, dx1, dyTop, dyBottom);
      if (range) {
        for (let r = range.r0; r <= range.r1; r++) {
          const bits = (mask[r] ?? 0) & range.cols;
          if (bits === 0) continue;
          let c = dir > 0 ? range.c0 : range.c1;
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
      }
      pen = 0; // rows already folded into maxPen; keep the shared check inert
    } else {
      pen =
        dir > 0
          ? Math.max(0, dx1 - (TILE_SIZE - dyBottom))
          : Math.max(0, TILE_SIZE - dx0);
    }
    if (pen > maxPen) maxPen = pen;
    return false;
  });
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

  forEachOverlappedCell(grid, x, y, hw, hh, (tx, ty) => {
    const kind = grid.kinds[ty * grid.width + tx] ?? 0;
    if (kind === 0) return false;
    if (!aabbTouchesSolid(grid, tx, ty, x, y, hw, hh)) return false;
    const cell = cellOverlapRect(tx, ty, x, y, hw, hh);
    if (!cell) return false;
    const { left, top } = cell;

    if (kind === TILE_SOLID) {
      const pen = dir > 0 ? y + hh - top : top + TILE_SIZE - (y - hh);
      if (pen > maxPen) maxPen = pen;
      return false;
    }

    // Slope: the moving edge's span within the cell decides the contact.
    const edgeMin = cell.ox0;
    const edgeMax = cell.ox1;

    // Surface height (top of the solid) along the moving edge, and the
    // box bottom's depth into the cell (unclamped — a bottom below the
    // cell means the box is under the tile, not landing on it).
    const bottomRel = y + hh - top;
    let surfaceY: number;

    if (kind === TILE_SLOPE_TL_BR || kind === TILE_SLOPE_TR_BL) {
      // 110/109 are corner brackets whose **top edge is solid across the
      // full cell** — a box falling onto one lands on that flat lip (like
      // a solid tile), so `dir > 0` (falling) resolves against `top`; the
      // hypotenuse only matters as the underside (a ceiling or a side
      // face), where 110's surface rises rightward (surface y = top + dx,
      // deepest at the max x of the moving edge — solid where dy ≤ dx) and
      // 109's falls rightward (surface y = top + TILE_SIZE − dx, deepest
      // at the min x — solid above the same TR→BL line). The lip only
      // fires for a box genuinely falling from above (bottom within a
      // substep of the cell top); an overhang under-runner whose top pokes
      // into the bracket from below must not be hoisted onto the lip.
      surfaceY =
        kind === TILE_SLOPE_TL_BR
          ? top + edgeMax
          : top + TILE_SIZE - edgeMin;
      if (dir > 0) {
        if (bottomRel <= SLOPE_RIDE_TOL + SLOPE_TOUCH_EPS) {
          surfaceY = top;
        } else {
          return false;
        }
      }
    } else {
      // The non-bracket kinds (262, 287, 288, 464) all hang their solid
      // below their surface line, and they all share the same guard for a
      // box that isn't landing on them: `dir > 0` skips one whose bottom
      // is below the CELL — that box is under the tile (an overhang
      // under-runner), not falling onto its surface. The epsilon covers
      // the grounded walker's gravity dip (≈0.13px), so a box at the
      // ramp's foot — bottom exactly at the cell's bottom edge, where the
      // surface starts — still reads as landing on it (a ground-level
      // walk-on ramp, not a step to hop onto).
      if (dir > 0 && bottomRel > TILE_SIZE + SLOPE_TOUCH_EPS) return false;

      if (kind === TILE_SLOPE_SHALLOW) {
        // 287 (dx + 2·dy ≥ 32): the solid hangs below the 2:1 line that
        // runs from the cell's bottom-left corner (0, 16) to the right
        // edge's midpoint (16, 8), so its landing surface IS that line,
        // sampled at the box's shallowest extent (rightmost/edgeMax) — the
        // same ride-on-the-leading-corner rule as 262 (sampling the
        // deepest point would bury the box under the rising slope). The
        // underside, however, is flat: the wedge fills the cell down to
        // its bottom edge at every column (dx + 2·16 ≥ 32 always), so a
        // box rising from below (ceiling) contacts the cell's bottom edge,
        // never the sloped face. The back side is the fully-solid right
        // column below the apex (dx = 16, dy ≥ 8), which 262 already gets
        // from its top.
        surfaceY =
          dir > 0 ? top + TILE_SIZE - edgeMax / 2 : top + TILE_SIZE;
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
        // buried position as a teleport.
        surfaceY = top + TILE_SIZE - edgeMax;
      }
    }

    const pen = dir > 0 ? y + hh - surfaceY : surfaceY - (y - hh);
    if (pen > maxPen) maxPen = pen;
    return false;
  });
  return maxPen;
}