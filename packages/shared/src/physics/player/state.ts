/**
 * Player physics state types + the spawn factory. The state is mutable,
 * serializable plain data: `stepPlayer` mutates it in place every frame,
 * and the client reports its fields (plus velocity) to the server for
 * anti-cheat validation.
 */

import type { PlayerPhysicsConfig } from "./config";
import { DEFAULT_PLAYER_PHYSICS, PLAYER_SPAWN } from "./config";

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

/** Baseline state at the shared spawn point, floating above the left floor. */
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