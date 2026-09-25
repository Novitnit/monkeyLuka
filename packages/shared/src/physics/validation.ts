/**
 * Networking contract between the client simulation and the server's
 * anti-cheat: the `player:input` wire message and `validatePositionReport`,
 * the pure trajectory checks (teleport / abnormal speed) the Colyseus room
 * runs on every client report before broadcasting it.
 */

import { isPointSolid } from "./collision";
import { DEFAULT_PLAYER_PHYSICS, maxPlayerSpeed } from "./player";
import { TILE_SIZE } from "./tiles";
import type { PlayerPhysicsConfig } from "./player";
import type { SolidGrid } from "./tiles";

/** Colyseus message name: client → server movement report. */
export const PLAYER_INPUT_MESSAGE = "player:input";

/**
 * Cadence at which the browser client sends `PLAYER_INPUT_MESSAGE` reports,
 * ms (the update loop's INPUT_INTERVAL_MS; see apps/web scene/constants.ts).
 * The room floors the speed-check `dt` by this interval: a high-latency,
 * jittery transport (Cloudflare tunnel, WAN) can deliver several of a
 * client's 50 ms-spaced reports back-to-back, collapsing the measured
 * wall-clock gap while the reported positions are a full cadence apart —
 * without this floor that reads as impossible movement and freezes honest
 * players.
 */
export const INPUT_INTERVAL_MS = 50;

/**
 * Colyseus message name: client → server interaction trigger (the E key on
 * an interaction tile — see interaction.ts). The room resolves the action
 * from the sent gid **after re-probing the player's last accepted position**
 * against the shared interaction grid, so a forged message can only fire an
 * interaction the sender is genuinely standing on.
 */
export const PLAYER_INTERACTION_MESSAGE = "player:interaction";

/**
 * Debug wire message: the client asks to be teleported back to its
 * checkpoint (the R key). The room registers the handler **unconditionally**
 * — its target is the server-chosen spawn, never a client-supplied
 * position, so a forged message can't bypass the anti-cheat — and the room
 * re-baselines its validation at the spawn so the jump isn't a teleport
 * violation. Only the R key itself is debug-gated, on the web side
 * (`NEXT_PUBLIC_DEBUG`).
 */
export const PLAYER_CHECKPOINT_MESSAGE = "player:checkpoint";

/**
 * Payload of `PLAYER_INPUT_MESSAGE`. Collision runs **client-side** (see
 * `stepPlayer`); this is the client's per-report summary of its simulated
 * state (position, velocity, contact, facing). Everything is advisory — the
 * server validates the reported trajectory (teleport / abnormal speed /
 * buried-in-geometry, see `validatePositionReport`) and broadcasts only
 * reports that pass. A failing report stops the player at the last accepted
 * position while the violation counts toward a kick.
 */
export interface PlayerInputMessage {
  /** Client-incrementing counter; server drops out-of-order or flooded seqs. */
  seq: number;
  /** Client-predicted position (map pixels, AABB center) — advisory. */
  px: number;
  py: number;
  /** Resulting velocity, px/s — advisory (clamped on the server). */
  vx: number;
  vy: number;
  /** Resulting contact state — advisory. */
  grounded: boolean;
  /** Resulting wall-cling state — advisory. */
  clinging: boolean;
  /** Resulting facing, 1 right / -1 left — advisory (normalized on server). */
  facing: number;
}

/**
 * Payload of `PLAYER_INTERACTION_MESSAGE`. Deliberately minimal: `gid` is
 * advisory — the server ignores it unless its own feet probe (on the last
 * accepted position, same shared rule as the client) reports the same gid.
 */
export interface PlayerInteractionMessage {
  /** The interaction tile gid the player believes it is standing on. */
  gid: number;
}

/** Anti-cheat tuning shared so client and server agree on the rules. */
export const ANTI_CHEAT = {
  /**
   * Ceiling on accepted input messages per second (the client sends ~20 Hz;
   * this allows the same input to be re-sent at a slightly higher rate).
   */
  maxInputRatePerSecond: 25,
  /**
   * Max distance between the client's reported position and the last accepted
   * position before the report counts as a teleport violation. Real teleports
   * (crossing the map instantly) exceed this; one report of latency stays far
   * below it.
   */
  maxPositionError: TILE_SIZE * 5,
  /**
   * Max extra displacement per second on top of the physical speed ceiling
   * before consecutive reports look like speed-hacking.
   */
  maxSpeedSlackPerSecond: TILE_SIZE * 12,
  /** Violations recorded before the room kicks the client. */
  maxViolations: 12,
} as const;

/**
 * Validates one reported position against the last accepted position and the
 * previous report. Pure so the room logic stays thin and testable.
 *
 * Client-authoritative model: the client simulates its own movement and this
 * validates the *trajectory* it reports. The room accepts a clean report and
 * broadcasts it as the player's state; a failing report stops the player —
 * the broadcast stays at the last accepted position while violations count
 * toward a kick. `authoritative` is that last accepted position (the server
 * no longer re-simulates); `dt` is the wall-clock seconds since it was
 * accepted (null for the first report of a session).
 *
 * Returns a list of `"teleport" | "speed"` violation types (empty = fine).
 */
export function validatePositionReport(
  grid: SolidGrid,
  reported: { px: number; py: number },
  authoritative: { x: number; y: number },
  previous: { px: number; py: number } | null,
  dt: number | null,
  config: PlayerPhysicsConfig = DEFAULT_PLAYER_PHYSICS,
): Array<"teleport" | "speed"> {
  if (!Number.isFinite(reported.px) || !Number.isFinite(reported.py)) {
    return ["teleport"];
  }
  const violations: Array<"teleport" | "speed"> = [];

  // The reported spot must at least be a plausible place to stand/be: reject
  // positions deep inside solid geometry outright. Samples are inset from the
  // collider's edges because a player resting on a floor or pressed against a
  // wall has its outline exactly ON the solid boundary — which is legal.
  const inset = 1;
  const halfW = Math.max(0, config.width / 2 - inset);
  const halfH = Math.max(0, config.height / 2 - inset);
  if (
    isPointSolid(grid, reported.px, reported.py) ||
    isPointSolid(grid, reported.px - halfW, reported.py) ||
    isPointSolid(grid, reported.px + halfW, reported.py) ||
    isPointSolid(grid, reported.px, reported.py - halfH) ||
    isPointSolid(grid, reported.px, reported.py + halfH)
  ) {
    violations.push("teleport");
  }

  // Far from the last accepted report → teleporting.
  const error = Math.hypot(
    reported.px - authoritative.x,
    reported.py - authoritative.y,
  );
  if (error > ANTI_CHEAT.maxPositionError) violations.push("teleport");

  // Faster-than-physics displacement between consecutive reports → speed hack.
  if (previous && dt !== null && dt > 0) {
    const moved = Math.hypot(
      reported.px - previous.px,
      reported.py - previous.py,
    );
    const allowed = maxPlayerSpeed(config) * dt +
      ANTI_CHEAT.maxSpeedSlackPerSecond * dt;
    if (moved > allowed) violations.push("speed");
  }

  return violations;
}