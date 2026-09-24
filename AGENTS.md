# AGENTS.md — monkeyLuka monorepo

If any changes are made, update AGENTS.md every time.

Guidance for humans and AI agents working here — read before editing.

## Docs navigation

Start here, then follow the link that matches what you're working on:

| Doc | What it's for |
|---|---|
| `AGENTS.md` | Monorepo dev guide (this file) — conventions, commands, gotchas |
| `architecture.md` | System architecture — processes, workspaces, data flow |
| `docs/` | `gameplay.md` — traps/doors/quests/anti-cheat deep-dive; `workspaces.md` — `bun add`/`bun patch`/new workspaces |
| `CLAUDE.md` | Claude Code entry stub → points at `AGENTS.md` |
| `apps/web/AGENTS.md` | `@monkeyluka/web` — Next.js 16 frontend + Elysia REST API under `/api` |
| `apps/server/AGENTS.md` | `@monkeyluka/server` — Colyseus realtime only, `defineServer` format |
| `packages/shared/AGENTS.md` | `@monkeyluka/shared` — framework-agnostic shared code |
| `Assets/` | Tiled game-map data + art (web-served via symlinks under `apps/web/public/map`, `public/player`, `public/trap`) |
| `discoveries/agents.md` | How to write a discovery note — one file per non-obvious bug/fix |

Read the workspace `AGENTS.md` before editing inside that workspace; read
`architecture.md` for a system-level view of how the pieces fit together.

## Stack

- **Bun ≥ 1.2** (developed on 1.3.14, pinned as `packageManager`). Node/npm/pnpm are not used.
- Key packages: `next@16`, `react@19`, `elysia@1.4`, `colyseus@0.18`, `@colyseus/schema@5`, `typescript@5`.

## What this repo is

```
monkeyLuka/
├── package.json / bun.lock     # Bun workspace root; single lockfile — commit it
├── patches/                    # `bun patch` diffs (see docs/workspaces.md)
├── architecture.md / docs/     # system architecture + gameplay/workspaces detail
├── discoveries/                # per-bug root-cause write-ups
├── Assets/                     # Tiled map data + art (web-served via public symlinks)
├── apps/  (web, server)        # Next.js 16 + Elysia /api  ·  Colyseus realtime
└── packages/shared             # raw-TS schemas + physics, no build (→ per-workspace AGENTS.md)
```

## Bun workspaces: how it works

- `package.json` declares `"workspaces": ["apps/*", "packages/*"]`; **one**
  `bun.lock` at the root — run `bun install` **only from the root**.
- Local deps use the **`workspace:*` protocol**, so edits are picked up
  instantly via symlink — no publish or rebuild step.
- Root `package.json` holds only shared dev tooling (`typescript`, `@types/bun`);
  app deps belong in that app's `package.json`.
- Adding a dep, `bun patch`-ing a dep, or adding a new workspace → `docs/workspaces.md`.

## Internal packages: no build, raw TypeScript

`packages/` ship raw `.ts` files (Bun runs TypeScript natively) — **never add a
build step or emit to `dist/`** (a duplicate module identity breaks `instanceof`
across workspaces). Keep shared packages **framework-agnostic** (no Next.js or
Elysia imports); type-only imports use `import type { ... }` because
`verbatimModuleSyntax` is on in the server + shared tsconfigs (web uses Next's
generated config; see below).

## Commands (run from the repository root)

| Command | What it does |
|---|---|
| `bun install` | Install everything; updates root `bun.lock` |
| `bun run dev` | Run **both** apps: `dev:web` + `dev:server` |
| `bun run dev:web` | Next.js dev server → http://localhost:3000 |
| `bun run dev:server` | Server in watch mode (`bun run --watch`) |
| `bun run build:web` | Production build of the Next.js app |
| `bun run start:server` | Run the server without watch mode |
| `bun run typecheck` | `tsc --noEmit` for web, server, and shared |
| `bun test` | Unit tests — see Testing below |

Per-workspace scripts also work from inside the app dir; don't use `npm run` (Bun is required for `.ts`).

## Testing

- `bun test` from the root runs shared physics/math + server map-loader/quest
  suites (each workspace's `test` script).
- **All tests are fixture-based**: no test reads `Assets/map/main.json` (the
  level is art in active rework) — a map edit must never break the suite.
- After changing shared constants (e.g. `PLAYER_SPAWN`, anti-cheat tuning),
  **restart the Colyseus server — don't trust the watch** (`bun run --watch`
  misses atomic saves, so web/server disagree and respawn silently breaks).
  Restart `bun run dev`, reload the tab, verify a fresh client's spawn. See
  `discoveries/stale-colyseus-dev-server-respawn-wrong-position.md`.

## Conventions & gotchas (repo-wide)

- **tsconfigs**: `apps/server` + `packages/shared` follow the Bun baseline
  (`module: "Preserve"`, `moduleResolution: "bundler"`, `verbatimModuleSyntax`,
  `noEmit`, `types: ["bun"]`) with `noImplicitOverride` — overrides must be
  marked `override`. `apps/web` uses Next's generated config; don't copy the
  server baseline into it.
- **Commit `bun.lock`**; don't add `.gitignore` rules beyond the root ones
  (`.next/`, `node_modules/`, and env files are covered; `apps/server/data/`
  — the run-results SQLite — is added too).
- Keep secrets out of source; use gitignored env files (an `env.example` may be committed).
- Non-obvious bugs get a write-up in `discoveries/` (one file per discovery —
  format in `discoveries/agents.md`); workspace-specific gotchas (Next.js
  typegen, Colyseus internals, `transpilePackages`) live in each workspace's
  `AGENTS.md`.

## Gameplay & anti-cheat (where the detail lives)

The player simulation is **client-side** (shared `packages/shared/src/physics/`):
collision, run/jump/wall-cling, traps, doors, quests, the endgame run-finish,
and the reconnect flow.
The full current-state deep-dive is **`docs/gameplay.md`**; per-workspace
detail: `apps/web/AGENTS.md` (rendering/debug), `apps/server/AGENTS.md`
(validation, quest gate, run-results SQLite), `packages/shared/AGENTS.md`
(physics models). Per-bug root causes: `discoveries/`.

**Endgame (404 finish tile)**: tile gid 404 in `layer1` is an interaction tile
(shared `INTERACTION_TILE_ACTIONS`: 404 → `"finish"`). Standing on it and
pressing E stops the run: the room stamps the server finish moment on the
synced `PlayerInfo.finishedAt`, the web client freezes its run timer at it
and shows the completion time (input freezes too), and the room records the
result to a SQLite store (`apps/server/src/game/run-results.ts`;
`apps/server/data/jungle-runs.sqlite`, env `JUNGLE_RUN_RESULTS_PATH`, time =
finish − joinedAt + 10s per counted death). See `docs/gameplay.md`.

## Boundaries

### Always

- Keep changes scoped to the requested task; follow existing repo patterns.
- Run targeted tests after modifying code (`bun test`, or a workspace's own
  test/typecheck scripts); restart both apps after changing shared constants.

### Ask First

- Adding a new dependency (or a `bun patch` of an existing one).
- Changing shared schemas/state or wire messages — the definition and both
  consuming processes must stay in sync.
- Changing public APIs, env vars, or the map/asset contract; deleting files or
  restructuring workspaces.

### Never

- Commit secrets or credentials (env files stay gitignored).
- Edit generated files or `bun.lock` by hand (regenerate via `bun install`);
  touch `node_modules/` except through the `bun patch` editable-copy flow.
- Weaken tsconfig strict options to make a build pass.
- Delete tests or code to work around a failing build or test.
- Ship a map edit that breaks the fixture-based test suite.
- Deploy to production without explicit approval.

## When Blocked

- Ask for clarification when requirements are ambiguous; don't guess about
  destructive operations (deletions, git history, deploy).
- Report unrelated infrastructure failures rather than working around them.

## References

- `architecture.md`, `docs/gameplay.md`, `docs/workspaces.md`,
  `discoveries/agents.md`