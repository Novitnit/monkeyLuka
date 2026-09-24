/**
 * Tile model: the constants that define the collision tile set (gids read
 * from the Tiled collision layer), the layer → grid conversion, and world
 * bounds math. Coordinate space is map pixel space, origin top-left, y
 * growing down, matching the tile grid: tile (tx, ty) occupies
 * `[tx*tw, (tx+1)*tw) × [ty*th, (ty+1)*th)`.
 *
 * Solid tiles (gids in the Tiled map's collision layer):
 * - 57  – fully solid block.
 * - 65  – plain full block (brick texture, same solid footprint as 57);
 *         `buildTileGrid` folds it into TILE_SOLID so the physics sees one
 *         solid kind.
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
 * - 290 – shallow diagonal tile, the mirror of 287 flipped left-right: the
 *         face runs from the bottom-right corner (16, 16) to the left
 *         edge's midpoint (0, 8) — solid BELOW that line, so a point is
 *         solid when 2·dy − dx ≥ 16 (equivalently dx ≤ 2·dy − 16). It is
 *         built and walked exactly like 287, mirrored: the foot is the
 *         bottom-right corner (flush with the bottom edge — a ground-level
 *         walker stepping LEFT steps straight onto it), the left column
 *         below the apex (dx = 0, dy ≥ 8) is the back side (the solid wall
 *         under the ramp's top), the underside is a flat ceiling, and the
 *         climbing surface is the line dy = 8 + dx/2, sampled at the box's
 *         leftmost extent (the apex side).
 * - 288 – staircase tile (the pixel shape in collision/masks.ts's STAIRS_MASK):
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
 * - 289 – staircase tile, the mirror of 288 flipped left-right (the pixel
 *         shape in collision/masks.ts's STAIRS_MIRROR_MASK): eight 2px-wide,
 *         1px-tall treads stepping DOWN from the top-LEFT (cols 0-1 at row
 *         0) to the bottom-right (cols 14-15 at row 7) — 288's staircase
 *         read right-to-left, so placed left of a 290 it continues the
 *         shallow mirror ramp down. Column 0 is a full-height left wall,
 *         column 15 a wall from row 7 down, row 15 a fully solid base,
 *         and the interior between the treads and the base is OPEN; the
 *         walkable surface is the stepped tread tops at dy = 7 − ⌊(15−c)/2⌋.
 *         Climbing it walks left, like 290; unlike 290 there is no flush
 *         foot (the treads rest on walls, exactly like 288).
 * - 464 – dead-zone tile (the hazard pit, a pixel mask like 288's): an
 *         OPEN basin — rows 0-12 empty (the mouth and interior, no rim
 *         lips or side walls) with a fully solid 3px base at the cell's
 *         bottom (rows 13-15), so a player walking over it at rim level
 *         drops into the basin instead of standing on a flat top. The mask
 *         is the collision shape (see DEAD_ZONE_MASK in collision/masks.ts);
 *         touching it returns the player to its checkpoint (the web client
 *         probes its local simulation with isBoxInDeadZone).
 * - 315 – interaction tile: NOT a solid kind — `buildTileGrid` ignores it
 *         (folded to 0, so the penetration code can never treat it as a
 *         slope) and it lives in the separate interaction grid built by
 *         `buildInteractionGrid` (interaction.ts). Standing on one (the
 *         web probes its feet cell) and pressing E triggers the tile's
 *         action on the server — 315 is showquest.
 * - 404 – endgame interaction tile: like 315, NOT a solid kind — folded to
 *         `0` by `buildTileGrid` and kept only in the interaction grid.
 *         Standing on it and pressing E ends the run: the room stamps the
 *         server finish moment and persists the result ("finish", see
 *         interaction.ts / apps/server run-results).
 * - 375/376/401/402 – door tiles: the four halves of a 2×2 door block,
 *         placed as 375,376 on top and 401,402 below. A CLOSED door is a
 *         solid block — `buildTileGrid` folds the gids into the single
 *         TILE_DOOR kind (an extra full-block kind, like 65 folds to
 *         TILE_SOLID), so the player cannot walk through a closed door —
 *         but it is NOT grab-able: the wall-cling (grab) check skips
 *         TILE_DOOR faces, so jumping against a door slides off instead
 *         of hanging (a door is a smooth, non-sticky face). The same
 *         layer feeds `buildDoorEntities` (door.ts), which recognizes
 *         each non-overlapping 2×2 block as one door world object with an
 *         open/closed state (doors start closed; toggling later must
 *         rebuild the grid).
 * An AABB "touches" a slope when its extreme corner crosses into the solid
 * half, which gives exact rect-vs-triangle tests (see collision.ts).
 */

/** Sources of truth: tile constants first lived in the web collision code. */
export const TILE_SIZE = 16;
/** Fully solid block tile. */
export const TILE_SOLID = 57;
/**
 * Plain full block tile (brick texture — identical solid footprint to 57,
 * which is why `buildTileGrid` folds gid 65 into TILE_SOLID instead of
 * keeping a second solid kind: the penetration code dispatches on kind and
 * treats every non-57 kind as a slope, so a distinct 65 kind would silently
 * become a 262-shaped wedge in the fallthrough branches).
 */
export const TILE_SOLID_65 = 65;
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
 * Shallow diagonal tile, the mirror of 287 flipped left-right: solid below
 * the bottom-aligned 2:1 line from the bottom-right corner (16, 16) to the
 * left edge's midpoint (0, 8) — a point is solid when 2·dy − dx ≥ 16
 * (262's wedge at half the rise, anchored to the cell's bottom edge and
 * mirrored). The left column below the apex (dx = 0, dy ≥ 8) is the back
 * side, a solid wall under the ramp's top; the foot (bottom-right corner)
 * sits flush with the bottom edge, so a ground-level walker steps straight
 * onto it from the floor, like 287.
 */
export const TILE_SLOPE_SHALLOW_MIRROR = 290;
/**
 * Staircase tile: a pixel-mask shape (see STAIRS_MASK in collision/masks.ts) —
 * eight 2px-wide treads stepping down from the top-right to the bottom-left
 * (the mirror-ish of 287, so a 287 followed by a 288 forms a continuous
 * ramp), with a full-height right wall, a left wall from mid-height down,
 * and a fully solid base row. The wall and base faces are what block
 * lateral motion; the tread tops (dy = 7 − ⌊c/2⌋) are the landing surface.
 */
export const TILE_STAIRS = 288;
/**
 * Staircase tile, the mirror of 288 flipped left-right (see
 * STAIRS_MIRROR_MASK in collision/masks.ts): eight 2px treads stepping down
 * from the top-LEFT to the bottom-right — 288's staircase read
 * right-to-left, so a 289 placed left of a 290 continues the shallow
 * mirror ramp (290) down — with a full-height LEFT wall, a right wall from
 * mid-height down, and a fully solid base row. The wall and base faces
 * block lateral motion; the tread tops (dy = 7 − ⌊(15−c)/2⌋) are the
 * landing surface, climbed walking left.
 */
export const TILE_STAIRS_MIRROR = 289;
/**
 * Dead-zone tile: a pixel-mask hazard pit (see DEAD_ZONE_MASK in
 * collision/masks.ts) — an OPEN basin with a 3px solid base at the cell's
 * bottom and nothing above it (no rim lips or side walls: a player walks
 * off the mouth and sinks to the floor). Touching it returns the player
 * to its checkpoint (the web client probes its local simulation with
 * isBoxInDeadZone), and the debug overlay draws its collision lines red.
 * It must stay its own kind — the
 * penetration code dispatches on kind, so folding it into TILE_SOLID (or
 * leaving it to the slope fallthrough) would make it a plain block / a
 * 262-shaped wedge instead of the basin.
 */
export const TILE_DEAD_ZONE = 464;
/**
 * First interaction tile: standing on one (see `interactionTileUnderFeet`
 * in interaction.ts) and pressing E sends `PLAYER_INTERACTION_MESSAGE` to
 * the server, which resolves its action from `INTERACTION_TILE_ACTIONS`
 * (315 → "showquest", logged server-side). The gid must stay OUT of
 * `TileKind` and `buildTileGrid`: interaction tiles are not collision
 * geometry, and the penetration fallthrough would turn a new kind into a
 * slope wedge.
 */
export const TILE_INTERACTION = 315;
/**
 * Endgame interaction tile (gid 404, a decoration tile just left of the
 * signpost in the real map — see `Assets/map/main.json`): the finish
 * point. Like `TILE_INTERACTION` it is NOT collision geometry —
 * `buildTileGrid` folds it to 0 and it lives only in the interaction grid
 * (interaction.ts); standing on it and pressing E resolves its action
 * (`INTERACTION_TILE_ACTIONS`: 404 → "finish"), which ends the run: the
 * room stamps the server wall-clock finish moment on `PlayerInfo.finishedAt`
 * and persists the completion time to its SQLite run-results store (see
 * `apps/server/src/game/run-results.ts`).
 */
export const TILE_ENDGAME = 404;
/** Door tile, top-left half of the 2×2 door block (gids 375/376 on the top
 * row). Door gids are solid: a closed door blocks the player, and
 * `buildTileGrid` folds all four gids into the single TILE_DOOR kind (see
 * FOLD_TO_DOOR). */
export const TILE_DOOR_TOP_LEFT = 375;
/** Door tile, top-right half of the 2×2 door block. */
export const TILE_DOOR_TOP_RIGHT = 376;
/** Door tile, bottom-left half of the 2×2 door block (gids 401/402 on the bottom row). */
export const TILE_DOOR_BOTTOM_LEFT = 401;
/** Door tile, bottom-right half of the 2×2 door block. */
export const TILE_DOOR_BOTTOM_RIGHT = 402;
/**
 * The single solid kind standing for all four door gids: `buildTileGrid`
 * folds 375/376/401/402 into it (like 65 folds into TILE_SOLID). Every
 * collision query treats it as a full block (so a closed door blocks
 * walking), but the wall-cling grab deliberately skips it — a door is a
 * smooth face, so the player cannot get stuck on it (non-sticky).
 */
export const TILE_DOOR = TILE_DOOR_TOP_LEFT;
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
  | typeof TILE_DOOR
  | typeof TILE_SLOPE_TL_BR
  | typeof TILE_SLOPE_TR_BL
  | typeof TILE_SLOPE_BR
  | typeof TILE_SLOPE_SHALLOW
  | typeof TILE_SLOPE_SHALLOW_MIRROR
  | typeof TILE_STAIRS
  | typeof TILE_STAIRS_MIRROR
  | typeof TILE_DEAD_ZONE;

/** A compact grid of tile kinds (0 = open, otherwise the gid). */
export interface SolidGrid {
  width: number;
  height: number;
  /** Row-major tile kinds (`TileKind`); read with `?? 0`. */
  kinds: Uint16Array;
}

/**
 * Extra gids with exactly the full-block footprint of `TILE_SOLID`:
 * `buildTileGrid` folds them into TILE_SOLID so the physics sees one solid
 * kind (the penetration code treats every non-57 kind as a slope). 65 is a
 * plain brick block with the same shape as 57.
 */
const FOLD_TO_SOLID = new Set<number>([TILE_SOLID_65]);

/**
 * The four door gids, all folding to the single TILE_DOOR kind: a closed
 * door is a full solid block the player cannot walk through, but a smooth
 * non-sticky face the wall-cling grab skips (see the grab check in
 * box.ts/step.ts).
 */
const FOLD_TO_DOOR = new Set<number>([
  TILE_DOOR_TOP_LEFT,
  TILE_DOOR_TOP_RIGHT,
  TILE_DOOR_BOTTOM_LEFT,
  TILE_DOOR_BOTTOM_RIGHT,
]);

/** Build the collision grid from a tile layer (non-solid gids become 0). */
export function buildTileGrid(layer: CollisionLayerData): SolidGrid {
  const kinds = new Uint16Array(layer.width * layer.height);
  for (let i = 0; i < layer.width * layer.height; i++) {
    const gid = layer.gids[i] ?? 0;
    kinds[i] = FOLD_TO_SOLID.has(gid)
      ? TILE_SOLID
      : FOLD_TO_DOOR.has(gid)
        ? TILE_DOOR
        : gid === TILE_SLOPE_TL_BR ||
          gid === TILE_SLOPE_TR_BL ||
          gid === TILE_SLOPE_BR ||
          gid === TILE_SLOPE_SHALLOW ||
          gid === TILE_SLOPE_SHALLOW_MIRROR ||
          gid === TILE_STAIRS ||
          gid === TILE_STAIRS_MIRROR ||
          gid === TILE_DEAD_ZONE ||
          gid === TILE_SOLID
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