/**
 * Unit tests for the server's jungle-map loader: the server must derive its
 * collision grid from the SAME raw Tiled JSON shape the browser client
 * renders, or the validated trajectory and client prediction diverge.
 *
 * These tests feed `parseJungleMap` SYNTHETIC raw maps. The shipped level
 * (`Assets/map/main.json`) is art in active rework, so no test here reads
 * it: a map edit can never change what the loader tests assert.
 */
import { describe, expect, test } from "bun:test";
import {
  PLAYER_SPAWN,
  ROOM_OBJECT_GROUP_NAME,
  TILE_DEAD_ZONE,
  TILE_DOOR,
  TILE_DOOR_BOTTOM_LEFT,
  TILE_DOOR_BOTTOM_RIGHT,
  TILE_DOOR_TOP_LEFT,
  TILE_DOOR_TOP_RIGHT,
  TILE_INTERACTION,
  TILE_SLOPE_SHALLOW,
  TILE_SLOPE_SHALLOW_MIRROR,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
  TILE_STAIRS,
  TILE_STAIRS_MIRROR,
  groupRoomObjectsByName,
  isPointSolid,
} from "@monkeyluka/shared";
import { parseJungleMap } from "./jungle-map";

/** Wraps a layer1 gid array into the raw Tiled-JSON shape the loader reads. */
function rawMap(
  width: number,
  height: number,
  gids: number[],
  objects?: Array<{ id: number; name?: string; x: number; y: number; width: number; height: number }>,
): Parameters<typeof parseJungleMap>[0] {
  const layers: Array<Record<string, unknown>> = [
    { type: "tilelayer", name: "layer1", width, height, data: gids },
  ];
  if (objects) {
    layers.push({
      type: "objectgroup",
      name: ROOM_OBJECT_GROUP_NAME,
      objects,
    });
  }
  return { width, height, layers };
}

describe("jungle-map loader", () => {
  test("loads a raw map's collision layer with the folding rules", () => {
    // Synthetic 8×4 map exercising every transformation the loader must
    // apply (the same ones the shipped map relies on): 57 → TILE_SOLID,
    // 65 folds into TILE_SOLID, the four door gids fold into TILE_DOOR,
    // each slope keeps its own kind, 464 stays TILE_DEAD_ZONE, and 315 is
    // an interaction tile that must NOT leak into the collision grid. All
    // dimensions derive from the layer itself — nothing is hard-coded to a
    // particular level's tile counts.
    const width = 8;
    const height = 4;
    const gids = new Array<number>(width * height).fill(0);
    // Row 0: every distinct collision kind.
    gids[0] = TILE_SOLID;
    gids[1] = 65; // folds into TILE_SOLID
    gids[2] = TILE_SLOPE_TL_BR; // 110
    gids[3] = TILE_SLOPE_TR_BL; // 109
    gids[4] = TILE_SLOPE_SHALLOW; // 287
    gids[5] = TILE_STAIRS; // 288
    gids[6] = TILE_STAIRS_MIRROR; // 289
    gids[7] = TILE_SLOPE_SHALLOW_MIRROR; // 290
    // Row 1: two 1×2 door stacks (375 above 401) + a 464 pit.
    gids[width + 2] = TILE_DOOR_TOP_LEFT;
    gids[width + 3] = TILE_DOOR_TOP_RIGHT;
    gids[2 * width + 2] = TILE_DOOR_BOTTOM_LEFT;
    gids[2 * width + 3] = TILE_DOOR_BOTTOM_RIGHT;
    gids[1 * width + 6] = TILE_DEAD_ZONE;
    // Row 2: an interaction tile (must never become collision).
    gids[2 * width + 4] = TILE_INTERACTION;

    const { grid, width: worldW, height: worldH } = parseJungleMap(
      rawMap(width, height, gids),
    );
    expect(grid.width).toBe(width);
    expect(grid.height).toBe(height);
    expect(worldW).toBe(width * 16);
    expect(worldH).toBe(height * 16);

    let solid = 0;
    let doors = 0;
    let slopes = 0;
    let pits = 0;
    for (const kind of grid.kinds) {
      if (kind === TILE_SOLID) solid += 1;
      if (kind === TILE_DOOR) doors += 1;
      if (
        kind === TILE_SLOPE_TL_BR ||
        kind === TILE_SLOPE_TR_BL ||
        kind === TILE_SLOPE_SHALLOW ||
        kind === TILE_SLOPE_SHALLOW_MIRROR ||
        kind === TILE_STAIRS ||
        kind === TILE_STAIRS_MIRROR
      ) {
        slopes += 1;
      }
      if (kind === TILE_DEAD_ZONE) pits += 1;
    }
    expect(solid).toBe(2); // 57 + 65 folded
    expect(doors).toBe(4); // the door stacks fold into four solid cells
    expect(slopes).toBe(6); // every slope kind preserved
    expect(pits).toBe(1);
    // The 315 interaction tile never reaches the collision grid.
    expect([...grid.kinds].some((k) => k === TILE_INTERACTION)).toBe(false);
  });

  test("spawn point floats above its platform and has open air below", () => {
    // Synthetic plaza: the spawn's column is clear air for the whole fall,
    // with a solid floor (row 13, top y=208) directly beneath — the same
    // “spawn is never buried and always lands” property the shipped level
    // guarantees, restated on a fixture a map edit cannot move.
    const width = 8;
    const height = 17;
    const gids = new Array<number>(width * height).fill(0);
    for (let x = 0; x < width; x++) gids[13 * width + x] = TILE_SOLID;
    const { grid } = parseJungleMap(rawMap(width, height, gids));
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

  test("rejects a layer whose data does not match its dimensions", () => {
    const layer1 = {
      type: "tilelayer",
      name: "layer1",
      width: 4,
      height: 4,
      data: [0, 0, 0],
    };
    expect(() =>
      parseJungleMap({ width: 4, height: 4, layers: [layer1] }),
    ).toThrow("Map collision layer data length 3 != 16");
  });

  test("named room objects link the signposts and doors they contain", () => {
    // Synthetic map: a `room` objectgroup with one rectangle (room1) over a
    // 315 signpost and a 1×2 door stack. The loader must surface all three
    // (roomObjects / interactions / doors), and grouping must link that
    // room's signpost to its door 1-to-1 — the room1 gate shape, built
    // in-test so map edits can't change it.
    const width = 12;
    const height = 6;
    const gids = new Array<number>(width * height).fill(0);
    gids[4 * width + 2] = TILE_INTERACTION; // signpost at (2, 4)
    gids[1 * width + 8] = TILE_DOOR_TOP_LEFT;
    gids[2 * width + 8] = TILE_DOOR_BOTTOM_LEFT;
    const raw = rawMap(width, height, gids, [
      // room1: 160×96 px starting at (32, 16) — contains both entities' centers.
      { id: 1, name: "room1", x: 32, y: 16, width: 160, height: 96 },
    ]);

    const { roomObjects, doors, interactions } = parseJungleMap(raw);
    expect(roomObjects).toHaveLength(1);
    expect(roomObjects[0]).toMatchObject({
      name: "room1",
      x: 32,
      y: 16,
      width: 160,
      height: 96,
    });
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ tx: 8, ty: 1 });
    expect(interactions.gids[4 * width + 2]).toBe(TILE_INTERACTION);

    const groups = groupRoomObjectsByName(roomObjects, doors, interactions);
    expect(groups.map((g) => g.name)).toEqual(["room1"]);
    expect(groups[0]!.showquest).toEqual([{ tx: 2, ty: 4 }]);
    expect(groups[0]!.doors).toHaveLength(1);
    expect(groups[0]!.doors[0]).toMatchObject({ tx: 8, ty: 1 });
  });
});