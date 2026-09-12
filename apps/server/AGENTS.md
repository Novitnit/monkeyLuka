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
  what clients `joinOrCreate("jungle", ...)` against (see `ROOM_NAMES` in
  `@monkeyluka/shared`).
- `defineRoom()` takes a **room class** (this core version does not accept the
  legacy object-literal rooms). Rooms live in `src/rooms/`.

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
grounded, facing` — written only by the room's report handler (see below).

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
   same `Assets/map/main.json` via four levels up from this file, override with
   `JUNGLE_MAP_PATH`) and registers the `PLAYER_INPUT_MESSAGE` handler. There is
   no `setFixedTimestep` and no simulation loop.
2. `onPlayerInput` sanitizes the payload shape (finite position/velocity/
   grounded/facing), applies a **flood rate limit**
   (`ANTI_CHEAT.maxInputRatePerSecond`), drops non-increasing `seq` (the
   WebSocket is ordered, so that means forgery/retransmit), then runs
   `validatePositionReport()` against the **last accepted report** — teleport
   (too far from it, or buried in solid geometry) and abnormal-speed checks.
3. A clean report becomes the new broadcast state: its `x/y/vx/vy/grounded/
   facing` are written to `PlayerInfo` (only changed fields, to cut patch
   churn; velocity is clamped to the physics ceiling since it is display-only).
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

### Checkpoint return (R key, debug)

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
`apps/web`), which is the only flag that needs setting.

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
walkable ramps aren't supported — the current map only uses 109/110 as
under-bevels. Keep that in mind if new slope tiles become floors.

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