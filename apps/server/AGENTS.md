# AGENTS.md — @monkeyluka/server

Guidance for agents editing `apps/server`. Repo-wide conventions (Bun
workspaces, installs, commands, tsconfig baseline) live in the root
`AGENTS.md` — read it before this one.

## What this app is

One process, one job: the **Colyseus** realtime matchmaker + WebSocket rooms
on `:2567`. Bootstrapped in the modern **`defineServer()` / `defineRoom()`
format** (`src/index.ts`), with room classes in `src/rooms/`.

There is **no REST API here anymore** — the old Elysia HTTP server (`:3001`)
was removed. Elysia now runs **inside the Next.js app** using its official
"Integration with Next.js" pattern: `apps/web/src/app/api/[[...slugs]]/route.ts`
exports `app.fetch` as every HTTP method, serving `/api` (+ `/api/health`)
with CORS. `apps/server` only provides realtime; keep it that way.

## Realtime server shape

`src/index.ts` builds the server with `defineServer()` from `colyseus`:

```ts
defineServer({
  greet: false,
  transport: new WebSocketTransport({ beforeUpgrade /* origin gate */ }),
  rooms: { [ROOM_NAMES.jungle]: defineRoom(JungleRoom) },
})
```

- **The `rooms` object keys are the public matchmaker names.** `jungle` here is
  what clients `create("jungle", ...)` against (see `ROOM_NAMES` in
  `@monkeyluka/shared`).
- `defineRoom()` takes a **room class** (this core version does not accept the
  legacy object-literal rooms). Rooms live in `src/rooms/`.
- **Jungle rooms are single-run**: the web client **creates** (never
  joins) a fresh room per Play press, `maxClients = 1`, and the room dies
  with its run — auto-disposed by Colyseus when the last client leaves
  (`autoDispose`, default on) and explicitly `disconnect()`ed ~2 s after a
  finish (`FINISH_DISPOSE_DELAY_MS`) so the client still receives the
  `finishedAt` patch before the seat is torn down. No two runs ever share a
  room's puzzle progress (solved signposts / opened doors).

## Ports & config

Env defaults: `COLYSEUS_PORT=2567`, `HOST=0.0.0.0`. Override via env or `.env`
files (Bun auto-loads `.env` in this dir; see `.env.example`).

`ALLOWED_ORIGIN_HOST` gates the Colyseus WebSocket handshake:
`WebSocketTransport.beforeUpgrade` rejects browser origins that don't match;
non-browser clients with no `Origin` header (e.g. smoke-test scripts) pass.
It is a **comma-separated host allowlist** (e.g. `localhost,192.168.1.109`);
`*` or unset allows any origin. Compiled by `compileOriginAllowlist()` in
`@monkeyluka/shared` — the same helper + env var feed the web app's Elysia
CORS, so set it in `apps/web/.env` too.

## Room state schema

`src/rooms/jungle/` (currently the only room) extends `Room<{
state: JungleRoomState }>` from the shared `schema()` API — no decorators.
It tracks joined players (`sessionId → name`) in the shared `JungleState`
schema, clamping names with `MAX_PLAYER_NAME_LENGTH` from `@monkeyluka/shared`.
`PlayerInfo` also carries the **broadcast** movement state — `x, y, vx, vy,
grounded, clinging, facing` — written only by the room's report handler (see
below).

Because `noImplicitOverride` is on (Bun baseline), Colyseus lifecycle methods
(`onCreate`, `onJoin`, `onLeave`, `onDispose`) and any base-class property you
re-declare (e.g. `maxClients`) must be marked `override`.

Note: `setState()` is deprecated in this core — assign `this.state = ...`
instead.

## Client-simulated movement & anti-cheat

Movement runs **client-side**: the client simulates itself every frame with the
shared physics and reports the result. The room does **no simulation** — it
only validates each report and relays it:

1. `onCreate` loads the collision map (`src/game/jungle-map.ts`, reading the
   same `Assets/map/main.json` via four levels up from this file, override
   with `JUNGLE_MAP_PATH` — it also builds the `InteractionGrid` and the
   door entities from the same layer, exposes the `room` objectgroup's
   raw rectangle objects as `roomObjects`, and groups them into door-link
   gates with `groupRoomObjectsByName` so `QuestGate` (quest-gate.ts) can
   open a door once every showquest interaction linked to it is answered
   correctly, seeding the synced `JungleState.doors` map from the door
   entities) and registers the
   `PLAYER_INPUT_MESSAGE` + `PLAYER_INTERACTION_MESSAGE` handlers. There is
   no `setFixedTimestep` and no simulation loop.
2. `onPlayerInput` sanitizes the payload shape (finite position/velocity/
   grounded/clinging/facing), applies a **flood rate limit**
   (`ANTI_CHEAT.maxInputRatePerSecond`), drops non-increasing `seq` (the
   WebSocket is ordered, so that means forgery/retransmit), then runs
   `validatePositionReport()` against the **last accepted report** — teleport
   (too far from it, or buried in solid geometry) and abnormal-speed checks.
3. A clean report becomes the new broadcast state: its `x/y/vx/vy/grounded/
   clinging/facing` are written to `PlayerInfo` (only changed fields, to cut
   patch churn; velocity is clamped to the physics ceiling since it is
   display-only — the horizontal clamp follows `max(runSpeed,
   wallJumpSpeed)` so wall-jump launches aren't undercut).
   Dead-zone pits (464) are handled **client-side**, not here: the room no
   longer probes accepted reports (`isBoxInDeadZone` now lives only in the
   web client's `scene/update.ts`, which returns the player to its
   checkpoint through `PLAYER_CHECKPOINT_MESSAGE` — see below). The probe's
   1px support allowance (the flush resting pose never entices the
   pixel-mask overlap — the probe needs `oy1 >= DEAD_ZONE_BASE_ROW - 1`)
   is why the return triggers at all: see
   `discoveries/dead-zone-touch-log-never-fired-flush-pose.md`.
   A failing report **stops the player** — the broadcast keeps the last
   accepted position with velocity zeroed — and increments the violation
   counter; the client is kicked at `ANTI_CHEAT.maxViolations`. After a stop
   the player only moves again once a report passes validation: a one-off
   glitch resumes in ~one report interval, sustained abnormal movement stays
   frozen and escalates to a kick.

`PlayerInfo` is written only from accepted reports; no raw client position ever
reaches the schema unvalidated. What the server checks is **plausibility**, not
full reachability: every report is bounded by the physical speed ceiling and
must be out of solid geometry, but a cheater pathing through a thin wall across
several individually-plausible reports is not caught (catch it by re-enabling
server-side re-simulation if that ever matters). Set
`JUNGLE_DEBUG_VALIDATION=1` to log rejected reports with their delta/flags.

### Checkpoint return (R key, debug; 464 pit, automatic)

The room always registers the `PLAYER_CHECKPOINT_MESSAGE` handler: it
teleports the player back to the spawn point (`PLAYER_SPAWN`), re-baselines
`lastValid`/`lastValidAt` so the jump isn't a teleport violation, and writes
the new state to the schema. It is **unconditional on purpose**: the target
is the server-chosen spawn (never a client-supplied position), so accepting
can't bypass the anti-cheat — a forged message merely resets the sender to
spawn. Gating it on a server debug flag would instead drop or kick players
when the web/server flags mismatch (see
`discoveries/checkpoint-message-drops-player-unregistered-handler.md`). The
**R key itself is debug-only** on the client (`NEXT_PUBLIC_DEBUG` in
`apps/web`), which is the only flag that needs setting. Touching a 464
dead-zone pit makes the client send this same message **automatically**
(`scene/update.ts` probes the local simulated position with
`isBoxInDeadZone` every frame and, on touch, runs the identical teleport +
`checkpointPending` flow) — same handler, same spawn re-baseline, so the
automatic return can't be forged into anything but a reset to spawn either.

The server re-baselines its validation state at the spawn point and broadcasts
the jump, so the client's reports validate immediately after it. Clients
therefore **freeze snapshot reconciliation** until the broadcast confirms the
jump (~one RTT): a report sent from the pre-teleport position after the
re-baseline reads as a teleport+speed violation — see
`discoveries/checkpoint-return-race-stale-snapshot-teleport-violations.md`.

Colyseus gotcha this uncovered: a client message with **no registered
handler** is fatal to that client — `RoomMessages.#noHandler` calls
`client.leave(CloseCode.WITH_ERROR)` in non-dev mode (dev mode only sends an
error). Never let a client send a message type the room may not have
registered.

### Interaction tiles (E key)

`onCreate` also registers `PLAYER_INTERACTION_MESSAGE`, whose
`onPlayerInteraction` runs the interaction the web client triggers with E:

1. `sanitizePlayerInteraction` strict-checks the payload — `gid` must be a
   finite number that is a **registered interaction gid** (`isInteractionTileGid`,
   from the shared `INTERACTION_TILE_ACTIONS` registry; 315 is the first, bound
   to `"showquest"`).
2. The wire `gid` alone is never trusted: the room re-probes its OWN last
   accepted position (`server-player.ts`'s `lastValid`, the same state the
   schema broadcasts) with the shared `probeInteractionTile` rule and
   requires it to report the same gid — plus `lastValid.grounded` (standing,
   not jumping through). The probe also yields the tile's OWN cell, the
   identity the completion gate keys on. A forged message can only fire an
   interaction the sender is genuinely standing on, and a press that races
   the ~1 RTT stale
   last-accepted position (just stepped onto the tile, report not yet
   accepted) is a harmless no-op until the next accepted report lands on it.
3. The action then runs in `interactions.ts` (`runInteraction`): a gid →
   handler map where the actual effects live. `showquest` sends the player a
   random question from the bank loaded at `onCreate` from
   `Assets/question.json` (`src/game/quest-bank.ts`, env
   `JUNGLE_QUESTIONS_PATH`): `pickRandomQuestion` + a Fisher–Yates
   `shuffleChoices` that tracks the correct index — **the key only ever
   lives in `ServerPlayer.pendingQuest`**, which also records the
   interaction tile the question came from (one unanswered question per
   player: a repeat press while pending is dropped, and `onReconnect`
   clears the slot so a reloaded player's signpost still works). The player
   gets `quest:question` `{question, choices}` (raw plain text, shuffled,
   no answer key); `onQuestAnswer` (registering `QUEST_ANSWER_MESSAGE` in
   `onCreate`) sanitizes the reported index (`sanitizeQuestAnswer`),
   bounds it by the sent `choiceCount`, grades it against the secret
   `correctIndex`, clears the slot, and replies `quest:result` `{correct}`.
   A **correct** answer marks the tile it came from completed in the room's
   `QuestGate` (`quest-gate.ts`, constructed in `onCreate` over
   `groupRoomObjectsByName(this.map.roomObjects, this.map.doors,
   this.map.interactions)`): that signpost can never be asked again, and
   once every showquest interaction linked to a door is completed the door
   opens for the room — `openDoor` clears the door's cells from the room's
   validation grid (`clearDoorFromGrid`, so a report sent from inside the
   doorway doesn't read as buried-in-geometry) and flips the synced
   `JungleState.doors` entry to `open` (seeded at `onCreate` from the map's
   door entities; clients clear their own prediction grids and hide the
   door art from the same schema).
   New interaction tiles = a registry entry in
   `packages/shared/.../interaction.ts` + a handler in `interactions.ts` + the
   gid placed in the map. The second registered tile is the **endgame
   finish**: gid 404 → `"finish"` (NOT a showquest, so it never joins a
   door-link gate — `groupRoomObjectsByName` collects only `"showquest"`-
   action tiles). Its handler enforces the once-per-run rule (the player's
   `finished` flag, set in `ServerPlayer` at join) and calls `ctx.finish()`, a
   room-owned closure; `finishRun` in the room stamps the server wall-clock
   finish moment on the synced `PlayerInfo.finishedAt`, records the run
   to the SQLite store (next section), and schedules `this.disconnect()`
   ~2 s later (`FINISH_DISPOSE_DELAY_MS`) to destroy the room — the room is
   single-run, and the delay just lets the `finishedAt` patch reach the
   client (freezing its timer / showing the overlay) before the seat goes.
   Not gated by a pending question — an unfinished showquest doesn't block
   finishing.

### Run results (SQLite, the finish persistence)

`src/game/run-results.ts` wraps `bun:sqlite` (built in — no dependency):
`initRunResultsDb` opens the file (default
`apps/server/data/jungle-runs.sqlite` resolved from the module URL, env
`JUNGLE_RUN_RESULTS_PATH`; `:memory:` for tests; WAL + busy_timeout so
several matchmade rooms sharing the file don't fight), creates the `runs`
table on first open, and returns a `RunResultsStore` the room holds for its
lifetime (closed in `onDispose`). `record()` upserts one row per session
(`session_id UNIQUE` — the room's `finished` flag normally prevents a second
record; the upsert backstops a restarted room that lost its sim map). The
`time_ms` is server-computed by the shared `runCompletionTimeMs` (finish −
`joinedAt` + 10s × `player.deaths`), so a client can never under-report. The
room counts a death in `onPlayerDeath` **after** the one-question gate (the
client's ~1/s self-heal re-request is dropped without counting), mirroring
the +10s the web HUD applies per death (`onDead`) — a rare reconnect blip
mid-death can overcount the saved time by one penalty (inflating, never
improving, the score). `all()` reads results back best-time-first (the
future leaderboard's ordering).

### Reconnection (drop → resume on the same seat)

A non-consented disconnect (tab close, reload, network blip) hits `onDrop`,
which holds the player's seat + world entry via `allowReconnection(client,
RECONNECT_GRACE_SECONDS)` (default 30 s, env `JUNGLE_RECONNECT_SECONDS`). The
player stays in `JungleState.players` frozen at the last accepted position;
when the seat expires (or the room disposes) the deferred rejects and
`removePlayer` cleans up. A reconnect reuses the **same sessionId** without
calling `onJoin`, so name and position survive; if it succeeds, `onReconnect`
resets `lastSeq`/`inputStamps`/`lastValidAt` — a reloaded page restarts its
report `seq` at 0, and without the reset every report would be dropped as a
non-increasing-`seq` retransmit. Consented leaves (`onLeave`: Exit button,
anti-cheat kick, room disposal) never hold a seat.

Known limitation: the seat counts toward `maxClients` while held, and a
sustained abnormal-movement report stream **before** a reload (already at
violation count N) resumes counting from N after the reconnect.

Known limitation: `stepPlayer` blocks against slope *faces* horizontally, so
walkable ramps aren't supported — the physics treats 109/110/262/287/288 as
sloped edges (262 is 109's mirror, solid on the bottom-right half; 287 is 262
at half the rise — a 2:1 ramp whose base is flush with the cell's bottom
edge, so it is a ground-level walk-on ramp with a solid back column under
its apex; 288 is the staircase tile — 287's mirror — a pixel mask with
2px treads, side walls, and a solid base row, and a 287 + 288 pair forms
the continuous ramp to 288's top). Keep that in mind if slope tiles
become walkable ramps.

## Colyseus 0.18 quirks

- HTTP matchmaker routes are **POST-only** (`POST /matchmake/joinOrCreate/<room>`).
- **Playground** is mounted at `/playground` (incl. trailing slash — `skipTrailingSlashes: true` is required because better-call's router 404s on a slash mismatch; the SPA only registers `/playground/` + `/playground/**:splat`).
- **Playground static assets are served through `@colyseus/better-call`'s Node adapter, which we patch** (`patches/@colyseus%2Fbetter-call@1.3.3.patch`, see `discoveries/playground-assets-stall-better-call-res-end.md`): upstream 1.3.3's `setResponse` never calls `res.end()` after a body hits backpressure, so any asset >16 KiB stalls the browser at exactly 16 KiB. Do not "fix" this by removing the patch or switching `res.end()` back into the loop.
- Colyseus is `colyseus@0.18` with core 0.18.11; `defineServer`/`defineRoom`/`Server`
  are all re-exported from the `colyseus` package itself, no `@colyseus/core` dep needed.
- Client SDK for tests/scripts is `@colyseus/sdk` — install it only where it's
  needed (e.g. as a devDependency of a smoke-test script), not in this package.

## Commands

From this dir: `bun run dev` (watch mode), `bun run start`, `bun run typecheck`,
`bun test`. From the repo root: `bun run dev:server`, `bun run start:server`,
`bun run typecheck:server`, `bun test`.