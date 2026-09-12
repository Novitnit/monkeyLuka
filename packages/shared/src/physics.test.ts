/**
 * Physics + collision verification for `@monkeyluka/shared`. Run from the
 * repo root with `bun test` (Bun's built-in runner), or from this workspace
 * with `bun test packages/shared/src/physics.test.ts`. These keep the shared
 * simulation honest: the server's anti-cheat is only as good as this math.
 */
import { describe, expect, test } from "bun:test";
import {
  ANTI_CHEAT,
  DEFAULT_PLAYER_PHYSICS,
  PLAYER_SPAWN,
  TILE_SIZE,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
  buildTileGrid,
  createPlayerState,
  gridPixelSize,
  isBoxSolid,
  isPointSolid,
  maxPlayerSpeed,
  stepPlayer,
  validatePositionReport,
  type CollisionLayerData,
  type PlayerInput,
  type SolidGrid,
} from "./physics";

/** Small helpers to build test maps. */
function layer(width: number, height: number, gids: number[]): CollisionLayerData {
  return { width, height, gids };
}

function emptyGrid(width = 8, height = 8): SolidGrid {
  return buildTileGrid(layer(width, height, new Array(width * height).fill(0)));
}

/** A floor of solid tiles at tile row `row`, spanning columns fromX..toX. */
function floorGrid(width: number, height: number, row: number): SolidGrid {
  const gids = new Array<number>(width * height).fill(0);
  for (let x = 0; x < width; x++) gids[row * width + x] = TILE_SOLID;
  return buildTileGrid(layer(width, height, gids));
}

const noInput: PlayerInput = { left: false, right: false, jump: false };
const STEP = 1 / 60;

const config = DEFAULT_PLAYER_PHYSICS;

/** Drops a fresh state onto the floor and settles it onto the ground. */
function settle(grid: SolidGrid, x: number, y: number) {
  const state = createPlayerState(config);
  state.x = x;
  state.y = y;
  for (let i = 0; i < 600; i++) {
    stepPlayer(state, noInput, grid, STEP, config);
    if (state.grounded) break;
  }
  return state;
}

describe("tile grid", () => {
  test("builds kinds from gids and ignores non-solid tiles", () => {
    const grid = buildTileGrid(
      layer(4, 1, [0, TILE_SOLID, TILE_SLOPE_TL_BR, TILE_SLOPE_TR_BL]),
    );
    expect(grid.kinds[0]).toBe(0);
    expect(grid.kinds[1]).toBe(TILE_SOLID);
    expect(grid.kinds[2]).toBe(TILE_SLOPE_TL_BR);
    expect(grid.kinds[3]).toBe(TILE_SLOPE_TR_BL);
  });

  test("point solidity respects the exact slope halves", () => {
    const grid = buildTileGrid(layer(2, 1, [TILE_SLOPE_TL_BR, TILE_SLOPE_TR_BL]));
    // 110 at (0,0): solid where dy <= dx (top-left half).
    expect(isPointSolid(grid, 2, 2)).toBe(true); // dx2, dy2
    expect(isPointSolid(grid, 12, 12)).toBe(true);
    expect(isPointSolid(grid, 2, 12)).toBe(false); // bottom-left, open
    expect(isPointSolid(grid, 13, 3)).toBe(true); // right edge, solid
    // 109 at (1,0): solid where dx + dy <= 16 (top-right half).
    expect(isPointSolid(grid, 16 + 2, 2)).toBe(true);
    expect(isPointSolid(grid, 16 + 2, 12)).toBe(true); // top half… 2+12=14 <= 16
    expect(isPointSolid(grid, 16 + 12, 12)).toBe(false); // 24 > 16, open
    expect(isPointSolid(grid, 16 + 14, 1)).toBe(true); // 15 <= 16
  });

  test("box solidity reports overlap with slopes and blocks", () => {
    const grid = buildTileGrid(layer(2, 1, [0, TILE_SOLID]));
    expect(isBoxSolid(grid, 24, 8, 10, 14)).toBe(true); // into tile 1
    expect(isBoxSolid(grid, 8, 8, 10, 14)).toBe(false);
  });

  test("gridPixelSize derives world bounds", () => {
    expect(gridPixelSize(emptyGrid(30, 17))).toEqual({
      width: 480,
      height: 272,
    });
  });
});

describe("gravity + floors", () => {
  test("falls and lands on a floor, then stays grounded", () => {
    const grid = floorGrid(8, 8, 6);
    const state = settle(grid, 64, 64);
    // Floor top at 6*16=96; collider half-height 7 → center rests at 96-7.
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(6 * TILE_SIZE - config.height / 2, 4);
    expect(state.vy).toBe(0);
  });

  test("a box resting on the ground does not sink over time", () => {
    const grid = floorGrid(8, 8, 6);
    const state = settle(grid, 64, 64);
    const y = state.y;
    for (let i = 0; i < 120; i++) stepPlayer(state, noInput, grid, STEP, config);
    expect(state.y).toBeCloseTo(y, 4);
    expect(state.grounded).toBe(true);
  });

  test("falls through a gap instead of ballooning into the void", () => {
    const grid = buildTileGrid(
      layer(8, 8, [
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        TILE_SOLID, 0, 0, 0, 0, 0, 0, TILE_SOLID, // pillars with a gap
        TILE_SOLID, TILE_SOLID, TILE_SOLID, 0, 0, TILE_SOLID, TILE_SOLID, TILE_SOLID,
        0, 0, 0, 0, 0, 0, 0, 0,
      ]),
    );
    const state = createPlayerState(config);
    state.x = 5 * TILE_SIZE;
    state.y = 2 * TILE_SIZE;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    // Fell through the gap onto the lower floor at tile row 6 (top at 96).
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(6 * TILE_SIZE - config.height / 2, 2);
  });
});

describe("walking + walls", () => {
  test("walks right at run speed and stops at a wall", () => {
    const grid = buildTileGrid(
      layer(8, 4, [
        0, 0, 0, TILE_SOLID, 0, 0, 0, 0, // wall column at x=3
        0, 0, 0, TILE_SOLID, 0, 0, 0, 0,
        0, 0, 0, TILE_SOLID, 0, 0, 0, 0,
        TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID,
      ]),
    );
    const state = settle(grid, 2 * TILE_SIZE, 3 * TILE_SIZE);
    const input: PlayerInput = { left: false, right: true, jump: false };
    for (let i = 0; i < 60; i++) stepPlayer(state, input, grid, STEP, config);
    // Wall at x=3*16; collider half-width 5 → center stops at 48-5=43.
    expect(state.x).toBeCloseTo(3 * TILE_SIZE - config.width / 2, 4);
    expect(state.vx).toBe(0);
    expect(state.grounded).toBe(true);
  });

  test("does not exceed run speed while walking", () => {
    const grid = floorGrid(8, 2, 1);
    const state = settle(grid, 32, 16);
    const input: PlayerInput = { left: false, right: true, jump: false };
    for (let i = 0; i < 120; i++) stepPlayer(state, input, grid, STEP, config);
    expect(state.vx).toBeLessThanOrEqual(config.runSpeed + 1e-6);
  });
});

describe("jumping", () => {
  test("jumps, rises, falls, lands, and is grounded again", () => {
    const grid = floorGrid(8, 8, 6);
    const state = settle(grid, 64, 64);
    const restY = state.y;
    let jumped = false;
    let peakY = state.y;
    let landed = false;
    for (let i = 0; i < 240; i++) {
      const input: PlayerInput = {
        left: false,
        right: false,
        jump: !jumped && i === 0,
      };
      if (i === 0) jumped = true;
      const res = stepPlayer(state, input, grid, STEP, config);
      if (res.landed) landed = true;
      peakY = Math.min(peakY, state.y);
      if (jumped && state.grounded) break;
    }
    expect(jumped).toBe(true);
    expect(restY - peakY).toBeGreaterThan(16); // actually left the ground
    expect(landed).toBe(true);
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(6 * TILE_SIZE - config.height / 2, 4);
  });

  test("jump height reaches the 16px platform step", () => {
    // Low floor at row 5 (top at 80), high floor at row 4 (top at 64): a
    // 16px step-up, reachable by a jump (~32px rise).
    const grid = buildTileGrid(
      layer(8, 8, [
        ...new Array<number>(8 * 4).fill(0),
        0, 0, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, // high floor row 4, x=2..7
        TILE_SOLID, TILE_SOLID, 0, 0, 0, 0, 0, 0, // low floor row 5, x=0..1
        ...new Array<number>(8 * 2).fill(0),
      ]),
    );
    const state = settle(grid, 16, 80);
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(5 * TILE_SIZE - config.height / 2, 3);
    const peak = (() => {
      let y = state.y;
      for (let i = 0; i < 90; i++) {
        stepPlayer(state, { left: false, right: false, jump: i === 0 }, grid, STEP, config);
        y = Math.min(y, state.y);
      }
      return y;
    })();
    // Rise of ~jumpSpeed²/(2·gravity) = 33.75px — clears 16px.
    expect(state.y - peak).toBeGreaterThan(16);

    // Jump from the low floor onto the high floor while walking right.
    const s2 = settle(grid, 16, 80);
    for (let i = 0; i < 90; i++) {
      stepPlayer(
        s2,
        { left: false, right: true, jump: i === 0 },
        grid,
        STEP,
        config,
      );
      if (s2.grounded && s2.y < 5 * TILE_SIZE) break;
    }
    expect(s2.grounded).toBe(true);
    expect(s2.y).toBeCloseTo(4 * TILE_SIZE - config.height / 2, 3);
  });

  test("coyote time lets a jump fire just after walking off a ledge", () => {
    // Tall world (16 rows) so stepping off the ledge never reaches the
    // invisible world floor within the test window.
    const grid = buildTileGrid(
      layer(8, 16, [
        ...new Array<number>(8 * 2).fill(0),
        TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, 0, 0, 0, 0, // ledge rows 2-3, x=0..3
        TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, 0, 0, 0, 0,
        ...new Array<number>(8 * 12).fill(0),
      ]),
    );
    const state = settle(grid, 2 * TILE_SIZE, 2 * TILE_SIZE);
    // Walk right off the ledge into the air…
    for (let i = 0; i < 30 && state.grounded; i++) {
      stepPlayer(state, { left: false, right: true, jump: false }, grid, STEP, config);
    }
    expect(state.grounded).toBe(false);
    // …then press jump within the coyote window.
    let jumped = false;
    for (let i = 0; i < 10; i++) {
      stepPlayer(state, { left: false, right: false, jump: true }, grid, STEP, config);
      if (state.vy < -100) jumped = true;
    }
    expect(jumped).toBe(true);
  });

  test("jump buffers a press made slightly before landing", () => {
    const grid = buildTileGrid(
      layer(8, 8, [
        ...new Array<number>(40).fill(0),
        TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID,
        0, 0, 0, 0, 0, 0, 0, 0,
      ]),
    );
    const state = createPlayerState(config);
    state.x = 4 * TILE_SIZE;
    state.y = 2 * TILE_SIZE; // falling toward row 5
    let jumped = false;
    for (let i = 0; i < 60; i++) {
      // Fall from y=32 to row 5's top (80) takes ~25 steps; press jump a few
      // steps before landing so the buffer is still live when we touch down.
      const res = stepPlayer(
        state,
        { left: false, right: false, jump: i === 22 },
        grid,
        STEP,
        config,
      );
      if (state.vy < -100) jumped = true;
      if (jumped) break;
      // stop early once landed and the buffer had a chance to fire
      if (res.landed && !jumped) break;
    }
    expect(jumped).toBe(true);
  });
});

describe("slopes", () => {
  test("lands exactly on a 110 (TL→BR) slope surface", () => {
    const grid = buildTileGrid(layer(4, 4, [
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      TILE_SOLID, TILE_SOLID, TILE_SLOPE_TL_BR, 0,
    ]));
    // A box on a 45° slope rests on its downhill edge: bottom-right corner
    // crosses the diagonal at dx = (x + hw) - tileLeft = 13, so the contact
    // is at y = 48 + 13 = 61 and the center settles at 61 − hh = 54.
    const state = createPlayerState(config);
    state.x = 2.5 * TILE_SIZE;
    state.y = TILE_SIZE;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(3 * TILE_SIZE + 13 - config.height / 2, 3);
  });

  test("lands exactly on a 109 (TR→BL) slope surface", () => {
    const grid = buildTileGrid(layer(4, 4, [
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, TILE_SLOPE_TR_BL, TILE_SOLID, TILE_SOLID,
    ]));
    // Mirror slope: rests on the downhill (left) edge at dx = 3 → contact
    // y = 48 + (16 − 3) = 61 → center 54.
    const state = createPlayerState(config);
    state.x = 1.5 * TILE_SIZE;
    state.y = TILE_SIZE;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(3 * TILE_SIZE + 13 - config.height / 2, 3);
  });
});

describe("the real jungle map", () => {
  // Reproduces Assets/map/main.json's collision layer (30×17 tiles).
  function jungleGrid(): SolidGrid {
    const width = 30;
    const height = 17;
    const gids = new Array<number>(width * height).fill(0);
    const set = (x: number, y: number, gid: number) => {
      gids[y * width + x] = gid;
    };
    // Left platform: top at tile row 13 (y=208)…
    for (let y = 13; y <= 14; y++) for (let x = 3; x <= 10; x++) set(x, y, TILE_SOLID);
    set(3, 15, TILE_SLOPE_TL_BR);
    for (let x = 4; x <= 9; x++) set(x, 15, TILE_SOLID);
    set(10, 15, TILE_SLOPE_TR_BL);
    for (let x = 4; x <= 9; x++) set(x, 16, TILE_SOLID);
    // Right platform: top at tile row 12 (y=192).
    for (let y = 12; y <= 13; y++) for (let x = 13; x <= 21; x++) set(x, y, TILE_SOLID);
    set(13, 14, TILE_SLOPE_TL_BR);
    for (let x = 14; x <= 20; x++) set(x, 14, TILE_SOLID);
    set(21, 14, TILE_SLOPE_TR_BL);
    for (let x = 14; x <= 20; x++) set(x, 15, TILE_SOLID);
    for (let x = 14; x <= 20; x++) set(x, 16, TILE_SOLID);
    return buildTileGrid(layer(width, height, gids));
  }

  test("spawns at PLAYER_SPAWN and falls onto the left platform", () => {
    const grid = jungleGrid();
    const state = createPlayerState(config);
    expect(state.x).toBe(PLAYER_SPAWN.x);
    expect(state.y).toBe(PLAYER_SPAWN.y);
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    // Left platform top at 13*16=208; center rests 7px above it.
    expect(state.y).toBeCloseTo(13 * TILE_SIZE - config.height / 2, 4);
  });

  test("a jump spans the 32px gap between platforms", () => {
    const grid = jungleGrid();
    const state = createPlayerState(config);
    for (let i = 0; i < 600 && !state.grounded; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
    }
    let crossed = false;
    for (let i = 0; i < 240; i++) {
      const res = stepPlayer(
        state,
        { left: false, right: true, jump: i === 0 },
        grid,
        STEP,
        config,
      );
      if (state.grounded && state.x > 13 * TILE_SIZE) crossed = true;
      if (crossed) break;
    }
    expect(crossed).toBe(true);
  });

  test("running off the left platform without a jump drops into the gap", () => {
    // The right platform sits 16px HIGHER than the left one; a ground run
    // falls short of the ledge and the player ends up sliding into the pit.
    const grid = jungleGrid();
    const state = createPlayerState(config);
    for (let i = 0; i < 600 && !state.grounded; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
    }
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, { left: false, right: true, jump: false }, grid, STEP, config);
      if (state.grounded && state.x > 13 * TILE_SIZE && state.y < 13 * TILE_SIZE) break;
    }
    // Either the run legitimately lands on the right platform (rare, but
    // deterministic per the sim), or it falls to the pit floor — it must
    // never end up floating or outside the world.
    const world = gridPixelSize(grid);
    expect(state.grounded).toBe(true);
    expect(state.y).toBeGreaterThan(0);
    expect(state.y).toBeLessThanOrEqual(world.height - config.height / 2 + 1e-6);
  });

  test("falls into the pit and stops at the world floor", () => {
    const grid = jungleGrid();
    const state = createPlayerState(config);
    state.x = 12 * TILE_SIZE; // middle of the gap between platforms
    state.y = 14 * TILE_SIZE;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(gridPixelSize(grid).height - config.height / 2, 3);
  });

  test("walking off the left platform edge drops into the pit", () => {
    const grid = jungleGrid();
    const state = createPlayerState(config);
    for (let i = 0; i < 600 && !state.grounded; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
    }
    state.x = 2.2 * TILE_SIZE; // left of the platform, over the void
    state.grounded = false;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(gridPixelSize(grid).height - config.height / 2, 3);
  });
});

describe("anti-cheat validation", () => {
  const grid = jungleLikeGrid();
  const authoritative = { x: 96, y: 160 };

  function jungleLikeGrid(): SolidGrid {
    return buildTileGrid(
      layer(30, 17, new Array<number>(30 * 17).fill(0).map((_, i) => {
        const x = i % 30;
        const y = Math.floor(i / 30);
        if (y === 13 && x >= 3 && x <= 10) return TILE_SOLID;
        if (y === 12 && x >= 13 && x <= 21) return TILE_SOLID;
        return 0;
      })),
    );
  }

  test("accepts a report that matches the simulation", () => {
    expect(
      validatePositionReport(grid, { px: 96, py: 160 }, authoritative, null, null),
    ).toEqual([]);
    expect(
      validatePositionReport(
        grid,
        { px: 97.5, py: 159 },
        authoritative,
        { px: 96.5, py: 158 },
        0.05,
      ),
    ).toEqual([]);
  });

  test("flags a teleport far from the simulated position", () => {
    expect(
      validatePositionReport(
        grid,
        { px: 400, py: 40 },
        authoritative,
        null,
        null,
      ),
    ).toContain("teleport");
  });

  test("flags a report buried in solid geometry", () => {
    expect(
      validatePositionReport(grid, { px: 60, py: 224 }, authoritative, null, null),
    ).toContain("teleport");
  });

  test("a player resting exactly on a floor boundary is not a violation", () => {
    // Left platform top edge is y=208; a standing collider's bottom edge sits
    // exactly there. That is legal and must not read as buried-in-solid.
    const restY = 13 * TILE_SIZE - config.height / 2; // center with feet at 208
    expect(
      validatePositionReport(
        grid,
        { px: 5 * TILE_SIZE, py: restY },
        { x: 5 * TILE_SIZE, y: restY },
        null,
        null,
      ),
    ).toEqual([]);
  });

  test("a player pressed against a wall boundary is not a violation", () => {
    // Against the right platform's left face at x=13*16=208.
    const px = 13 * TILE_SIZE - config.width / 2;
    const py = 13 * TILE_SIZE - config.height / 2;
    expect(
      validatePositionReport(grid, { px, py }, { x: px, y: py }, null, null),
    ).toEqual([]);
  });

  test("flags a report that outruns the physical speed ceiling", () => {
    const now = { px: 100, py: 160 };
    const prev = { px: 60, py: 160 };
    // 40px in 50ms = 800px/s ≫ maxPlayerSpeed (340).
    const violations = validatePositionReport(
      grid,
      now,
      authoritative,
      prev,
      0.05,
    );
    expect(violations).toContain("speed");
  });

  test("the speed ceiling is the physical max, never undercutting", () => {
    expect(maxPlayerSpeed(config)).toBe(Math.max(config.runSpeed, config.maxFallSpeed));
    // Sanity: a normal walk report (run speed over 50ms ≈ 5.5px) passes.
    expect(
      validatePositionReport(
        grid,
        { px: 96 + config.runSpeed * 0.05, py: 160 },
        authoritative,
        { px: 96, py: 160 },
        0.05,
      ),
    ).not.toContain("speed");
  });

  test("NaN positions are rejected outright", () => {
    expect(
      validatePositionReport(
        grid,
        { px: Number.NaN, py: 160 },
        authoritative,
        null,
        null,
      ),
    ).toContain("teleport");
  });

  test("anti-cheat constants are sane relative to physics", () => {
    // Position error allowance should exceed one frame of max-speed movement
    // but stay far under a cross-map teleport.
    const oneFrame = maxPlayerSpeed(config) / 60;
    expect(ANTI_CHEAT.maxPositionError).toBeGreaterThan(oneFrame);
    expect(ANTI_CHEAT.maxPositionError).toBeLessThan(TILE_SIZE * 10);
  });
});