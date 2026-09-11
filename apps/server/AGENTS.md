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

`ALLOWED_ORIGIN_HOST` (default `"*"`) is compiled into a regex used for the
Colyseus WebSocket handshake only: `WebSocketTransport.beforeUpgrade` rejects
browser origins that don't match; non-browser clients with no `Origin` header
(e.g. smoke-test scripts) pass. The same env var feeds the web app's Elysia
CORS — set it in `apps/web/.env` too.

## Room state schema

`src/rooms/jungle-room.ts` (currently the only room) extends `Room<{
state: JungleRoomState }>` from the shared `schema()` API — no decorators.
It tracks joined players (`sessionId → name`) in the shared `JungleState`
schema, clamping names with `MAX_PLAYER_NAME_LENGTH` from `@monkeyluka/shared`.

Because `noImplicitOverride` is on (Bun baseline), Colyseus lifecycle methods
(`onCreate`, `onJoin`, `onLeave`, `onDispose`) and any base-class property you
re-declare (e.g. `maxClients`) must be marked `override`.

Note: `setState()` is deprecated in this core — assign `this.state = ...`
instead.

## Colyseus 0.18 quirks

- HTTP matchmaker routes are **POST-only** (`POST /matchmake/joinOrCreate/<room>`).
- **Playground** is mounted at `/playground` (incl. trailing slash — `skipTrailingSlashes: true` is required because better-call's router 404s on a slash mismatch; the SPA only registers `/playground/` + `/playground/**:splat`).
- **Playground static assets are served through `@colyseus/better-call`'s Node adapter, which we patch** (`patches/@colyseus%2Fbetter-call@1.3.3.patch`, see `discoveries/playground-assets-stall-better-call-res-end.md`): upstream 1.3.3's `setResponse` never calls `res.end()` after a body hits backpressure, so any asset >16 KiB stalls the browser at exactly 16 KiB. Do not "fix" this by removing the patch or switching `res.end()` back into the loop.
- Colyseus is `colyseus@0.18` with core 0.18.11; `defineServer`/`defineRoom`/`Server`
  are all re-exported from the `colyseus` package itself, no `@colyseus/core` dep needed.
- Client SDK for tests/scripts is `@colyseus/sdk` — install it only where it's
  needed (e.g. as a devDependency of a smoke-test script), not in this package.

## Commands

From this dir: `bun run dev` (watch mode), `bun run start`, `bun run typecheck`.
From the repo root: `bun run dev:server`, `bun run start:server`.