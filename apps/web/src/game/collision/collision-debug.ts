/**
 * Phaser debug overlay for the collision geometry: draws every boundary edge
 * of the collision blocks on top of the map, clipped to each room the same
 * way the tiles are. Horizontal edges (floors) are blue, vertical edges
 * (walls) are green, the 110/109/262/287/288/290 slope lines (orange) take over the
 * block boundary wherever they touch a 57 tile, and the dead-zone (464) pit
 * outline is drawn RED (the `hazard` segments from collision-geometry).
 * Each door Entity's perimeter is drawn PURPLE on its OWN graphics
 * (one per room it crosses), so an opened door's lines can be hidden
 * individually via `hideDoor()` — the overlay then stops drawing
 * collision at a doorway that is now passable, while the door's art
 * keeps rendering.
 *
 * The lines are children of their room containers, so they inherit the
 * room's scale/position. They are visible by default and can be toggled at
 * runtime via `setEnabled()` — the geometry behind them lives in
 * `./collision-geometry.ts` and is meant to drive collision calculations later.
 */

import type Phaser from "phaser";
import { doorKey } from "@monkeyluka/shared";
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
  /** Dead-zone hazard pit outline color (default red). */
  hazardColor?: number;
  /** Door Entity perimeter color (default purple). */
  doorColor?: number;
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
  /**
   * Hide one door Entity's purple perimeter (its synced state is
   * open): the debug overlay stops drawing collision at a doorway that
   * is now passable. Idempotent; a later `setEnabled(true)` does NOT
   * bring the hidden door's lines back.
   */
  hideDoor(tx: number, ty: number): void;
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
  const hazardColor = options.hazardColor ?? 0xff0000;
  const doorColor = options.doorColor ?? 0x9b30ff;
  const lineWidth = options.lineWidth ?? 2;

  // Room grid: same row-major layout as the map renderer.
  const { columns } = roomGridSize(map, roomWidth, roomHeight);

  let enabled = options.enabled ?? true;
  const graphics: Phaser.GameObjects.Graphics[] = [];
  // Per-door purple perimeters, each on its OWN graphics (one entry per room
  // the door stack crosses), keyed by `doorKey(tx, ty)`, so an opened door's
  // lines can be hidden individually (`hideDoor`) without touching the rest
  // of the overlay. `hiddenDoors` keeps the hidden set authoritative, so a
  // later `setEnabled(true)` doesn't resurrect an open door's lines.
  const doorGraphics = new Map<string, Phaser.GameObjects.Graphics[]>();
  const hiddenDoors = new Set<string>();

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

    // Walls (vertical) first, then floors (horizontal), then the dead-zone
    // hazard pits, then slopes, so corners read cleanly.
    for (const s of geometry.segments) {
      if (s.kind === "wall") drawSegment(s, wallColor);
    }
    for (const s of geometry.segments) {
      if (s.kind === "floor") drawSegment(s, floorColor);
    }
    for (const s of geometry.segments) {
      if (s.kind === "hazard") drawSegment(s, hazardColor);
    }
    for (const d of geometry.diagonals) drawSegment(d, diagonalColor);

    overlay.setVisible(enabled);
    rooms[index].add(overlay);

    // Door perimeters come from `CollisionGeometry.doors` (per Entity, not
    // flat segments like the 464 outline): each door's perimeter is
    // clipped into the rooms it crosses and drawn on its own graphics
    // object, keyed by `doorKey(tx, ty)` — so when the synced schema
    // reports the door open, `hideDoor` can drop exactly those lines.
    const tw = map.tileWidth;
    const th = map.tileHeight;
    for (const door of geometry.doors) {
      const key = doorKey(door.tx, door.ty);
      const left = door.tx * tw;
      const top = door.ty * th;
      const right = left + door.cols * tw;
      const bottom = top + door.rows * th;
      const sides = [
        { x1: left, y1: top, x2: right, y2: top },
        { x1: right, y1: top, x2: right, y2: bottom },
        { x1: left, y1: top, x2: left, y2: bottom },
        { x1: left, y1: bottom, x2: right, y2: bottom },
      ];
      for (const side of sides) {
        const clipped = clipSegment(
          side.x1,
          side.y1,
          side.x2,
          side.y2,
          originX,
          originY,
          originX + roomWidth,
          originY + roomHeight,
        );
        if (!clipped) continue;
        const overlays = doorGraphics.get(key) ?? [];
        let doorOverlay = overlays[index];
        if (!doorOverlay) {
          doorOverlay = scene.add.graphics();
          doorOverlay.setVisible(enabled && !hiddenDoors.has(key));
          overlays[index] = doorOverlay;
          doorGraphics.set(key, overlays);
          rooms[index].add(doorOverlay);
        }
        doorOverlay.lineStyle(lineWidth, doorColor, 1);
        doorOverlay.lineBetween(
          clipped.x1 - originX,
          clipped.y1 - originY,
          clipped.x2 - originX,
          clipped.y2 - originY,
        );
      }
    }
  }

  return {
    get enabled(): boolean {
      return enabled;
    },
    setEnabled(on: boolean): void {
      enabled = on;
      for (const overlay of graphics) overlay.setVisible(on);
      // Doors the room opened stay hidden even when the toggle turns back
      // on — their lines describe a closed door that no longer exists.
      for (const [key, overlays] of doorGraphics) {
        const visible = on && !hiddenDoors.has(key);
        for (const overlay of overlays) if (overlay) overlay.setVisible(visible);
      }
    },
    hideDoor(tx: number, ty: number): void {
      const key = doorKey(tx, ty);
      hiddenDoors.add(key);
      for (const overlay of doorGraphics.get(key) ?? []) {
        if (overlay) overlay.setVisible(false);
      }
    },
    destroy(): void {
      for (const overlay of graphics) overlay.destroy();
      for (const overlays of doorGraphics.values()) {
        for (const overlay of overlays) if (overlay) overlay.destroy();
      }
    },
  };
}