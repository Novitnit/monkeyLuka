/**
 * Tile model: the constants that define the collision tile set (gids read
 * from the Tiled collision layer), the layer → grid conversion, and world
 * bounds math. Coordinate space is map pixel space, origin top-left, y
 * growing down, matching the tile grid: tile (tx, ty) occupies
 * `[tx*tw, (tx+1)*tw) × [ty*th, (ty+1)*th)`.
 *
 * Solid tiles (gids in the Tiled map's collision layer):
 * - 57  – fully solid block.
 * - 110 – diagonal tile, solid on its top-left half (line TL → BR). A point
 *         inside the tile with local coords (dx, dy) is solid when dy ≤ dx.
 * - 109 – diagonal tile, solid on its top-right half (line TR → BL); a point
 *         is solid when dx + dy ≤ 16 (the half above the descending line).
 * - 262 – diagonal tile, solid on its bottom-right half (line TR → BL, the
 *         mirror of 109); a point is solid when dx + dy ≥ 16 (the half below
 *         the descending line).
 * - 287 – shallow diagonal tile, the 2:1 ramp: the face runs from the
 *         bottom-left corner (0, 16) to the right edge's midpoint (16, 8)
 *         of the cell — 16px of run, only 8px of rise. It is solid BELOW
 *         that line (the same side as 262, but twice as flat and aligned
 *         to the bottom edge): a point is solid when dx + 2·dy ≥ 32. The
 *         right column below the apex (dx = 16, dy ≥ 8) is the back side —
 *         a solid wall under the ramp's top. The face reaches the cell's
 *         bottom on the left, so the ramp's foot is flush with the bottom
 *         edge: a ground-level walker steps straight onto it (there is no
 *         flat lip to land on, and the tile's top edge is open except at
 *         the apex).
 * - 288 – staircase tile (the pixel shape in collision.ts's STAIRS_MASK):
 *         eight 2px-wide, 1px-tall treads stepping DOWN from the top-right
 *         (cols 14-15 at row 0) to the bottom-left (cols 0-1 at row 7) —
 *         a 16px run, 8px rise, the mirror of 287, so placed right of a
 *         287 it continues the ramp up. Column 15 is a full-height right
 *         wall, column 0 a wall from row 7 down, row 15 a fully solid
 *         base — and the interior between the treads and the base is OPEN
 *         (point tests read it as empty; the walkable surface is the
 *         stepped tread tops at dy = 7 − ⌊c/2⌋). Unlike 287 there is no
 *         flush foot: the treads rest on walls, so climbing it is like a
 *         staircase (or a ramp's continuation), not a ground-level walk-on.
 * An AABB "touches" a slope when its extreme corner crosses into the solid
 * half, which gives exact rect-vs-triangle tests (see collision.ts).
 */

/** Sources of truth: tile constants first lived in the web collision code. */
export const TILE_SIZE = 16;
/** Fully solid block tile. */
export const TILE_SOLID = 57;
/** Diagonal tile, solid on its top-left half (line TL → BR). */
export const TILE_SLOPE_TL_BR = 110;
/** Diagonal tile, solid on its top-right half (line TR → BL). */
export const TILE_SLOPE_TR_BL = 109;
/** Diagonal tile, solid on its bottom-right half (line TR → BL, mirrored from 109). */
export const TILE_SLOPE_BR = 262;
/**
 * Shallow diagonal tile (2:1 ramp): solid below the bottom-aligned line
 * from the bottom-left corner (0, 16) to the right edge's midpoint (16, 8)
 * — the 262 wedge at half the rise, anchored to the cell's bottom edge (a
 * point is solid when dx + 2·dy ≥ 32). The right column below the apex is
 * the back side: a solid wall under the ramp's top.
 */
export const TILE_SLOPE_SHALLOW = 287;
/**
 * Staircase tile: a pixel-mask shape (see STAIRS_MASK in collision.ts) —
 * eight 2px-wide treads stepping down from the top-right to the bottom-left
 * (the mirror-ish of 287, so a 287 followed by a 288 forms a continuous
 * ramp), with a full-height right wall, a left wall from mid-height down,
 * and a fully solid base row. The wall and base faces are what block
 * lateral motion; the tread tops (dy = 7 − ⌊c/2⌋) are the landing surface.
 */
export const TILE_STAIRS = 288;
/** Tiled layer name the collision geometry and physics read. */
export const COLLISION_LAYER_NAME = "layer1";

/**
 * What collision needs from a tile layer. `gids` is row-major, top-left
 * first, 0 = empty. Works with the web's resolved `TiledMap` layer and with
 * the server's own parse of `Assets/map/main.json`.
 */
export interface CollisionLayerData {
  width: number;
  height: number;
  gids: number[];
}

/** A tile kind the physics understands: open or one of the solid gids. */
export type TileKind =
  | 0
  | typeof TILE_SOLID
  | typeof TILE_SLOPE_TL_BR
  | typeof TILE_SLOPE_TR_BL
  | typeof TILE_SLOPE_BR
  | typeof TILE_SLOPE_SHALLOW
  | typeof TILE_STAIRS;

/** A compact grid of tile kinds (0 = open, otherwise the gid). */
export interface SolidGrid {
  width: number;
  height: number;
  /** Row-major tile kinds (`TileKind`); read with `?? 0`. */
  kinds: Uint16Array;
}

/** Build the collision grid from a tile layer (ignores non-solid gids). */
export function buildTileGrid(layer: CollisionLayerData): SolidGrid {
  const kinds = new Uint16Array(layer.width * layer.height);
  for (let i = 0; i < layer.width * layer.height; i++) {
    const gid = layer.gids[i] ?? 0;
    kinds[i] =
      gid === TILE_SOLID ||
      gid === TILE_SLOPE_TL_BR ||
      gid === TILE_SLOPE_TR_BL ||
      gid === TILE_SLOPE_BR ||
      gid === TILE_SLOPE_SHALLOW ||
      gid === TILE_STAIRS
        ? gid
        : 0;
  }
  return { width: layer.width, height: layer.height, kinds };
}

/** World size in pixels for a grid (used to clamp players to the map). */
export function gridPixelSize(
  grid: SolidGrid,
): { width: number; height: number } {
  return { width: grid.width * TILE_SIZE, height: grid.height * TILE_SIZE };
}