/**
 * Phaser debug overlay for the collision geometry: draws every boundary edge
 * of the collision blocks on top of the map, clipped to each room the same
 * way the tiles are. Horizontal edges (floors) are blue, vertical edges
 * (walls) are green, and the 109/110 slope lines (orange) take over the
 * block boundary wherever they touch a 57 tile.
 *
 * The lines are children of their room containers, so they inherit the
 * room's scale/position. They are visible by default and can be toggled at
 * runtime via `setEnabled()` — the geometry behind them lives in
 * `./collision-geometry.ts` and is meant to drive collision calculations later.
 */

import type Phaser from "phaser";
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  roomGridSize,
  type TiledMap,
} from "../map/tiled-map";
import type { CollisionGeometry } from "./collision-geometry";

export interface CollisionDebugOptions {
  /** Show the lines on creation (default true). */
  enabled?: boolean;
  /** Vertical wall edge color (default green). */
  wallColor?: number;
  /** Horizontal floor edge color (default blue). */
  floorColor?: number;
  /** Diagonal slope color (default orange). */
  diagonalColor?: number;
  /** Line width in room-local pixels; scales with the room (default 2). */
  lineWidth?: number;
  /** Room size the geometry is clipped to; must match the map render. */
  roomWidth?: number;
  roomHeight?: number;
}

export interface CollisionDebug {
  /** Whether the lines are currently visible. */
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  destroy(): void;
}

/**
 * Clips a line segment to an axis-aligned box (Liang–Barsky); returns null
 * when the segment lies fully outside.
 */
function clipSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return { x1: x1 + t0 * dx, y1: y1 + t0 * dy, x2: x1 + t1 * dx, y2: y1 + t1 * dy };
}

/**
 * Draws the collision geometry as debug lines on top of `rooms`, one Graphics
 * per room (row-major grid of `roomWidth`×`roomHeight` windows over the map).
 */
export function createCollisionDebug(
  scene: Phaser.Scene,
  map: TiledMap,
  rooms: Phaser.GameObjects.Container[],
  geometry: CollisionGeometry,
  options: CollisionDebugOptions = {},
): CollisionDebug {
  const roomWidth = options.roomWidth ?? ROOM_WIDTH;
  const roomHeight = options.roomHeight ?? ROOM_HEIGHT;
  const wallColor = options.wallColor ?? 0x00ff00;
  const floorColor = options.floorColor ?? 0x00aaff;
  const diagonalColor = options.diagonalColor ?? 0xff9900;
  const lineWidth = options.lineWidth ?? 2;

  // Room grid: same row-major layout as the map renderer.
  const { columns } = roomGridSize(map, roomWidth, roomHeight);

  let enabled = options.enabled ?? true;
  const graphics: Phaser.GameObjects.Graphics[] = [];

  for (let index = 0; index < rooms.length; index++) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const originX = col * roomWidth;
    const originY = row * roomHeight;

    const overlay = scene.add.graphics();
    graphics.push(overlay);

    const drawSegment = (
      segment: { x1: number; y1: number; x2: number; y2: number },
      color: number,
    ): void => {
      const clipped = clipSegment(
        segment.x1,
        segment.y1,
        segment.x2,
        segment.y2,
        originX,
        originY,
        originX + roomWidth,
        originY + roomHeight,
      );
      if (!clipped) return;
      overlay.lineStyle(lineWidth, color, 1);
      overlay.lineBetween(
        clipped.x1 - originX,
        clipped.y1 - originY,
        clipped.x2 - originX,
        clipped.y2 - originY,
      );
    };

    // Walls (vertical) first, then floors (horizontal), then slopes, so
    // corners read cleanly.
    for (const s of geometry.segments) {
      if (s.kind === "wall") drawSegment(s, wallColor);
    }
    for (const s of geometry.segments) {
      if (s.kind === "floor") drawSegment(s, floorColor);
    }
    for (const d of geometry.diagonals) drawSegment(d, diagonalColor);

    overlay.setVisible(enabled);
    rooms[index].add(overlay);
  }

  return {
    get enabled(): boolean {
      return enabled;
    },
    setEnabled(on: boolean): void {
      enabled = on;
      for (const overlay of graphics) overlay.setVisible(on);
    },
    destroy(): void {
      for (const overlay of graphics) overlay.destroy();
    },
  };
}