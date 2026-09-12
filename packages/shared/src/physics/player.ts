/**
 * Deterministic player physics: input → run acceleration, gravity, buffered
 * jump, and axis-separated AABB collision with slope surfaces via the
 * penetration helpers in collision.ts. Runs client-side every frame for
 * prediction; the server validates the reported trajectory instead of
 * re-simulating (see validation.ts).
 */

import {
  horizontalPenetration,
  verticalPenetration,
  wallBeside,
} from "./collision";
import { TILE_SIZE, gridPixelSize } from "./tiles";
import type { SolidGrid } from "./tiles";

/** Input axes the player sends each step; jump is a pressed edge. */
export interface PlayerInput {
  left: boolean;
  right: boolean;
  /** True on the step the jump key was pressed (not held). */
  jump: boolean;
}

export interface PlayerPhysicsConfig {
  /** Collider size — slightly smaller than the 16px sprite for forgiveness. */
  width: number;
  height: number;
  /** Horizontal run speed, px/s. */
  runSpeed: number;
  /** Horizontal acceleration (reaching run speed), px/s². */
  acceleration: number;
  /** Deceleration when no horizontal input, px/s². */
  deceleration: number;
  /** Gravity, px/s² (positive pulls down). */
  gravity: number;
  /** Upward impulse of a jump, px/s. */
  jumpSpeed: number;
  /** Horizontal launch of a wall jump (away from the wall), px/s. */
  wallJumpSpeed: number;
  /** Upward impulse of a wall jump, px/s. */
  wallJumpLift: number;
  /** Terminal fall speed, px/s (also the anti-cheat speed ceiling). */
  maxFallSpeed: number;
  /** Seconds a jump is still accepted after walking off a ledge. */
  coyoteTime: number;
  /** Seconds a jump press stays buffered before it expires. */
  jumpBufferTime: number;
  /** Longest single collision substep (prevents tunneling), px. */
  maxSubstep: number;
}

/** Where the player spawns (map pixels, AABB center). */
export const PLAYER_SPAWN = { x: 96, y: 176 } as const;

/**
 * Tuning for the jungle monkey. Chosen so the platforms are reachable: the
 * right platform's top is 16px above the left one and the gap between them
 * is 32px — a full jump rises ~34px and covers ~90px horizontally.
 */
export const DEFAULT_PLAYER_PHYSICS: PlayerPhysicsConfig = {
  width: 13,
  height: 14,
  runSpeed: 55,
  acceleration: 640,
  deceleration: 900,
  gravity: 480,
  jumpSpeed: 140,
  // Wall jump: up + away, stronger vertically than a ground jump so it can
  // climb a one-tile wall face (rise ~ 170²/(2·480) ≈ 30px, airtime
  // ~ 2·170/480 ≈ 0.71s — enough to cross the 32px platform gap while
  // steering). hypot(170, 96) ≈ 195 < maxFallSpeed so the anti-cheat speed
  // ceiling is never undercut.
  wallJumpSpeed: 96,
  wallJumpLift: 170,
  maxFallSpeed: 340,
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  maxSubstep: TILE_SIZE / 2,
};

/** Mutable per-player physics state (serializable, plain data). */
export interface PlayerPhysicsState {
  /** AABB center, map pixels, y down. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  /** 1 facing right, -1 facing left (drives sprite flip). */
  facing: 1 | -1;
  /** Grabbed a wall: hanging mid-air beside it (no gravity, no lateral drift). */
  clinging: boolean;
  /** Wall side being clung to: 1 = wall on the right, -1 = wall on the left. */
  clingDir: 1 | -1;
  /** Seconds of coyote leniency remaining (0 = none). */
  coyoteTime: number;
  /** Seconds of buffered jump remaining (0 = none). */
  jumpBufferTime: number;
}

export interface PlayerStepResult {
  /** Grounded after this step. */
  grounded: boolean;
  /** Became grounded this step (landed a jump/fall). */
  landed: boolean;
  /** -1 / +1 when a wall blocked horizontal motion this step, else 0. */
  hitWall: -1 | 0 | 1;
  /** Hit a ceiling this step. */
  hitCeiling: boolean;
}

/** Baseline state at the shared spawn point, resting on the left platform. */
export function createPlayerState(
  config: PlayerPhysicsConfig = DEFAULT_PLAYER_PHYSICS,
): PlayerPhysicsState {
  return {
    x: PLAYER_SPAWN.x,
    y: PLAYER_SPAWN.y,
    vx: 0,
    vy: 0,
    grounded: false,
    facing: 1,
    clinging: false,
    clingDir: 1,
    coyoteTime: 0,
    jumpBufferTime: 0,
  };
}

/**
 * Advances the player by `dt` seconds under `input`. Mutates `state` and
 * returns contact info for effects. Runs client-side every frame; the client
 * reports the result and the server validates its trajectory (see
 * `validatePositionReport`).
 *
 * Wall cling (grab): while airborne, pressing (or having buffered) jump
 * while next to a wall and moving into it grabs the wall — the player hangs
 * mid-air (gravity/lateral drift off, facing away from the wall) until they
 * press jump
 * again (wall jump: launches up and away), press away from the wall, walk
 * the wall face below them, or land. See `wallBeside` in collision.ts.
 */
export function stepPlayer(
  state: PlayerPhysicsState,
  input: PlayerInput,
  grid: SolidGrid,
  dt: number,
  config: PlayerPhysicsConfig = DEFAULT_PLAYER_PHYSICS,
): PlayerStepResult {
  const hw = config.width / 2;
  const hh = config.height / 2;
  const result: PlayerStepResult = {
    grounded: state.grounded,
    landed: false,
    hitWall: 0,
    hitCeiling: false,
  };
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  // --- Wall cling (grab) state. ---
  if (state.clinging) {
    // Wall jump: jump pressed while clinging launches up and away, then
    // normal physics resumes this same step so the impulse is integrated.
    if (state.jumpBufferTime > 0) {
      state.vy = -config.wallJumpLift;
      state.vx = -state.clingDir * config.wallJumpSpeed;
      state.clinging = false;
      state.jumpBufferTime = 0;
      state.coyoteTime = 0;
    } else {
      // Let go when the player steers away from the wall, the wall face
      // ends below them, or (handled in the vertical pass) they land.
      const away = state.clingDir > 0 ? input.left : input.right;
      if (
        away ||
        !wallBeside(grid, state.x, state.y, hw, hh, state.clingDir)
      ) {
        state.clinging = false;
      } else {
        // Hanging: no gravity, no lateral drift, glued to the cling wall.
        state.vy = 0;
        state.vx = 0;
        state.grounded = false;
        // Face away from the wall — the mirror of the cling side on the
        // X-axis (the monkey braces against the wall behind it).
        state.facing = (-state.clingDir) as 1 | -1;
      }
    }
  }

  if (!state.clinging) {
    // --- Horizontal control: accelerate toward the run speed. ---
    const targetVx = dir * config.runSpeed;
    if (state.vx < targetVx) {
      state.vx = Math.min(targetVx, state.vx + config.acceleration * dt);
    } else if (state.vx > targetVx) {
      state.vx = Math.max(targetVx, state.vx - config.deceleration * dt);
    }
    if (dir !== 0) state.facing = dir as 1 | -1;

    // --- Gravity. ---
    state.vy = Math.min(state.vy + config.gravity * dt, config.maxFallSpeed);
  }

  // Ground is re-derived from the vertical pass every step: a player who
  // walks off a ledge must stop being grounded immediately.
  state.grounded = false;

  // --- Integrate + collide, axis-separated with clamped substeps. ---
  // While hanging vx/vy are both 0, so this pass is a no-op.
  const world = gridPixelSize(grid);

  // Horizontal axis.
  let remainingX = state.vx * dt;
  while (Math.abs(remainingX) > 1e-6) {
    const step = Math.max(
      -config.maxSubstep,
      Math.min(config.maxSubstep, remainingX),
    );
    state.x += step;
    remainingX -= step;

    const pen = horizontalPenetration(
      grid,
      state.x,
      state.y,
      hw,
      hh,
      Math.sign(step) as 1 | -1,
    );
    if (pen > 0) {
      state.x -= Math.sign(step) * pen;
      state.vx = 0;
      result.hitWall = Math.sign(step) as -1 | 1;
      break;
    }
  }

  // Vertical axis (after horizontal, so corner landings resolve cleanly).
  let remainingY = state.vy * dt;
  while (Math.abs(remainingY) > 1e-6) {
    const step = Math.max(
      -config.maxSubstep,
      Math.min(config.maxSubstep, remainingY),
    );
    state.y += step;
    remainingY -= step;

    const vyDir = Math.sign(step) as 1 | -1;
    const pen = verticalPenetration(grid, state.x, state.y, hw, hh, vyDir);
    if (pen > 0) {
      state.y -= vyDir * pen;
      state.vy = 0;
      if (vyDir > 0) {
        state.grounded = true;
        result.landed = true;
        // Landing ends a cling (e.g. the world floor under a hang).
        state.clinging = false;
      } else {
        result.hitCeiling = true;
      }
      break;
    }
  }

  // Clamp to the world, treating the borders as an invisible floor/walls.
  const maxX = world.width - hw;
  const maxY = world.height - hh;
  if (state.x < hw) {
    state.x = hw;
    if (state.vx < 0) state.vx = 0;
    result.hitWall = -1;
  } else if (state.x > maxX) {
    state.x = maxX;
    if (state.vx > 0) state.vx = 0;
    result.hitWall = 1;
  }
  if (state.y < hh) {
    state.y = hh;
    if (state.vy < 0) state.vy = 0;
  } else if (state.y > maxY) {
    state.y = maxY;
    state.vy = 0;
    if (!state.grounded) {
      state.grounded = true;
      result.landed = true;
      state.clinging = false;
    }
  }

  // --- Jump: buffer presses, grant coyote time off ledges, grab walls. ---
  // Checked after integration so a press buffered right before touching
  // ground fires the instant the player lands (a “quick bounce”).
  state.jumpBufferTime = input.jump
    ? config.jumpBufferTime
    : Math.max(0, state.jumpBufferTime - dt);
  state.coyoteTime = state.grounded
    ? config.coyoteTime
    : Math.max(0, state.coyoteTime - dt);
  if (state.jumpBufferTime > 0 && (state.grounded || state.coyoteTime > 0)) {
    state.vy = -config.jumpSpeed;
    state.grounded = false;
    state.jumpBufferTime = 0;
    state.coyoteTime = 0;
    result.landed = false; // the bounce supersedes the landing contact
  } else if (state.jumpBufferTime > 0 && !state.grounded && !state.clinging) {
    // Wall grab: airborne, jump pressed (or still buffered), beside a wall
    // and moving into it. `result.hitWall` covers the step the wall stopped
    // the player (even without input); the input checks cover a player
    // already resting flush against the wall. Reaching here skips the wall
    // jump path — a grab consumes the press instead of launching.
    const grabDir: 0 | 1 | -1 =
      result.hitWall !== 0 &&
      wallBeside(grid, state.x, state.y, hw, hh, result.hitWall as 1 | -1)
        ? result.hitWall
        : input.right && wallBeside(grid, state.x, state.y, hw, hh, 1)
          ? 1
          : input.left && wallBeside(grid, state.x, state.y, hw, hh, -1)
            ? -1
            : 0;
    if (grabDir !== 0) {
      state.clinging = true;
      state.clingDir = grabDir;
      state.jumpBufferTime = 0;
      state.coyoteTime = 0;
    }
  }

  result.grounded = state.grounded;
  return result;
}

/**
 * The fastest a legitimately-simulated player can travel, px/s. Used by the
 * server's speed check on reported positions; identical on both sides so the
 * ceiling can never undercut a real player.
 */
export function maxPlayerSpeed(config: PlayerPhysicsConfig = DEFAULT_PLAYER_PHYSICS): number {
  return Math.max(config.runSpeed, config.maxFallSpeed);
}