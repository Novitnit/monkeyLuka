/**
 * Shared, framework-agnostic code lives here.
 *
 * This package ships raw TypeScript in its `exports` (no build step).
 * Bun runs `.ts` files natively, so every consumer in this repo can import
 * it directly. See AGENTS.md for how this works and when `transpilePackages`
 * is needed (e.g. for the Next.js web app).
 */

import { schema, t } from "@colyseus/schema";

export const APP_NAME = "monkeyLuka";

/** A room/game identifier used by both server and client. */
export const ROOM_NAMES = {
  arena: "arena",
} as const;

/** Max length (trimmed) for the leaderboard name a player enters at Play. */
export const MAX_PLAYER_NAME_LENGTH = 24;

/**
 * A player's public identity inside an arena room — keyed by sessionId in
 * `ArenaState.players`. Kept lean on purpose; leaderboard stats get added
 * here as the game ships.
 */
export const PlayerInfo = schema({
  name: t.string(),
}, "PlayerInfo");
export type PlayerInfo = InstanceType<typeof PlayerInfo>;

/** Root room state, synced to every client in an arena room. */
export const ArenaState = schema({
  players: t.map(PlayerInfo),
}, "ArenaState");
export type ArenaRoomState = InstanceType<typeof ArenaState>;

export function greeting(name: string): string {
  return `Welcome to ${name}!`;
}

export interface HealthStatus {
  ok: boolean;
  service: string;
  uptime: number;
}
