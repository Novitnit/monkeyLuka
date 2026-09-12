/**
 * Deterministic player physics: input → run acceleration, gravity, buffered
 * jump, and axis-separated AABB collision with slope surfaces via the
 * penetration helpers in collision.ts. Runs client-side every frame for
 * prediction; the server validates the reported trajectory instead of
 * re-simulating (see validation.ts).
 */

import { horizontalPenetration, verticalPenetration } from "./collision";
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
  width: 16,
  height: 16,
  runSpeed: 55,
  acceleration: 640,
  deceleration: 900,
  gravity: 480,
  jumpSpeed: 140,
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
    coyoteTime: 0,
    jumpBufferTime: 0,
  };
}

/**
 * Advances the player by `dt` seconds under `input`. Mutates `state` and
 * returns contact info for effects. Runs client-side every frame; the client
 * reports the result and the server validates its trajectory (see
 * `validatePositionReport`).
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
  // --- Horizontal control: accelerate toward the run speed. ---
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const targetVx = dir * config.runSpeed;
  if (state.vx < targetVx) {
    state.vx = Math.min(targetVx, state.vx + config.acceleration * dt);
  } else if (state.vx > targetVx) {
    state.vx = Math.max(targetVx, state.vx - config.deceleration * dt);
  }
  if (dir !== 0) state.facing = dir as 1 | -1;

  // --- Gravity. ---
  state.vy = Math.min(state.vy + config.gravity * dt, config.maxFallSpeed);

  // Ground is re-derived from the vertical pass every step: a player who
  // walks off a ledge must stop being grounded immediately.
  state.grounded = false;

  // --- Integrate + collide, axis-separated with clamped substeps. ---
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

    const dir = Math.sign(step) as 1 | -1;
    const pen = verticalPenetration(grid, state.x, state.y, hw, hh, dir);
    if (pen > 0) {
      state.y -= dir * pen;
      state.vy = 0;
      if (dir > 0) {
        state.grounded = true;
        result.landed = true;
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
    }
  }

  // --- Jump: buffer presses, grant coyote time off ledges. ---
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