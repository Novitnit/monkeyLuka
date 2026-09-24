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
export * from "./math";
export * from "./quest";
export * from "./finish";

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
 * stopped at the previously accepted position. `clinging` mirrors the wall-
 * grab state so remote sprites play the cling animation. `joinedAt` is the
 * server wall-clock moment (ms) this player's run started — stamped by the
 * room in `onJoin`, never by the client; clients derive their top-right
 * run-timer from it, and it survives a reload because a reconnected
 * session reuses the same schema entry (the timer keeps counting instead
 * of restarting). See `physics.ts` for the shared simulation and its
 * validation rules.
 */
export const PlayerInfo = schema({
  name: t.string(),
  x: t.number(),
  y: t.number(),
  vx: t.number(),
  vy: t.number(),
  grounded: t.boolean(),
  clinging: t.boolean(),
  facing: t.number(),
  joinedAt: t.number(),
  // 0 until the player reaches the 404 endgame interaction tile, then the
  // server wall-clock finish moment (set by the room in its "finish"
  // action handler). The client freezes its run timer at this moment to
  // display the completion time, and the room records the same moment to
  // its SQLite run-results store. Only the server ever writes it.
  finishedAt: t.number(),
}, "PlayerInfo");
export type PlayerInfo = InstanceType<typeof PlayerInfo>;

/**
 * A door's public, synced state — one entry per door entity (see
 * `buildDoorEntities` in physics), keyed by `doorKey(tx, ty)`. Written by
 * the room when it opens a door (every showquest interaction linked to the
 * door answered correctly); clients clear the door's collision cells and
 * hide its art the moment the schema reports "open". It is synced like the
 * player map, so a player joining after a door opened still finds it open.
 */
export const DoorInfo = schema({
  tx: t.number(),
  ty: t.number(),
  state: t.string(),
}, "DoorInfo");
export type DoorInfo = InstanceType<typeof DoorInfo>;

/** Root room state, synced to every client in a jungle room. */
export const JungleState = schema({
  players: t.map(PlayerInfo),
  doors: t.map(DoorInfo),
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
