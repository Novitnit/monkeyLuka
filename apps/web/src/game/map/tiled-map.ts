/**
 * Minimal loader for the Tiled JSON map format (orthogonal maps with
 * `source`-based tilesets) used by `Assets/map/main.json`.
 *
 * Runs in the browser only: it fetches the map JSON plus each `.tsx`
 * tileset, resolves the tileset image URL, and preloads the image so the
 * Phaser renderer can register it synchronously via `textures.addImage`.
 * No Phaser imports here — engine-free so it stays SSR-safe and
 * typecheckable on its own. The tileset fetch/parse/image helpers live in
 * `./tileset-loader.ts`.
 */

import {
  basename,
  fetchText,
  joinUrl,
  loadImage,
  parseTmx,
  pickImageUrl,
  type ParsedTmx,
} from "./tileset-loader";

/**
 * Size of the map window each room renders and the room-locked camera
 * shows. Rooms are *designed* 480×272, but ROOM_WIDTH is 484: the renderer
 * scales the map to fill the 1280×720 canvas height (scale = 720/272 ≈
 * 2.647), so a 480px room renders only ≈ 1270.6px wide — 9.4px narrower
 * than the canvas, which let the room-locked camera (scrolled to the room
 * edge) show a sliver of the next room. A 484px window renders ≈ 1281.2px,
 * pushing the seam just off-screen. Only rendering and the camera room-lock
 * read this — the physics grid and the server use raw map tiles, so the
 * 4px overlap changes no gameplay geometry.
 */
export const ROOM_WIDTH = 480;
export const ROOM_HEIGHT = 272;

/** A normalized, render-ready tileset. */
export interface TiledTileset {
  /** First global tile id (gid) this tileset owns. */
  firstGid: number;
  name: string;
  /** URL the browser loaded and cached. */
  imageUrl: string;
  /** The fully-loaded tileset image, ready for `textures.addImage`. */
  image: HTMLImageElement;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
}

/**
 * A tile layer; `gids` is row-major, top-left first. `visible` mirrors the
 * Tiled flag: the renderer skips hidden layers, but collision geometry is
 * built regardless (the `layer1` collision layer is typically hidden).
 */
export interface TiledTileLayer {
  name: string;
  visible: boolean;
  width: number;
  height: number;
  gids: number[];
}

export interface TiledMap {
  /** Map size in tiles. */
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  layers: TiledTileLayer[];
  tilesets: TiledTileset[];
}

/**
 * Number of `roomWidth`×`roomHeight` windows the map divides into (row-major
 * grid; the last row/column may be partial). Shared by the map renderer and
 * the collision-debug overlay so both slice the map into rooms identically.
 */
export function roomGridSize(
  map: TiledMap,
  roomWidth: number,
  roomHeight: number,
): { rows: number; columns: number } {
  const rows = Math.max(
    1,
    Math.ceil((map.height * map.tileHeight) / roomHeight),
  );
  const columns = Math.max(
    1,
    Math.ceil((map.width * map.tileWidth) / roomWidth),
  );
  return { rows, columns };
}

/** Minimal shape of the raw Tiled JSON export we consume (main.json). */
export interface RawTiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers?: Array<{
    type?: string;
    name?: string;
    visible?: boolean;
    width?: number;
    height?: number;
    data?: number[] | string;
  }>;
  tilesets?: Array<{
    firstgid?: number;
    name?: string;
    source?: string;
    image?: string;
    columns?: number;
    tilecount?: number;
    tilewidth?: number;
    tileheight?: number;
  }>;
}

/** Parses a raw Tiled JSON map (already fetched) into our normalized model. */
export async function resolveTiledMap(
  baseUrl: string,
  raw: RawTiledMap,
): Promise<TiledMap> {
  const tilesets: TiledTileset[] = [];
  for (const ref of raw.tilesets ?? []) {
    const firstGid = ref.firstgid ?? 1;

    let parsed: ParsedTmx;
    if (ref.source) {
      parsed = parseTmx(await fetchText(joinUrl(baseUrl, ref.source)));
    } else if (ref.image) {
      // Inline tileset: derive the grid from the image once we know its size.
      const imageUrl = joinUrl(baseUrl, ref.image);
      const el = await loadImage(imageUrl);
      const tileWidth = ref.tilewidth ?? raw.tilewidth;
      const tileHeight = ref.tileheight ?? raw.tileheight;
      const columns =
        ref.columns ?? Math.max(1, Math.floor(el.naturalWidth / tileWidth));
      const rows = ref.tilecount
        ? Math.ceil(ref.tilecount / columns)
        : Math.max(1, Math.ceil(el.naturalHeight / tileHeight));
      tilesets.push({
        firstGid,
        name: ref.name ?? "tileset",
        imageUrl,
        image: el,
        tileWidth,
        tileHeight,
        columns,
        rows,
      });
      continue;
    } else {
      throw new Error(
        "Tileset entry has neither `source` nor `image` (unsupported map)",
      );
    }

    // Resolve the tileset image, falling back to the bare filename when the
    // `.tsx` references a path from its original download location.
    const imageUrl = await pickImageUrl([
      joinUrl(baseUrl, parsed.image),
      joinUrl(baseUrl, basename(parsed.image)),
    ]);
    const el = await loadImage(imageUrl);

    tilesets.push({
      firstGid,
      name: parsed.name,
      imageUrl,
      image: el,
      tileWidth: parsed.tileWidth,
      tileHeight: parsed.tileHeight,
      columns: parsed.columns,
      rows: Math.ceil(parsed.tileCount / parsed.columns),
    });
  }

  const layers: TiledTileLayer[] = [];
  for (const layer of raw.layers ?? []) {
    if (layer.type !== "tilelayer") continue;
    const width = layer.width ?? raw.width;
    const height = layer.height ?? raw.height;
    const data = layer.data ?? [];
    layers.push({
      name: layer.name ?? "layer",
      // Keep hidden layers so collision can still read them; rendering
      // filters on `visible` on its own.
      visible: layer.visible !== false,
      width,
      height,
      gids:
        typeof data === "string"
          ? data.split(",").map((value) => Number(value.trim()))
          : data,
    });
  }

  return {
    width: raw.width,
    height: raw.height,
    tileWidth: raw.tilewidth,
    tileHeight: raw.tileheight,
    layers,
    tilesets,
  };
}

/** Resolves a gid to its tileset + source pixel position; null if unknown. */
export function tileFrameForGid(
  map: TiledMap,
  gid: number,
): { tileset: TiledTileset; localId: number; sourceX: number; sourceY: number } | null {
  if (gid <= 0) return null;
  for (const tileset of map.tilesets) {
    const count = tileset.columns * tileset.rows;
    if (gid >= tileset.firstGid && gid < tileset.firstGid + count) {
      const localId = gid - tileset.firstGid;
      return {
        tileset,
        localId,
        sourceX: (localId % tileset.columns) * tileset.tileWidth,
        sourceY: Math.floor(localId / tileset.columns) * tileset.tileHeight,
      };
    }
  }
  return null;
}