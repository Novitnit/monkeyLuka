/**
 * Unit tests for the server's jungle-map loader: the server must derive its
 * collision grid from the SAME `Assets/map/main.json` the browser client
 * renders, or the validated trajectory and client prediction diverge.
 */
import { describe, expect, test } from "bun:test";
import {
  PLAYER_SPAWN,
  TILE_DOOR,
  TILE_SLOPE_BR,
  TILE_SLOPE_SHALLOW,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
  TILE_STAIRS,
  groupRoomObjectsByName,
  isPointSolid,
} from "@monkeyluka/shared";
import { parseJungleMap } from "./jungle-map";

/** Frozen snapshot of the real map file (Assets/map/main.json). */
const raw = (await Bun.file(
  new URL("../../../../Assets/map/main.json", import.meta.url),
).json()) as Parameters<typeof parseJungleMap>[0];

describe("jungle-map loader", () => {
  test("loads the real map's collision layer", () => {
    const { grid, width, height } = parseJungleMap(raw);
    expect(grid.width).toBe(120);
    expect(grid.height).toBe(17);
    expect(width).toBe(120 * 16);
    expect(height).toBe(17 * 16);

    // Snapshot of the real map's layer1 (computed from main.json): the map
    // is 120 tiles wide (the right half, columns 60-119, is empty canvas
    // reserved for future rooms). The playable left half is unchanged: 146
    // solid tiles (of which 3 are gid 65, folded into TILE_SOLID by
    // buildTileGrid) and 10 sloped kinds (4×110, 2×109, 2×287, 2×288 —
    // the two 287+288 ramp pairs; the current map has no 262). The four
    // door tiles (375/376/401/402) become their own TILE_DOOR kind — a
    // closed door is solid but non-sticky (walls can be grabbed, doors
    // can't) — so they count separately. The other decoration gids (315,
    // 464) must NOT become collision.
    let solid = 0;
    let doors = 0;
    let slopes = 0;
    for (const kind of grid.kinds) {
      if (kind === TILE_SOLID) solid += 1;
      if (kind === TILE_DOOR) doors += 1;
      if (
        kind === TILE_SLOPE_TL_BR ||
        kind === TILE_SLOPE_TR_BL ||
        kind === TILE_SLOPE_BR ||
        kind === TILE_SLOPE_SHALLOW ||
        kind === TILE_STAIRS
      ) {
        slopes += 1;
      }
    }
    expect(solid).toBe(146);
    expect(doors).toBe(4);
    expect(slopes).toBe(10);
  });

  test("spawn point floats above the left platform and has open air below", () => {
    const { grid } = parseJungleMap(raw);
    // The spawn center (56,192) floats above the row-13 floor (top y=208).
    expect(isPointSolid(grid, PLAYER_SPAWN.x, PLAYER_SPAWN.y)).toBe(false);
    // Directly below the spawn, the platform begins at y=208.
    expect(isPointSolid(grid, PLAYER_SPAWN.x, 208)).toBe(true);
    expect(isPointSolid(grid, PLAYER_SPAWN.x, 180)).toBe(false);
  });

  test("rejects maps without the collision layer", () => {
    expect(() => parseJungleMap({ width: 4, height: 4, layers: [] })).toThrow(
      'Map has no "layer1" tile layer',
    );
  });

  test("real map links room1's signpost to its door (1 showquest × 1 door)", () => {
    const { roomObjects, doors, interactions } = parseJungleMap(raw);
    const groups = groupRoomObjectsByName(roomObjects, doors, interactions);

    // The room objectgroup holds a single `room1` rectangle spanning the
    // whole map (0,0, 496×272, hidden in Tiled) — the whole-map bounds
    // rect the map originally used, restored after the split
    // (see discoveries/door-debug-no-line-mismatched-room-object-names.md).
    // It contains the 315 signpost at tile (17, 11) and the door block at
    // tile (29, 8) by center, so the group still links signpost → door —
    // 1 showquest × 1 door, no extra objects.
    expect(roomObjects.map((o) => o.name)).toEqual(["room1"]);
    expect(roomObjects[0]).toMatchObject({ x: 0, y: 0, width: 496, height: 272 });
    expect(groups.map((g) => g.name)).toEqual(["room1"]);

    const room1 = groups[0]!;
    expect(room1.objects).toHaveLength(1);
    expect(room1.showquest).toHaveLength(1);
    expect(room1.showquest[0]).toEqual({ tx: 17, ty: 11 });
    expect(room1.doors).toHaveLength(1);
    expect(room1.doors[0]).toMatchObject({ tx: 29, ty: 8 });
  });
});