/**
 * Physics + collision verification for `@monkeyluka/shared`. Run from the
 * repo root with `bun test` (Bun's built-in runner), or from this workspace
 * with `bun test packages/shared/src/physics.test.ts`. These keep the shared
 * simulation honest: the server's anti-cheat is only as good as this math.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANTI_CHEAT,
  DEFAULT_PLAYER_PHYSICS,
  DOOR_TILE_GIDS,
  INTERACTION_TILE_ACTIONS,
  PLAYER_SPAWN,
  TILE_DOOR_BOTTOM_LEFT,
  TILE_DOOR_BOTTOM_RIGHT,
  TILE_DOOR_TOP_LEFT,
  TILE_DOOR_TOP_RIGHT,
  TILE_INTERACTION,
  TILE_SIZE,
  TILE_DEAD_ZONE,
  TILE_DOOR,
  TILE_SLOPE_BR,
  TILE_SLOPE_SHALLOW,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
  TILE_STAIRS,
  buildDoorEntities,
  buildInteractionGrid,
  buildTileGrid,
  createPlayerState,
  gridPixelSize,
  grabableWallBeside,
  interactionActionForGid,
  interactionTileUnderFeet,
  isBoxInDeadZone,
  isBoxSolid,
  isDoorTileGid,
  isInteractionTileGid,
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
      layer(8, 1, [
        0, TILE_SOLID, TILE_SLOPE_TL_BR, TILE_SLOPE_TR_BL, TILE_SLOPE_BR,
        TILE_STAIRS, 65, 315,
      ]),
    );
    expect(grid.kinds[0]).toBe(0);
    expect(grid.kinds[1]).toBe(TILE_SOLID);
    expect(grid.kinds[2]).toBe(TILE_SLOPE_TL_BR);
    expect(grid.kinds[3]).toBe(TILE_SLOPE_TR_BL);
    expect(grid.kinds[4]).toBe(TILE_SLOPE_BR);
    expect(grid.kinds[5]).toBe(TILE_STAIRS);
    // 65 is a plain full block in the tileset — it folds into TILE_SOLID
    // (the penetration code treats every non-57 kind as a slope, so the
    // grid must not carry a second solid kind).
    expect(grid.kinds[6]).toBe(TILE_SOLID);
    // 315 also appears in layer1 but is not a collision tile — ignored.
    expect(grid.kinds[7]).toBe(0);
  });

  test("point solidity respects the exact slope halves", () => {
    const grid = buildTileGrid(
      layer(3, 1, [TILE_SLOPE_TL_BR, TILE_SLOPE_TR_BL, TILE_SLOPE_BR]),
    );
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
    // 262 at (2,0): solid where dx + dy >= 16 (bottom-right half, mirror of 109).
    expect(isPointSolid(grid, 32 + 12, 12)).toBe(true); // 24 >= 16
    expect(isPointSolid(grid, 32 + 4, 4)).toBe(false); // 8 < 16, open
    expect(isPointSolid(grid, 32 + 15, 1)).toBe(true); // 16 >= 16, on the line
    expect(isPointSolid(grid, 32 + 1, 15)).toBe(true); // 16 >= 16, on the line
  });

  test("box solidity reports overlap with slopes and blocks", () => {
    const grid = buildTileGrid(layer(2, 1, [0, TILE_SOLID]));
    expect(isBoxSolid(grid, 24, 8, 10, 14)).toBe(true); // into tile 1
    expect(isBoxSolid(grid, 8, 8, 10, 14)).toBe(false);

    // A box fully inside 262's solid half touches it; a box tucked into the
    // open top-left corner does not.
    const wedge = buildTileGrid(layer(2, 2, [0, 0, 0, TILE_SLOPE_BR]));
    expect(isBoxSolid(wedge, 24, 24, 10, 10)).toBe(true); // dx+d∈[3,13]: corner 26 ≥ 16
    expect(isBoxSolid(wedge, 17, 17, 4, 4)).toBe(false); // corner 3+3 < 16
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
    // Start near the ledge's right edge (3*16=48; the ledge ends at 4*16=64)
    // so the 30-frame walk runs off it before the loop guard sees a hang.
    const state = settle(grid, 3 * TILE_SIZE, 2 * TILE_SIZE);
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
  test("lands on the flat lip of a 110 (TL→BR) slope, not the hypotenuse", () => {
    const grid = buildTileGrid(layer(4, 4, [
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      TILE_SOLID, TILE_SOLID, TILE_SLOPE_TL_BR, 0,
    ]));
    // 110's solid is the bracket ABOVE the TL→BR line, whose top edge is
    // solid across the whole cell — a falling box contacts that flat lip
    // before the hypotenuse and rests on it like a solid tile's top
    // (bottom = cell top, center = 3*16 − 7 = 41).
    const state = createPlayerState(config);
    state.x = 2.5 * TILE_SIZE;
    state.y = TILE_SIZE;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(3 * TILE_SIZE - config.height / 2, 3);
  });

  test("lands on the flat lip of a 109 (TR→BL) slope, not the hypotenuse", () => {
    const grid = buildTileGrid(layer(4, 4, [
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, TILE_SLOPE_TR_BL, TILE_SOLID, TILE_SOLID,
    ]));
    // Same flat-lip landing as 110: 109's solid is also the bracket above
    // the line with a fully-solid top edge → bottom = cell top.
    const state = createPlayerState(config);
    state.x = 1.5 * TILE_SIZE;
    state.y = TILE_SIZE;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(3 * TILE_SIZE - config.height / 2, 3);
  });

  test("lands on the 262 (TR→BL, bottom-right) wedge surface", () => {
    const grid = buildTileGrid(layer(4, 4, [
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      TILE_SOLID, TILE_SOLID, TILE_SLOPE_BR, 0,
    ]));
    // 262's solid hangs BELOW the line, so its landing surface IS the line.
    // A resting box binds at the line's shallowest point under its span —
    // its bottom-right corner: right edge at 2.5*16+6.5 = 46.5 → edgeMax
    // = 14.5 → bottom = 48 + (16 − 14.5) = 49.5 → center 42.5. (Sampling
    // the deepest point instead left the box 13px buried in the wedge.)
    const state = createPlayerState(config);
    state.x = 2.5 * TILE_SIZE;
    state.y = TILE_SIZE;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(
      3 * TILE_SIZE + (TILE_SIZE - 14.5) - config.height / 2,
      3,
    );
  });
});

describe("shallow ramp (287, 2:1)", () => {
  test("point solidity respects the bottom-aligned line (dx + 2·dy ≥ 32)", () => {
    const grid = buildTileGrid(layer(1, 1, [TILE_SLOPE_SHALLOW]));
    // Solid below the line from the bottom-left corner (0, 16) to the
    // right edge's midpoint (16, 8) — the ramp sits flush on the cell's
    // bottom edge, and the right column below the apex is the solid back
    // side. Open above the face (the old model mirrored this shape into
    // the top half: solid from (0, 8) to (16, 0)).
    expect(isPointSolid(grid, 0.4, 15.8)).toBe(true); // left base, on the line near the bottom edge
    expect(isPointSolid(grid, 15.9, 8.05)).toBe(true); // near the apex
    expect(isPointSolid(grid, 8, 12)).toBe(true); // mid-span on the line
    expect(isPointSolid(grid, 2, 15)).toBe(true); // 2 + 30 = 32 ≥ 32, on the line
    expect(isPointSolid(grid, 2, 14)).toBe(false); // 30 < 32, open above the face
    expect(isPointSolid(grid, 0, 15)).toBe(false); // above the left base
    expect(isPointSolid(grid, 15, 9)).toBe(true); // back side below the apex
    expect(isPointSolid(grid, 15, 6)).toBe(false); // above the apex: the top-right corner is open
    expect(isPointSolid(grid, 8, 4)).toBe(false); // 8 + 8 = 16 < 32 — the old mirror's top is gone
    expect(isPointSolid(grid, 3, 12)).toBe(false); // 27 < 32 — solid under the old model, open now
    expect(isPointSolid(grid, 12, 14)).toBe(true); // deep, solid
  });

  test("box solidity reports touches with the bottom-aligned wedge", () => {
    const grid = buildTileGrid(layer(1, 1, [TILE_SLOPE_SHALLOW]));
    // The solid is below the line dx + 2·dy = 32, maximized at the
    // overlap's bottom-right corner (ox1, oy1): reachable iff it is solid.
    expect(isBoxSolid(grid, 16, 12, 10, 10)).toBe(true); // deep right side
    expect(isBoxSolid(grid, 2, 2, 4, 4)).toBe(false); // tucked open top-left
    expect(isBoxSolid(grid, 14, 3, 4, 4)).toBe(false); // over the apex — open where the old mirror was solid
    expect(isBoxSolid(grid, 4, 12, 6, 6)).toBe(true); // low band is solid
  });

  test("lands on the 2:1 ramp surface, not the cell's flat top", () => {
    // 287 at (2,2), sitting flush on a solid floor (row 3) so the mass is
    // closed: the face runs from the cell's bottom-left corner (32, 48) to
    // the right edge's midpoint (48, 40). There is no flat lip — a falling
    // box rests on the line itself.
    const grid = buildTileGrid(layer(4, 4, [
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, TILE_SLOPE_SHALLOW, 0,
      TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID,
    ]));
    const state = createPlayerState(config);
    state.x = 2.5 * TILE_SIZE;
    state.y = TILE_SIZE;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    // Binds the line at its shallowest point under the span (the right
    // edge, dx = 14.5): bottom = 32 + (16 − 14.5/2) = 40.75 → center 33.75.
    expect(state.y).toBeCloseTo(
      2 * TILE_SIZE + (TILE_SIZE - 14.5 / 2) - config.height / 2,
      1,
    );
  });

  test("a floor-level walker steps straight onto the ramp at its flush foot", () => {
    // Ramp at (2,2) on a solid floor (row 3). Its base now sits FLUSH on
    // the floor (the face starts at the cell's bottom-left corner, 32,48),
    // so a grounded walker walking right from the floor is lifted onto the
    // ramp immediately — the old shape floated the base 8px above the
    // floor, so the same walker was wall-blocked at an invisible face
    // (that regression test is gone with the shape).
    const gids = new Array<number>(8 * 4).fill(0);
    gids[2 * 8 + 2] = TILE_SLOPE_SHALLOW;
    for (let x = 0; x < 8; x++) gids[3 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 4, gids));
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE - 2; // on the floor, just left of the foot
    state.y = 3 * TILE_SIZE - config.height / 2; // feet on the floor (48)
    state.grounded = true;
    state.vy = 0;
    const floorY = state.y;
    // A few steps: it must already be riding the face (feet above the
    // floor), never blocked at the invisible old face.
    let climbed = false;
    for (let i = 0; i < 12; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      if (state.y + config.height / 2 < floorY + config.height / 2 - 0.5) {
        climbed = true;
      }
    }
    expect(climbed).toBe(true);
    expect(state.grounded).toBe(true);
    expect(state.x).toBeGreaterThan(2 * TILE_SIZE);
  });

  test("walks up the 287 ramp from the floor to the apex without violations", () => {
    // Same layout: ramp at (2,2) on a closed floor (row 3). A grounded
    // walker crosses the flush foot and rides the 2:1 face up to the apex
    // (48, 40) — every report must pass anti-cheat (the old shape's
    // floating face buried the walker and tripped the teleport check).
    const gids = new Array<number>(8 * 4).fill(0);
    gids[2 * 8 + 2] = TILE_SLOPE_SHALLOW;
    for (let x = 0; x < 8; x++) gids[3 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 4, gids));
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE - 2;
    state.y = 3 * TILE_SIZE - config.height / 2; // feet on the floor (48)
    state.grounded = true;
    state.vy = 0;
    const violations: string[] = [];
    let lastValid = { x: state.x, y: state.y };
    for (let i = 0; i < 400; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      if (i % 3 === 0) {
        const v = validatePositionReport(
          grid,
          { px: state.x, py: state.y },
          lastValid,
          { px: lastValid.x, py: lastValid.y },
          3 / 60,
          config,
        );
        if (v.length) violations.push(`s${i}:${v.join("+")}`);
        lastValid = { x: state.x, y: state.y };
      }
      if (state.x > 3 * TILE_SIZE - config.width / 2) break; // at the apex
    }
    expect(violations).toEqual([]);
    expect(state.grounded).toBe(true);
    // It left the floor and now rides the face near the apex (feet ≈ 40).
    expect(state.y).toBeCloseTo(
      2 * TILE_SIZE + (TILE_SIZE - config.width / 2 - 1 - 0.5) - config.height / 2,
      0,
    );
  });

  test("a box below the apex on the right is wall-blocked by the back side", () => {
    // The right column below the apex (dx = 16, dy ≥ 8) is solid. A box
    // standing on the floor to the right of the ramp cannot walk left
    // through it: the ramp's base row is solid the whole way across (the
    // face is flush with the bottom edge), so a ground-level box meets the
    // tile's right face as a wall.
    const gids = new Array<number>(8 * 4).fill(0);
    gids[2 * 8 + 2] = TILE_SLOPE_SHALLOW;
    for (let x = 0; x < 8; x++) gids[3 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 4, gids));
    const state = createPlayerState(config);
    state.x = 3 * TILE_SIZE + 8; // right of the ramp, on the floor
    state.y = 3 * TILE_SIZE - config.height / 2; // feet on the floor (48)
    state.grounded = true;
    state.vy = 0;
    for (let i = 0; i < 240; i++) {
      stepPlayer(
        state,
        { left: true, right: false, jump: false },
        grid,
        STEP,
        config,
      );
    }
    expect(state.grounded).toBe(true);
    // Never entered the ramp's cell at floor level — its left edge stays
    // at the tile's right face (x = 48), so the center is ≥ 48 + w/2 − 1.
    expect(state.x).toBeGreaterThanOrEqual(3 * TILE_SIZE - config.width / 2 - 1);
  });

  test("a rising box under the ramp hits the flat underside, not the face", () => {
    // 287 floating at (2,1) with open air below: the wedge fills the cell
    // down to its bottom edge at every column, so the underside is a flat
    // ceiling at y = 2·16·… = 32, even under the ramp's shallow left wing.
    const grid = buildTileGrid(layer(4, 3, [
      0, 0, 0, 0,
      0, 0, TILE_SLOPE_SHALLOW, 0,
      0, 0, 0, 0,
    ]));
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 2; // under the shallow left wing (dx ≈ 2)
    state.y = 2.5 * TILE_SIZE; // below the tile, rising
    state.vy = -config.jumpSpeed / 2; // moving up, half a jump
    let minHead = Infinity;
    for (let i = 0; i < 30; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      minHead = Math.min(minHead, state.y - config.height / 2);
    }
    // The flat underside (y = 32) bounces the head back — it must never
    // tunnel past the cell bottom, and it must have reached it. Once
    // stopped (vy = 0) gravity pulls the box back down, so it does not stay
    // pinned.
    expect(minHead).toBeGreaterThanOrEqual(2 * TILE_SIZE - 0.05);
    expect(minHead).toBeLessThanOrEqual(2 * TILE_SIZE + 0.05);
  });
});

describe("staircase tile (288, 2:1 steps)", () => {
  test("point solidity matches the pixel mask", () => {
    const grid = buildTileGrid(layer(1, 1, [TILE_STAIRS]));
    // Eight 2px-wide treads step down from the top-right (cols 14-15, row
    // 0) to the bottom-left (cols 0-1, row 7); col 15 is a full-height
    // right wall, col 0 a wall from row 7 down, row 15 the full base; the
    // interior between the treads and the base is open.
    expect(isPointSolid(grid, 0.4, 0.4)).toBe(false); // open top-left
    expect(isPointSolid(grid, 14.5, 0.4)).toBe(true); // top tread
    expect(isPointSolid(grid, 14.5, 1.5)).toBe(false); // under the top tread (open)
    expect(isPointSolid(grid, 12.5, 1.5)).toBe(true); // second tread
    expect(isPointSolid(grid, 12.5, 2.5)).toBe(false); // under it
    expect(isPointSolid(grid, 0.5, 7.5)).toBe(true); // leftmost tread
    expect(isPointSolid(grid, 0.5, 6.5)).toBe(false); // above it
    expect(isPointSolid(grid, 8, 12)).toBe(false); // hollow interior
    expect(isPointSolid(grid, 15.5, 12)).toBe(true); // right wall
    expect(isPointSolid(grid, 0.5, 12)).toBe(true); // left wall
    expect(isPointSolid(grid, 8, 15.5)).toBe(true); // base row
  });

  test("box solidity reads the mask: walls/treads solid, hollow open", () => {
    const grid = buildTileGrid(layer(1, 1, [TILE_STAIRS]));
    expect(isBoxSolid(grid, 0.5, 11, 3, 6)).toBe(true); // left wall (col 0, rows 8-14)
    expect(isBoxSolid(grid, 15.5, 11, 3, 6)).toBe(true); // right wall (col 15)
    expect(isBoxSolid(grid, 8, 11, 8, 4)).toBe(false); // hollow interior
    expect(isBoxSolid(grid, 14.5, 0.5, 3, 1)).toBe(true); // top tread
    expect(isBoxSolid(grid, 1, 0.5, 3, 1)).toBe(false); // open top-left
  });

  test("lands on the staircase, binding the topmost tread under the span", () => {
    // 288 at (2,1) floating in open air: the box drops onto the steps and
    // rests on the shallowest tread under its span — its rightmost column
    // (the same ride-on-the-leading-corner rule as 262/287).
    const gids = new Array<number>(8 * 3).fill(0);
    gids[1 * 8 + 2] = TILE_STAIRS;
    const grid = buildTileGrid(layer(8, 3, gids));

    // Right edge at 46.5 → cell dx 14.5 → topRow(14) = 0 → bottom = cell
    // top (16) → center 9 (flush on the top tread).
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 8;
    state.y = TILE_SIZE;
    for (let i = 0; i < 900; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(TILE_SIZE - config.height / 2, 3);
  });

  test("a walker climbs the full staircase from foot to top without violations", () => {
    // 288 at (2,1) with open air around it; the walker starts on the
    // leftmost tread (bottom = top + topRow(0) = 23) and rides the 2px
    // treads up to the top (bottom = 16). Every report must pass.
    const grid = buildTileGrid(
      layer(6, 3, [0, 0, 0, 0, 0, 0, 0, 0, TILE_STAIRS, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 4;
    state.y = TILE_SIZE + 7 - config.height / 2;
    state.grounded = true;
    state.vy = 0;
    const violations: string[] = [];
    let lastValid = { x: state.x, y: state.y };
    let minBottom = state.y + config.height / 2;
    for (let i = 0; i < 300; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      minBottom = Math.min(minBottom, state.y + config.height / 2);
      if (i % 3 === 0) {
        const v = validatePositionReport(
          grid,
          { px: state.x, py: state.y },
          lastValid,
          { px: lastValid.x, py: lastValid.y },
          3 / 60,
          config,
        );
        if (v.length) violations.push(`s${i}:${v.join("+")}`);
        lastValid = { x: state.x, y: state.y };
      }
      if (state.x + config.width / 2 > 3 * TILE_SIZE) break; // right edge off the tile
    }
    expect(violations).toEqual([]);
    expect(state.grounded).toBe(true);
    // It climbed from the left foot (bottom 23) to the top tread (bottom 16).
    expect(minBottom).toBeLessThanOrEqual(TILE_SIZE + 0.05);
    expect(minBottom).toBeGreaterThan(TILE_SIZE - 1);
  });

  test("a floor-level box is wall-blocked by the left limb, never hoisted", () => {
    // 288 at (2,1) directly above a solid floor (row 2). The base row is
    // solid, so a box on the floor cannot walk under the tile; its left
    // limb (col 0, rows 7-15) blocks a box pushing in at floor level —
    // and the box must not be hoisted 9px onto the steps (no flush foot:
    // the lowest tread top is 1px above the cell's bottom edge).
    const gids = new Array<number>(8 * 3).fill(0);
    gids[1 * 8 + 2] = TILE_STAIRS;
    for (let x = 0; x < 8; x++) gids[2 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 3, gids));
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE - 2;
    state.y = 2 * TILE_SIZE - config.height / 2; // feet on the floor (32)
    state.grounded = true;
    state.vy = 0;
    const floorY = state.y;
    for (let i = 0; i < 120; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      // Never lifted off the floor, never passed the tile's left face.
      expect(state.y).toBeLessThanOrEqual(floorY + 1e-6);
    }
    expect(state.grounded).toBe(true);
    expect(state.x).toBeLessThanOrEqual(2 * TILE_SIZE - config.width / 2 + 0.5);
  });

  test("a rising box under the staircase hits the flat underside, not a tread", () => {
    // 288 floating at (2,1) with open air below: the base row is solid at
    // every column, so the underside is a flat ceiling at the cell's
    // bottom edge — even over the hollow interior.
    const grid = buildTileGrid(
      layer(4, 3, [0, 0, 0, 0, 0, 0, TILE_STAIRS, 0, 0, 0, 0, 0]),
    );
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 6; // under the hollow interior
    state.y = 2.5 * TILE_SIZE; // below the tile, rising
    state.vy = -config.jumpSpeed / 2;
    let minHead = Infinity;
    for (let i = 0; i < 30; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      minHead = Math.min(minHead, state.y - config.height / 2);
    }
    expect(minHead).toBeGreaterThanOrEqual(2 * TILE_SIZE - 0.05);
    expect(minHead).toBeLessThanOrEqual(2 * TILE_SIZE + 0.05);
  });
});

describe("dead zone tile (464, hazard pit)", () => {
  test("point solidity matches the pixel mask", () => {
    const grid = buildTileGrid(layer(1, 1, [TILE_DEAD_ZONE]));
    // Rows 0-12 are the open mouth + interior of the basin; rows 13-15 the
    // fully solid base. No rim lips or side walls: the pit is a hole.
    expect(isPointSolid(grid, 0.4, 0.4)).toBe(false); // open at the mouth
    expect(isPointSolid(grid, 0.4, 6)).toBe(false); // open interior
    expect(isPointSolid(grid, 8, 12)).toBe(false); // still open above the base
    expect(isPointSolid(grid, 8, 13.5)).toBe(true); // base row
    expect(isPointSolid(grid, 0.4, 15.5)).toBe(true); // base at the lip column too
    expect(isPointSolid(grid, 15.5, 14.5)).toBe(true); // base at the right edge
  });

  test("isBoxInDeadZone only fires for 464 cells, over their solid pixels", () => {
    const gids = new Array<number>(4 * 2).fill(0);
    gids[1] = TILE_DEAD_ZONE; // (1,0)
    gids[2 * 4 + 2] = TILE_SOLID; // (2,1) — ordinary floor, not a hazard
    const grid = buildTileGrid(layer(4, 2, gids));
    // Inside the pit (over the base) → touching.
    expect(isBoxInDeadZone(grid, 1 * TILE_SIZE + 8, 12, 10, 10)).toBe(true);
    // Floating in the open mouth (nothing solid below yet) → not touching.
    expect(isBoxInDeadZone(grid, 1 * TILE_SIZE + 8, 6, 6, 4)).toBe(false);
    // Over the ordinary 57 floor → never a dead zone.
    expect(isBoxInDeadZone(grid, 2 * TILE_SIZE + 8, 28, 10, 10)).toBe(false);
    // Empty cell → not a dead zone.
    expect(isBoxInDeadZone(grid, 0, 0, 10, 10)).toBe(false);
  });

  test("a player at rest on the basin floor IS in the dead zone (flush-bottom bug)", () => {
    // Regression for the never-firing touch probe: `stepPlayer` resolves a
    // fall in the pit to a resting pose whose bottom edge is exactly flush
    // with the base top (dyBottom == DEAD_ZONE_BASE_ROW), and the pixel-mask
    // overlap rect ends AT that row without entering it — so the bare mask
    // probe returned false for every real 13x14 player and the checkpoint
    // return gated by it never triggered. The probe grants a 1px support
    // allowance: the flush resting pose, and a body hovering up to 1px above
    // the floor, must both read as touching the pit.
    const gids = new Array<number>(8 * 3).fill(0);
    gids[1 * 8 + 2] = TILE_DEAD_ZONE;
    const grid = buildTileGrid(layer(8, 3, gids));
    // Feet flush on the base (center y = 16+13−h/2, the same pose as the
    // anti-cheat validation test) → touching.
    expect(
      isBoxInDeadZone(
        grid,
        2 * TILE_SIZE + 8,
        1 * TILE_SIZE + 13 - config.height / 2,
        config.width,
        config.height,
      ),
    ).toBe(true);
    // The same pose on an ordinary 57 floor beside the pit → never a hazard.
    gids[1 * 8 + 1] = TILE_SOLID;
    expect(
      isBoxInDeadZone(
        grid,
        1 * TILE_SIZE + 4,
        1 * TILE_SIZE + 13 - config.height / 2,
        config.width,
        config.height,
      ),
    ).toBe(false);
    // The full sim: walk off a floor into the pit, rest, probe reads true.
    const state = createPlayerState(config);
    state.x = 1 * TILE_SIZE + 4; // on the floor, left of the pit
    state.y = 1 * TILE_SIZE - config.height / 2;
    state.grounded = true;
    state.vy = 0;
    for (let i = 0; i < 240; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      // Resting on the basin floor (center y = 16+13−h/2 ≈ 22, vs 9 on the
      // rim floor) — stop before it walks off the far side of the pit cell.
      if (state.grounded && state.y > 1 * TILE_SIZE + 2) break;
    }
    expect(state.grounded).toBe(true);
    expect(
      isBoxInDeadZone(
        grid,
        state.x,
        state.y,
        config.width,
        config.height,
      ),
    ).toBe(true);
  });

  test("a box falling into the pit sinks to the basin floor, not the rim", () => {
    // 464 at (2,1) floating in open air: a falling box drops through the
    // open mouth and rests on the base (row 13, feet at 16+13=29 → center 22).
    const gids = new Array<number>(8 * 3).fill(0);
    gids[1 * 8 + 2] = TILE_DEAD_ZONE;
    const grid = buildTileGrid(layer(8, 3, gids));
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 8;
    state.y = TILE_SIZE;
    for (let i = 0; i < 900; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(
      TILE_SIZE + 13 - config.height / 2,
      3,
    );
  });

  test("a rim-level walker steps into the pit and drops to the basin floor", () => {
    // Solid floor at (1,1), 464 pit at (2,1): walking right at rim level
    // must NOT be wall-blocked by the 1px lip — the box rides it for a
    // frame, then drops into the open interior and lands on the base.
    const gids = new Array<number>(8 * 3).fill(0);
    gids[1 * 8 + 1] = TILE_SOLID;
    gids[1 * 8 + 2] = TILE_DEAD_ZONE;
    const grid = buildTileGrid(layer(8, 3, gids));
    const state = createPlayerState(config);
    state.x = 1 * TILE_SIZE + 4; // on the floor, left of the pit
    state.y = 1 * TILE_SIZE - config.height / 2; // feet on the floor top
    state.grounded = true;
    state.vy = 0;
    let dropped = false;
    for (let i = 0; i < 240; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      // Once the feet leave the floor top, it has dropped into the basin.
      if (state.y + config.height / 2 > 1 * TILE_SIZE + 2) dropped = true;
      if (dropped && state.grounded) break;
    }
    expect(dropped).toBe(true);
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(
      1 * TILE_SIZE + 13 - config.height / 2,
      3,
    );
  });

  test("a body inside the basin is wall-blocked by a solid neighbor — lips never eject it", () => {
    // 464 pit at (2,1) with a solid floor at (3,1) to the right. The box
    // stands on the basin floor, walks right, and must stop at the solid
    // neighbor's face — the 4px rim lips must NOT shove it around (or off
    // the base) just because its head grazes them near a seam.
    const gids = new Array<number>(8 * 3).fill(0);
    gids[1 * 8 + 2] = TILE_DEAD_ZONE;
    gids[1 * 8 + 3] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 3, gids));
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 2; // inside the basin
    state.y = 1 * TILE_SIZE + 13 - config.height / 2; // feet on the base
    state.grounded = true;
    state.vy = 0;
    for (let i = 0; i < 120; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
    }
    // Blocked at the solid floor's left face (x = 48): center 48 − w/2.
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(1 * TILE_SIZE + 13 - config.height / 2, 3);
    expect(state.x).toBeCloseTo(3 * TILE_SIZE - config.width / 2, 2);
  });

  test("standing in the dead zone passes anti-cheat validation", () => {
    const gids = new Array<number>(8 * 3).fill(0);
    gids[1 * 8 + 2] = TILE_DEAD_ZONE;
    const grid = buildTileGrid(layer(8, 3, gids));
    // The box rests on the basin floor; its outline is flush against the
    // base top — the probe points (inset 1px) must all read open air, so a
    // legitimately sunken player is never flagged as buried-in-geometry.
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 8;
    state.y = 1 * TILE_SIZE + 13 - config.height / 2;
    const violations = validatePositionReport(
      grid,
      { px: state.x, py: state.y },
      { x: state.x, y: state.y },
      null,
      null,
      config,
    );
    expect(violations).toEqual([]);
  });
});

describe("the real jungle map", () => {
  // Loads the actual Assets/map/main.json collision layer (60×17 tiles) —
  // the tests exercise the game's real geometry, not an approximation.
  function jungleGrid(): SolidGrid {
    const raw = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "..", "..", "Assets", "map", "main.json"),
        "utf8",
      ),
    ) as {
      layers: Array<{
        name: string;
        width: number;
        height: number;
        data: number[] | string;
      }>;
    };
    const layer1 = raw.layers.find((l) => l.name === "layer1");
    if (!layer1) throw new Error("Assets/map/main.json is missing layer1");
    const gids =
      typeof layer1.data === "string"
        ? layer1.data.split(",").map((v) => Number(v.trim()))
        : layer1.data;
    return buildTileGrid({
      width: layer1.width,
      height: layer1.height,
      gids,
    });
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

  test("a jump from the floor clears the 16px rise onto the ramp", () => {
    // The redesigned map has no same-height platform gap: the left floor
    // (row 13, feet 208) is one tile below the 287/288 ramp runway (row 12,
    // feet 192). From the spawn landing spot a jump with a short run-up
    // must rise onto the ramp — never fall into the pit to its right.
    const grid = jungleGrid();
    const state = createPlayerState(config);
    for (let i = 0; i < 600 && !state.grounded; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
    }
    expect(state.grounded).toBe(true); // floor top at 208
    let onRamp = false;
    for (let i = 0; i < 300; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: i === 12 },
        grid,
        STEP,
        config,
      );
      if (state.grounded && state.x > 6 * TILE_SIZE) {
        onRamp = true;
        break;
      }
    }
    expect(onRamp).toBe(true);
    // It landed on the ramp/runway surface, well above the row-13 floor.
    expect(state.y + config.height / 2).toBeLessThan(13 * TILE_SIZE);
  });

  test("running off the left platform without a jump drops into the gap", () => {
    // A ground run from the spawn crosses the ramp runway and drops off its
    // end into the pit — the sim must never end up floating or outside the
    // world (a pure bounds check; the exact landing spot is not asserted).
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

  test("falls into the pit and stops on the dead-zone basin floor", () => {
    // x=192 drops into the gap between the platforms at cols 13-22; below it
    // sits a TILE_DEAD_ZONE (464) pit at (12,16) — the hazard basin's
    // base (rows 13-15, top at worldHeight−3) catches the fall. The world
    // floor would be at worldHeight, but the dead zone's 3px base (the
    // basin floor) is what stops it.
    const grid = jungleGrid();
    const state = createPlayerState(config);
    state.x = 12 * TILE_SIZE; // middle of the gap between platforms
    state.y = 14 * TILE_SIZE;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(
      gridPixelSize(grid).height - 3 - config.height / 2,
      3,
    );
  });

  test("walking left off the floor's edge drops into the dead-zone pit", () => {
    // The redesigned map's left floor (row 13) runs from x=16 to x=144; the
    // spawn lands mid-floor, so the old “over the void” start no longer
    // exists. Walking left past x=16 falls over the edge into the 464
    // dead-zone pit at cols 0-1 (row 16): the basin's base (top at
    // worldHeight−3) stops the fall, not the world floor.
    const grid = jungleGrid();
    const state = createPlayerState(config);
    for (let i = 0; i < 600 && !state.grounded; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
    }
    let fell = false;
    for (let i = 0; i < 900; i++) {
      stepPlayer(state, { left: true, right: false, jump: false }, grid, STEP, config);
      if (!state.grounded) fell = true;
      if (fell && state.grounded) break;
    }
    expect(fell).toBe(true);
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(
      gridPixelSize(grid).height - 3 - config.height / 2,
      3,
    );
  });

  test("walks the full left section from spawn without tripping the anti-cheat", () => {
    // Regression for the slope kick, re-anchored to the redesigned map:
    // from the actual spawn the walker falls to the row-13 floor, climbs
    // the 287 ramp, the 288 staircase, and the row-12 runway (feet 192)
    // with every movement report passing validation. The old 262 bug (the
    // vertical sampler burying the box under the ramp, reading every report
    // as buried-in-geometry) is exercised here by the same rising motion.
    const grid = jungleGrid();
    const state = createPlayerState(config);
    const violations: string[] = [];
    let lastValid = { x: state.x, y: state.y };
    let nextReport = 3;
    for (let i = 0; i < 900; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      if (i >= nextReport) {
        const v = validatePositionReport(
          grid,
          { px: state.x, py: state.y },
          lastValid,
          { px: lastValid.x, py: lastValid.y },
          3 / 60,
          config,
        );
        if (v.length) violations.push(`s${i}:${v.join("+")}`);
        lastValid = { x: state.x, y: state.y };
        nextReport = i + 3;
      }
      // Up on the runway at col 8 (x > 128) — past the ramp pair.
      if (state.grounded && state.x > 8 * TILE_SIZE + 8) break;
    }
    expect(violations).toEqual([]);
    expect(state.grounded).toBe(true);
    // It climbed from the floor (feet 208) onto the runway top (feet 192).
    expect(state.y + config.height / 2).toBeCloseTo(12 * TILE_SIZE, 2);
    expect(state.x).toBeGreaterThan(8 * TILE_SIZE);
  });

  test("walks up the jungle 287 ramp from the floor without tripping the anti-cheat", () => {
    // The map's 287 at (7,12) (x 112..128) sits on the row-13 floor
    // (y = 208) whose top is the ramp's flush base. Its face runs from the
    // bottom-left corner (112, 208) to the right edge's midpoint (128, 200)
    // — walking right from the floor must climb the ramp (the old
    // top-aligned model floated the foot 8px up, so the walker hit an
    // invisible face at the base) and every report must pass.
    const grid = jungleGrid();
    const state = createPlayerState(config);
    state.x = 7 * TILE_SIZE - 4; // on the floor just left of the foot
    state.y = 13 * TILE_SIZE - config.height / 2; // feet on the floor (208)
    state.grounded = true;
    state.vy = 0;
    const violations: string[] = [];
    let lastValid = { x: state.x, y: state.y };
    for (let i = 0; i < 400; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      if (i % 3 === 0) {
        const v = validatePositionReport(
          grid,
          { px: state.x, py: state.y },
          lastValid,
          { px: lastValid.x, py: lastValid.y },
          3 / 60,
          config,
        );
        if (v.length) violations.push(`s${i}:${v.join("+")}`);
        lastValid = { x: state.x, y: state.y };
      }
      if (state.x > 7 * TILE_SIZE + 4) break; // well onto the ramp's face
    }
    expect(violations).toEqual([]);
    expect(state.grounded).toBe(true);
    expect(state.x).toBeGreaterThan(7 * TILE_SIZE + 4);
    // It climbed off the floor onto the face (feet ≈ 204 at dx ≈ 8-9).
    expect(state.y + config.height / 2).toBeLessThan(13 * TILE_SIZE);
    expect(state.y + config.height / 2).toBeGreaterThan(
      12 * TILE_SIZE + 16 - config.width - 3,
    );
  });

  test("walks from the floor up the full 287+288 ramp without tripping the anti-cheat", () => {
    // The map's 287 at (7,12) and its sibling 288 at (8,12) form the
    // continuous ramp the discovery notes promised as a follow-up: 287
    // lifts the walker from the row-13 floor (feet 208) to its apex (feet
    // 200), then 288's staircase continues to the top (feet 192 — the
    // cell's top edge). The 287→288 seam is 1px (287's apex at dy 8 vs
    // 288's left tread at dy 7), settled by the vertical pass; every
    // report must pass.
    const grid = jungleGrid();
    const state = createPlayerState(config);
    state.x = 7 * TILE_SIZE - 4; // on the floor just left of the foot
    state.y = 13 * TILE_SIZE - config.height / 2; // feet on the floor (208)
    state.grounded = true;
    state.vy = 0;
    const violations: string[] = [];
    let lastValid = { x: state.x, y: state.y };
    let minBottom = state.y + config.height / 2;
    for (let i = 0; i < 400; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      minBottom = Math.min(minBottom, state.y + config.height / 2);
      if (i % 3 === 0) {
        const v = validatePositionReport(
          grid,
          { px: state.x, py: state.y },
          lastValid,
          { px: lastValid.x, py: lastValid.y },
          3 / 60,
          config,
        );
        if (v.length) violations.push(`s${i}:${v.join("+")}`);
        lastValid = { x: state.x, y: state.y };
      }
      if (state.x > 8 * TILE_SIZE + 10) break; // right edge near 288's far treads
    }
    expect(violations).toEqual([]);
    expect(state.grounded).toBe(true);
    // It climbed from the floor (208) to 288's top tread (192 — the
    // cell's top edge, which is flush with the topmost tread).
    expect(minBottom).toBeLessThanOrEqual(12 * TILE_SIZE + 1);
    expect(minBottom).toBeGreaterThan(12 * TILE_SIZE - 3);
  });

  test("walking under a 110 chamfer on a lower floor is not hoisted", () => {
    // Corridor: solid walls at rows 12-13, an overhanging 110 chamfer at
    // (3,14), solid floor at row 15. The box's top pokes into the chamfer
    // cell while it walks on the floor below — the old flat-lip override
    // hoisted it 16px onto the lip every cycle (a recurring bounce).
    const gids = new Array<number>(8 * 16).fill(0);
    for (let x = 3; x <= 7; x++) {
      gids[12 * 8 + x] = TILE_SOLID;
      gids[13 * 8 + x] = TILE_SOLID;
    }
    gids[14 * 8 + 3] = TILE_SLOPE_TL_BR;
    for (let x = 0; x < 8; x++) gids[15 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 16, gids));
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE;
    state.y = 15 * TILE_SIZE - config.height / 2; // feet on the floor (240)
    state.grounded = true;
    state.vy = 0;
    const floorY = state.y;
    for (let i = 0; i < 120; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      // The chamfer face may stop the walker (a head-level wall), but it
      // must never lift the box off the floor.
      expect(state.y).toBeLessThanOrEqual(floorY + 1e-6);
    }
    expect(state.grounded).toBe(true);
  });

  test("walking under a 109 cap on a lower floor is not hoisted", () => {
    // Mirror of the 110 case: an overhanging 109 cap at (4,14), walking
    // LEFT beneath it.
    const gids = new Array<number>(8 * 16).fill(0);
    for (let x = 4; x <= 7; x++) {
      gids[12 * 8 + x] = TILE_SOLID;
      gids[13 * 8 + x] = TILE_SOLID;
    }
    gids[14 * 8 + 4] = TILE_SLOPE_TR_BL;
    for (let x = 0; x < 8; x++) gids[15 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 16, gids));
    const state = createPlayerState(config);
    state.x = 6 * TILE_SIZE;
    state.y = 15 * TILE_SIZE - config.height / 2; // feet on the floor (240)
    state.grounded = true;
    state.vy = 0;
    const floorY = state.y;
    for (let i = 0; i < 120; i++) {
      stepPlayer(
        state,
        { left: true, right: false, jump: false },
        grid,
        STEP,
        config,
      );
      expect(state.y).toBeLessThanOrEqual(floorY + 1e-6);
    }
    expect(state.grounded).toBe(true);
  });
});

describe("wall cling", () => {
  /** Tall wall column at tile x=4 (rows 0..8) + a full floor at row 9. */
  function wallGrid(): SolidGrid {
    const gids = new Array<number>(8 * 10).fill(0);
    for (let y = 0; y < 9; y++) gids[y * 8 + 4] = TILE_SOLID;
    for (let x = 0; x < 8; x++) gids[9 * 8 + x] = TILE_SOLID;
    return buildTileGrid(layer(8, 10, gids));
  }

  /** Mid-air, flush against the wall's left face at x=4·16=64, falling. */
  function fallingBesideWall() {
    const grid = wallGrid();
    const state = createPlayerState(config);
    state.x = 4 * TILE_SIZE - config.width / 2; // 56 → right edge flush at 64
    state.y = 3 * TILE_SIZE; // row 3, well above the floor
    return { grid, state };
  }

  /** Runs the grab until `state.clinging`, using a fresh fallingBesideWall(). */
  function grabTheWall() {
    const { grid, state } = fallingBesideWall();
    for (let i = 0; i < 10; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: true },
        grid,
        STEP,
        config,
      );
      if (state.clinging) break;
    }
    expect(state.clinging).toBe(true);
    expect(state.clingDir).toBe(1); // the wall is on the right
    return { grid, state };
  }

  test("grabs a wall while airborne and moving into it, then hangs (no gravity)", () => {
    const { grid, state } = grabTheWall();
    const y = state.y;
    // Clinging with gravity off: the height stays frozen forever.
    for (let i = 0; i < 120; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: false },
        grid,
        STEP,
        config,
      );
      expect(state.clinging).toBe(true);
      expect(state.y).toBe(y);
      expect(state.vy).toBe(0);
    }
  });

  test("pressing jump while clinging launches up and away from the wall", () => {
    const { grid, state } = grabTheWall();
    const startY = state.y;

    // Press jump while hanging: buffered at the end of this step, so the
    // launch fires on the next step.
    stepPlayer(state, { left: false, right: false, jump: true }, grid, STEP, config);
    expect(state.clinging).toBe(true); // still hanging during the buffer step

    stepPlayer(state, noInput, grid, STEP, config);
    expect(state.clinging).toBe(false);
    expect(state.vx).toBeLessThan(0); // away from the wall (wall on the right)
    expect(state.vy).toBeLessThan(0); // upward

    // And it keeps rising for a while before gravity returns.
    let rose = false;
    for (let i = 0; i < 12; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.y < startY - 10) rose = true;
    }
    expect(rose).toBe(true);
  });

  test("pressing away from the wall releases the cling and the player falls", () => {
    const { grid, state } = grabTheWall();
    stepPlayer(state, { left: true, right: false, jump: false }, grid, STEP, config);
    expect(state.clinging).toBe(false);
    const y = state.y;
    for (let i = 0; i < 30; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
    }
    expect(state.y).toBeGreaterThan(y);
  });

  test("a ground jump next to a wall is still a normal jump, not a grab", () => {
    const grid = wallGrid();
    const state = settle(grid, 3 * TILE_SIZE, 9 * TILE_SIZE); // flush, grounded
    expect(state.grounded).toBe(true);
    let jumped = false;
    for (let i = 0; i < 30 && !jumped; i++) {
      stepPlayer(
        state,
        { left: true, right: false, jump: i === 0 },
        grid,
        STEP,
        config,
      );
      jumped = state.vy < -100;
    }
    expect(jumped).toBe(true);
    expect(state.clinging).toBe(false);
  });

  test("airborne beside a wall but steering away does not grab", () => {
    const { grid, state } = fallingBesideWall();
    const startY = state.y;
    for (let i = 0; i < 30; i++) {
      stepPlayer(
        state,
        { left: true, right: false, jump: true },
        grid,
        STEP,
        config,
      );
      expect(state.clinging).toBe(false);
    }
    expect(state.y).toBeGreaterThan(startY); // fell instead of grabbing
  });

  test("cling + wall-jump reports pass trajectory validation", () => {
    const { grid, state } = fallingBesideWall();
    let lastValid = { x: state.x, y: state.y };
    let previous = { px: state.x, py: state.y };
    let grabbed = false;
    const violations: string[] = [];
    for (let i = 0; i < 60; i++) {
      const input: PlayerInput = !grabbed
        ? { left: false, right: true, jump: true }
        : i === 12
          ? { left: false, right: false, jump: true } // buffer the wall jump
          : { left: false, right: false, jump: false };
      stepPlayer(state, input, grid, 1 / 20, config);
      if (!grabbed && state.clinging) grabbed = true;
      violations.push(
        ...validatePositionReport(
          grid,
          { px: state.x, py: state.y },
          lastValid,
          previous,
          0.05,
          config,
        ),
      );
      lastValid = { x: state.x, y: state.y };
      previous = { px: state.x, py: state.y };
    }
    expect(grabbed).toBe(true);
    expect(violations).toEqual([]);
  });

  test("grabs the right platform face in the real map and wall-jumps off it", () => {
    // Minimal slice of the real map: the right platform's left face (solid
    // rows 12-13, x=13..21) is all this test needs.
    const grid = buildTileGrid(
      layer(
        30,
        17,
        new Array<number>(30 * 17).fill(0).map((_, i) => {
          const x = i % 30;
          const y = Math.floor(i / 30);
          if ((y === 12 || y === 13) && x >= 13 && x <= 21) return TILE_SOLID;
          return 0;
        }),
      ),
    );
    const state = createPlayerState(config);
    // Mid-air, flush against the right platform's left face (x=13·16=208,
    // solid rows 12-13: y 192..224).
    state.x = 13 * TILE_SIZE - config.width / 2;
    state.y = 205;
    let grabbed = false;
    for (let i = 0; i < 20; i++) {
      stepPlayer(
        state,
        { left: false, right: true, jump: true },
        grid,
        STEP,
        config,
      );
      if (state.clinging) {
        grabbed = true;
        break;
      }
    }
    expect(grabbed).toBe(true);
    // Wall jump: away = left (back toward the left platform), and up.
    stepPlayer(state, { left: false, right: false, jump: true }, grid, STEP, config);
    stepPlayer(state, noInput, grid, STEP, config);
    expect(state.clinging).toBe(false);
    expect(state.vx).toBeLessThan(0);
    expect(state.vy).toBeLessThan(0);
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

describe("interaction tiles (315 → showquest)", () => {
  test("the registry binds tile 315 to showquest", () => {
    expect(INTERACTION_TILE_ACTIONS[TILE_INTERACTION]).toBe("showquest");
    expect(interactionActionForGid(TILE_INTERACTION)).toBe("showquest");
    expect(interactionActionForGid(TILE_SOLID)).toBeUndefined();
    expect(isInteractionTileGid(TILE_INTERACTION)).toBe(true);
    expect(isInteractionTileGid(57)).toBe(false);
  });

  test("buildInteractionGrid keeps only registered interaction gids", () => {
    const grid = buildInteractionGrid(
      layer(8, 1, [0, TILE_SOLID, TILE_INTERACTION, 65, TILE_DEAD_ZONE]),
    );
    expect(grid.gids[0]).toBe(0);
    expect(grid.gids[1]).toBe(0); // 57 is collision, not interaction
    expect(grid.gids[2]).toBe(TILE_INTERACTION);
    expect(grid.gids[3]).toBe(0);
    expect(grid.gids[4]).toBe(0);
  });

  test("interaction gids never leak into the collision grid", () => {
    // buildTileGrid is the collision source of truth: 315 must stay a 0
    // there, or the penetration fallthrough would turn it into a slope.
    const grid = buildTileGrid(
      layer(4, 1, [TILE_INTERACTION, 57, 65, TILE_DEAD_ZONE]),
    );
    expect(grid.kinds[0]).toBe(0);
    expect(grid.kinds[1]).toBe(TILE_SOLID);
    expect(grid.kinds[2]).toBe(TILE_SOLID);
    expect(grid.kinds[3]).toBe(TILE_DEAD_ZONE);
  });

  test("feet flush at the boundary of a floor trigger the tile perched above", () => {
    // The real-map placement: 315 sits directly ABOVE the floor cell the
    // player stands on, so a resting player's feet are exactly on the
    // boundary between the two cells. 315 at (2,3), solid floor at row 4.
    const gids = new Array<number>(8 * 8).fill(0);
    gids[3 * 8 + 2] = TILE_INTERACTION;
    for (let x = 0; x < 8; x++) gids[4 * 8 + x] = TILE_SOLID;
    const grid = buildInteractionGrid(layer(8, 8, gids));

    // Feet exactly on the floor top (boundary between row 3 and row 4).
    const feet = 4 * TILE_SIZE;
    expect(interactionTileUnderFeet(grid, 2 * 16 + 8, feet - config.height / 2, config.height)).
      toBe(TILE_INTERACTION);
    // A 1px-sunk foot (slope support settlement) still reads it.
    expect(interactionTileUnderFeet(grid, 2 * 16 + 8, feet - config.height / 2 + 1, config.height)).
      toBe(TILE_INTERACTION);
    // Outside the tile's horizontal span → nothing.
    expect(interactionTileUnderFeet(grid, 4 * 16 + 8, feet - config.height / 2, config.height)).
      toBe(0);
  });

  test("standing ON an interaction tile (tile as floor) triggers via the feet cell", () => {
    // 315 IS the floor tile: feet rest on its top edge, so the feet cell
    // itself is the interaction cell (primary probe, no boundary-above).
    const gids = new Array<number>(8 * 8).fill(0);
    gids[3 * 8 + 2] = TILE_INTERACTION;
    for (let x = 0; x < 8; x++) gids[4 * 8 + x] = TILE_SOLID; // ground under it
    const grid = buildInteractionGrid(layer(8, 8, gids));

    const feet = 3 * TILE_SIZE; // standing ON the tile's top edge
    expect(interactionTileUnderFeet(grid, 2 * 16 + 8, feet - config.height / 2, config.height)).
      toBe(TILE_INTERACTION);
  });

  test("feet two cells below an interaction tile do not trigger it", () => {
    // 315 at row 2, floor at row 4: the player on the far floor has its feet
    // at the row-4 boundary; the cell above is empty, so no trigger.
    const gids = new Array<number>(8 * 8).fill(0);
    gids[2 * 8 + 1] = TILE_INTERACTION;
    for (let x = 0; x < 8; x++) gids[4 * 8 + x] = TILE_SOLID;
    const grid = buildInteractionGrid(layer(8, 8, gids));

    const feet = 4 * TILE_SIZE;
    expect(interactionTileUnderFeet(grid, 1 * 16 + 8, feet - config.height / 2, config.height)).
      toBe(0);
  });

  test("the real map's tile 315 is under the feet of a player on its floor", () => {
    // main.json has exactly one interaction gid: 315 at tile (17, 11), with
    // a solid floor (row 12) directly beneath it — the signpost the player
    // stands in front of.
    const raw = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "..", "..", "Assets", "map", "main.json"),
        "utf8",
      ),
    ) as {
      layers: Array<{
        name: string;
        width: number;
        height: number;
        data: number[] | string;
      }>;
    };
    const layer1 = raw.layers.find((l) => l.name === "layer1");
    if (!layer1) throw new Error("Assets/map/main.json is missing layer1");
    const gids =
      typeof layer1.data === "string"
        ? layer1.data.split(",").map((v) => Number(v.trim()))
        : layer1.data;
    const grid = buildInteractionGrid({
      width: layer1.width,
      height: layer1.height,
      gids,
    });

    const idx = 11 * layer1.width + 17;
    expect(grid.gids[idx]).toBe(TILE_INTERACTION);
    expect([...grid.gids].filter((g) => g !== 0)).toEqual([TILE_INTERACTION]);

    // A player at rest on the floor beneath it (feet flush at 12*16).
    const feet = 12 * TILE_SIZE;
    expect(
      interactionTileUnderFeet(
        grid,
        17 * 16 + 8,
        feet - config.height / 2,
        config.height,
      ),
    ).toBe(TILE_INTERACTION);
  });
});

describe("door entities", () => {
  const door = [
    TILE_DOOR_TOP_LEFT,
    TILE_DOOR_TOP_RIGHT,
    TILE_DOOR_BOTTOM_LEFT,
    TILE_DOOR_BOTTOM_RIGHT,
  ];

  /** Places a 2×2 door block with its top-left corner at (tx, ty). */
  const placeDoor = (
    gids: number[],
    width: number,
    tx: number,
    ty: number,
  ): void => {
    gids[ty * width + tx] = TILE_DOOR_TOP_LEFT;
    gids[ty * width + tx + 1] = TILE_DOOR_TOP_RIGHT;
    gids[(ty + 1) * width + tx] = TILE_DOOR_BOTTOM_LEFT;
    gids[(ty + 1) * width + tx + 1] = TILE_DOOR_BOTTOM_RIGHT;
  };

  test("recognizes a 2×2 block of the four gids as one door", () => {
    // Canonical placement: 375,376 / 401,402 with the top-left at (2, 3)
    // in an 8×8 layer.
    const gids = new Array<number>(8 * 8).fill(0);
    placeDoor(gids, 8, 2, 3);
    const doors = buildDoorEntities(layer(8, 8, gids));
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({
      tx: 2,
      ty: 3,
      cols: 2,
      rows: 2,
      state: "closed",
    });
    // A door glyph is exactly the four door gids.
    expect(DOOR_TILE_GIDS).toEqual(door);
    expect(door.every(isDoorTileGid)).toBe(true);
    expect(isDoorTileGid(TILE_SOLID)).toBe(false);
  });

  test("ignores non-door gids and partial blocks", () => {
    // Two half-doors (one column each) plus a stray top half with a solid
    // under it: none form a full 2×2 door.
    const gids = new Array<number>(8 * 8).fill(0);
    gids[10] = TILE_SOLID;
    gids[3 * 8 + 5] = TILE_DOOR_TOP_LEFT;
    gids[3 * 8 + 6] = TILE_DOOR_TOP_RIGHT;
    gids[4 * 8 + 7] = TILE_DOOR_BOTTOM_LEFT;
    expect(buildDoorEntities(layer(8, 8, gids))).toHaveLength(0);
  });

  test("flush-adjacent doors are separate entities", () => {
    // Two doors sharing an edge: (1,2) and (3,2) — the greedy 2×2 scan
    // claims each 2×2 once instead of re-reading overlapping windows.
    const gids = new Array<number>(8 * 8).fill(0);
    placeDoor(gids, 8, 1, 2);
    placeDoor(gids, 8, 3, 2);
    placeDoor(gids, 8, 2, 5);
    const doors = buildDoorEntities(layer(8, 8, gids));
    expect(doors).toHaveLength(3);
    expect(doors.map((d) => [d.tx, d.ty])).toEqual([
      [1, 2],
      [3, 2],
      [2, 5],
    ]);
  });

  test("closed doors fold into the TILE_DOOR kind (solid, non-sticky)", () => {
    // A closed door is its own solid kind: the four door gids land in the
    // grid as TILE_DOOR — a full block (box queries read it as solid, so
    // the player can't walk through), but distinct from TILE_SOLID so the
    // wall-cling grab can skip it.
    const grid = buildTileGrid(layer(8, 4, [
      TILE_DOOR_TOP_LEFT, TILE_DOOR_TOP_RIGHT, 0, 0, 0, 0, 0, 0,
      TILE_DOOR_BOTTOM_LEFT, TILE_DOOR_BOTTOM_RIGHT, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
    ]));
    expect([...grid.kinds].filter((k) => k !== 0)).toEqual([
      TILE_DOOR, TILE_DOOR, TILE_DOOR, TILE_DOOR,
    ]);
    // The door still reads as solid for box/point queries (blocks walking;
    // a box overlapping the block at (0,0)-(1,1) is solid).
    expect(isBoxSolid(grid, 16, 16, config.width, config.height)).toBe(true);
  });

  test("a player cannot cling to (grab) a closed door", () => {
    // A tall DOOR column at tile x=4 (rows 0..8) + a full floor at row 9 —
    // the mirror of the wall-cling setup, but made of TILE_DOOR. Airborne,
    // flush against the face, moving into it with jump held: the grab must
    // NOT fire — the player slides down the face and lands (non-sticky),
    // instead of hanging frozen in the air.
    const gids = new Array<number>(8 * 10).fill(0);
    for (let y = 0; y < 9; y++) gids[y * 8 + 4] = TILE_DOOR;
    for (let x = 0; x < 8; x++) gids[9 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 10, gids));

    const state = createPlayerState(config);
    state.x = 4 * TILE_SIZE - config.width / 2; // right edge flush at 64
    state.y = 3 * TILE_SIZE; // row 3, well above the floor
    for (let i = 0; i < 120; i++) {
      // Jump only during the initial grab window (and never on the ground,
      // so a landed player rests instead of quick-bouncing).
      const jump = state.grounded ? false : i < 10;
      stepPlayer(
        state,
        { left: false, right: true, jump },
        grid,
        STEP,
        config,
      );
      if (state.clinging) break;
    }
    expect(state.clinging).toBe(false);
    // The player fell down the face to the floor instead of hanging.
    expect(state.y).toBeGreaterThan(3 * TILE_SIZE);
    expect(state.grounded).toBe(true);
  });

  test("a player cannot cling to a closed door's face where it continues onto a wall", () => {
    // The real map's door (2×2 block) sits flush on top of a solid wall
    // column, so the door's side faces and the wall's face are one
    // continuous surface. The grab probe is a 2px strip at the box's side
    // edge spanning the box's full height: beside the door's bottom row it
    // overlaps BOTH the door cell AND the wall cell below it. The door must
    // veto the whole grab — the old "skip door cells" fold let the wall
    // cell count, and the player grabbed the door's face right at the seam
    // and hung there.
    const gids = new Array<number>(8 * 13).fill(0);
    placeDoor(gids, 8, 4, 8);
    for (let y = 10; y < 13; y++) {
      gids[y * 8 + 4] = TILE_SOLID;
      gids[y * 8 + 5] = TILE_SOLID;
    }
    const grid = buildTileGrid(layer(8, 13, gids));
    const hw = config.width / 2;
    const hh = config.height / 2;
    const x = 4 * TILE_SIZE - config.width / 2; // flush beside the left face

    // Probe-level: while the strip still touches the door (the seam band
    // rows 9-10, and even a 2px graze of the door's bottom edge) the face
    // is not grabable; only once the strip fully clears the door's bottom
    // (y ≥ 10·16) is the wall below the door a normal grabable wall.
    expect(grabableWallBeside(grid, x, 156, hw, hh, 1)).toBe(false);
    expect(grabableWallBeside(grid, x, 165, hw, hh, 1)).toBe(false);
    expect(grabableWallBeside(grid, x, 10 * TILE_SIZE + 7, hw, hh, 1)).toBe(true);

    // Integration: falling down the door's face holding right+jump never
    // grabs while any part of the probe touches the door; the player slides
    // down the smooth face and the first grab can only happen once the box
    // has fully cleared the door's bottom edge (on the wall below).
    const state = createPlayerState(config);
    state.x = x;
    state.y = 156;
    const doorBottom = 10 * TILE_SIZE;
    let grabbedBesideDoor = false;
    let grabbedBelow = false;
    for (let i = 0; i < 300 && !grabbedBelow; i++) {
      stepPlayer(state, { left: false, right: true, jump: true }, grid, STEP, config);
      if (state.clinging) {
        if (state.y - hh < doorBottom) grabbedBesideDoor = true;
        else grabbedBelow = true;
      }
    }
    expect(grabbedBesideDoor).toBe(false);
    expect(grabbedBelow).toBe(true);
  });

  test("a player cannot walk through a closed door", () => {
    // Door block (2×2 of door gids) at rows 1-2, cols 2-3 — the player
    // walks right into its face and must stop, exactly like a wall
    // (door left face at x=2*16; collider half-width 5 → center stops at
    // 32-5=27).
    const gids = new Array<number>(8 * 4).fill(0);
    placeDoor(gids, 8, 2, 1);
    for (let x = 0; x < 8; x++) gids[3 * 8 + x] = TILE_SOLID; // floor beneath
    const grid = buildTileGrid(layer(8, 4, gids));

    const state = settle(grid, 1 * TILE_SIZE, 3 * TILE_SIZE);
    const input: PlayerInput = { left: false, right: true, jump: false };
    for (let i = 0; i < 120; i++) stepPlayer(state, input, grid, STEP, config);
    expect(state.x).toBeCloseTo(2 * TILE_SIZE - config.width / 2, 4);
    expect(state.vx).toBe(0);
    expect(state.grounded).toBe(true);
  });

  test("the real map's door is one entity at (29, 8)", () => {
    const raw = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "..", "..", "Assets", "map", "main.json"),
        "utf8",
      ),
    ) as {
      layers: Array<{
        name: string;
        width: number;
        height: number;
        data: number[] | string;
      }>;
    };
    const layer1 = raw.layers.find((l) => l.name === "layer1");
    if (!layer1) throw new Error("Assets/map/main.json is missing layer1");
    const gids =
      typeof layer1.data === "string"
        ? layer1.data.split(",").map((v) => Number(v.trim()))
        : layer1.data;
    const doors = buildDoorEntities({
      width: layer1.width,
      height: layer1.height,
      gids,
    });
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ tx: 29, ty: 8 });
  });
});