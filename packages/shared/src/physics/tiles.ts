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
  | typeof TILE_SLOPE_TR_BL;

/** A compact grid of tile kinds (0 = open, otherwise the gid). */
export interface SolidGrid {
  width: number;
  height: number;
  /** Row-major tile kinds (`TileKind`); read with `?? 0`. */
  kinds: Uint8Array;
}

/** Build the collision grid from a tile layer (ignores non-solid gids). */
export function buildTileGrid(layer: CollisionLayerData): SolidGrid {
  const kinds = new Uint8Array(layer.width * layer.height);
  for (let i = 0; i < layer.width * layer.height; i++) {
    const gid = layer.gids[i] ?? 0;
    kinds[i] =
      gid === TILE_SOLID || gid === TILE_SLOPE_TL_BR || gid === TILE_SLOPE_TR_BL
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