/**
 * Shared, framework-agnostic code lives here.
 *
 * This package ships raw TypeScript in its `exports` (no build step).
 * Bun runs `.ts` files natively, so every consumer in this repo can import
 * it directly. See AGENTS.md for how this works and when `transpilePackages`
 * is needed (e.g. for the Next.js web app).
 */

import { schema, t } from "@colyseus/schema";

export * from "./physics";

export const APP_NAME = "monkeyLuka";

/** A room/game identifier used by both server and client. */
export const ROOM_NAMES = {
  jungle: "jungle",
} as const;

/** Max length (trimmed) for the leaderboard name a player enters at Play. */
export const MAX_PLAYER_NAME_LENGTH = 24;

/**
 * A player's public identity inside a jungle room — keyed by sessionId in
 * `JungleState.players`. `name` is the leaderboard identity; the position/
 * velocity fields are the **authoritative** state the room broadcasts: the
 * last client movement report that passed validation (velocity clamped to
 * the physics max). The client renders this state and reconciles its local
 * prediction against it; a report that fails validation leaves the player
 * stopped at the previously accepted position. See `physics.ts` for the
 * shared simulation and its validation rules.
 */
export const PlayerInfo = schema({
  name: t.string(),
  x: t.number(),
  y: t.number(),
  vx: t.number(),
  vy: t.number(),
  grounded: t.boolean(),
  facing: t.number(),
}, "PlayerInfo");
export type PlayerInfo = InstanceType<typeof PlayerInfo>;

/** Root room state, synced to every client in a jungle room. */
export const JungleState = schema({
  players: t.map(PlayerInfo),
}, "JungleState");
export type JungleRoomState = InstanceType<typeof JungleState>;

export function greeting(name: string): string {
  return `Welcome to ${name}!`;
}

export interface HealthStatus {
  ok: boolean;
  service: string;
  uptime: number;
}

/**
 * Compile the `ALLOWED_ORIGIN_HOST` allowlist into the matcher used to gate
 * browser origins (the Colyseus WebSocket handshake and the Elysia `/api`
 * CORS).
 *
 * Accepts a comma-separated list of hosts — e.g. `"localhost,192.168.1.109"`
 * (matching how `next.config.ts` reads `allowedDevOrigins`). Each entry
 * matches `http(s)://<host>[:port]`; a literal `*` entry, or an empty/unset
 * value, means "allow any origin" (returns `true`).
 */
export function compileOriginAllowlist(raw: string | undefined): RegExp | true {
  const hosts = (raw ?? "*")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  if (hosts.length === 0 || hosts.includes("*")) {
    return true;
  }

  const sources = hosts.map(
    (host) =>
      `https?://${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?::\\d+)?`,
  );
  return new RegExp(`^(?:${sources.join("|")})$`);
}
