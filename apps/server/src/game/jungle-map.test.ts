/**
 * Unit tests for the server's jungle-map loader: the server must derive its
 * collision grid from the SAME `Assets/map/main.json` the browser client
 * renders, or the validated trajectory and client prediction diverge.
 */
import { describe, expect, test } from "bun:test";
import {
  PLAYER_SPAWN,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
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
    expect(grid.width).toBe(30);
    expect(grid.height).toBe(17);
    expect(width).toBe(30 * 16);
    expect(height).toBe(17 * 16);

    // The real map's layer1 has 77 solid tiles + 4 slopes; its other gid
    // (464, decoration) must NOT become collision.
    let solid = 0;
    let slopes = 0;
    for (const kind of grid.kinds) {
      if (kind === TILE_SOLID) solid += 1;
      if (kind === TILE_SLOPE_TL_BR || kind === TILE_SLOPE_TR_BL) slopes += 1;
    }
    expect(solid).toBe(77);
    expect(slopes).toBe(4);
  });

  test("spawn point floats above the left platform and has open air below", () => {
    const { grid } = parseJungleMap(raw);
    // The spawn center (96,176) is above the left platform top (row 13, y=208).
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
});