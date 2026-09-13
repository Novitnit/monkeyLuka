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
 * shows. Rooms are *designed* 480×272 and ROOM_WIDTH must stay exactly
 * 480 — never wider: the 480px window keeps the camera grid aligned to
 * the designed rooms (no neighbor content ever pulled into the frame).
 * The renderer scales each room to exactly the 1280px canvas width
 * (scale = canvasWidth / ROOM_WIDTH = 1280/480 ≈ 2.667), so a scaled
 * room is exactly the viewport and the seam lands exactly on its edge —
 * no sliver of the next room. Tradeoff: that scale makes the 272px room
 * height ≈ 725.3px, 5.3px over the 720px canvas, so the map's top/bottom
 * rows crop ~2.67px each at the world's vertical edges (no single scale
 * can make 480px exactly 1280px wide and 272px fit in 720px: 1280/480
 * ≈ 2.667 > 720/272 ≈ 2.647). Only rendering and the camera room-lock
 * read this — the physics grid and the server use raw map tiles, so no
 * gameplay geometry changes with it.
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

/** One annotation object from a Tiled objectgroup (rectangle in map px). */
export interface TiledObject {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A Tiled objectgroup — the `room` group carries the door-link annotations. */
export interface TiledObjectGroup {
  name: string;
  objects: TiledObject[];
}

/**
 * An image layer (Tiled `imagelayer`), e.g. the 480×272 `background` image
 * behind the tile layers. `image` is preloaded like tileset images;
 * `repeatX`/`repeatY` mirror Tiled's `repeatx`/`repeaty` flags and the
 * renderer tiles the image across rooms accordingly.
 */
export interface TiledImageLayer {
  name: string;
  visible: boolean;
  /** World position of the image's top-left corner, px. */
  x: number;
  y: number;
  /** URL the browser loaded and cached. */
  imageUrl: string;
  /** The fully-loaded image, ready for `textures.addImage`. */
  image: HTMLImageElement;
  width: number;
  height: number;
  repeatX: boolean;
  repeatY: boolean;
}

export interface TiledMap {
  /** Map size in tiles. */
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  layers: TiledTileLayer[];
  /** `imagelayer`s in file order, rendered behind the tile layers. */
  imageLayers: TiledImageLayer[];
  /**
   * Objectgroups in file order — the `room` group's named rectangles link
   * showquest signposts to the doors they gate (see door-links in
   * @monkeyluka/shared).
   */
  objectGroups: TiledObjectGroup[];
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
    // `imagelayer` fields.
    x?: number;
    y?: number;
    image?: string;
    repeatx?: boolean;
    repeaty?: boolean;
    // `objectgroup` fields (the room group's annotation objects).
    objects?: Array<{
      id?: number;
      name?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }>;
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
  const imageLayers: TiledImageLayer[] = [];
  const objectGroups: TiledObjectGroup[] = [];
  for (const layer of raw.layers ?? []) {
    if (layer.type === "objectgroup") {
      // The room group's named rectangles are door-link annotations (see
      // door-links in @monkeyluka/shared) — kept engine-free like the
      // tile layers.
      objectGroups.push({
        name: layer.name ?? "objectgroup",
        objects: (layer.objects ?? []).map((obj) => ({
          id: obj.id ?? 0,
          name: obj.name ?? "",
          x: obj.x ?? 0,
          y: obj.y ?? 0,
          width: obj.width ?? 0,
          height: obj.height ?? 0,
        })),
      });
      continue;
    }
    if (layer.type === "imagelayer") {
      if (!layer.image) {
        throw new Error(
          `Image layer "${layer.name ?? "?"}" has no image URL`,
        );
      }
      // Resolve like tileset images, falling back to the bare filename.
      const imageUrl = await pickImageUrl([
        joinUrl(baseUrl, layer.image),
        joinUrl(baseUrl, basename(layer.image)),
      ]);
      const el = await loadImage(imageUrl);
      imageLayers.push({
        name: layer.name ?? "imagelayer",
        visible: layer.visible !== false,
        x: layer.x ?? 0,
        y: layer.y ?? 0,
        imageUrl,
        image: el,
        width: el.naturalWidth,
        height: el.naturalHeight,
        repeatX: layer.repeatx === true,
        repeatY: layer.repeaty === true,
      });
      continue;
    }
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
    imageLayers,
    objectGroups,
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