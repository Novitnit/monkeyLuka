/**
 * Phaser side of the Tiled map: registers each tileset as a texture (one
 * frame per tile) and each image layer (background) as a full-image texture,
 * then renders the map as separate `ROOM_WIDTH`×`ROOM_HEIGHT` rooms. Image
 * layers draw first (behind the tiles), tiled per `repeatx`/`repeaty`;
 * anything that would overflow a room's bounds is cropped away.
 *
 * Room scale: rooms are laid out in a grid (row-major). Each room is scaled
 * to exactly the canvas width (`scale = canvasWidth / roomWidth` ≈ 1280/480
 * ≈ 2.667), so a room-locked camera (viewport = canvas width) ends exactly at
 * the seam and the neighbor room never peeks in. `ROOM_WIDTH` is constrained
 * to the designed 480px; the width-exact scale then renders the 272px room
 * height ≈ 725.3px — 5.3px over the 720px canvas, so the map's top/bottom
 * rows crop ~2.67px each at the vertical world edges. For stacked room
 * rows (rows > 1) the height rule takes over so the grid can't overflow
 * the canvas many rooms deep; leftover horizontal space becomes margins.
 *
 * Selected tile layers (`topTileLayers` option) are NOT drawn inside the
 * rooms: each is rendered whole into its own map-pixel-coordinate container
 * (`TiledMapRender.topLayers`, a transform twin of room 0) so the caller
 * can raise it over world-object layers — the jungle scene lifts `out_tile`
 * above the door layer so doors draw behind the front decoration art.
 */

import type Phaser from "phaser";
import { isDoorTileGid } from "@monkeyluka/shared";
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  roomGridSize,
  tileFrameForGid,
  type TiledImageLayer,
  type TiledMap,
  type TiledTileLayer,
  type TiledTileset,
} from "./tiled-map";

export interface TiledMapRenderOptions {
  roomWidth?: number;
  roomHeight?: number;
  /** Canvas-pixel gap between rooms, applied after scaling. */
  gap?: number;
  /**
   * Tile layer names to lift out of the per-room rendering: instead of
   * drawing inside each room (and thus under every world object layer the
   * scene adds after the rooms), each named layer is rendered whole into
   * its own map-pixel-coordinate container (a transform twin of room 0)
   * returned via `TiledMapRender.topLayers`. The caller places that
   * container in the display list where it belongs — e.g. the scene
   * raises `out_tile` above the door layer so doors draw behind the
   * level's rim art.
   */
  topTileLayers?: readonly string[];
}

export interface TiledMapRender {
  columns: number;
  rows: number;
  /** One container per room, row-major, sized `roomWidth`×`roomHeight`. */
  rooms: Phaser.GameObjects.Container[];
  /**
   * One whole-map container per `topTileLayers` entry (order preserved),
   * children in map-pixel coordinates at the same position/scale as
   * `rooms[0]` — added to the scene after the rooms, ready to be raised
   * over world-object layers by the caller.
   */
  topLayers: {
    name: string;
    container: Phaser.GameObjects.Container;
  }[];
  /** Uniform scale applied to every room. */
  scale: number;
}

function tilesetKey(tileset: TiledTileset): string {
  return `tiles:${tileset.firstGid}`;
}

/**
 * Registers the tileset image as a Phaser texture and adds one frame per
 * tile, keyed by the tile's local id (0-based within the tileset).
 */
function registerTilesetTexture(scene: Phaser.Scene, tileset: TiledTileset): string {
  const key = tilesetKey(tileset);
  if (scene.textures.exists(key)) return key;

  const texture = scene.textures.addImage(key, tileset.image);
  if (!texture) {
    throw new Error(`Could not register tileset texture "${key}"`);
  }

  for (let localId = 0; localId < tileset.rows * tileset.columns; localId++) {
    const sx = (localId % tileset.columns) * tileset.tileWidth;
    const sy = Math.floor(localId / tileset.columns) * tileset.tileHeight;
    texture.add(localId, 0, sx, sy, tileset.tileWidth, tileset.tileHeight);
  }
  return key;
}

/**
 * Registers an image layer's image as a Phaser texture (the whole image is
 * a single frame), keyed by layer name — Tiled layer names are unique.
 */
function registerImageTexture(
  scene: Phaser.Scene,
  layer: TiledImageLayer,
): string {
  const key = `image:${layer.name}`;
  if (scene.textures.exists(key)) return key;

  const texture = scene.textures.addImage(key, layer.image);
  if (!texture) {
    throw new Error(`Could not register image layer texture "${key}"`);
  }
  return key;
}

/**
 * Placements of a (possibly repeating) image on one axis that intersect
 * `[from, to)`: a single placement at `start` when `repeat` is false, else
 * `start += size` stepping from the first placement at-or-before `from`.
 */
function repeatPositions(
  start: number,
  size: number,
  from: number,
  to: number,
  repeat: boolean,
): number[] {
  if (!repeat) return [start];
  if (size <= 0) return [];
  const positions: number[] = [];
  const first = start + Math.floor((from - start) / size) * size;
  for (let position = first; position < to; position += size) {
    positions.push(position);
  }
  return positions;
}

/**
 * Renders one image layer into a room: every image placement (honoring
 * `repeatx`/`repeaty`) that intersects the room window, cropped to the
 * visible part exactly like tiles are. Image layers are backgrounds, so
 * they go in behind the tile layers.
 */
function renderImageLayer(
  scene: Phaser.Scene,
  room: Phaser.GameObjects.Container,
  layer: TiledImageLayer,
  originX: number,
  originY: number,
  roomWidth: number,
  roomHeight: number,
): void {
  const key = registerImageTexture(scene, layer);

  for (const x of repeatPositions(
    layer.x,
    layer.width,
    originX,
    originX + roomWidth,
    layer.repeatX,
  )) {
    for (const y of repeatPositions(
      layer.y,
      layer.height,
      originY,
      originY + roomHeight,
      layer.repeatY,
    )) {
      const left = Math.max(x, originX);
      const top = Math.max(y, originY);
      const right = Math.min(x + layer.width, originX + roomWidth);
      const bottom = Math.min(y + layer.height, originY + roomHeight);
      if (right <= left || bottom <= top) continue;

      const image = scene.add.image(left - originX, top - originY, key);
      image.setOrigin(0, 0);

      // Clip image placements that poke past the room boundary.
      if (
        right - left !== layer.width ||
        bottom - top !== layer.height
      ) {
        image.setCrop(left - x, top - y, right - left, bottom - top);
      }

      room.add(image);
    }
  }
}

/**
 * Renders one room: image layers (backgrounds) first, then every tile whose
 * rect intersects the room's `roomWidth`×`roomHeight` window. Tiles that
 * straddle a room edge are cropped to the visible part; tiles fully outside
 * are skipped.
 */
function renderRoom(
  scene: Phaser.Scene,
  map: TiledMap,
  col: number,
  row: number,
  roomWidth: number,
  roomHeight: number,
  skipLayers: ReadonlySet<string>,
): Phaser.GameObjects.Container {
  const room = scene.add.container(0, 0);
  room.setName(`room-${col}-${row}`);

  const originX = col * roomWidth;
  const originY = row * roomHeight;

  for (const layer of map.imageLayers) {
    if (!layer.visible) continue;
    renderImageLayer(scene, room, layer, originX, originY, roomWidth, roomHeight);
  }

  for (const layer of map.layers) {
    if (!layer.visible || skipLayers.has(layer.name)) continue;
    for (let tileY = 0; tileY < layer.height; tileY++) {
      for (let tileX = 0; tileX < layer.width; tileX++) {
        const gid = layer.gids[tileY * layer.width + tileX];
        if (!gid) continue;

        // Door stacks render from the dedicated door sprite sheet
        // (door-render.ts), not the tileset: its sprite covers the door's
        // 1×2 stack and must be the ONLY door art so hiding it after the
        // opening animation leaves a genuinely open doorway.
        if (isDoorTileGid(gid)) continue;

        const frame = tileFrameForGid(map, gid);
        if (!frame) continue;

        const tileLeft = tileX * map.tileWidth;
        const tileTop = tileY * map.tileHeight;

        // Clip the tile to the room bounds.
        const left = Math.max(tileLeft, originX);
        const top = Math.max(tileTop, originY);
        const right = Math.min(tileLeft + map.tileWidth, originX + roomWidth);
        const bottom = Math.min(tileTop + map.tileHeight, originY + roomHeight);
        if (right <= left || bottom <= top) continue;

        const image = scene.add.image(
          left - originX,
          top - originY,
          tilesetKey(frame.tileset),
          frame.localId,
        );
        image.setOrigin(0, 0);

        // Crop tiles that poke past the room boundary.
        if (
          right - left !== map.tileWidth ||
          bottom - top !== map.tileHeight
        ) {
          image.setCrop(left - tileLeft, top - tileTop, right - left, bottom - top);
        }

        room.add(image);
      }
    }
  }

  return room;
}

/**
 * Renders one whole tile layer into a container placed in map-pixel
 * coordinates (the container is a transform twin of room 0: same
 * position/scale as `rooms[0]`, children at `tx*TILE_WIDTH`). No room
 * clipping — the layer spans the full map. Door gids stay skipped so the
 * dedicated door sprite remains the door stacks' only art.
 */
function renderTopTileLayer(
  scene: Phaser.Scene,
  map: TiledMap,
  layer: TiledTileLayer,
): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0);
  container.setName(`top-layer:${layer.name}`);

  for (let tileY = 0; tileY < layer.height; tileY++) {
    for (let tileX = 0; tileX < layer.width; tileX++) {
      const gid = layer.gids[tileY * layer.width + tileX];
      if (!gid) continue;
      if (isDoorTileGid(gid)) continue;

      const frame = tileFrameForGid(map, gid);
      if (!frame) continue;

      const image = scene.add.image(
        tileX * map.tileWidth,
        tileY * map.tileHeight,
        tilesetKey(frame.tileset),
        frame.localId,
      );
      image.setOrigin(0, 0);
      container.add(image);
    }
  }
  return container;
}

/** Renders the whole map as cropped rooms laid out on the canvas. */
export function renderTiledMap(
  scene: Phaser.Scene,
  map: TiledMap,
  options: TiledMapRenderOptions = {},
): TiledMapRender {
  const roomWidth = options.roomWidth ?? ROOM_WIDTH;
  const roomHeight = options.roomHeight ?? ROOM_HEIGHT;
  const gap = options.gap ?? 32;

  for (const tileset of map.tilesets) {
    registerTilesetTexture(scene, tileset);
  }

  // The map is tiled by rooms; the last column/row may be partial.
  const { columns, rows } = roomGridSize(map, roomWidth, roomHeight);
  const topTileLayerNames = new Set(options.topTileLayers ?? []);

  const rooms: Phaser.GameObjects.Container[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      rooms.push(
        renderRoom(scene, map, col, row, roomWidth, roomHeight, topTileLayerNames),
      );
    }
  }

  // Fit a single room's width into the canvas exactly: the room-locked
  // camera's viewport is the full canvas width, so a room scaled to
  // canvasWidth / roomWidth (= 1280/480 ≈ 2.667) ends exactly at the
  // viewport edge and the neighbor room never peeks in. ROOM_WIDTH is
  // capped at the designed 480px, so this scale renders the 272px room
  // height ≈ 725.3px — 5.3px over the 720px canvas, cropping ~2.67px off
  // the map's top and bottom rows at the world edges (a single scale can't
  // make a 480px room exactly 1280px wide and still fit 272px in 720px).
  // For stacked room rows (rows > 1) the height rule takes over so several
  // rows can't overflow the canvas at once.
  const canvasWidth = scene.scale.width;
  const canvasHeight = scene.scale.height;
  const heightFilling = canvasHeight / roomHeight;
  const totalHeightAtFill = rows * roomHeight * heightFilling + (rows - 1) * gap;
  const widthFitting = canvasWidth / roomWidth;
  const scale =
    rows > 1 && totalHeightAtFill > canvasHeight
      ? (canvasHeight - (rows - 1) * gap) / (rows * roomHeight)
      : widthFitting;

  const totalWidth = columns * roomWidth * scale + (columns - 1) * gap;
  const totalHeight = rows * roomHeight * scale + (rows - 1) * gap;
  const originX = (canvasWidth - totalWidth) / 2;
  const originY = (canvasHeight - totalHeight) / 2;

  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const room = rooms[index++];
      room.setPosition(
        originX + col * (roomWidth * scale + gap),
        originY + row * (roomHeight * scale + gap),
      );
      room.setScale(scale);
    }
  }

  // Lifted tile layers: whole-map containers at room 0's transform,
  // added to the scene after the rooms (drawn above them) so the caller
  // can raise them over world-object layers.
  const topLayers: TiledMapRender["topLayers"] = [];
  for (const layer of map.layers) {
    if (!layer.visible || !topTileLayerNames.has(layer.name)) continue;
    const container = renderTopTileLayer(scene, map, layer);
    container.setPosition(originX, originY);
    container.setScale(scale);
    topLayers.push({ name: layer.name, container });
  }

  return { columns, rows, rooms, topLayers, scale };
}