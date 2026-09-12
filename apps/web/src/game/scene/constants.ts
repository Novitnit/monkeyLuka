/**
 * Asset locations and timing constants for the jungle scene.
 *
 * The Tiled map + tilesets are fetched from `Assets/map` and the player
 * sprite sheets from `Assets/player/sheets`, both served via the
 * `public/map` and `public/player` symlinks (the real files live in the
 * repo root `Assets/`).
 */

/** Where the Tiled map and its tileset assets are served from. */
export const MAP_DIR = "/map";
export const MAP_FILE = "main.json";

/** Where the player sprite sheets are served from. */
export const PLAYER_DIR = "/player";

/** How often the client reports its state to the server, ms (~20 Hz). */
export const INPUT_INTERVAL_MS = 50;