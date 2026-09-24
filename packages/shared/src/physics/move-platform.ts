/**
 * Movable platforms — the `move_platform` objectgroup of the Tiled map.
 *
 * Unlike the lethal `Trap_Spike_Run` markers (the `trap` objectgroup), a
 * move_platform is a SUPPORT surface, not a hazard: a slab (a 32×16
 * platform rendered from the `movePlatformF.png` sheet — two 16×16 frames
 * side by side, see the web render module) that patrols the object's
 * rectangle horizontally at a constant speed, bouncing at its edges.
 * Standing on the slab's top grants ground support (`grounded`), but the
 * platform does **not** carry the player — the player must walk to follow
 * it. When the slab slides out from under the feet, or the player walks
 * off its edge, support ends and the player falls like walking off any
 * ledge.
 *
 * One entity per object in the group; the object's own Tiled id is its
 * identity. The real map's single object is unnamed (`name: ""` with
 * `type: ""`) — inside its own objectgroup the GROUP name is the type, so
 * this builder does not filter objects by name (contrast
 * `buildTrapSpikeRuns`, where the objects' own names are the type and the
 * `trap` group is the shared container). The object's rectangle is the
 * patrol lane: the slab sweeps from the rect's left edge to its right
 * edge, vertically centered, so the slab's top surface rides the rect's
 * top edge.
 *
 * One optional custom property drives the motion:
 *
 * - `speed` — constant patrol speed, px/s. Missing → the default
 *   (`MOVE_PLATFORM_DEFAULT_SPEED`); an explicit invalid value (0,
 *   negative, NaN) skips the object entirely (a misconfigured platform is
 *   dropped, mirroring `buildTrapSpikeRuns`).
 *
 * The default speed sits BELOW the player's run speed (55 px/s): since the
 * platform never carries, a slab that outruns the player can never be
 * caught again, while a slower slab can always be walked onto and followed.
 * Map authors tune `speed` to the lane.
 *
 * Pure and engine-free like the rest of the physics barrel:
 * `buildMovePlatforms` turns the raw Tiled annotations into
 * `MovePlatformEntity`s, `stepMovePlatform` advances a
 * `MovePlatformMotion` deterministically, `isBoxOnMovePlatform` is the
 * feet-on-the-slab probe the web client runs against the player box, and
 * `supportPlayerOnMovePlatform` applies the ground support it grants
 * (grounded, feet snapped onto the top — but never touching `x`/`vx`, so
 * the player never rides along). Positions are map pixels, the same space
 * as the player physics and the spike-run traps.
 */

import type { PlayerPhysicsConfig, PlayerPhysicsState } from "./player";
import { DEFAULT_PLAYER_PHYSICS } from "./player";
import type {
  TrapObjectAnnotation,
  TrapObjectProperty,
} from "./trap-spike-run";

/**
 * The Tiled objectgroup that holds the platform annotations. It is its own
 * group (not the shared `trap` group): the group name IS the type, and
 * every object inside it is one platform instance.
 */
export const MOVE_PLATFORM_OBJECT_GROUP_NAME = "move_platform";
/** Custom property: constant patrol speed (px/s); missing → default. */
export const MOVE_PLATFORM_SPEED_PROP = "speed";
/**
 * Default patrol speed, px/s — BELOW the player's run speed (55 px/s), so
 * the slab can always be walked onto and followed: the platform does not
 * carry, and a slab faster than the player would be unrecoverable once it
 * outran the feet. Map authors tune `speed` per lane.
 */
export const MOVE_PLATFORM_DEFAULT_SPEED = 45;
/**
 * The slab's standing surface: 32px wide × 16px tall (two 16×16 sheet
 * frames side by side, rendered as a doubled sprite — see
 * move-platform-render.ts). The web overlay and the support probe test
 * this exact footprint.
 */
export const MOVE_PLATFORM_WIDTH = 32;
export const MOVE_PLATFORM_HEIGHT = 16;
/**
 * Feet-to-surface catch band, px: a falling player's feet can be up to
 * this far above the slab top (or exactly on it, +1px sink slack) and
 * still be supported. Sized above the worst per-frame fall (~6px at
 * 340 px/s @ 60 fps) so a falling player never tunnels through the slab;
 * feet BELOW the top never catch, so the platform never hoists a player
 * walking underneath it.
 */
export const MOVE_PLATFORM_RIDE_TOLERANCE = 6;

/** A raw move_platform object as parsed from the map's objectgroup. */
export type MovePlatformObjectAnnotation = TrapObjectAnnotation;
/** One custom property of a Tiled move_platform object (name + raw value). */
export type MovePlatformObjectProperty = TrapObjectProperty;

/**
 * One recognized move_platform: the patrol lane plus its constant speed.
 * `id` is the Tiled object's own numeric id, distinguishing each platform
 * instance.
 */
export interface MovePlatformEntity {
  id: number;
  /** Patrol lane, map px (the Tiled object's rectangle). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Constant patrol speed, px/s (bounces at the lane's edges). */
  speed: number;
}

/**
 * Recognize every move_platform in its objectgroup. The group name is the
 * type, so every object becomes a platform (the real map's instance is
 * unnamed); an object with a degenerate rect, or an EXPLICIT `speed` that
 * is junk (0, negative, NaN/`"nope"`), is skipped — a misconfigured
 * platform is dropped. A MISSING `speed` falls back to
 * `MOVE_PLATFORM_DEFAULT_SPEED`: the real map carries no props, and a
 * platform without one is still a platform.
 */
export function buildMovePlatforms(
  objects: readonly TrapObjectAnnotation[],
): MovePlatformEntity[] {
  const movePlatforms: MovePlatformEntity[] = [];
  for (const obj of objects) {
    if (obj.width <= 0 || obj.height <= 0) continue;
    const speedProp = obj.properties.find(
      (candidate) => candidate.name === MOVE_PLATFORM_SPEED_PROP,
    );
    let speed = MOVE_PLATFORM_DEFAULT_SPEED;
    if (speedProp !== undefined) {
      const parsed = Number(speedProp.value);
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      speed = parsed;
    }
    movePlatforms.push({
      id: obj.id,
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      speed,
    });
  }
  return movePlatforms;
}

/**
 * Runtime motion of one move_platform: the slab's current center (map px)
 * and its signed patrol speed (the sign is the travel direction).
 */
export interface MovePlatformMotion {
  x: number;
  y: number;
  /** Signed patrol speed (px/s); the sign is the travel direction. */
  vx: number;
}

/**
 * The initial motion of a platform: its slab centered in its patrol lane,
 * moving right at the constant patrol speed.
 */
export function createMovePlatformMotion(
  platform: MovePlatformEntity,
): MovePlatformMotion {
  return {
    x: platform.x + platform.width / 2,
    y: platform.y + platform.height / 2,
    vx: platform.speed,
  };
}

/**
 * Advance a platform's motion by `dt` seconds: the slab moves along the
 * patrol lane's horizontal axis at the constant speed, bouncing at the
 * left/right edges (clamping onto the edge and flipping direction). The
 * slab never moves vertically — the lane is a flat corridor, so the
 * standing surface's height is constant.
 */
export function stepMovePlatform(
  motion: MovePlatformMotion,
  platform: MovePlatformEntity,
  dt: number,
): void {
  if (dt <= 0) return;
  const minX = platform.x;
  const maxX = platform.x + platform.width;
  motion.x += motion.vx * dt;
  if (motion.x <= minX) {
    motion.x = minX;
    motion.vx = Math.abs(motion.vx);
  } else if (motion.x >= maxX) {
    motion.x = maxX;
    motion.vx = -Math.abs(motion.vx);
  }
}

/** The slab's top edge — the standing surface, map px. */
export function movePlatformSurfaceTop(
  motion: MovePlatformMotion,
  platform: MovePlatformEntity,
): number {
  return motion.y - platform.height / 2;
}

/**
 * Does the player's AABB (center (x, y), `width`×`height` — the same box
 * the dead-zone/trap probes use) stand on the platform's slab right now?
 * The player's feet (AABB bottom) must be at/above the slab top by no more
 * than `MOVE_PLATFORM_RIDE_TOLERANCE` (a falling catch; feet exactly on
 * the top with a 1px sink slack), never below the top (so a player walking
 * underneath is never hoisted), and the box must horizontally overlap the
 * slab — the 32×16 `MOVE_PLATFORM_WIDTH`×`MOVE_PLATFORM_HEIGHT` surface
 * centered on the motion position. The web client probes its own simulated
 * position against every platform each frame — see the support in
 * `scene/update.ts`.
 */
export function isBoxOnMovePlatform(
  motion: MovePlatformMotion,
  platform: MovePlatformEntity,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const half = MOVE_PLATFORM_WIDTH / 2;
  const top = movePlatformSurfaceTop(motion, platform);
  const bottom = y + height / 2;
  if (bottom > top + 1) return false;
  if (bottom < top - MOVE_PLATFORM_RIDE_TOLERANCE) return false;
  return Math.abs(motion.x - x) <= width / 2 + half;
}

/**
 * Apply the ground support a platform grants a player standing on its
 * slab: the feet are snapped onto the slab top, vertical velocity zeroed
 * (the slab is a floor), the player marked grounded (so runs/jumps/coyote
 * work exactly like standing on tiles) and not clinging, with the coyote
 * timer refilled so a buffered jump press fires off the slab. Deliberately
 * touches **only** `y`/`vy`/`grounded`/`clinging`/`coyoteTime` — `x` and
 * `vx` are never modified: the platform does NOT carry the player, who
 * must walk manually (see the module comment). The caller gates this on a
 * non-rising (`vy >= 0`) state so a jump press is never cancelled by the
 * next support snap.
 */
export function supportPlayerOnMovePlatform(
  physics: PlayerPhysicsState,
  motion: MovePlatformMotion,
  platform: MovePlatformEntity,
  config: PlayerPhysicsConfig = DEFAULT_PLAYER_PHYSICS,
): void {
  physics.y = movePlatformSurfaceTop(motion, platform) - config.height / 2;
  physics.vy = 0;
  physics.grounded = true;
  physics.clinging = false;
  physics.coyoteTime = config.coyoteTime;
}