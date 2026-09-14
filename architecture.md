# monkeyLuka — Architecture

A living description of how monkeyLuka is built and how the pieces fit
together. Start here for a system-level view; start at `AGENTS.md` for
conventions and commands to obey while editing.

## 1. Overview

monkeyLuka is a multiplayer web game ("a monkey-powered multiplayer game").
The codebase is a single repository of three **Bun workspaces**, all
TypeScript, all run by **Bun** with no build step for internal packages.

Two processes make up the running system:

| Process | Port | Job |
|---|---|---|
| `@monkeyluka/web` (Next.js) | `:3000` | Serves the site, hosts the Phaser game client, and hosts the **REST API** (Elysia) under `/api` |
| `@monkeyluka/server` (Colyseus) | `:2567` | Realtime matchmaker + WebSocket rooms |

The browser talks to the web app over HTTP(S) for pages and the REST API, and
to the Colyseus server over WebSocket for realtime game state. Gameplay is
**client-simulated**: the client runs the shared collision + run/jump physics
every frame and renders its own prediction with no server round-trip; the
room only validates the movement reports it receives (teleport / abnormal
speed / buried-in-geometry) and broadcasts the accepted trajectory, stopping
a player whose reports look abnormal.

## 2. System diagram

```
                        ┌────────────────────────────────────────────┐
                        │            @monkeyluka/web (:3000)         │
                        │                                            │
  Browser ── HTTP ────► │  Next.js 16 (App Router)                   │
  (React 19)            │   ├─ pages: /, /play, /leaderboard,        │
      │                 │   │   /how-to-play                         │
      │   WebSocket     │   ├─ Phaser 4 client (dynamic import)      │
      │   (Colyseus)    │   │    ├─ shared physics simulation         │
      │                 │   │    └─ predicted state → server, renders │
      │                 │   └─ Elysia REST API under /api            │
      │                 │        GET /          project info         │
      │                 │        GET /health    live HealthStatus    │
      │                 │                                            │
      ▼                 └────────────────────────────────────────────┘
┌─────────────────┐            ┌────────────────────────────────────────┐
│  (state schema  │            │          @monkeyluka/server (:2567)    │
│  shared via     │  WS        │  Colyseus 0.18 (defineServer format)   │
│  @monkeyluka/   │◄──────────►│  rooms: { jungle: JungleRoom }          │
│  shared, raw-TS)│   report   │  JungleRoom:                           │
└─────────────────┘   ↓        │   ├─ loads Assets/map/main.json        │
                          │    │   ├─ relays validated client reports  │
                          │    │   ├─ validates reports (teleport/speed)│
                          │    │   └─ syncs JungleState.players         │
                          └────►└────────────────────────────────────────┘
```

Both processes import the **same** `@monkeyluka/shared` package — including
the **same module instance** of the `JungleState` / `PlayerInfo` Colyseus
schemas — which is exactly why the package ships raw `.ts` and is never
compiled to `dist/` (see §5).

## 3. Workspace map

```
monkeyLuka/
├── package.json                 # workspace root — shared scripts + dev deps
├── bun.lock                     # single lockfile, committed
├── architecture.md              # this file
├── AGENTS.md                    # monorepo dev guide (read before editing)
├── CLAUDE.md                    # navigation stub → AGENTS.md
├── map/                         # planned: tracked Tiled map data + art (not a Bun workspace)
├── apps/
│   ├── web/                     # @monkeyluka/web — frontend + REST API
│   │   └── src/
│   │       ├── app/             # App Router pages + /api/[[...slugs]]/route.ts
│   │       ├── components/      # play-screen, site-header/footer, game-gate, …
│   │       ├── game/jungle-game.ts  # Phaser client bootstrap (dynamic import)
│   │       ├── hooks/           # use-fullscreen, use-media-query
│   │       └── lib/colyseus.ts  # browser Colyseus client singleton
│   └── server/                  # @monkeyluka/server — Colyseus only
│       └── src/
│           ├── index.ts         # defineServer() bootstrap + origin gate
│           └── rooms/jungle/    # JungleRoom + bookkeeping/input/schema-write
└── packages/
    └── shared/                  # @monkeyluka/shared — raw-TS shared code
        └── src/
            ├── index.ts         # schemas, room names, shared constants
            └── physics/         # barrel index.ts → tiles / collision/ / player/ / validation
```

## 4. Runtime & packaging decisions

- **Everything is TypeScript on Bun.** Bun executes `.ts` natively (for the
  server) and Turbopack bundles it (for Next.js). No `dist/` builds.
- **`workspace:*` protocol** links internal packages by symlink, so edits are
  picked up instantly. Installing is done **only from the repo root**
  (`bun install`); one `bun.lock` pins everything.
- **The tsconfig baseline** is the Bun starter set plus
  `noImplicitOverride`, `verbatimModuleSyntax`, strict mode, and `noEmit`.
  `noImplicitOverride` matters in practice: Colyseus lifecycle members
  (`onCreate`, `onJoin`, `maxClients`, …) must be marked `override`.
- Internal packages must stay **framework-agnostic** — no Next.js/Elysia
  imports. The one deliberate exception is `@colyseus/schema` in shared ($5).

## 5. @monkeyluka/shared — the single source of truth

`packages/shared/src/index.ts` is the shared contract between server and web,
and `packages/shared/src/physics/index.ts` is the shared **simulation & validation**
engine both sides run verbatim:

- `ROOM_NAMES.jungle` — the public matchmaker room name clients join with.
- `MAX_PLAYER_NAME_LENGTH` (24) — name clamp enforced on both client (input)
  and server (join options).
- `PlayerInfo` / `JungleState` — `@colyseus/schema` **schemas** describing the
  synced room state (`JungleState` = `players: Map<sessionId, PlayerInfo>`);
  `PlayerInfo` carries the authoritative `x/y/vx/vy/grounded/facing`.
- `physics/` — barrel (`index.ts`) re-exporting the split simulation/validation modules
  `tiles.ts` (tile constants, grid, world bounds), `collision/` (point/AABB
  tests + penetration helpers, split into masks/geometry/point/box/support/penetration), `player/` (`stepPlayer()`: run accel, gravity,
  coyote/buffered jump), `trap-spike-run.ts` (movable traps: `Trap_Spike_Run`
  objects from the `trap` objectgroup patrol their rect — `stepTrapSpikeRun`
  bounces at the edges and re-rolls a random speed every
  `time2change_speed` seconds; `isBoxTouchingTrapSpikeRun` is the lethal contact
  probe the web client runs; the web renders the `Trap_Spike_Run.png` sheet),
  `validation.ts` (`PLAYER_INPUT_MESSAGE` contract + `validatePositionReport()` + `ANTI_CHEAT` rules). Covered by
  `src/physics.test.ts` (`bun test`). Movement runs **client-side**: the client
  simulates itself every frame with `stepPlayer()` and reports the result; the
  room validates the reported trajectory and broadcasts it, stopping the player
  while a report fails.
- `HealthStatus` — the shape served by `/api/health`.
- Small constants (`APP_NAME`) and helpers (`greeting()`).

**Why raw `.ts` and why it matters.** The package's `exports` map points
straight at `src/index.ts`. If it were compiled to `dist/`, server and web
would each load their own copy of the schema classes; `@colyseus/schema`
serialization relies on shared instance identity — a duplicated module would
break schema behavior. Shipping raw TypeScript keeps one module identity for
all consumers. The price: Turbopack doesn't follow bare `.ts` exports on its
own, so Next.js adds `@monkeyluka/shared` to `transpilePackages`.

The schemas are the **serialization format shared over the wire**; the
physics is the **simulation contract** — the client runs it for rendering, and
the room logic (report sanitization, validation, stop-on-violation and kick
rules) deliberately lives in the server, not here.

## 6. @monkeyluka/server — realtime (Colyseus)

One process, one job. `apps/server/src/index.ts`:

```ts
defineServer({
  greet: false,
  transport: new WebSocketTransport({ beforeUpgrade /* origin gate */ }),
  rooms: { [ROOM_NAMES.jungle]: defineRoom(JungleRoom) },
});
```

- **`rooms` object keys are the public matchmaker names** — the `jungle` key
  is what clients `joinOrCreate("jungle", …)` against.
- `defineRoom()` takes a room **class** (no object-literal rooms in this
  core). `JungleRoom` (`src/rooms/jungle/`) extends
  `Room<{ state: JungleRoomState }>`:
  - `onCreate` → loads the map via `src/game/jungle-map.ts` (from
    `Assets/map/main.json`), `this.state = new JungleState()`, and registers
    the `PLAYER_INPUT_MESSAGE` handler. There is **no simulation loop** —
    movement is client-simulated; per report the room validates and writes
    the accepted `x/y/vx/vy/grounded/facing` into `PlayerInfo`.
  - `onJoin` → insert `PlayerInfo({ name, … })` (physics starts at
    `PLAYER_SPAWN`) keyed by `client.sessionId`, clamping the name with
    `MAX_PLAYER_NAME_LENGTH`.
  - `onLeave` → delete the session's entry; `onDispose` → clear all.
  - `onDrop` (non-consented disconnect: reload / tab close / blip) →
    `allowReconnection(client, RECONNECT_GRACE_SECONDS)` holds the seat +
    world entry so the session rejoins with the **same sessionId** and its
    name/last position survive; `onReconnect` resets the report `seq` gate
    (a reloaded page restarts `seq` at 0) and the speed clock. Consented
    leaves (Exit button, kick) don't hold a seat.
  - **Reconnection client-side**: `apps/web/src/lib/jungle-session.ts` stores
    the `reconnectionToken` in sessionStorage; the Play screen resumes
    silently after a reload (`client.reconnect`), and the Colyseus SDK's
    retry loop covers mid-session blips while the client freezes its local
    simulation (so no report burst looks like speed-hacking on reconnect).
  - **Anti-cheat**: input payloads are shape-checked, rate-limited
    (`ANTI_CHEAT.maxInputRatePerSecond`), seq-checked, and the reported
    trajectory is validated by `validatePositionReport()` against the last
    accepted report (teleport / abnormal speed / buried-in-geometry); a
    failing report stops the player at the last accepted position and
    violations count toward a kick at `ANTI_CHEAT.maxViolations`. No
    unvalidated client-supplied position is ever written to the schema.
  - `maxClients = 20` is a soft cap until real matchmaking/filtering lands.
- **Origin gate**: `ALLOWED_ORIGIN_HOST` is a **comma-separated host
  allowlist** compiled by `compileOriginAllowlist()` in `@monkeyluka/shared`
  (default `*` / unset = any origin) and applied in `beforeUpgrade` — browser
  clients whose `Origin` doesn't match get a 403. Non-browser clients without
  an `Origin` header pass.
- There is **no REST API here**. The old standalone Elysia `:3001` process
  was removed; HTTP lives in the web app (§7). Keep it that way.

## 7. @monkeyluka/web — frontend + REST API

### 7.1 Next.js app (React 19 + Tailwind 4)

App Router pages: `/` (menu), `/play`, `/leaderboard` and `/how-to-play`
(placeholders). The root layout wraps everything in `GameGate`, which blocks
touch devices until the viewport is landscape and full-screen (or standalone
PWA) — no user gesture, no lock, no rendering.

### 7.2 The play flow

`/play` is the realtime entry point (`src/components/play-screen.tsx`):

1. **Menu → name dialog.** A Play button opens a modal asking for the
   leaderboard name (validated client-side against
   `MAX_PLAYER_NAME_LENGTH`).
2. **Join.** `colyseusClient.joinOrCreate(ROOM_NAMES.jungle, { name }, JungleState)`
   from `src/lib/colyseus.ts` opens the WebSocket to the Colyseus server and
   supplies `JungleState` as the root schema so `room.state` is typed and
   live-synced.
3. **Boot Phaser.** Once joined, `createJungleGame()` (in
   `src/game/jungle-game.ts`) mounts a Phaser 4 game into a fullscreen div,
   reading the player's name and room id from the room state, renders the
   Tiled map with collision debug, and starts the movement loop (§9).

The screen tracks a small phase machine (`idle → naming → joining → playing`)
and carefully tears everything down on exit/unmount: Phaser instance is
destroyed, and the room `leave()` is fired. Escape closes the dialog; the
join-in-flight phase blocks cancellation.

**SRR constraint:** Phaser touches `window` at module scope, so
`createJungleGame()` does `await import("phaser")` — it must never be imported
statically, or prerendering `/play` crashes.

### 7.3 REST API — Elysia mounted inside Next

Formerly a separate process, the REST API now runs inside the App Router
using Elysia's official Next.js integration:
`src/app/api/[[...slugs]]/route.ts`.

- One `Elysia` instance with `{ prefix: "/api" }`; `app.fetch` is exported as
  every HTTP method (`GET`–`DELETE`, `OPTIONS`) so any `/api**` request hits
  Elysia.
- Routes: `GET /api` (project info) and `GET /api/health` (live
  `HealthStatus`).
- `export const dynamic = "force-dynamic"` keeps route handlers un-prerendered
  so `/api/health` reports real uptime.
- CORS uses `ALLOWED_ORIGIN_HOST` compiled by `compileOriginAllowlist()` in
  `@monkeyluka/shared` (comma-separated host allowlist; same env var as the
  Colyseus handshake gate and Next's `allowedDevOrigins`).
- Next 16 normalizes `/api/` → `/api`; Elysia matches both.

### 7.4 Networking defaults that make LAN dev work

- The Colyseus endpoint defaults to `ws://<page-hostname>:2567` — a phone or
  laptop loading the site from the serving machine's LAN IP dials the same
  machine's Colyseus port automatically. Override with
  `NEXT_PUBLIC_COLYSEUS_ENDPOINT`.
- `ALLOWED_ORIGIN_HOST` gates three things at once: the Colyseus WebSocket
  handshake, the Elysia `/api` CORS, and Next 16's `allowedDevOrigins`
  (Next blocks non-localhost dev origins otherwise). It is a comma-separated
  host allowlist (`*` or unset = any origin) — e.g.
  `localhost,192.168.1.109` keeps both localhost and LAN dev working; the
  Colyseus gate + Elysia CORS compile it via `compileOriginAllowlist()` in
  `@monkeyluka/shared`, Next parses it itself in `next.config.ts`.
- Set it in **both** `apps/server/.env` and `apps/web/.env`.

## 8. Environment variables

| Variable | Owner | Default | Purpose |
|---|---|---|---|
| `COLYSEUS_PORT` | server | `2567` | Colyseus listen port |
| `HOST` | server | `0.0.0.0` | Colyseus bind host |
| `ALLOWED_ORIGIN_HOST` | server + web | `"*"` (any) | Comma-separated host allowlist for WS handshake, `/api` CORS, and Next dev origins; `*`/unset = allow any |
| `NEXT_PUBLIC_COLYSEUS_ENDPOINT` | web | `ws://<hostname>:2567` | Browser-side Colyseus endpoint override |

`.env` files are gitignored; `.env.example` files are committed.

## 9. Data flow: one player joining the jungle

```
Player (browser)
  │  1. GET /play                      → Next.js renders menu
  │  2. Play → dialog (name validated)
  │  3. joinOrCreate("jungle", {name}, JungleState)
  │     └─ WebSocket upgrade (:2567)   → Colyseus matchmaker
  │  4. JungleRoom.onJoin:             → state.players[sessionId] = PlayerInfo(name, spawn)
  │  5. client boots Phaser            → builds SolidGrid from layer1 (same gids as server)
  │  6. every frame:                   → keyboard → PlayerInput → stepPlayer() (client-side collision)
  │                                    → sprite renders the prediction directly (no server wait)
  │  7. ~20 Hz:                        → PLAYER_INPUT_MESSAGE (seq, predicted pos/vel/state)
  │     server per report:            → sanitize + flood/seq → validatePositionReport()
  │                                    → clean: broadcast as PlayerInfo fields
  │                                    → failing: stop (freeze + zero v) + count violation
  └── state patch broadcast            → all members' room.state updates
  │  8. local player reconciles against broadcast x/y; remote players ease to it
  ▼
Phaser jungle scene (walk/jump via shared physics)
```

## 10. Cross-cutting gotchas (codified in AGENTS.md)

- **No internal builds ever** — never emit `dist/` for `packages/` (module
  identity / `instanceof` breakage).
- **Phaser: dynamic import only.**
- **Colyseus 0.18:** matchmaker HTTP routes are POST-only; use
  `this.state = …` not `setState()`; `defineRoom` takes room classes;
  `defineServer`/`defineRoom`/`WebSocketTransport` are re-exported by the
  `colyseus` package itself.
- **Next.** typegen (`/api/types`, `LayoutProps`) needs a first `next dev` or
  `next build`; `@monkeyluka/shared` must stay in `transpilePackages`.
- **Type imports** use `import type` / `export type` (`verbatimModuleSyntax`).

## 11. Where the architecture is going (as stated in code)

The codebase is foundation-stage and self-documents its next steps:

- Leaderboard identity exists in `JungleState.players`; leaderboard **stats**
  are called out as the next addition to `PlayerInfo`.
- `maxClients` is a soft cap until real **matchmaking/filtering** lands.
- **Gameplay is now client-simulated with server-side anomaly detection**:
  shared tile collision + run/jump physics run on the client; the room
  validates movement reports and stops players whose reports look abnormal
  (kick after repeated violations). Next steps: walk/other animations, better
  netcode feel (delay compensation / rollback), vertical z-ordering, and
  goals/collectibles.
- `map/` is reserved for tracked **Tiled game-map data + art** (not a Bun
  workspace), per the root `AGENTS.md`, though the directory doesn't exist
  yet.