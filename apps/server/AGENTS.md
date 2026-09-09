# AGENTS.md — @monkeyluka/server

Guidance for agents editing `apps/server`. Repo-wide conventions (Bun
workspaces, installs, commands, tsconfig baseline) live in the root
`AGENTS.md` — read it before this one.

## What this app is

One process exposing two ports:

- `:3001` — **ElysiaJS** REST API (`GET /`, `GET /health`). Non-greedy: it
  uses `Bun.serve()` under the hood.
- `:2567` — **Colyseus** realtime matchmaker + WebSocket rooms. It runs its
  own `node:http` server and `ws` transport, which **does work on Bun** —
  verified end-to-end (room join + schema state sync).

## Ports & config

Env defaults: `PORT=3001`, `COLYSEUS_PORT=2567`, `HOST=0.0.0.0`. Override via
env or `.env` files (Bun auto-loads `.env` in this dir; see `.env.example`).

`ALLOWED_ORIGIN_HOST` (default `"*"`) is compiled into a regex used for
**both** Elysia CORS and the Colyseus WebSocket handshake
(`WebSocketTransport.beforeUpgrade` rejects browser origins that don't match;
non-browser clients with no `Origin` header — e.g. smoke-test scripts — pass).

## Room state schema

Room handlers live in `src/rooms/` (currently empty until the first room
lands). Use the **functional `schema()` API** from `@colyseus/schema` for room
state — no decorators, no special tsconfig flags beyond what's on.

If you ever switch to the legacy `@type()` decorators: `experimentalDecorators`
is already enabled in `tsconfig.json`, but you must **also** set
`useDefineForClassFields: false` there.

Because `noImplicitOverride` is on (Bun baseline), Colyseus lifecycle methods
(`onCreate`, `onJoin`, …) must be marked `override`.

## Colyseus 0.18 quirks

- HTTP matchmaker routes are **POST-only** (`POST /matchmake/joinOrCreate/<room>`).
- Client SDK for tests/scripts is `@colyseus/sdk` — install it only where it's
  needed (e.g. as a devDependency of a smoke-test script), not in this package.

## Commands

From this dir: `bun run dev` (watch mode), `bun run start`, `bun run typecheck`.
From the repo root: `bun run dev:server`, `bun run start:server`.