/**
 * Interaction tiles: the gid → action registry, the interaction grid built
 * alongside the collision grid, and the feet-cell probe the web client uses
 * to detect "standing on an interaction tile" (E key → the server resolves
 * the tile's action).
 *
 * Interaction tiles are NOT collision geometry: a gid with a registered
 * action never enters the `SolidGrid` `kinds` (buildTileGrid folds unknown
 * gids to 0, and its
 * penalty for a new kind is the penetration fallthrough turning it into a
 * slope wedge), so they are tracked in their own grid. Adding a new
 * interaction tile is: place the gid in the map, register its action below,
 * and execute the action on the server (`apps/server/.../interactions.ts`).
 */

import {
  TILE_ENDGAME,
  TILE_INTERACTION,
  TILE_SIZE,
  type CollisionLayerData,
} from "./tiles";

/**
 * The action bound to each interaction tile gid. The value is the action id
 * the server executes when a player standing on the tile presses E; adding
 * a tile is one entry here (plus its gid in the map and a matching handler
 * on the server). 315 is the first interaction tile → "showquest" (the
 * server sends that player a question); 404 is the endgame tile → "finish"
 * (the run ends: the room stamps the finish moment, freezes the client's
 * timer, and saves the completion time to its SQLite result store).
 */
export const INTERACTION_TILE_ACTIONS = {
  [TILE_INTERACTION]: "showquest",
  [TILE_ENDGAME]: "finish",
} as const;

/** The union of registered interaction actions. */
export type InteractionTileAction =
  (typeof INTERACTION_TILE_ACTIONS)[keyof typeof INTERACTION_TILE_ACTIONS];

/** The action for an interaction gid, or undefined when the gid is inert. */
export function interactionActionForGid(
  gid: number,
): InteractionTileAction | undefined {
  return (INTERACTION_TILE_ACTIONS as Record<number, InteractionTileAction | undefined>)[
    gid
  ];
}

/**
 * Walks the registry as a set of known gids (for `buildInteractionGrid` and
 * wire-payload validation).
 */
export function isInteractionTileGid(gid: number): boolean {
  return gid in INTERACTION_TILE_ACTIONS;
}

/**
 * Whether a gid is the question-tablet tile (315 — the showquest
 * signpost). The web map renderer skips this gid's tileset art: the tile
 * renders from the QuestionTablet sprite sheet instead
 * (apps/web/src/game/quest/question-tablet.ts), so the animated tablet is
 * the signpost's only art.
 */
export function isQuestionTabletTileGid(gid: number): boolean {
  return gid === TILE_INTERACTION;
}

/**
 * A compact grid of interaction tile gids (0 = no interaction). Same dims
 * and source layer as the collision grid, but interaction gids never appear
 * in `SolidGrid.kinds` — see the module doc.
 */
export interface InteractionGrid {
  width: number;
  height: number;
  /** Row-major interaction gids (`TileKind`-style gid or 0). */
  gids: Uint16Array;
}

/**
 * Build the interaction grid from a tile layer (the same `layer1` the
 * collision grid reads). Only gids with a registered action are kept; all
 * other gids (including nothing) become 0.
 */
export function buildInteractionGrid(
  layer: CollisionLayerData,
): InteractionGrid {
  const known = new Set(
    (Object.keys(INTERACTION_TILE_ACTIONS) as unknown[]).map(Number),
  );
  const gids = new Uint16Array(layer.width * layer.height);
  for (let i = 0; i < gids.length; i++) {
    const gid = layer.gids[i] ?? 0;
    gids[i] = known.has(gid) ? gid : 0;
  }
  return { width: layer.width, height: layer.height, gids };
}

/**
 * How far below a cell boundary the feet may be and still count as resting
 * against the cell above. A player at rest on a flat floor has its collider
 * bottom flushed exactly to the floor surface (a cell boundary), and slope
 * support bands let it settle ~1px into the floor, so the feet point alone
 * would read the floor cell — not the interaction cell perched on it.
 */
export const INTERACTION_FEET_SLACK = 2;

/** The interaction tile an E-key probe resolved, with its grid cell. */
export interface InteractionTileProbe {
  /** The interaction gid found at the cell (always a registered gid). */
  gid: number;
  /** Grid column of the tile. */
  tx: number;
  /** Grid row of the tile. */
  ty: number;
}

/**
 * The interaction tile under the player's feet, or null. `x`/`y` are the
 * AABB center; `height` its height (feet = y + height/2 ≙ the collider's
 * bottom edge). Probes the cell containing the feet point, then — when the
 * feet sit at or within `INTERACTION_FEET_SLACK` below a cell boundary —
 * the cell just above it: the interaction tile's base is placed flush at
 * the standing surface (315 sits directly above the floor cell it triggers
 * from), so the flush-boundary case is the common one and the point alone
 * would miss it. Returns the CELL the gid came from, so callers can act on
 * that tile's identity (e.g. mark a signpost solved) — not just the gid.
 * Pure and engine-free, so the web client probes its local prediction and
 * the server re-probes its last accepted position with the very same rule.
 */
export function probeInteractionTile(
  grid: InteractionGrid,
  x: number,
  y: number,
  height: number,
): InteractionTileProbe | null {
  const feetY = y + height / 2;
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(feetY / TILE_SIZE);

  const gid = grid.gids[ty * grid.width + tx] ?? 0;
  if (gid !== 0) return { gid, tx, ty };

  if (ty > 0 && feetY % TILE_SIZE <= INTERACTION_FEET_SLACK) {
    const above = grid.gids[(ty - 1) * grid.width + tx] ?? 0;
    if (above !== 0) return { gid: above, tx, ty: ty - 1 };
  }
  return null;
}

/**
 * The interaction tile gid under the player's feet, or 0 — shorthand over
 * `probeInteractionTile` for callers that only need the gid.
 */
export function interactionTileUnderFeet(
  grid: InteractionGrid,
  x: number,
  y: number,
  height: number,
): number {
  return probeInteractionTile(grid, x, y, height)?.gid ?? 0;
}