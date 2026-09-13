/**
 * Phaser debug overlay for the door-link groups (`NEXT_PUBLIC_DOOR_DEBUG`,
 * `__jungleDoorDebug`): draws one CYAN line from every showquest
 * interaction to every door within the same room-objectgroup name group, so
 * the map author sees at a glance which signpost gates which door. Each
 * group's counts are logged when the overlay is created.
 *
 * The groups come from `groupRoomObjectsByName` in @monkeyluka/shared: each
 * room object's rectangle contains its tile entities by CENTER, and objects
 * that share a name link their showquest interactions to their doors (the
 * real map has a single room object named `room1` — a whole-map bounds rect
 * (0,0,496×272) containing the signpost and the door by center). This module is pure display; the future "answer
 * the question correctly → open the matching door" logic will read the very
 * same groups server-side.
 *
 * Lines are children of their room containers (room-local coordinates,
 * clipped per room like the collision-debug overlay), so they inherit each
 * room's scale/position and stay aligned with the tile art.
 */

import type Phaser from "phaser";
import {
  doorEntityCenter,
  interactionLinkCenter,
  type DoorLinkGroup,
} from "@monkeyluka/shared";
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  roomGridSize,
  type TiledMap,
} from "../map/tiled-map";

export interface DoorDebugOptions {
  /** Show the lines on creation (default true). */
  enabled?: boolean;
  /** Door-link line color (default cyan). */
  linkColor?: number;
  /** Line width in room-local pixels; scales with the room (default 2). */
  lineWidth?: number;
  /** Room size the lines are clipped to; must match the map render. */
  roomWidth?: number;
  roomHeight?: number;
}

export interface DoorDebug {
  /** Whether the lines are currently visible. */
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  destroy(): void;
}

/**
 * Clips a line segment to an axis-aligned box (Liang–Barsky); returns null
 * when the segment lies fully outside. Mirrors collision-debug.ts so the two
 * overlays slice the map identically.
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
 * Draws the door-link lines as debug lines on top of `rooms`, one Graphics
 * per room (row-major grid of `roomWidth`×`roomHeight` windows over the
 * map). Every (showquest, door) pair within the same name group becomes one
 * line from the showquest tile's center to the door block's center.
 */
export function createDoorDebug(
  scene: Phaser.Scene,
  map: TiledMap,
  rooms: Phaser.GameObjects.Container[],
  groups: DoorLinkGroup[],
  options: DoorDebugOptions = {},
): DoorDebug {
  const roomWidth = options.roomWidth ?? ROOM_WIDTH;
  const roomHeight = options.roomHeight ?? ROOM_HEIGHT;
  const linkColor = options.linkColor ?? 0x00ffff;
  const lineWidth = options.lineWidth ?? 2;

  // Room grid: same row-major layout as the map renderer + collision-debug.
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

    for (const group of groups) {
      for (const signpost of group.showquest) {
        const from = interactionLinkCenter(signpost);
        for (const door of group.doors) {
          const to = doorEntityCenter(door);
          const clipped = clipSegment(
            from.x,
            from.y,
            to.x,
            to.y,
            originX,
            originY,
            originX + roomWidth,
            originY + roomHeight,
          );
          if (!clipped) continue;
          overlay.lineStyle(lineWidth, linkColor, 1);
          overlay.lineBetween(
            clipped.x1 - originX,
            clipped.y1 - originY,
            clipped.x2 - originX,
            clipped.y2 - originY,
          );
        }
      }
    }

    overlay.setVisible(enabled);
    rooms[index].add(overlay);
  }

  // Surface the per-group counts once (the map author's at-a-glance check).
  console.info(
    `[door-debug] ${groups
      .map(
        (g) =>
          `"${g.name}": ${g.showquest.length} showquest × ${g.doors.length} doors`,
      )
      .join(", ")}`,
  );

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