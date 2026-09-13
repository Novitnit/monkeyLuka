/**
 * Pixel masks for the two mask-shaped tile kinds (288 stairs, 464 dead-zone
 * pit): the row bitmasks themselves, plus the mask math shared by every
 * query (`maskForKind`, `maskRectRange`, `stairsTopRow`). The masks are the
 * tiles' collision shape, not an analytic wedge — see the per-mask comments
 * below for what each pixel means.
 */

import { TILE_SIZE, TILE_STAIRS } from "../tiles";

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
export const DEAD_ZONE_BASE_ROW = 13;

/**
 * Topmost solid pixel row at column `c` of the stairs mask (0..15): the
 * treads' tops step up one row every two columns, from row 7 at the left
 * (cols 0-1) to row 0 at the right (cols 14-15). The box's landing /
 * support surface sits at that row (the tread's top edge).
 */
export function stairsTopRow(c: number): number {
  return 7 - Math.floor(c / 2);
}

/** The pixel mask for a mask-shaped kind (288 stairs / 464 dead zone). */
export function maskForKind(kind: number): readonly number[] {
  return kind === TILE_STAIRS ? STAIRS_MASK : DEAD_ZONE_MASK;
}

/**
 * The pixel-column/-row range a cell-local rect [x0,x1]×[y0,y1] covers on a
 * 16×16 pixel mask, clamped into the mask, plus `cols`: the column bitmask
 * with bits c0..c1 set. Null when the rect covers no pixels (fully outside
 * the mask). Shared by the point/AABB overlap tests and the horizontal
 * penetration scan so the clamp + bitmask math lives once.
 */
export function maskRectRange(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): { c0: number; c1: number; r0: number; r1: number; cols: number } | null {
  const c0 = Math.max(0, Math.floor(x0));
  const c1 = Math.min(TILE_SIZE - 1, Math.ceil(x1) - 1);
  const r0 = Math.max(0, Math.floor(y0));
  const r1 = Math.min(TILE_SIZE - 1, Math.ceil(y1) - 1);
  if (c1 < c0 || r1 < r0) return null;
  return { c0, c1, r0, r1, cols: ((1 << (c1 - c0 + 1)) - 1) << c0 };
}