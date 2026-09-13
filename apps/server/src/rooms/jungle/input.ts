/**
 * Wire-payload handling for `PLAYER_INPUT_MESSAGE` / `PLAYER_INTERACTION_MESSAGE`:
 * strict shape checks that reject forged payloads before they reach the
 * validation pipeline, and the advisory-velocity clamp applied to accepted
 * reports before broadcast.
 */

import {
  isInteractionTileGid,
  type PlayerInputMessage,
  type PlayerInteractionMessage,
} from "@monkeyluka/shared";

/** Strict shape check of the wire payload; null when it looks forged. */
export function sanitizePlayerInput(message: unknown): PlayerInputMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const m = message as Record<string, unknown>;

  if (typeof m.seq !== "number" || !Number.isFinite(m.seq) || m.seq < 0) {
    return null;
  }
  if (
    typeof m.px !== "number" ||
    !Number.isFinite(m.px) ||
    typeof m.py !== "number" ||
    !Number.isFinite(m.py)
  ) {
    return null;
  }
  if (
    typeof m.vx !== "number" ||
    !Number.isFinite(m.vx) ||
    typeof m.vy !== "number" ||
    !Number.isFinite(m.vy) ||
    typeof m.grounded !== "boolean" ||
    typeof m.clinging !== "boolean" ||
    typeof m.facing !== "number" ||
    !Number.isFinite(m.facing)
  ) {
    return null;
  }

  return {
    seq: m.seq,
    px: m.px,
    py: m.py,
    vx: m.vx,
    vy: m.vy,
    grounded: m.grounded,
    clinging: m.clinging,
    // Normalize: remote sprites flip on this, so anything else is a lie we
    // don't want broadcast.
    facing: m.facing >= 0 ? 1 : -1,
  };
}

/** Clamp an advisory velocity to `max` (the physical ceiling for that axis). */
export function clampVelocity(v: number, max: number): number {
  return Math.max(-max, Math.min(max, v));
}

/**
 * Strict shape check of the `PLAYER_INTERACTION_MESSAGE` payload; null when
 * it looks forged. `gid` must be a registered interaction tile (not just any
 * number) — the position itself is never trusted from the wire: validation
 * happens in the room via the shared `interactionTileUnderFeet` probe on the
 * player's last accepted position.
 */
export function sanitizePlayerInteraction(
  message: unknown,
): PlayerInteractionMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const m = message as Record<string, unknown>;
  if (typeof m.gid !== "number" || !Number.isFinite(m.gid)) return null;
  const gid = Math.trunc(m.gid);
  if (!isInteractionTileGid(gid)) return null;
  return { gid };
}