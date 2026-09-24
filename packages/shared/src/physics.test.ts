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
  TILE_SLOPE_SHALLOW_MIRROR,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
  TILE_STAIRS,
  TILE_STAIRS_MIRROR,
  buildDoorEntities,
  buildInteractionGrid,
  buildMovePlatforms,
  buildTileGrid,
  buildTrapSpikeRuns,
  clearDoorFromGrid,
  createMovePlatformMotion,
  createPlayerState,
  createTrapSpikeRunMotion,
  doorKey,
  gridPixelSize,
  grabableWallBeside,
  groupRoomObjectsByName,
  interactionActionForGid,
  interactionTileUnderFeet,
  isBoxInDeadZone,
  isBoxOnMovePlatform,
  isBoxSolid,
  isBoxTouchingTrapSpikeRun,
  isDoorTileGid,
  isInteractionTileGid,
  isPointSolid,
  isTrapSpikeRunObject,
  maxPlayerSpeed,
  movePlatformSurfaceTop,
  probeInteractionTile,
  stepMovePlatform,
  stepPlayer,
  stepTrapSpikeRun,
  supportPlayerOnMovePlatform,
  validatePositionReport,
  MOVE_PLATFORM_DEFAULT_SPEED,
  MOVE_PLATFORM_RIDE_TOLERANCE,
  MOVE_PLATFORM_WIDTH,
  type CollisionLayerData,
  type PlayerInput,
  type RoomObject,
  type SolidGrid,
  type TrapObjectAnnotation,
  type TrapObjectProperty,
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
      layer(9, 1, [
        0, TILE_SOLID, TILE_SLOPE_TL_BR, TILE_SLOPE_TR_BL, TILE_SLOPE_BR,
        TILE_STAIRS, 65, 315, TILE_SLOPE_SHALLOW_MIRROR,
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
    // 290 is the mirror of 287 — a real slope kind, kept as itself.
    expect(grid.kinds[8]).toBe(TILE_SLOPE_SHALLOW_MIRROR);
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

describe("shallow ramp mirror (290, 2:1, flipped from 287)", () => {
  test("point solidity respects the mirrored line (2·dy − dx ≥ 16)", () => {
    const grid = buildTileGrid(layer(1, 1, [TILE_SLOPE_SHALLOW_MIRROR]));
    // Solid below the line from the bottom-right corner (16, 16) to the
    // left edge's midpoint (0, 8) — 287's ramp flipped left-right. Open
    // above the face (the top-right region); the left column below the
    // apex is the solid back side.
    expect(isPointSolid(grid, 15.6, 15.8)).toBe(true); // right base, on the line near the bottom edge
    expect(isPointSolid(grid, 0.1, 8.05)).toBe(true); // near the apex (left edge's midpoint)
    expect(isPointSolid(grid, 8, 12)).toBe(true); // mid-span on the line (24 − 8 = 16)
    expect(isPointSolid(grid, 14, 15)).toBe(true); // 30 − 14 = 16, on the line
    expect(isPointSolid(grid, 14, 14)).toBe(false); // 28 − 14 = 14 < 16, open above the face
    expect(isPointSolid(grid, 16, 15)).toBe(false); // above the right base
    expect(isPointSolid(grid, 1, 9)).toBe(true); // back side below the apex
    expect(isPointSolid(grid, 1, 6)).toBe(false); // above the apex: the top-left corner is open
    expect(isPointSolid(grid, 8, 4)).toBe(false); // 8 − 8 = 0 < 16
    expect(isPointSolid(grid, 13, 12)).toBe(false); // 24 − 13 = 11 < 16
    expect(isPointSolid(grid, 4, 14)).toBe(true); // deep, solid
  });

  test("box solidity reports touches with the mirrored wedge", () => {
    const grid = buildTileGrid(layer(1, 1, [TILE_SLOPE_SHALLOW_MIRROR]));
    // The solid is below the line 2·dy − dx = 16, maximized at the
    // overlap's top-LEFT corner (ox0, oy1): reachable iff it is solid.
    expect(isBoxSolid(grid, 0, 12, 10, 10)).toBe(true); // deep left side
    expect(isBoxSolid(grid, 14, 2, 4, 4)).toBe(false); // tucked open top-right
    expect(isBoxSolid(grid, 2, 3, 4, 4)).toBe(false); // over the apex — the top is open
    expect(isBoxSolid(grid, 12, 12, 6, 6)).toBe(true); // low band is solid
  });

  test("lands on the mirrored 2:1 surface, binding the LEFT edge", () => {
    // 290 at (2,2), flush on a solid floor (row 3). A falling box rests
    // on the line itself, sampled at its leftmost extent (dx0 = 0 — the
    // apex side): bottom = 32 + (8 + 0/2) = 40 → center 33. The SAME box
    // on a 287 would bind at its right edge (dx1 = 10.5 → bottom 42.75),
    // so this asserts the flip, not a symmetric coincidence.
    const grid = buildTileGrid(layer(4, 4, [
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, TILE_SLOPE_SHALLOW_MIRROR, 0,
      TILE_SOLID, TILE_SOLID, TILE_SOLID, TILE_SOLID,
    ]));
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 4; // span dx [0, 10.5]
    state.y = TILE_SIZE;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(
      2 * TILE_SIZE + TILE_SIZE / 2 - config.height / 2,
      1,
    );
  });

  test("a floor-level walker steps onto the ramp at its flush foot", () => {
    // Ramp at (2,2) on a solid floor (row 3). Its base is flush on the
    // floor (the face starts at the bottom-right corner, 48,48), so a
    // grounded walker walking LEFT from the floor is lifted onto the
    // ramp immediately — never blocked at an invisible face.
    const gids = new Array<number>(8 * 4).fill(0);
    gids[2 * 8 + 2] = TILE_SLOPE_SHALLOW_MIRROR;
    for (let x = 0; x < 8; x++) gids[3 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 4, gids));
    const state = createPlayerState(config);
    state.x = 3 * TILE_SIZE + 2; // on the floor, just right of the foot
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
        { left: true, right: false, jump: false },
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
    expect(state.x).toBeLessThan(3 * TILE_SIZE);
  });

  test("walks up the 290 ramp from the floor to the apex without violations", () => {
    // Same layout: ramp at (2,2) on a closed floor (row 3). A grounded
    // walker crosses the flush foot and rides the mirrored 2:1 face up
    // to the apex (32, 40) — every report must pass anti-cheat, exactly
    // like 287's uphill march (just mirrored).
    const gids = new Array<number>(8 * 4).fill(0);
    gids[2 * 8 + 2] = TILE_SLOPE_SHALLOW_MIRROR;
    for (let x = 0; x < 8; x++) gids[3 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 4, gids));
    const state = createPlayerState(config);
    state.x = 3 * TILE_SIZE + 2;
    state.y = 3 * TILE_SIZE - config.height / 2; // feet on the floor (48)
    state.grounded = true;
    state.vy = 0;
    const violations: string[] = [];
    let lastValid = { x: state.x, y: state.y };
    for (let i = 0; i < 400; i++) {
      stepPlayer(
        state,
        { left: true, right: false, jump: false },
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
      if (state.x < 2 * TILE_SIZE + config.width / 2) break; // left edge near the tile's left edge — the apex
    }
    expect(violations).toEqual([]);
    expect(state.grounded).toBe(true);
    // It left the floor and now rides the face at the apex (feet ≈ 40 —
    // the apex at dy 8 on the cell's left edge).
    expect(state.y).toBeCloseTo(
      2 * TILE_SIZE + TILE_SIZE / 2 - config.height / 2,
      0,
    );
  });

  test("a box on the left is wall-blocked by the back side, never entered", () => {
    // The left column below the apex (dx = 0, dy ≥ 8) is solid, and the
    // base row is solid the whole way across — so a ground-level box
    // standing on the floor to the left of the ramp cannot walk right
    // through it: it meets the tile's left face as a wall.
    const gids = new Array<number>(8 * 4).fill(0);
    gids[2 * 8 + 2] = TILE_SLOPE_SHALLOW_MIRROR;
    for (let x = 0; x < 8; x++) gids[3 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 4, gids));
    const state = createPlayerState(config);
    state.x = 1 * TILE_SIZE + 8; // left of the ramp, on the floor
    state.y = 3 * TILE_SIZE - config.height / 2; // feet on the floor (48)
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
    }
    expect(state.grounded).toBe(true);
    // Never entered the ramp's cell at floor level — its right edge stays
    // at the tile's left face (x = 32), so the center is ≤ 32 + w/2 + 1.
    expect(state.x).toBeLessThanOrEqual(2 * TILE_SIZE + config.width / 2 + 1);
  });

  test("a rising box under the ramp hits the flat underside, not the face", () => {
    // 290 floating at (2,1) with open air below: the wedge fills the cell
    // down to its bottom edge at every column, so the underside is a flat
    // ceiling at y = 32 — even under the ramp's deep right wing (the
    // mirror of 287's flat-underside test, box under the deep side).
    const grid = buildTileGrid(layer(4, 3, [
      0, 0, 0, 0,
      0, 0, TILE_SLOPE_SHALLOW_MIRROR, 0,
      0, 0, 0, 0,
    ]));
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 14; // under the deep right wing (dx ≈ 14)
    state.y = 2.5 * TILE_SIZE; // below the tile, rising
    state.vy = -config.jumpSpeed / 2; // moving up, half a jump
    let minHead = Infinity;
    for (let i = 0; i < 30; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      minHead = Math.min(minHead, state.y - config.height / 2);
    }
    // The flat underside (y = 32) bounces the head back — it must never
    // tunnel past the cell bottom, and it must have reached it.
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

describe("mirrored staircase tile (289, 2:1 steps)", () => {
  test("point solidity matches the mirrored pixel mask", () => {
    const grid = buildTileGrid(layer(1, 1, [TILE_STAIRS_MIRROR]));
    // 288's staircase reflected left-right: eight 2px-wide treads step
    // down from the top-left (cols 0-1, row 0) to the bottom-right (cols
    // 14-15, row 7); col 0 is a full-height left wall, col 15 a wall from
    // row 7 down, row 15 the full base; the interior is open.
    expect(isPointSolid(grid, 15.5, 0.4)).toBe(false); // open top-right
    expect(isPointSolid(grid, 0.5, 0.4)).toBe(true); // top tread (left)
    expect(isPointSolid(grid, 1.5, 1.5)).toBe(false); // under the top tread (open; col 0 is the left wall)
    expect(isPointSolid(grid, 2.5, 1.5)).toBe(true); // second tread
    expect(isPointSolid(grid, 2.5, 2.5)).toBe(false); // under it
    expect(isPointSolid(grid, 14.5, 7.5)).toBe(true); // rightmost tread
    expect(isPointSolid(grid, 14.5, 6.5)).toBe(false); // above it
    expect(isPointSolid(grid, 8, 12)).toBe(false); // hollow interior
    expect(isPointSolid(grid, 0.5, 12)).toBe(true); // left wall
    expect(isPointSolid(grid, 15.5, 12)).toBe(true); // right wall
    expect(isPointSolid(grid, 8, 15.5)).toBe(true); // base row
  });

  test("box solidity reads the mask: walls/treads solid, hollow open", () => {
    const grid = buildTileGrid(layer(1, 1, [TILE_STAIRS_MIRROR]));
    expect(isBoxSolid(grid, 0.5, 11, 3, 6)).toBe(true); // left wall (col 0)
    expect(isBoxSolid(grid, 15.5, 11, 3, 6)).toBe(true); // right wall (col 15, rows 8-14)
    expect(isBoxSolid(grid, 8, 11, 8, 4)).toBe(false); // hollow interior
    expect(isBoxSolid(grid, 0.5, 0.5, 3, 1)).toBe(true); // top tread (cols 0-1)
    expect(isBoxSolid(grid, 15, 0.5, 3, 1)).toBe(false); // open top-right
  });

  test("lands on the mirrored staircase, binding the topmost tread under the span", () => {
    // 289 at (2,1) floating in open air: the box drops onto the steps and
    // rests on the shallowest tread under its span — its LEFTMOST column,
    // the mirror of 288's ride-on-the-leading-corner rule.
    const gids = new Array<number>(8 * 3).fill(0);
    gids[1 * 8 + 2] = TILE_STAIRS_MIRROR;
    const grid = buildTileGrid(layer(8, 3, gids));

    // Left edge at 32.5 → cell dx 0.5 → stairsMirrorTopRow(0) = 0 → bottom
    // = cell top (16) → center 9 (flush on the top tread).
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 7;
    state.y = TILE_SIZE;
    for (let i = 0; i < 900; i++) {
      stepPlayer(state, noInput, grid, STEP, config);
      if (state.grounded) break;
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(TILE_SIZE - config.height / 2, 3);
  });

  test("a walker climbs the full mirrored staircase from foot to top without violations", () => {
    // 289 at (2,1) with open air around it; the walker starts on the
    // rightmost tread (bottom = top + stairsMirrorTopRow(15) = 23) and
    // rides the treads up, walking LEFT, to the top (bottom = 16).
    const grid = buildTileGrid(
      layer(6, 3, [0, 0, 0, 0, 0, 0, 0, 0, TILE_STAIRS_MIRROR, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    const state = createPlayerState(config);
    state.x = 2 * TILE_SIZE + 12;
    state.y = TILE_SIZE + 7 - config.height / 2;
    state.grounded = true;
    state.vy = 0;
    const violations: string[] = [];
    let lastValid = { x: state.x, y: state.y };
    let minBottom = state.y + config.height / 2;
    for (let i = 0; i < 300; i++) {
      stepPlayer(
        state,
        { left: true, right: false, jump: false },
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
      if (state.x - config.width / 2 < 2 * TILE_SIZE) break; // left edge off the tile
    }
    expect(violations).toEqual([]);
    expect(state.grounded).toBe(true);
    // It climbed from the right foot (bottom 23) to the top tread (bottom 16).
    expect(minBottom).toBeLessThanOrEqual(TILE_SIZE + 0.05);
    expect(minBottom).toBeGreaterThan(TILE_SIZE - 1);
  });

  test("a floor-level box is wall-blocked by the right limb, never hoisted", () => {
    // 289 at (2,1) directly above a solid floor (row 2). The base row is
    // solid, so a box on the floor cannot walk under the tile; its right
    // limb (col 15, rows 7-15) blocks a box pushing in at floor level —
    // and the box must not be hoisted onto the steps (no flush foot:
    // the lowest tread top is 1px above the cell's bottom edge).
    const gids = new Array<number>(8 * 3).fill(0);
    gids[1 * 8 + 2] = TILE_STAIRS_MIRROR;
    for (let x = 0; x < 8; x++) gids[2 * 8 + x] = TILE_SOLID;
    const grid = buildTileGrid(layer(8, 3, gids));
    const state = createPlayerState(config);
    state.x = 3 * TILE_SIZE + 2;
    state.y = 2 * TILE_SIZE - config.height / 2; // feet on the floor (32)
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
      // Never lifted off the floor, never passed the tile's right face.
      expect(state.y).toBeLessThanOrEqual(floorY + 1e-6);
    }
    expect(state.grounded).toBe(true);
    expect(state.x).toBeGreaterThanOrEqual(3 * TILE_SIZE + config.width / 2 - 0.5);
  });

  test("a rising box under the mirrored staircase hits the flat underside, not a tread", () => {
    // 289 floating at (2,1) with open air below: the base row is solid at
    // every column, so the underside is a flat ceiling at the cell's
    // bottom edge — even over the hollow interior.
    const grid = buildTileGrid(
      layer(4, 3, [0, 0, 0, 0, 0, 0, TILE_STAIRS_MIRROR, 0, 0, 0, 0, 0]),
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

describe("jungle physics (frozen map fixture)", () => {
  // Frozen fixture: the shipped level's left section (40×17) as it stood
  // when these tests were written. Deliberately decoupled from
  // `Assets/map/main.json` — the map is actively reworked, and a map edit
  // must never change what these simulation tests assert. The fixture keeps
  // the geometry the assertions below were tuned against: the row-13 floor
  // (top 208) under the spawn, the 287/288 ramp pair and row-12 runway
  // (top 192), the 110/109 chamfers, and the 464 dead-zone pits at the
  // bottom. Legend per cell: `.` open, `#` solid (57/65), `A` 110, `B` 109,
  // `C` 287, `D` 288, `E` 464, `S` 315 (non-collision — folds to 0).
  function jungleFixtureGrid(): SolidGrid {
    const rows = [
      "........................................",
      "........................................",
      "........................................",
      "........................................",
      "........................................",
      "........................................",
      "........................................",
      "........................................",
      "........................................",
      "........................................",
      "....................#################...",
      ".................S..####...##########...",
      "......CD#.....CD########...##########...",
      ".########....###########...A#########...",
      ".A#######....###########......#######...",
      "..######B....##########B......A######...",
      "EE######EEEEEA#########EEEEEEEE######...",
    ];
    const legend: Record<string, number> = {
      "#": TILE_SOLID,
      A: TILE_SLOPE_TL_BR,
      B: TILE_SLOPE_TR_BL,
      C: TILE_SLOPE_SHALLOW,
      D: TILE_STAIRS,
      E: TILE_DEAD_ZONE,
      S: TILE_INTERACTION,
    };
    const width = rows[0]!.length;
    const gids = new Array<number>(width * rows.length).fill(0);
    rows.forEach((row, y) => {
      for (let x = 0; x < width; x++) {
        const gid = legend[row[x]!];
        if (gid !== undefined) gids[y * width + x] = gid;
      }
    });
    return buildTileGrid(layer(width, rows.length, gids));
  }

  test("spawns at PLAYER_SPAWN and falls onto the left platform", () => {
    const grid = jungleFixtureGrid();
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
    // The fixture has no same-height platform gap: the left floor (row 13,
    // feet 208) is one tile below the 287/288 ramp runway (row 12, feet
    // 192). From the spawn landing spot a jump with a short run-up must
    // rise onto the ramp — never fall into the pit to its right.
    const grid = jungleFixtureGrid();
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
    const grid = jungleFixtureGrid();
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
    // x=192 drops into the gap between the fixture's floor plates (the
    // plaza at cols 9-12); below it sits a TILE_DEAD_ZONE (464) pit at
    // (12,16) — the hazard basin's base (rows 13-15, top at
    // worldHeight−3) catches the fall. The world floor would be at
    // worldHeight, but the dead zone's 3px base (the basin floor) is what
    // stops it.
    const grid = jungleFixtureGrid();
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
    // The fixture's left floor (row 13) runs from x=16 to x=144; the spawn
    // lands mid-floor, so the old “over the void” start no longer exists.
    // Walking left past x=16 falls over the edge into the 464 dead-zone
    // pit at cols 0-1 (row 16): the basin's base (top at worldHeight−3)
    // stops the fall, not the world floor.
    const grid = jungleFixtureGrid();
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
    // Regression for the slope kick, run against the frozen fixture: from
    // the actual spawn the walker falls to the row-13 floor, climbs the 287
    // ramp, the 288 staircase, and the row-12 runway (feet 192) with every
    // movement report passing validation. The old 262 bug (the vertical
    // sampler burying the box under the ramp, reading every report as
    // buried-in-geometry) is exercised here by the same rising motion.
    const grid = jungleFixtureGrid();
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
    // The fixture's 287 at (6,12) (x 96..112) sits on the row-13 floor
    // (y = 208) whose top is the ramp's flush base. Its face runs from the
    // bottom-left corner (96, 208) to the right edge's midpoint (112, 200)
    // — walking right from the floor must climb the ramp (the old
    // top-aligned model floated the foot 8px up, so the walker hit an
    // invisible face at the base) and every report must pass.
    const grid = jungleFixtureGrid();
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
    // The fixture's 287 at (6,12) and its sibling 288 at (7,12) form the
    // continuous ramp the discovery notes promised as a follow-up: 287
    // lifts the walker from the row-13 floor (feet 208) to its apex (feet
    // 200), then 288's staircase continues to the top (feet 192 — the
    // cell's top edge). The 287→288 seam is 1px (287's apex at dy 8 vs
    // 288's left tread at dy 7), settled by the vertical pass; every
    // report must pass.
    const grid = jungleFixtureGrid();
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

  test("pressing away from the wall keeps the cling — only a jump detaches", () => {
    const { grid, state } = grabTheWall();
    const yBefore = state.y;
    // Steering away does NOT release the cling: the player is glued to the
    // wall, no gravity, no lateral drift.
    for (let i = 0; i < 60; i++) {
      stepPlayer(state, { left: true, right: false, jump: false }, grid, STEP, config);
      expect(state.clinging).toBe(true);
      expect(state.y).toBe(yBefore);
      expect(state.vy).toBe(0);
      expect(state.vx).toBe(0);
    }
    // Only the jump detaches.
    stepPlayer(state, { left: true, right: false, jump: true }, grid, STEP, config);
    stepPlayer(state, { left: true, right: false, jump: false }, grid, STEP, config);
    expect(state.clinging).toBe(false);
    const y = state.y;
    // The wall jump boosted the player ~30px up; wait out the airtime (~0.7s)
    // to confirm they now fall instead of hanging.
    for (let i = 0; i < 80; i++) {
      stepPlayer(state, { left: true, right: false, jump: false }, grid, STEP, config);
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

  test("probeInteractionTile resolves the tile's own cell (its identity)", () => {
    // 315 sits directly ABOVE the floor cell the player stands on (the
    // signpost base is flush with the standing surface), so the flush
    // case reads the boundary-ABOVE cell — and the probe must report THAT
    // cell (row 3), not the feet cell below it (row 4): the cell is what
    // marks the signpost completed.
    const gids = new Array<number>(8 * 8).fill(0);
    gids[3 * 8 + 2] = TILE_INTERACTION;
    for (let x = 0; x < 8; x++) gids[4 * 8 + x] = TILE_SOLID;
    const grid = buildInteractionGrid(layer(8, 8, gids));

    // Flush resting on the floor below the signpost → the signpost's cell.
    const feet = 4 * TILE_SIZE;
    expect(
      probeInteractionTile(grid, 2 * 16 + 8, feet - config.height / 2, config.height),
    ).toEqual({ gid: TILE_INTERACTION, tx: 2, ty: 3 });
    // A 1px-sunk foot (slope support settlement) still resolves the same cell.
    expect(
      probeInteractionTile(grid, 2 * 16 + 8, feet - config.height / 2 + 1, config.height),
    ).toEqual({ gid: TILE_INTERACTION, tx: 2, ty: 3 });
    // Standing ON the tile itself (tile as floor) resolves the feet cell.
    expect(
      probeInteractionTile(grid, 2 * 16 + 8, 3 * TILE_SIZE - config.height / 2, config.height),
    ).toEqual({ gid: TILE_INTERACTION, tx: 2, ty: 3 });
    // No interaction under the feet → null.
    expect(
      probeInteractionTile(grid, 4 * 16 + 8, feet - config.height / 2, config.height),
    ).toBeNull();
    // The gid-only shorthand agrees on all of the above.
    expect(
      interactionTileUnderFeet(grid, 2 * 16 + 8, feet - config.height / 2, config.height),
    ).toBe(TILE_INTERACTION);
  });

  test("a signpost tile is under the feet of a player on its floor", () => {
    // Signpost-atop-floor fixture: 315 at tile (17, 11) perched on a solid
    // row-12 floor — the signpost's base is flush with the standing floor's
    // top, so the tile sits in the cell above the feet. Built here (not
    // read from the shipped map) so a map edit can't move or remove it.
    const width = 24;
    const height = 13;
    const gids = new Array<number>(width * height).fill(0);
    gids[11 * width + 17] = TILE_INTERACTION;
    for (let x = 13; x < width; x++) gids[12 * width + x] = TILE_SOLID;
    const grid = buildInteractionGrid(layer(width, height, gids));

    const idx = 11 * width + 17;
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

  test("a door block's identity key is its top-left cell", () => {
    // A 2×2 door placed at (29, 8) — the position the shipped map's room1
    // gate used — built here synthetically so a map edit can't move it:
    // the block is still exactly one entity and its wire/schema key is
    // "29,8".
    const gids = new Array<number>(40 * 10).fill(0);
    placeDoor(gids, 40, 29, 8);
    const doors = buildDoorEntities(layer(40, 10, gids));
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ tx: 29, ty: 8 });
    // Its identity key is the top-left cell, the schema/wire map key.
    expect(doorKey(29, 8)).toBe("29,8");
    expect(doorKey(doors[0]!.tx, doors[0]!.ty)).toBe("29,8");
  });

  test("clearDoorFromGrid makes a closed door's doorway passable", () => {
    // Mirror of the closed-door test: the four gids fold into TILE_DOOR and
    // a box overlapping the block reads solid, until the door is opened —
    // clearing the four cells to 0 makes the doorway passable. That is
    // exactly what both sides apply when every linked showquest is answered:
    // the room clears its validation grid (so reports inside the doorway
    // aren't buried-in-geometry) and each client clears its prediction grid.
    const gids = new Array<number>(8 * 4).fill(0);
    placeDoor(gids, 8, 2, 1);
    for (let x = 0; x < 8; x++) gids[3 * 8 + x] = TILE_SOLID; // floor beneath
    const grid = buildTileGrid(layer(8, 4, gids));
    const doorway = { x: 3 * TILE_SIZE, y: 2 * TILE_SIZE }; // inside the block
    expect(
      isBoxSolid(grid, doorway.x, doorway.y, config.width, config.height),
    ).toBe(true);

    clearDoorFromGrid(grid, 2, 1);
    // Only the floor row remains solid.
    const solids = [...grid.kinds].filter((k) => k !== 0);
    expect(solids).toHaveLength(8);
    expect(solids.every((k) => k === TILE_SOLID)).toBe(true);
    expect(
      isBoxSolid(grid, doorway.x, doorway.y, config.width, config.height),
    ).toBe(false);
  });
});

describe("door-link groups (room objectgroup ↔ tiles)", () => {
  /** Builds a 6×6 layer with a 315 showquest tile at (1,4) and a 2×2 door block at (3,1). */
  const linkLayer = (): CollisionLayerData => {
    const width = 6;
    const height = 6;
    const gids = new Array<number>(width * height).fill(0);
    gids[4 * width + 1] = TILE_INTERACTION;
    gids[1 * width + 3] = TILE_DOOR_TOP_LEFT;
    gids[1 * width + 4] = TILE_DOOR_TOP_RIGHT;
    gids[2 * width + 3] = TILE_DOOR_BOTTOM_LEFT;
    gids[2 * width + 4] = TILE_DOOR_BOTTOM_RIGHT;
    return layer(width, height, gids);
  };

  test("a room object contains the entities whose centers fall in its rect", () => {
    const layerMap = linkLayer();
    const doors = buildDoorEntities(layerMap);
    const interactions = buildInteractionGrid(layerMap);
    const room1: RoomObject = { id: 1, name: "room1", x: 0, y: 0, width: 96, height: 96 };
    const groups = groupRoomObjectsByName([room1], doors, interactions);

    // room1 encloses the whole layer: its 315 signpost center (24, 72) and
    // the door block center (64, 32) both land inside, so the group links
    // 1 showquest to 1 door — the real map's shape in miniature.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe("room1");
    expect(groups[0]!.objects).toEqual([room1]);
    expect(groups[0]!.showquest).toHaveLength(1);
    expect(groups[0]!.showquest[0]).toEqual({ tx: 1, ty: 4 });
    expect(groups[0]!.doors).toHaveLength(1);
    expect(groups[0]!.doors[0]).toMatchObject({ tx: 3, ty: 1 });
  });

  test("rectangles link only the entities they contain (counts per group)", () => {
    const layerMap = linkLayer();
    const doors = buildDoorEntities(layerMap);
    const interactions = buildInteractionGrid(layerMap);

    const objects: RoomObject[] = [
      // A rect over just the signpost (1 showquest, no door)…
      { id: 1, name: "sign", x: 16, y: 64, width: 16, height: 16 },
      // … a rect over just the door (1 door, no showquest)…
      { id: 2, name: "gate", x: 48, y: 16, width: 32, height: 32 },
      // … and a small rect containing neither (links nothing).
      { id: 3, name: "decor", x: 0, y: 0, width: 32, height: 32 },
    ];
    const groups = groupRoomObjectsByName(objects, doors, interactions);

    expect(groups.map((g) => g.name)).toEqual(["sign", "gate", "decor"]);
    expect(groups[0]!.showquest).toHaveLength(1);
    expect(groups[0]!.doors).toHaveLength(0);
    expect(groups[1]!.showquest).toHaveLength(0);
    expect(groups[1]!.doors).toHaveLength(1);
    expect(groups[1]!.doors[0]).toMatchObject({ tx: 3, ty: 1 });
    expect(groups[2]!.showquest).toHaveLength(0);
    expect(groups[2]!.doors).toHaveLength(0);
  });

  test("same-name rectangles collate into one gate; shared centers don't double-count", () => {
    const layerMap = linkLayer();
    const doors = buildDoorEntities(layerMap);
    const interactions = buildInteractionGrid(layerMap);

    // Two rects named "gate1": one over the signpost, one over the door —
    // plus a second signpost rect overlapping the first (same center) to
    // prove dedupe inside a group.
    const objects: RoomObject[] = [
      { id: 1, name: "gate1", x: 16, y: 64, width: 16, height: 16 },
      { id: 2, name: "gate1", x: 0, y: 64, width: 32, height: 16 }, // still centers on (24, 72)
      { id: 3, name: "gate1", x: 48, y: 16, width: 32, height: 32 },
    ];
    const groups = groupRoomObjectsByName(objects, doors, interactions);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.objects).toHaveLength(3);
    expect(groups[0]!.showquest).toHaveLength(1);
    expect(groups[0]!.doors).toHaveLength(1);
  });
});

describe("Trap_Spike_Run entities (patrol)", () => {
  const trapSpikeRunProps = (
    overrides: Record<string, unknown> = {},
  ): TrapObjectProperty[] =>
    Object.entries({
      speedMax: 100,
      speedMin: 50,
      time2change_speed: 5,
      ...overrides,
    }).map(([name, value]) => ({ name, value }));

  const trapSpikeRunObj = (
    name = "Trap_Spike_Run",
    overrides: Partial<TrapObjectAnnotation> = {},
  ): TrapObjectAnnotation => ({
    id: 1,
    name,
    x: 944,
    y: 208,
    width: 368,
    height: 16,
    properties: trapSpikeRunProps(),
    ...overrides,
  });

  test("recognizes Trap_Spike_Run objects and coerces the props", () => {
    // The real map types speedMax as a string ("100") — values are coerced
    // regardless of Tiled's type field. The entity id is the Tiled
    // object's own id, so two instances stay distinct despite the shared
    // name.
    const trapSpikeRuns = buildTrapSpikeRuns([
      trapSpikeRunObj("Trap_Spike_Run", {
        properties: trapSpikeRunProps({ speedMax: "100" }),
      }),
      trapSpikeRunObj("Trap_Spike_Run", { id: 2 }),
    ]);
    expect(trapSpikeRuns).toHaveLength(2);
    expect(trapSpikeRuns[0]).toMatchObject({
      id: 1,
      x: 944,
      y: 208,
      width: 368,
      height: 16,
      speedMin: 50,
      speedMax: 100,
      time2changeSpeed: 5,
    });
    expect(trapSpikeRuns[1]!.id).toBe(2);
  });

  test("isTrapSpikeRunObject matches only the exact trap name", () => {
    expect(isTrapSpikeRunObject("Trap_Spike_Run")).toBe(true);
    // The old suffixed spelling is no longer recognized (the game renamed
    // the object to match the sprite sheet).
    expect(isTrapSpikeRunObject("Trap_Spike_Run_1")).toBe(false);
    expect(isTrapSpikeRunObject("signpost")).toBe(false);
    expect(isTrapSpikeRunObject("")).toBe(false);
  });

  test("skips non-trap names and missing/invalid properties", () => {
    const trapSpikeRuns = buildTrapSpikeRuns([
      trapSpikeRunObj("signpost"),
      trapSpikeRunObj("Trap_Spike_Run_1"), // suffixed spelling — not a trap
      trapSpikeRunObj("Trap_Spike_Run "), // trailing space — exact match only
      trapSpikeRunObj("Trap_Spike_Run", { properties: [] }),
      // speedMin > speedMax is an empty range — misconfigured, skipped.
      trapSpikeRunObj("Trap_Spike_Run", { properties: trapSpikeRunProps({ speedMin: 200 }) }),
      // Same for a non-positive max.
      trapSpikeRunObj("Trap_Spike_Run", { properties: trapSpikeRunProps({ speedMax: -1 }) }),
      // A zero interval would re-roll forever inside stepTrapSpikeRun.
      trapSpikeRunObj("Trap_Spike_Run", {
        properties: trapSpikeRunProps({ time2change_speed: 0 }),
      }),
    ]);
    expect(trapSpikeRuns).toHaveLength(0);
  });

  test("motion starts centered in the patrol rect, moving right", () => {
    const [spikeRun] = buildTrapSpikeRuns([trapSpikeRunObj()]);
    const motion = createTrapSpikeRunMotion(spikeRun!, () => 0.5);
    expect(motion.x).toBe(spikeRun!.x + spikeRun!.width / 2);
    expect(motion.y).toBe(spikeRun!.y + spikeRun!.height / 2);
    expect(motion.vx).toBeCloseTo(
      spikeRun!.speedMin + 0.5 * (spikeRun!.speedMax - spikeRun!.speedMin),
      10,
    );
    expect(motion.untilSpeedChange).toBe(spikeRun!.time2changeSpeed);
  });

  test("bounces at the patrol rect's edges, flipping direction", () => {
    const [spikeRun] = buildTrapSpikeRuns([trapSpikeRunObj()]);
    const motion = createTrapSpikeRunMotion(spikeRun!, () => 0); // pinned to speedMin
    const dt = 1 / 60;
    // Runs to the right edge and clamps exactly onto it.
    let guard = 0;
    while (motion.x < spikeRun!.x + spikeRun!.width && guard++ < 100_000) {
      stepTrapSpikeRun(motion, spikeRun!, dt, () => 0);
    }
    expect(guard).toBeLessThan(100_000);
    expect(motion.x).toBe(spikeRun!.x + spikeRun!.width);
    expect(motion.vx).toBeLessThan(0); // flipped back left
    // Then back to the left edge.
    guard = 0;
    while (motion.x > spikeRun!.x && guard++ < 100_000) {
      stepTrapSpikeRun(motion, spikeRun!, dt, () => 0);
    }
    expect(motion.x).toBe(spikeRun!.x);
    expect(motion.vx).toBeGreaterThan(0); // flipped back right
  });

  test("re-rolls a new random speed every time2change_speed seconds", () => {
    // A wide trap: at speedMin the first 4.99s step (≈250px) stays inside
    // the patrol rect, so no bounce flips the direction before the roll.
    const [spikeRun] = buildTrapSpikeRuns([
      trapSpikeRunObj("Trap_Spike_Run", { x: 0, width: 1000 }),
    ]); // interval 5s, speed 50..100
    const motion = createTrapSpikeRunMotion(spikeRun!, () => 0); // starts at speedMin
    let calls = 0;
    const rng = () => {
      calls++;
      return 1; // → speedMax = 100
    };
    // One step short of the interval: no re-roll yet.
    stepTrapSpikeRun(motion, spikeRun!, spikeRun!.time2changeSpeed - 0.01, rng);
    expect(calls).toBe(0);
    // Crossing the interval re-rolls exactly once, keeping the direction.
    stepTrapSpikeRun(motion, spikeRun!, 0.02, rng);
    expect(calls).toBe(1);
    expect(motion.vx).toBe(spikeRun!.speedMax); // still moving right
    // The countdown restarts from the interval (minus the overshoot).
    expect(motion.untilSpeedChange).toBeCloseTo(
      spikeRun!.time2changeSpeed - 0.01,
      5,
    );
  });

  test("touching the marker kills: the box overlaps the trap's square", () => {
    const [spikeRun] = buildTrapSpikeRuns([trapSpikeRunObj()]);
    const motion = createTrapSpikeRunMotion(spikeRun!, () => 0.5); // centered in the rect
    const half = spikeRun!.height / 2;
    // A player box centered on the marker overlaps it regardless of how
    // small the player collider is.
    expect(
      isBoxTouchingTrapSpikeRun(
        motion,
        spikeRun!,
        motion.x,
        motion.y,
        config.width,
        config.height,
      ),
    ).toBe(true);
    // A box just inside the marker's right edge touches (edge contact is
    // lethal — the same conservative stance as isBoxInDeadZone).
    expect(
      isBoxTouchingTrapSpikeRun(
        motion,
        spikeRun!,
        motion.x + half + config.width / 2,
        motion.y,
        config.width,
        config.height,
      ),
    ).toBe(true);
    // A box a hair past the edge does not.
    expect(
      isBoxTouchingTrapSpikeRun(
        motion,
        spikeRun!,
        motion.x + half + config.width / 2 + 0.01,
        motion.y,
        config.width,
        config.height,
      ),
    ).toBe(false);
    // A player standing well above (e.g. on a platform over the patrol
    // strip) never touches it.
    expect(
      isBoxTouchingTrapSpikeRun(
        motion,
        spikeRun!,
        motion.x,
        motion.y - spikeRun!.height - config.height,
        config.width,
        config.height,
      ),
    ).toBe(false);
  });
});
describe("move_platform entities (support sheet, no carry)", () => {
  // Mirrors the real map's `move_platform` objectgroup: the object itself
  // is unnamed (`name: ""`) — inside its own group the GROUP name is the
  // type, so the builder recognizes every object in it.
  const movePlatformObj = (
    overrides: Partial<TrapObjectAnnotation> = {},
  ): TrapObjectAnnotation => ({
    id: 21,
    name: "",
    x: 1504,
    y: 144,
    width: 288,
    height: 16,
    properties: [],
    ...overrides,
  });

  test("buildMovePlatforms treats every object in the group as a platform (unnamed instances included)", () => {
    const platforms = buildMovePlatforms([
      movePlatformObj(),
      movePlatformObj({ id: 22 }),
    ]);
    expect(platforms).toHaveLength(2);
    expect(platforms[0]).toMatchObject({
      id: 21,
      x: 1504,
      y: 144,
      width: 288,
      height: 16,
      speed: MOVE_PLATFORM_DEFAULT_SPEED, // no `speed` prop → default
    });
    expect(platforms[1]!.id).toBe(22);
  });

  test("coerces a string `speed` and skips misconfigured objects", () => {
    const platforms = buildMovePlatforms([
      movePlatformObj({
        id: 1,
        properties: [{ name: "speed", value: "80" }],
      }),
      movePlatformObj({ id: 2, properties: [{ name: "speed", value: 0 }] }),
      movePlatformObj({ id: 3, properties: [{ name: "speed", value: -10 }] }),
      movePlatformObj({ id: 4, properties: [{ name: "speed", value: "nope" }] }),
      movePlatformObj({ id: 5, width: 0 }), // degenerate rect
      movePlatformObj({ id: 6, height: -1 }),
    ]);
    expect(platforms).toHaveLength(1);
    expect(platforms[0]).toMatchObject({ id: 1, speed: 80 });
  });

  test("motion starts centered in the lane, moving right at the constant speed", () => {
    const [platform] = buildMovePlatforms([movePlatformObj()]);
    const motion = createMovePlatformMotion(platform!);
    expect(motion.x).toBe(platform!.x + platform!.width / 2);
    expect(motion.y).toBe(platform!.y + platform!.height / 2);
    expect(motion.vx).toBe(platform!.speed);
  });

  test("sweeps the lane at a constant speed, bouncing at the edges", () => {
    const [platform] = buildMovePlatforms([movePlatformObj()]);
    const motion = createMovePlatformMotion(platform!);
    const dt = 1 / 60;
    let guard = 0;
    while (motion.x < platform!.x + platform!.width && guard++ < 100_000) {
      stepMovePlatform(motion, platform!, dt);
    }
    expect(guard).toBeLessThan(100_000);
    expect(motion.x).toBe(platform!.x + platform!.width);
    expect(motion.vx).toBeLessThan(0); // bounced back left
    guard = 0;
    while (motion.x > platform!.x && guard++ < 100_000) {
      stepMovePlatform(motion, platform!, dt);
    }
    expect(guard).toBeLessThan(100_000);
    expect(motion.x).toBe(platform!.x);
    expect(motion.vx).toBeGreaterThan(0); // bounced back right
  });

  test("isBoxOnMovePlatform: feet on the slab top catch; below/side/too-high do not", () => {
    const [platform] = buildMovePlatforms([movePlatformObj()]);
    const motion = createMovePlatformMotion(platform!);
    const half = MOVE_PLATFORM_WIDTH / 2;
    const feetOnTop = movePlatformSurfaceTop(motion, platform!) - config.height / 2;
    // Feet exactly on the top → supported.
    expect(
      isBoxOnMovePlatform(
        motion,
        platform!,
        motion.x,
        feetOnTop,
        config.width,
        config.height,
      ),
    ).toBe(true);
    // A hair above the catch band (already rising past it) → no support.
    expect(
      isBoxOnMovePlatform(
        motion,
        platform!,
        motion.x,
        feetOnTop - MOVE_PLATFORM_RIDE_TOLERANCE - 0.5,
        config.width,
        config.height,
      ),
    ).toBe(false);
    // Feet below the top (a player walking under the slab) → never hoisted.
    expect(
      isBoxOnMovePlatform(
        motion,
        platform!,
        motion.x,
        platform!.y + config.height + 2,
        config.width,
        config.height,
      ),
    ).toBe(false);
    // Horizontally past the slab's edge → no overlap.
    expect(
      isBoxOnMovePlatform(
        motion,
        platform!,
        motion.x + half + config.width / 2 + 0.5,
        feetOnTop,
        config.width,
        config.height,
      ),
    ).toBe(false);
  });

  test("supportPlayerOnMovePlatform grounds the player on the slab WITHOUT carrying them", () => {
    const [platform] = buildMovePlatforms([movePlatformObj()]);
    const motion = createMovePlatformMotion(platform!);
    const state = createPlayerState(config);
    state.x = motion.x - 40; // approaching from the left
    state.y = movePlatformSurfaceTop(motion, platform!) - config.height / 2;
    state.vx = 55; // walking right
    const xBefore = state.x;
    const vxBefore = state.vx;
    supportPlayerOnMovePlatform(state, motion, platform!, config);
    // Grounded with the feet snapped onto the top, vertical drift zeroed,
    // coyote refilled so a buffered jump still fires.
    expect(state.grounded).toBe(true);
    expect(state.y).toBe(
      movePlatformSurfaceTop(motion, platform!) - config.height / 2,
    );
    expect(state.vy).toBe(0);
    expect(state.coyoteTime).toBe(config.coyoteTime);
    // The crux: x and vx are untouched — the slab does NOT pull/push the
    // player; the player stays where its own walk put it.
    expect(state.x).toBe(xBefore);
    expect(state.vx).toBe(vxBefore);
  });

  test("a standing player keeps support over an empty grid and falls when the slab slides out from under them (no carry)", () => {
    const [platform] = buildMovePlatforms([movePlatformObj()]);
    const motion = createMovePlatformMotion(platform!);
    // A tall, wide EMPTY world containing the patrol lane: no tiles at
    // all — the slab is the only support.
    const grid = emptyGrid(140, 12);
    const state = createPlayerState(config);
    state.x = motion.x;
    state.y = movePlatformSurfaceTop(motion, platform!) - config.height / 2;

    // The support flow mirrors scene/update.ts: step the slab, step the
    // player, then (only while not rising AND the feet still overlap the
    // slab) apply the support.
    const support = () => {
      stepMovePlatform(motion, platform!, STEP);
      stepPlayer(state, noInput, grid, STEP, config);
      if (
        state.vy >= 0 &&
        isBoxOnMovePlatform(
          motion,
          platform!,
          state.x,
          state.y,
          config.width,
          config.height,
        )
      ) {
        supportPlayerOnMovePlatform(state, motion, platform!, config);
      }
    };

    // Hold still: the slab slides away, support lasts only while the feet
    // overlap it, then the player drops — and nothing re-supports them.
    // (They fall to the world's invisible floor much later; the window in
    // between proves the slab, not any carry, was holding them up.)
    let supportedFrames = 0;
    let airborneFrames = 0;
    for (let frame = 0; frame < 120; frame++) {
      support();
      if (state.grounded) supportedFrames++;
      else airborneFrames++;
    }
    expect(supportedFrames).toBeGreaterThan(0); // it did support
    expect(airborneFrames).toBeGreaterThan(0); // and fell when the slab left
    expect(supportedFrames).toBeLessThan(120); // but not FOREVER — not glued
  });

  test("walking right keeps the player aboard the slab; support never carries", () => {
    const [platform] = buildMovePlatforms([movePlatformObj()]);
    const motion = createMovePlatformMotion(platform!);
    const grid = emptyGrid(140, 12); // tall, wide empty world containing the lane
    const state = createPlayerState(config);
    state.x = motion.x;
    state.y = movePlatformSurfaceTop(motion, platform!) - config.height / 2;

    const support = () => {
      stepMovePlatform(motion, platform!, STEP);
      stepPlayer(state, { left: false, right: true, jump: false }, grid, STEP, config);
      if (
        state.vy >= 0 &&
        isBoxOnMovePlatform(
          motion,
          platform!,
          state.x,
          state.y,
          config.width,
          config.height,
        )
      ) {
        supportPlayerOnMovePlatform(state, motion, platform!, config);
      }
    };

    // The player walks right (run speed 55 > slab 45) and overtakes the
    // slab slowly, so support holds for a meaningful stretch — thanks to
    // the player's own walk, not any carry (the slab can't keep the feet
    // under it once they've outrun it).
    let supportedFrames = 0;
    const xStart = state.x;
    for (let frame = 0; frame < 120; frame++) {
      support();
      if (state.grounded) supportedFrames++;
    }
    expect(supportedFrames).toBeGreaterThan(60);
    // The player moved under its own steam (way more than the slab moved it
    // — which is zero).
    expect(state.x - xStart).toBeGreaterThan(platform!.speed * 2);
  });

  test("a jump press launches the player off the slab and the vy>=0 gate stops re-catch", () => {
    const [platform] = buildMovePlatforms([movePlatformObj()]);
    const motion = createMovePlatformMotion(platform!);
    const grid = emptyGrid(140, 12); // tall, wide empty world containing the lane
    const state = createPlayerState(config);
    state.x = motion.x;
    state.y = movePlatformSurfaceTop(motion, platform!) - config.height / 2;

    const support = () => {
      stepMovePlatform(motion, platform!, STEP);
      stepPlayer(state, noInput, grid, STEP, config);
      if (
        state.vy >= 0 &&
        isBoxOnMovePlatform(
          motion,
          platform!,
          state.x,
          state.y,
          config.width,
          config.height,
        )
      ) {
        supportPlayerOnMovePlatform(state, motion, platform!, config);
      }
    };

    // Settle onto the slab across a few frames.
    for (let i = 0; i < 10; i++) {
      support();
      expect(state.grounded).toBe(true);
    }
    // A buffered jump press fires off the slab (coyote is held at full
    // while supported)... 
    stepMovePlatform(motion, platform!, STEP);
    stepPlayer(state, { left: false, right: false, jump: true }, grid, STEP, config);
    expect(state.vy).toBeLessThan(0);
    expect(state.grounded).toBe(false);
    // ...and while rising, the vy >= 0 gate keeps the support off — the
    // slab never hoists a player back that just jumped.
    stepMovePlatform(motion, platform!, STEP);
    stepPlayer(state, noInput, grid, STEP, config);
    if (state.vy >= 0) {
      supportPlayerOnMovePlatform(state, motion, platform!, config);
    }
    expect(state.vy).toBeLessThan(0);
    expect(state.grounded).toBe(false);
  });
});
