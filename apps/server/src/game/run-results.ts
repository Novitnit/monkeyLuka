/**
 * Persistence for completed jungle runs. One row per finished session in a
 * small SQLite file, written by the Colyseus room the moment the endgame
 * interaction (gid 404 → "finish") validates. `bun:sqlite` is built into
 * Bun — no dependency, no migration tool: the table is created on first
 * open, and the file lives under `apps/server/data/` (gitignored; override
 * with `JUNGLE_RUN_RESULTS_PATH`).
 *
 * The recorded time is computed by the room from server wall-clock values
 * (see `runCompletionTimeMs` in @monkeyluka/shared) — never client-
 * supplied — so a forged finish press can only ever fire a real, on-tile
 * finish (the same feet probe as a signpost gates it) and the result is
 * authoritative. One result per session (`session_id` UNIQUE): the room's
 * `finished` flag makes a repeat press a no-op, and an upsert backstops a
 * server that lost its sim map (restart) without duplicating the run.
 */

import { Database, type Statement } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** One completed run, server-authoritative. */
export interface RunResultRecord {
  /** Colyseus session id — ties the row to the run that produced it. */
  sessionId: string;
  /** Leaderboard name the player entered at Play. */
  name: string;
  /** Completion time in ms (`finishedAt − joinedAt` + death penalties). */
  timeMs: number;
  /** Server wall-clock ms of the finish moment. */
  finishedAt: number;
  /** Matchmade room id, for provenance. */
  roomId: string;
}

/** A stored row as read back (sqlite snake_case columns → camelCase aliases). */
export interface StoredRunResult extends RunResultRecord {
  id: number;
}

/** Env override for the DB file (absolute, or relative to the server's CWD) —
 * the same pattern as `JUNGLE_MAP_PATH` / `JUNGLE_QUESTIONS_PATH`.
 * `:memory:` opens an in-memory DB (tests). */
const RESULTS_PATH_ENV = "JUNGLE_RUN_RESULTS_PATH";

/**
 * Default DB location, resolved against this source file so it works from
 * any CWD: apps/server/src/game → apps/server/data/jungle-runs.sqlite.
 */
const DEFAULT_RESULTS_URL = new URL(
  "../../data/jungle-runs.sqlite",
  import.meta.url,
);

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    room_id TEXT NOT NULL DEFAULT ''
  )
`;

const INSERT_RUN = `
  INSERT INTO runs (session_id, name, time_ms, finished_at, room_id)
  VALUES (?1, ?2, ?3, ?4, ?5)
  ON CONFLICT(session_id) DO UPDATE SET
    name = excluded.name,
    time_ms = excluded.time_ms,
    finished_at = excluded.finished_at,
    room_id = excluded.room_id
`;

const SELECT_RUNS = `
  SELECT
    id,
    session_id AS sessionId,
    name,
    time_ms AS timeMs,
    finished_at AS finishedAt,
    room_id AS roomId
  FROM runs
  ORDER BY time_ms ASC, finished_at ASC
`;

/**
 * Handle around the results DB: `record` writes one run (idempotent per
 * session), `all` reads them back (best-time first — the future
 * leaderboard's ordering), `close` releases the file handle (room dispose).
 */
export class RunResultsStore {
  private readonly insert: Statement;
  private readonly select: Statement;

  constructor(
    private readonly db: Database,
    readonly path: string,
  ) {
    db.run(CREATE_TABLE);
    this.insert = db.prepare(INSERT_RUN);
    this.select = db.prepare(SELECT_RUNS);
  }

  /** Persist a finished run (one row per session; re-records update in place). */
  record(run: RunResultRecord): void {
    this.insert.run(
      run.sessionId,
      run.name,
      run.timeMs,
      run.finishedAt,
      run.roomId,
    );
  }

  /** All stored runs, best time first. */
  all(): StoredRunResult[] {
    return this.select.all() as StoredRunResult[];
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Open (creating if needed) the run-results store. `path` defaults to
 * `apps/server/data/jungle-runs.sqlite` resolved against this module —
 * robust to any CWD like the map/quest loaders; parent directories are
 * created on the way.
 */
export function initRunResultsDb(
  path: string | undefined = process.env[RESULTS_PATH_ENV],
): RunResultsStore {
  const target =
    path && path.trim().length > 0 ? path : DEFAULT_RESULTS_URL.pathname;
  if (target !== ":memory:") {
    mkdirSync(dirname(target), { recursive: true });
  }
  // `create: true` is Bun's default, stated for clarity (tests may opt out).
  const db = new Database(target, { create: true });
  // Several matchmade rooms may open the same file; WAL keeps readers from
  // blocking writers, and busy_timeout makes a concurrent finish wait its
  // turn instead of throwing SQLITE_BUSY.
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  return new RunResultsStore(db, target);
}