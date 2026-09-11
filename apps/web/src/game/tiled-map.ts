/**
 * Minimal loader for the Tiled JSON map format (orthogonal maps with
 * `source`-based tilesets) used by `Assets/map/main.json`.
 *
 * Runs in the browser only: it fetches the map JSON plus each `.tsx`
 * tileset, resolves the tileset image URL, and preloads the image so the
 * Phaser renderer can register it synchronously via `textures.addImage`.
 * No Phaser imports here — engine-free so it stays SSR-safe and
 * typecheckable on its own.
 */

/** A room is a 480×272 window over the map. */
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

/** A visible tile layer; `gids` is row-major, top-left first. */
export interface TiledTileLayer {
  name: string;
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

/** Shape of the `<tileset>` element we parse out of a `.tsx` file. */
interface ParsedTmx {
  name: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  tileCount: number;
  image: string;
  imageWidth: number;
  imageHeight: number;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${response.status})`);
  }
  return response.text();
}

/** Loads an image into the browser cache and resolves with the element. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Could not load image ${url}`));
    image.src = url;
  });
}

/**
 * Tries each candidate URL in order and returns the first that loads.
 * Needed because some `.tsx` files reference asset paths from their original
 * download location (e.g. `Legacy-Fantasy - High Forest 2.3/Assets/Tiles.png`)
 * that don't exist in this repo — we fall back to the bare filename.
 */
async function pickImageUrl(candidates: string[]): Promise<string> {
  const seen = new Set<string>();
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      await loadImage(url);
      return url;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `Could not load tileset image (tried: ${candidates.join(", ")})`,
  );
}

/** Parses the `<tileset>` element out of a `.tsx` file. */
function parseTmx(xml: string): ParsedTmx {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const tileset = doc.getElementsByTagName("tileset")[0];
  if (!tileset) {
    throw new Error("Tileset file has no <tileset> element");
  }
  const image = tileset.getElementsByTagName("image")[0];
  if (!image) {
    throw new Error("Tileset file has no <image> element");
  }

  const attr = (el: Element, name: string): number => {
    const value = el.getAttribute(name);
    return value === null ? Number.NaN : Number(value);
  };

  const tileWidth = attr(tileset, "tilewidth");
  const tileHeight = attr(tileset, "tileheight");
  const tileCount = attr(tileset, "tilecount");
  const columns =
    attr(tileset, "columns") ||
    Math.max(1, Math.floor(attr(image, "width") / tileWidth));

  if (
    Number.isNaN(tileWidth) ||
    Number.isNaN(tileHeight) ||
    Number.isNaN(tileCount)
  ) {
    throw new Error("Tileset file is missing tilewidth/tileheight/tilecount");
  }

  return {
    name: tileset.getAttribute("name") ?? "tileset",
    tileWidth,
    tileHeight,
    columns,
    tileCount,
    image: image.getAttribute("source") ?? "",
    imageWidth: attr(image, "width"),
    imageHeight: attr(image, "height"),
  };
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
    if (layer.type !== "tilelayer" || layer.visible === false) continue;
    const width = layer.width ?? raw.width;
    const height = layer.height ?? raw.height;
    const data = layer.data ?? [];
    layers.push({
      name: layer.name ?? "layer",
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