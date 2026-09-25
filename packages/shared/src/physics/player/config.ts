/**
 * Player tuning and input contract: the config + spawn defaults for the
 * shared simulation and the speed ceiling `maxPlayerSpeed` the anti-cheat
 * uses.
 */

import { TILE_SIZE } from "../tiles";

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
export const PLAYER_SPAWN = { x: (4*16)+8, y: (11*16) } as const;
// export const PLAYER_SPAWN = { x: (33*16)+8, y: (9*16) } as const;
// export const PLAYER_SPAWN = { x: (59*16)+8, y: (1*16) } as const;
// export const PLAYER_SPAWN = { x: (59*16)+8, y: (13*16) } as const;
// export const PLAYER_SPAWN = { x: (90*16)+8, y: (8*16) } as const;
// export const PLAYER_SPAWN = { x: (114*16)+8, y: (8*16) } as const;

/**
 * Tuning for the jungle monkey. Chosen so the platforms are reachable: the
 * runway above the left floor (via the 287/288 ramps) sits 16px higher — a
 * full jump rises ~34px and covers ~90px horizontally.
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

/**
 * The fastest a legitimately-simulated player can travel, px/s. Used by the
 * server's speed check on reported positions; identical on both sides so the
 * ceiling can never undercut a real player.
 */
export function maxPlayerSpeed(config: PlayerPhysicsConfig = DEFAULT_PLAYER_PHYSICS): number {
  return Math.max(config.runSpeed, config.maxFallSpeed);
}