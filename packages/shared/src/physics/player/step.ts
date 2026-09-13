/**
 * Deterministic player physics: input → run acceleration, gravity, buffered
 * jump, and axis-separated AABB collision with slope surfaces via the
 * penetration helpers in collision.ts. Runs client-side every frame for
 * prediction; the server validates the reported trajectory instead of
 * re-simulating (see validation.ts).
 */

import {
  grabableWallBeside,
  horizontalPenetration,
  verticalPenetration,
  wallBeside,
} from "../collision";
import { gridPixelSize } from "../tiles";
import type { SolidGrid } from "../tiles";
import type { PlayerInput, PlayerPhysicsConfig } from "./config";
import { DEFAULT_PLAYER_PHYSICS } from "./config";
import type { PlayerPhysicsState, PlayerStepResult } from "./state";

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
 * again (wall jump: launches up and away), walk the wall face below them,
 * or land. Steering away from the wall does NOT release the cling — the
 * only way to detach while the wall is still beside them is to jump. See
 * `wallBeside` in collision.ts.
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
      // Let go only when the wall face ends below them or (handled in the
      // vertical pass) they land. Steering away from the wall does not
      // release the cling — the player detaches by jumping.
      if (!wallBeside(grid, state.x, state.y, hw, hh, state.clingDir)) {
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
  // ground fires the instant the player lands (a "quick bounce").
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
    // already resting flush against the wall. `grabableWallBeside` excludes
    // doors (TILE_DOOR): a door is a smooth face, so jumping into a closed
    // door slides off instead of hanging — the door is non-sticky, ordinary
    // walls keep the cling. Reaching here skips the wall jump path — a grab
    // consumes the press instead of launching.
    const grabDir: 0 | 1 | -1 =
      result.hitWall !== 0 &&
      grabableWallBeside(grid, state.x, state.y, hw, hh, result.hitWall as 1 | -1)
        ? result.hitWall
        : input.right && grabableWallBeside(grid, state.x, state.y, hw, hh, 1)
          ? 1
          : input.left && grabableWallBeside(grid, state.x, state.y, hw, hh, -1)
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