/**
 * Unit tests for the run-results SQLite store (`run-results.ts`): records
 * one row per finished session, re-records update in place (the room's
 * `finished` flag normally prevents that, but the upsert backstops a server
 * that lost its sim map), and the `.all()` readback orders best-time first.
 * In-memory DBs only — the tests never touch the real data file.
 */
import { describe, expect, test } from "bun:test";
import { initRunResultsDb, type RunResultRecord } from "./run-results";

const base: RunResultRecord = {
  sessionId: "sess-1",
  name: "Monkey",
  timeMs: 65_000,
  finishedAt: 1_700_000_000_000,
  roomId: "room-1",
};

describe("run-results store", () => {
  test("records a run and reads it back", () => {
    const store = initRunResultsDb(":memory:");
    store.record(base);
    const rows = store.all();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      sessionId: "sess-1",
      name: "Monkey",
      timeMs: 65_000,
      finishedAt: 1_700_000_000_000,
      roomId: "room-1",
    });
    expect(typeof rows[0]!.id).toBe("number");
    store.close();
  });

  test("one result per session — a re-record updates in place", () => {
    const store = initRunResultsDb(":memory:");
    store.record(base);
    store.record({ ...base, timeMs: 71_000 });
    const rows = store.all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.timeMs).toBe(71_000);
    store.close();
  });

  test("all() orders best time first", () => {
    const store = initRunResultsDb(":memory:");
    for (const [sessionId, timeMs] of [
      ["slow", 300_000],
      ["fast", 90_000],
      ["mid", 150_000],
    ] as const) {
      store.record({ ...base, sessionId, timeMs, name: sessionId });
    }
    const rows = store.all();
    expect(rows.map((row) => row.sessionId)).toEqual(["fast", "mid", "slow"]);
    store.close();
  });
});