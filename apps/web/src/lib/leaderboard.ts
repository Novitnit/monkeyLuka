/**
 * Leaderboard reads: the completed jungle runs shown on `/leaderboard`.
 *
 * Completed runs are written by the Colyseus room (apps/server) into
 * `data/jungle-runs.sqlite` at the repo root (the Docker mount `/app/data`)
 * through Bun's `bun:sqlite` — the schema, the env override and the write
 * path all live in `apps/server/src/game/run-results.ts`, which stays the
 * authoritative source of truth. This module is just the read side: it
 * opens the same file with Node's built-in `node:sqlite` and returns the
 * rows shortest-time-first for the leaderboard page.
 *
 * Why `node:sqlite` and not `bun:sqlite`? The web app's `next dev`/`build`
 * run on Node (the `next` bin's shebang is `#!/usr/bin/env node` — see
 * apps/web/AGENTS.md), so Bun's sqlite module isn't resolvable in this
 * process. Both drivers read the same standard SQLite file, so the only
 * alignment they need is the file path + the row shape.
 */

import { DatabaseSync } from "node:sqlite";

/** Same env override the server store honors (`JUNGLE_RUN_RESULTS_PATH`). */
const RESULTS_PATH_ENV = "JUNGLE_RUN_RESULTS_PATH";

/**
 * The DB location: the `JUNGLE_RUN_RESULTS_PATH` env override (same
 * variable + semantics as the server — absolute, or relative to THIS app's
 * CWD), else the default `data/jungle-runs.sqlite` at the repo root. The
 * dev/build scripts `cd` into `apps/web`, so `../../data` lands on the
 * repo's `data/` dir; the standalone container's `server.js` chdirs to
 * `/app/apps/web`, so the same relative path lands on the shared
 * `/app/data` mount (`data/` there too).
 */
function resolveResultsPath(): string {
  const override = process.env[RESULTS_PATH_ENV]?.trim();
  if (override) return override;
  return "../../data/jungle-runs.sqlite";
}

/**
 * One finished run as the leaderboard shows it — the persistence columns
 * of the server's `StoredRunResult` minus the internal `id`/`sessionId`.
 */
export interface LeaderboardEntry {
  /** Leaderboard name the player entered at Play. */
  name: string;
  /** Completion time in ms (finish − joinedAt + death penalties). */
  timeMs: number;
  /** Server wall-clock ms of the finish moment (breaks time ties). */
  finishedAt: number;
  /** Matchmade room id, for provenance. */
  roomId: string;
}

const SELECT_RUNS = `
  SELECT name, time_ms AS timeMs, finished_at AS finishedAt, room_id AS roomId
  FROM runs
  ORDER BY time_ms ASC, finished_at ASC
`;

/**
 * All completed runs, shortest to longest. Best-time-first ordering
 * matches the server store's `.all()` (`ORDER BY time_ms ASC` — the
 * future leaderboard's ordering). Normally only the room writes, but a
 * GET/SSR must still never create the file: opened read-only, and a
 * missing DB just means no runs yet. A `timeout` lets a concurrent room
 * write (WAL) finish instead of throwing SQLITE_BUSY. Every read
 * opens/closes its own connection: no long-lived handle across requests.
 */
export function readLeaderboard(): LeaderboardEntry[] {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(resolveResultsPath(), {
      readOnly: true,
      timeout: 5000,
    });
  } catch {
    // No results file yet → no completed runs.
    return [];
  }
  try {
    return db
      .prepare(SELECT_RUNS)
      .all() as unknown as LeaderboardEntry[];
  } finally {
    db.close();
  }
}

/**
 * Formats a completion time (ms) as `m:ss.cc` — minutes never zero-pad,
 * hundredths shown so fast runs still sort visibly (the in-game HUD's
 * `m:ss` precision would render almost every run "0:00").
 */
export function formatLeaderboardTime(timeMs: number): string {
  const totalSeconds = Math.max(0, timeMs) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const [whole, hundredths] = seconds.toFixed(2).split(".");
  return `${minutes}:${whole!.padStart(2, "0")}.${hundredths}`;
}

/** The same duration as an ISO 8601 time (`PT<seconds>S`) for `time@datetime`. */
export function leaderboardTimeIso(timeMs: number): string {
  return `PT${(Math.max(0, timeMs) / 1000).toFixed(3)}S`;
}