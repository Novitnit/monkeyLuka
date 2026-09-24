/**
 * Asset locations and timing constants for the jungle scene.
 *
 * The Tiled map + tilesets are fetched from `Assets/map`, the player
 * sprite sheets from `Assets/player/sheets`, and the movable-trap sheet
 * from `Assets/trap`, served via the `public/map`, `public/player`, and
 * `public/trap` symlinks (the real files live in the repo root `Assets/`).
 */

/** Where the Tiled map and its tileset assets are served from. */
export const MAP_DIR = "/map";
export const MAP_FILE = "main.json";

/** Where the player sprite sheets are served from. */
export const PLAYER_DIR = "/player";

/** Where the movable-trap sprite sheet is served from. */
export const TRAP_DIR = "/trap";

/**
 * The door-opening sprite sheet: served as `public/door.png` (the symlink
 * into `Assets/door.png`, same pattern as the public/trap symlinks).
 */
export const DOOR_SPRITE = "/door.png";

/**
 * Front-most map decoration layer (`out_tile` in main.json): rendered as
 * its own whole-map container (see map-renderer's `topTileLayers`) and
 * raised above the door layer so door panels draw BEHIND the level's rim
 * art instead of over it.
 */
export const OUT_TILE_LAYER_NAME = "out_tile";

/** How often the client reports its state to the server, ms (~20 Hz). */
export const INPUT_INTERVAL_MS = 50;