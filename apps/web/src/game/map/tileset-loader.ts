/**
 * Engine-free loading helpers for Tiled tilesets: fetches `.tsx` files,
 * parses the `<tileset>` element, and loads the tileset image into the
 * browser cache (trying candidate URLs for assets that moved since
 * download). Used by `resolveTiledMap` in `tiled-map.ts`; no Phaser import
 * so it stays SSR-safe and typecheckable on its own.
 */

/** Shape of the `<tileset>` element we parse out of a `.tsx` file. */
export interface ParsedTmx {
  name: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  tileCount: number;
  image: string;
  imageWidth: number;
  imageHeight: number;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${response.status})`);
  }
  return response.text();
}

/** Loads an image into the browser cache and resolves with the element. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image ${url}`));
    image.src = url;
  });
}

/**
 * Tries each candidate URL in order and returns the first that loads.
 * Needed because some `.tsx` files reference asset paths from their original
 * download location (e.g. `Legacy-Fantasy - High Forest 2.3/Assets/Tiles.png`)
 * that don't exist in this repo — we fall back to the bare filename.
 */
export async function pickImageUrl(candidates: string[]): Promise<string> {
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
export function parseTmx(xml: string): ParsedTmx {
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
