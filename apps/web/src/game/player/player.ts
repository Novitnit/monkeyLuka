/**
 * Phaser side of the player: a monkey sprite driven by the **shared** physics
 * from `@monkeyluka/shared`. Collision is client-side — this sprite's local
 * step IS the player's movement (rendered immediately); the server validates
 * the reports derived from it and can stop the player. The sprite sheets are
 * served from `public/player` (a symlink to `Assets/player/sheets`), and
 * coordinates are room-local because the sprite is a child of the scene's
 * player layer (a transform twin of room 0, added above all the rooms) and
 * inherits its position/scale.
 */

import type Phaser from "phaser";
import {
  DEFAULT_PLAYER_PHYSICS,
  PLAYER_SPAWN,
  createPlayerState,
  stepPlayer,
  type PlayerInput,
  type PlayerPhysicsState,
  type PlayerStepResult,
  type SolidGrid,
} from "@monkeyluka/shared";
import {
  PLAYER_IDLE_TEXTURE,
  setPlayerAnimation,
} from "./animations";

/** Sprite-sheet texture key the jungle scene loads for the player. */
export const PLAYER_TEXTURE = PLAYER_IDLE_TEXTURE;

export { PLAYER_SPAWN };

/**
 * Largest frame delta fed to the local simulation, seconds. Prevents a tab
 * that was backgrounded for seconds from teleporting the prediction far ahead
 * of the server in a single frame.
 */
const MAX_STEP_DT = 1 / 20;

/** Error beyond which the local prediction is discarded for the server's. */
export const SNAP_DISTANCE = 32;
/** How quickly the render correction closes a sub-snap error (per second). */
const CORRECTION_RATE = 8;
/** Cap on the render correction, px — keeps corrections imperceptible. */
const MAX_CORRECTION = 20;

/** Authoritative state as broadcast in `PlayerInfo`. */
export interface PlayerSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  clinging: boolean;
  facing: number;
}

/** The local, physics-driven monkey. */
export interface Player {
  sprite: Phaser.GameObjects.Sprite;
  /** Locally simulated physics state; the server validates reports from it. */
  readonly physics: PlayerPhysicsState;
  /** Next input applied by the local prediction step. */
  setInput(input: PlayerInput): void;
  /** Advances local prediction one frame; returns contact info. */
  update(dt: number): PlayerStepResult;
  /** Reconciles against the server's broadcast snapshot. */
  applyServerSnapshot(snapshot: PlayerSnapshot): void;
  /** Debug: instantly places the simulation at (x, y) with zero velocity. */
  teleportTo(x: number, y: number): void;
  /** Writes the (corrected) predicted position to the sprite. */
  render(dt: number): void;
  destroy(): void;
}

/**
 * Spawns the player sprite at `PLAYER_SPAWN` inside `room` and wires it to
 * the shared collision grid. The local simulation is the movement itself; the
 * server validates the reports it produces and broadcasts the accepted
 * trajectory, which this reconciles against (a rejected report stops the
 * player until one passes).
 */
export function createPlayer(
  scene: Phaser.Scene,
  room: Phaser.GameObjects.Container,
  grid: SolidGrid,
): Player {
  const physics = createPlayerState(DEFAULT_PLAYER_PHYSICS);
  let input: PlayerInput = { left: false, right: false, jump: false };
  // Offset from predicted to rendered position: chases the server's position
  // when the two disagree, then settles back to zero as prediction agrees.
  const correction = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };

  const sprite = scene.add.sprite(physics.x, physics.y, PLAYER_TEXTURE);
  sprite.setDepth(10);
  room.add(sprite);

  return {
    sprite,
    physics,

    setInput(next: PlayerInput): void {
      input = next;
    },

    update(dt: number): PlayerStepResult {
      const result = stepPlayer(
        physics,
        input,
        grid,
        Math.min(dt, MAX_STEP_DT),
        DEFAULT_PLAYER_PHYSICS,
      );
      // The jump edge lasts a single frame; the network layer re-sends it
      // until the server has had a chance to apply it.
      input = { ...input, jump: false };
      return result;
    },

    applyServerSnapshot(snapshot: PlayerSnapshot): void {
      const ex = snapshot.x - physics.x;
      const ey = snapshot.y - physics.y;
      if (Math.hypot(ex, ey) > SNAP_DISTANCE) {
        // Too far to reconcile smoothly (server correction, teleport, or a
        // long stall) — trust the server outright.
        physics.x = snapshot.x;
        physics.y = snapshot.y;
        physics.vx = snapshot.vx;
        physics.vy = snapshot.vy;
        physics.grounded = snapshot.grounded;
        physics.clinging = snapshot.clinging;
        correction.x = 0;
        correction.y = 0;
        target.x = 0;
        target.y = 0;
        return;
      }
      target.x = ex;
      target.y = ey;
    },

    teleportTo(x: number, y: number): void {
      physics.x = x;
      physics.y = y;
      physics.vx = 0;
      physics.vy = 0;
      correction.x = 0;
      correction.y = 0;
      target.x = 0;
      target.y = 0;
    },

    render(dt: number): void {
      const rate = Math.min(1, CORRECTION_RATE * dt);
      correction.x += (target.x - correction.x) * rate;
      correction.y += (target.y - correction.y) * rate;
      const clamp = (value: number): number =>
        Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, value));
      sprite.x = physics.x + clamp(correction.x);
      sprite.y = physics.y + clamp(correction.y);
      sprite.setFlipX(physics.facing < 0);
      // Frame the idle/cling/jog/jump animation from the simulated state.
      setPlayerAnimation(sprite, physics.grounded, physics.vx, physics.clinging);
    },

    destroy(): void {
      sprite.destroy();
    },
  };
}