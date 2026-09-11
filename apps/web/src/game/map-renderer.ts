/**
 * Phaser side of the Tiled map: registers each tileset as a texture (one
 * frame per tile), then renders the map as separate `ROOM_WIDTH`×`ROOM_HEIGHT`
 * rooms. Anything that would overflow a room's 480×272 bounds is cropped away.
 *
 * Rooms are laid out in a grid (row-major). The whole grid is scaled to fill
 * the canvas height as much as possible and centered, so whatever horizontal
 * space is left over becomes the left/right margins.
 */

import type Phaser from "phaser";
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  tileFrameForGid,
  type TiledMap,
  type TiledTileset,
} from "./tiled-map";

export interface TiledMapRenderOptions {
  roomWidth?: number;
  roomHeight?: number;
  /** Canvas-pixel gap between rooms, applied after scaling. */
  gap?: number;
}

export interface TiledMapRender {
  columns: number;
  rows: number;
  /** One container per room, row-major, sized `roomWidth`×`roomHeight`. */
  rooms: Phaser.GameObjects.Container[];
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
 * Renders one room: every tile whose rect intersects the room's
 * `roomWidth`×`roomHeight` window. Tiles that straddle a room edge are
 * cropped to the visible part; tiles fully outside are skipped.
 */
function renderRoom(
  scene: Phaser.Scene,
  map: TiledMap,
  col: number,
  row: number,
  roomWidth: number,
  roomHeight: number,
): Phaser.GameObjects.Container {
  const room = scene.add.container(0, 0);
  room.setName(`room-${col}-${row}`);

  const originX = col * roomWidth;
  const originY = row * roomHeight;

  for (const layer of map.layers) {
    for (let tileY = 0; tileY < layer.height; tileY++) {
      for (let tileX = 0; tileX < layer.width; tileX++) {
        const gid = layer.gids[tileY * layer.width + tileX];
        if (!gid) continue;

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
  const columns = Math.max(
    1,
    Math.ceil((map.width * map.tileWidth) / roomWidth),
  );
  const rows = Math.max(
    1,
    Math.ceil((map.height * map.tileHeight) / roomHeight),
  );

  const rooms: Phaser.GameObjects.Container[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      rooms.push(renderRoom(scene, map, col, row, roomWidth, roomHeight));
    }
  }

  // Scale to fill the full height when possible; shrink only if several
  // stacked room rows would overflow the canvas.
  const canvasWidth = scene.scale.width;
  const canvasHeight = scene.scale.height;
  const heightFilling = canvasHeight / roomHeight;
  const totalHeightAtFill = rows * roomHeight * heightFilling + (rows - 1) * gap;
  const scale =
    totalHeightAtFill > canvasHeight
      ? (canvasHeight - (rows - 1) * gap) / (rows * roomHeight)
      : heightFilling;

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

  return { columns, rows, rooms, scale };
}