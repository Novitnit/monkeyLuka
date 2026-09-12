/**
 * Jungle matchmaking room, split into focused modules (mirrors the shared
 * physics barrel layout):
 * - `jungle-room.ts`  – the `JungleRoom` class (lifecycle + report pipeline)
 * - `server-player.ts`– per-client bookkeeping types (`ServerPlayer`,
 *   `BroadcastState`)
 * - `input.ts`        – `PLAYER_INPUT_MESSAGE` payload sanitizing +
 *   advisory-velocity clamp
 * - `schema-write.ts` – patch-churn-reducing `PlayerInfo` writes
 */

export { JungleRoom } from "./jungle-room";