/**
 * The run-finish contract: the flat time penalty a death adds to the run
 * timer (and therefore to the completion time the room records), and the
 * pure helper that defines a completion time.
 *
 * The finish itself is an interaction tile (gid 404 → action "finish", see
 * `tiles.ts` / `interaction.ts`): the room validates the E press with the
 * same feet probe as a signpost, then stamps its server wall-clock finish
 * moment on the synced `PlayerInfo.finishedAt`. The client freezes its run
 * timer at that moment (showing the completion time) and the room persists
 * the result to its SQLite store (`apps/server/src/game/run-results.ts`).
 */

/**
 * Flat penalty added to the run timer each time the player dies — the web
 * HUD jumps the readout 10 seconds forward (it shifts its elapsed base
 * backward; see `apps/web/src/game/timer/run-timer.ts`), and the room
 * counts the same penalty into the completion time it records, so the saved
 * result matches the readout that stopped. Applied once per death (the
 * client's `dead` guard keeps a death from re-firing; the room counts one
 * death per death question it sends).
 */
export const RUN_DEATH_PENALTY_MS = 10_000;

/**
 * The completion time of a run in ms, server-computed: wall-clock elapsed
 * since the run's `joinedAt` (stamped in `onJoin`, surviving reconnects),
 * plus one `RUN_DEATH_PENALTY_MS` per death the room counted. Pure, so the
 * room's SQLite record, the client's frozen HUD readout, and a unit test
 * all share one definition of "the time".
 */
export function runCompletionTimeMs(
  joinedAt: number,
  finishedAt: number,
  deaths: number,
): number {
  return (
    Math.max(0, finishedAt - joinedAt) +
    Math.max(0, deaths) * RUN_DEATH_PENALTY_MS
  );
}