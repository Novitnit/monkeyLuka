# AGENTS.md — @monkeyluka/web

Guidance for agents editing `apps/web`. Repo-wide conventions (Bun
workspaces, installs, commands, tsconfig baseline) live in the root
`AGENTS.md` — read it before this one.

## What this app is

`@monkeyluka/web` — Next.js 16 (App Router) frontend on React 19 + Tailwind 4.
Source lives in `src/` with the `@/*` path alias pointing at `./src/*`.

It also hosts the project's **REST API**: the Elysia app that used to run as a
separate `apps/server` process now mounts inside Next via Elysia's official
"Integration with Nextjs" pattern (see below).

## Play flow & realtime client

`/play` (`src/components/play-screen.tsx`) is the jungle entry point: it owns
the join state machine (name → join → play) and the Phaser mount lifecycle.
A Play button opens the name dialog (`src/components/name-dialog.tsx` — the
name goes on the leaderboard; it owns autofocus + Escape-to-close), and the
menu card itself is `src/components/play-menu.tsx`. On confirm,
`colyseusClient.joinOrCreate("jungle", { name }, JungleState)` from
`src/lib/colyseus.ts` joins the Colyseus room and boots the Phaser client
(`src/game/jungle-game.ts`) into a fullscreen mount. Room state + room name
come from `@monkeyluka/shared`. Screen chrome shared with the placeholder
screens (ambient glow backdrop, “back to menu” pill) lives in
`src/components/chrome.tsx`.
- The idle menu wears the shared chrome: `SiteHeader` at the top and a
  "← Back to the menu" link under the Play button. Once a room is joined the
  screen switches to the fullscreen Phaser mount (which keeps only its own
  Exit button).
- The jungle client is split for focus: `src/game/jungle-game.ts` is the thin
  boot (dynamic `await import("phaser")` + game config) and the whole scene
  lives in `src/game/jungle-scene.ts` (loads + renders the Tiled map into
  room containers, spawns the player via `createPlayer()` from
  `src/game/player/player.ts`, drives input, ~20 Hz reports and snapshot
  reconciliation). Remote players are rendered by
  `src/game/player/remote-players.ts` (one sprite per other session, eased
  toward the server position, animated from the `idle`/`jog`/`jump` sprite
  sheets in `Assets/player/sheets`, served via the `public/player` symlink;
  spawn **96,176** inside the first room). The sprite is a child of the room
  container so it inherits room scale/position.
  Player animations are registered by `src/game/player/animations.ts`
  (16×16 cells: `jog` uses 8 of a 3×3 sheet, `jump` 5 of a 2×3 sheet,
  row-major; the jump arc plays once, the rest loop) and driven from state —
  airborne → jump, grounded + moving → jog, grounded + still → idle — via
  the shared physics for the local monkey and the `PlayerInfo` broadcast
  (`grounded`/`vx`) for remotes. Tiled loading lives in `src/game/map/tiled-map.ts`
  (engine-free: fetches `Assets/map/main.json` + `.tsx` tilesets via the
  `public/map` symlink) with the tileset fetch/parse/image helpers in
  `src/game/map/tileset-loader.ts`; the Phaser rendering in
  `src/game/map/map-renderer.ts` (rooms are `ROOM_WIDTH`×`ROOM_HEIGHT` —
  484×272: one *designed* 480px room plus a 4px sliver, cropped at room
  edges; `jungle-scene.ts` passes `gap: 0` so room columns abut exactly and
  the map renders as one continuous world — tile, physics, and camera
  coordinates agree across the room seams). The scene camera is room-locked:
  every frame it snaps to the whole `ROOM_WIDTH`×`ROOM_HEIGHT` room the
  local monkey is in (never a smooth follow), so only the current room is
  ever visible and neighbors stay off-screen until the player crosses a
  boundary. The 480→484 bump exists because the renderer scales rooms to
  fill the 1280×720 canvas *height* (scale ≈ 2.647): a 480px room would
  render only ≈ 1270.6px wide and the sealed camera viewport would show a
  ~9.4px sliver of the next room — see
  `discoveries/room-camera-shows-adjacent-room-seam.md`.
  `tsconfig.json` excludes `public` so the symlinked assets aren't
  typechecked.
- Collision prep: `src/game/collision/collision-geometry.ts` (engine-free,
  like `tiled-map.ts`)
  extracts collision geometry from the `layer1` tiles — 57/109/110 tiles
  form one solid block wherever adjacent (a 57 side bordering a slope emits
  no straight edge; the slope line takes over that boundary). Blocks are
  traced to boundary edges (`kind: "floor"` for horizontal runs, `"wall"`
  for vertical; `side` tells which side the solid is on) plus the 109/110
  diagonal lines. **Collision ignores a layer's `visible` flag** — the
  hidden `layer1` is still parsed by `resolveTiledMap` and used; the renderer
  (`map-renderer.ts`) is what skips `visible: false` layers. The room grid
  (`roomGridSize` in `tiled-map.ts`) is shared by the renderer and the debug
  overlay so both slice the map into rooms identically.
  `src/game/collision/collision-debug.ts` draws those as a Phaser overlay (green
  vertical walls, blue horizontal floors, orange slopes), toggleable via
  `__jungleCollisionDebug.setEnabled(false)`; `createJungleGame` takes
  `{ collisionDebug?: boolean }` (defaults to the `NEXT_PUBLIC_DEBUG` flag —
  off unless it's "1"/"true").

- **Player movement & netcode**: `src/game/player/player.ts` drives the
  monkey with the **shared physics** (`createPlayerState`/`stepPlayer` from
  `@monkeyluka/shared`; the grid comes from building `layer1` with
  `buildTileGrid` — the same gids the server validates against, so prediction
  and collision share geometry). Movement is **client-simulated**: the scene
  (`jungle-scene.ts`) reads arrows/WASD + Space/Up, predicts the local monkey
  every frame, and renders that prediction directly — no server round-trip
  before movement appears. It streams `PLAYER_INPUT_MESSAGE` at ~20 Hz (the
  predicted `px/py/vx/vy/grounded/facing`), and reconciles
  against the broadcast `PlayerInfo` snapshot (snap beyond 32 px, else a
  clamped lean-in) so a report the server rejected visibly stops the monkey;
  other players render directly from server positions (eased). The sprite is
  flipped to `facing`; `render.rooms[0]` contains both local and remote
  sprites, so coordinates are room-local. **Debug only** (`NEXT_PUBLIC_DEBUG`):
  R teleports the local monkey back to its checkpoint — a scene-level
  `checkpoint` starting at `PLAYER_SPAWN` (update it there when real
  checkpoints land) — via `player.teleportTo()` plus a
  `PLAYER_CHECKPOINT_MESSAGE` to the room, whose always-registered handler
  re-baselines validation at the spawn so the jump isn't a teleport
  violation (the room accepts it unconditionally: the target is the
  server-chosen spawn, so it can't bypass the anti-cheat). Snapshot
  reconciliation is **frozen until the server confirms the jump**
  (`checkpointPending`): the broadcast is ~one RTT stale and snapping to it
  would undo the teleport and read as a teleport+speed violation — see
  `discoveries/checkpoint-return-race-stale-snapshot-teleport-violations.md`.

- **Reconnection**: `src/lib/jungle-session.ts` keeps the live room's
  `reconnectionToken` + name in **sessionStorage** (survives reloads, not tab
  closes). `play-screen.tsx` starts directly in a "resuming" phase on mount
  when a session exists and silently re-enters the room via
  `colyseusClient.reconnect(token, JungleState)` — the same sessionId, name
  and last position come back, since the server holds the seat after a drop.
  Because the phase initializer reads `sessionStorage` (client-only), the
  screen gates its real UI behind an internal `booted` flag: SSR and the
  first client frame both render a neutral loader, then the actual phase
  (menu / reconnect / game) appears after mount. **Do not remove that gate**
  or `/play` re-introduces a hydration mismatch every time a session
  survives a reload — see `discoveries/play-screen-hydration-mismatch-sessionstorage.md`.
  The resume effect uses a **live liveness ref** (not a `cancelled` closure
  snapshot) to decide whether to adopt the reconnected room: StrictMode's
  dev-only mount → unmount → mount re-arms the ref, so the reconnect is
  adopted instead of being immediately left — see
  `discoveries/jungle-resume-leaves-room-under-strictmode.md`.
  Mid-session network blips are auto-reconnected by the Colyseus SDK's own
  retry loop (`Room.reconnection`); while the socket is down
  (`!room.connection.isOpen`) `jungle-scene.ts` **freezes local simulation**
  so no movement reports pile up (a burst of buffered reports flushing on
  reconnect has near-zero wall-clock dt and looks like a speed hack). On a
  fresh mount the local player is seeded from its own broadcast position
  (`applyServerSnapshot`) instead of `PLAYER_SPAWN`, so a resumed player
  doesn't teleport on the first report. If the seat expires, `room.onLeave`
  fires and the screen drops back to the menu with the name pre-filled;
  deliberate exits always clear the stored session.

- **Phaser must be imported dynamically** — its bundle touches `window` at
  module scope, so `createJungleGame()` does `await import("phaser")` (never
  import it statically, or SSR prerender of `/play` crashes).
- **Colyseus endpoint** defaults to `ws://<page-hostname>:2567` so LAN dev
  reaches the serving machine; override with `NEXT_PUBLIC_COLYSEUS_ENDPOINT`
  (see `.env.example`).
- Deps: `phaser`, `@colyseus/sdk`, `elysia`, `@elysia/cors`, `@monkeyluka/shared`.

## REST API (Elysia × Next.js)

`src/app/api/[[...slugs]]/route.ts` is the whole Elysia app, following the
[ElysiaJS Next.js integration](https://elysiajs.com/integrations/nextjs):
create the `Elysia` instance once, set `{ prefix: "/api" }`, then export
`app.fetch` as each HTTP method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`,
`OPTIONS`). Requests that reach Next's `/api**` catch-all are forwarded
straight to Elysia.

- Routes: `GET /api` (project info), `GET /api/health` (HealthStatus).
- `export const dynamic = "force-dynamic"` keeps route handlers un-prerendered
  so `/api/health` reports live uptime.
- CORS uses `ALLOWED_ORIGIN_HOST`, a comma-separated host allowlist compiled
  by `compileOriginAllowlist()` in `@monkeyluka/shared` (same env var +
  semantics as the Colyseus handshake gate and `allowedDevOrigins` below);
  Next 16 normalizes `/api/` → `/api`, Elysia matches both.

## Commands

From this dir: `bun run dev`, `bun run build`, `bun run start`,
`bun run lint`, `bun run typecheck`. From the repo root: `bun run dev:web`,
`bun run build:web`, `bun run typecheck:web`.

## Next.js typegen

`LayoutProps` and friends are generated by Next into `.next/types/` on first
`next dev`/`next build`. Run one of those before `tsc --noEmit` here; a clean
checkout needs a build before `bun run typecheck` will pass.

## Importing raw-TS packages (@monkeyluka/shared)

Turbopack does **not** follow bare `.ts` exports on its own. The web app
imports `@monkeyluka/shared` (room state, room names), so it is in
`transpilePackages` in `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  transpilePackages: ["@monkeyluka/shared"],
};
```

## Web dev over LAN

`next.config.ts` reads `ALLOWED_ORIGIN_HOST` (default `"*"`) into
`allowedDevOrigins`; set it in `apps/web/.env` to the LAN IP used to reach
:3000, otherwise Next 16 blocks non-localhost dev origins. The same env var
drives the Elysia `/api` CORS in the route handler above.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Auto-managed agent files

`next dev` (v16) maintains the `<!-- BEGIN/END:nextjs-agent-rules -->` block
above and the scaffolded `CLAUDE.md` stub via
`next/dist/server/lib/generate-agent-files.js`. Keep the markers intact;
manual text outside them (like this section) survives the upsert.