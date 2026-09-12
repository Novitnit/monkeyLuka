/**
 * Server-side load of the jungle's collision map. The browser client resolves
 * `Assets/map/main.json` through `public/map`, so the Colyseus server reads
 * the same tracked file directly from the repo root — both sides build their
 * `SolidGrid` from identical gids, so the geometry the client simulates
 * against is the same geometry the server validates reports against.
 */

import {
  buildTileGrid,
  COLLISION_LAYER_NAME,
  TILE_SIZE,
  type SolidGrid,
} from "@monkeyluka/shared";

/** Minimal raw Tiled-JSON shape we consume (see the web's tiled-map.ts). */
interface RawMapLayer {
  type?: string;
  name?: string;
  width?: number;
  height?: number;
  data?: number[] | string;
}

interface RawTiledMap {
  width: number;
  height: number;
  layers?: RawMapLayer[];
}

export interface JungleMapData {
  grid: SolidGrid;
  /** World size in pixels (matches the web's map model). */
  width: number;
  height: number;
}

/**
 * Default map location, resolved against this source file so it works from
 * any CWD: apps/server/src/game → repo root (four levels up) → Assets/map.
 */
const DEFAULT_MAP_URL = new URL(
  "../../../../Assets/map/main.json",
  import.meta.url,
);

/** Override point for tests/deploys (absolute path or relative to CWD). */
const MAP_PATH_ENV = "JUNGLE_MAP_PATH";

/** Parses the raw Tiled JSON export into the shared collision grid. */
export function parseJungleMap(raw: RawTiledMap): JungleMapData {
  const layer = (raw.layers ?? []).find(
    (candidate) =>
      candidate.name === COLLISION_LAYER_NAME &&
      (candidate.type === undefined || candidate.type === "tilelayer"),
  );
  if (!layer) {
    throw new Error(`Map has no "${COLLISION_LAYER_NAME}" tile layer`);
  }

  const width = layer.width ?? raw.width;
  const height = layer.height ?? raw.height;
  const data = layer.data ?? [];
  const gids =
    typeof data === "string"
      ? data.split(",").map((value) => Math.max(0, Number(value.trim())) || 0)
      : data;

  if (gids.length !== width * height) {
    throw new Error(
      `Map collision layer data length ${gids.length} != ${width * height}`,
    );
  }

  const grid = buildTileGrid({ width, height, gids });
  return { grid, width: grid.width * TILE_SIZE, height: grid.height * TILE_SIZE };
}

/** Reads and parses the jungle map JSON from disk. */
export async function loadJungleMap(
  path: string | undefined = process.env[MAP_PATH_ENV],
): Promise<JungleMapData> {
  const target = path ? path : DEFAULT_MAP_URL;
  const file = Bun.file(target);
  if (!(await file.exists())) {
    throw new Error(`Jungle map not found at ${target}`);
  }
  const raw = (await file.json()) as RawTiledMap;
  return parseJungleMap(raw);
}