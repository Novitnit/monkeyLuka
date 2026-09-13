/**
 * Player simulation barrel: re-exports the public player API used by the web
 * client (local prediction) and the server (anti-cheat speed ceiling). The
 * code lives split into focused modules:
 * - `config.ts` – `PlayerInput`, `PlayerPhysicsConfig`, `PLAYER_SPAWN`,
 *                 `DEFAULT_PLAYER_PHYSICS`, `maxPlayerSpeed`
 * - `state.ts`  – `PlayerPhysicsState`, `PlayerStepResult`, the spawn factory
 *                 `createPlayerState`
 * - `step.ts`   – `stepPlayer`, the deterministic per-frame simulation
 */

export * from "./config";
export * from "./state";
export * from "./step";