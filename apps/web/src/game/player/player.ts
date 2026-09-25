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
/**
 * Server-broadcast offset beyond which the broadcast is adopted outright no
 * matter its velocity. Below this, while the server is still ACCEPTING the
 * local trajectory (its broadcast velocities are non-zero), the offset is
 * just the transport's ~one-RTT lead — the sprite ignores it and renders
 * the local prediction directly, so honest high-latency play (Cloudflare
 * tunnel, WAN) never trails or rubber-bands. (The in-game teleport flows —
 * checkpoint, revive — place the sim directly and never reach this path.)
 */
const HARD_SNAP_LIMIT = 240;

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
  /**
   * Boot-time adoption of a server snapshot (resumed session): places the
   * simulation at the server's last accepted state unconditionally, so the
   * first report reads as a re-baseline instead of a teleport.
   */
  adoptServerState(snapshot: PlayerSnapshot): void;
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
      const dist = Math.hypot(ex, ey);
      // The broadcast is authoritative when the server STOPPED us (violation
      // halt, checkpoint re-baseline) or the discrepancy is so large it can't
      // be a latency artifact (teleport-scale correction / long stall) —
      // adopt it outright so the monkey visibly freezes where the server put
      // it. Otherwise the offset is just ~one RTT of honest movement the
      // server hasn't caught up to yet: the local simulation IS the player
      // (it's client-simulated), so there is nothing to reconcile — the
      // sprite renders the prediction directly and never trails.
      const stopped =
        Math.abs(snapshot.vx) < 1e-6 && Math.abs(snapshot.vy) < 1e-6;
      if (dist > HARD_SNAP_LIMIT || (stopped && dist > SNAP_DISTANCE)) {
        physics.x = snapshot.x;
        physics.y = snapshot.y;
        physics.vx = snapshot.vx;
        physics.vy = snapshot.vy;
        physics.grounded = snapshot.grounded;
        physics.clinging = snapshot.clinging;
      }
    },

    adoptServerState(snapshot: PlayerSnapshot): void {
      physics.x = snapshot.x;
      physics.y = snapshot.y;
      physics.vx = snapshot.vx;
      physics.vy = snapshot.vy;
      physics.grounded = snapshot.grounded;
      physics.clinging = snapshot.clinging;
    },

    teleportTo(x: number, y: number): void {
      physics.x = x;
      physics.y = y;
      physics.vx = 0;
      physics.vy = 0;
    },

    render(_dt: number): void {
      // The local prediction IS the rendered position: movement is
      // client-simulated, so the sprite shows exactly what the player asked
      // for — zero input→pixel latency (no chasing the ~one-RTT-stale
      // broadcast), and the trap/pit kill probes align with what the player
      // actually sees. Only server stops/teleports move `physics`, and the
      // sprite follows them the frame the snapshot is applied.
      sprite.x = physics.x;
      sprite.y = physics.y;
      sprite.setFlipX(physics.facing < 0);
      // Frame the idle/cling/jog/jump animation from the simulated state.
      setPlayerAnimation(sprite, physics.grounded, physics.vx, physics.clinging);
    },

    destroy(): void {
      sprite.destroy();
    },
  };
}