/**
 * Ambient types for `node:sqlite` (Node ≥ 22.5, built into the Node 26
 * runtime this app runs on) — @types/node@20 predates the module, so tsc
 * can't see it yet. This shim declares only the surface the web app uses
 * (the leaderboard reader, `src/lib/leaderboard.ts`); keep it honest with
 * `node:sqlite`'s real API when extending (e.g. add `iterate`, named
 * params, `backup`, ...).
 *
 * NOT the bun:sqlite store's API — the write side lives in apps/server on
 * `bun:sqlite` (see run-results.ts). The two are unrelated drivers; their
 * only shared contract is the SQLite file format.
 */
declare module "node:sqlite" {
  export interface DatabaseSyncOptions {
    /** Open the database read-only (SELECT-only access). */
    readOnly?: boolean;
    /** Milliseconds to wait when the database is locked (SQLITE_BUSY). */
    timeout?: number;
    enableForeignKeyConstraints?: boolean;
    open?: boolean;
  }

  export class StatementSync {
    all(...anonymousParameters: unknown[]): unknown[];
    get(...anonymousParameters: unknown[]): unknown;
    run(...anonymousParameters: unknown[]): unknown;
    iterate(...anonymousParameters: unknown[]): IterableIterator<unknown>;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}