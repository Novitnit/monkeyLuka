# AGENTS.md — monkeyLuka monorepo

If any changes are made, update AGENTS.md every time.

Guidance for humans and AI agents working in this repository. Read this before
editing: it explains how the Bun workspace monorepo works and the conventions
you must follow.

## Docs navigation

Start here, then follow the link that matches what you're working on:

| Doc | What it's for |
|---|---|
| `AGENTS.md` | Monorepo dev guide (this file) — conventions, commands, gotchas |
| `architecture.md` | System architecture — processes, workspaces, data flow |
| `CLAUDE.md` | Claude Code entry stub → points at `AGENTS.md` |
| `apps/web/AGENTS.md` | `@monkeyluka/web` — Next.js 16 frontend + Elysia REST API under `/api` |
| `apps/server/AGENTS.md` | `@monkeyluka/server` — Colyseus realtime only, `defineServer` format |
| `packages/shared/AGENTS.md` | `@monkeyluka/shared` — framework-agnostic shared code |
| `Assets/` | Tiled game-map data + art (not a Bun workspace; served to the web app via symlinks under `apps/web/public/map` and `apps/web/public/player`) |
| `discoveries/agents.md` | How to write a discovery note — one file per non-obvious bug/fix |

Read the workspace `AGENTS.md` before editing inside that workspace; read
`architecture.md` for a system-level view of how the pieces fit together.

## What this repo is

A single-repo workspace managed by **Bun workspaces**. Everything is
TypeScript and runs on **Bun**. There is **no build step** for internal
packages.

```
monkeyLuka/
├── package.json          # workspace root (scripts, shared dev deps)
├── bun.lock              # single lockfile for the whole repo — commit it
├── patches/              # `bun patch` diffs for deps we must fix (see below)
├── AGENTS.md             # monorepo dev guide (this file); per-workspace AGENTS.md for details
├── architecture.md       # system architecture: processes, data flow, design decisions
├── CLAUDE.md             # navigation entry point → AGENTS.md (Claude Code compat)
├── discoveries/          # per-bug root-cause write-ups → discoveries/agents.md
├── Assets/               # tracked Tiled game-map data + art (web-served via public symlinks)
├── apps/
│   ├── web/              # @monkeyluka/web  — Next.js 16 (App Router) frontend + Elysia REST API under /api → apps/web/AGENTS.md
│   └── server/           # @monkeyluka/server — Colyseus realtime matchmaker + rooms (defineServer) → apps/server/AGENTS.md
└── packages/
    └── shared/           # @monkeyluka/shared — framework-agnostic shared code → packages/shared/AGENTS.md
        └── src/
            ├── index.ts      # schemas (JungleState/PlayerInfo), room names, origin allowlist
            └── physics.ts    # barrel → tiles.ts / collision.ts / player.ts / validation.ts
```

## Requirements & versions

- **Bun ≥ 1.2** (developed on 1.3.14). Node/npm/pnpm are not used.
- Key packages: `next@16`, `react@19`, `elysia@1.4`, `colyseus@0.18`,
  `@colyseus/schema@5`, `typescript@5`.

## How Bun workspaces work here

- `package.json` at the root declares `"workspaces": ["apps/*", "packages/*"]`.
- **One** `bun.lock` at the root; run `bun install` **only from the root**.
  It installs every workspace's dependencies in ~seconds (Bun installs a
  content-addressed store under `node_modules/.bun` and symlinks each
  workspace's deps into its own `node_modules`).
- **Local dependencies use the `workspace:*` protocol** — e.g.
  `apps/server/package.json` has `"@monkeyluka/shared": "workspace:*"`.
  This symlinks the package, so edits are picked up instantly with no publish
  or rebuild step.
- The root `package.json` holds only **shared dev tooling** (`typescript`,
  `@types/bun`). App-specific deps belong in that app's `package.json`.

### Adding a dependency

CD into the target workspace, then `bun add` (or `bun add -d`):

```sh
cd apps/server && bun add some-package
cd apps/web && bun add -d some-plugin
```

This installs everywhere, updates only that workspace's `package.json`, and
records the resolution in the root `bun.lock`. Do **not** run `bun install`
inside a workspace — run it at the root.

### Patching a dependency

When a dependency has an upstream bug we can't wait for, patch it with
`bun patch` (committed to `patches/`, pinned via `patchedDependencies` in the
root `package.json` + `bun.lock`, applied automatically on `bun install`):

```sh
EDITOR=true bun patch <pkg>        # switches it to editable mode
# edit the extracted copy under node_modules/<pkg>
bun patch --commit 'node_modules/<pkg>'   # writes patches/… and pins it
bun install                        # relinks the patched copy (run from root)
```

Notes: the editable copy alone can't resolve its own deps (they live in the
`.bun` store) — always `bun install` after `--commit`; patch both the `.mjs`
and `.cjs` build outputs when both exist. Every patch needs a write-up in
`discoveries/` and a pointer from the owning workspace's `AGENTS.md`.

### Adding a new workspace

1. Create `apps/foo/` or `packages/foo/` with its own `package.json`
   (`name`, `type: "module"`, `private: true`, `scripts`).
2. Copy the `tsconfig.json` baseline from `apps/server` or `packages/shared`.
3. Add the workspace name to a consumer's deps with `"workspace:*"`.
4. `bun install` at the root.
5. Give the new workspace its own `AGENTS.md` (mirror `apps/server/AGENTS.md`
   or `packages/shared/AGENTS.md`) and link it from this file.

## Internal packages: no build, raw TypeScript

**`packages/` do not need to be built, and you should not add build steps to
them.** They ship raw `.ts` files because Bun runs TypeScript natively. The
pattern and its rules are documented in `packages/shared/AGENTS.md`; the rules
every consumer must respect:

- **Never `emit`/compile to `dist/` for internal packages** — you'd create a
  duplicate module identity and break `instanceof` checks across workspaces.
- Keep shared packages **framework-agnostic** (no Next.js or Elysia imports).
- Type-only imports should use `import type { ... }` because `verbatimModuleSyntax`
  is enabled in every tsconfig.

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
| `bun test` | Unit tests: shared physics/collision + server map loader |

Per-workspace scripts also work from inside the app dir (`bun run dev` in
`apps/web`). Don't use `npm run`; Bun's shell runner resolves workspace bins
fine, and Bun is required for `.ts` execution anyway.

## Conventions & gotchas (repo-wide)

- **TypeScript configs** follow the Bun baseline (`module: "Preserve"`,
  `moduleResolution: "bundler"`, `verbatimModuleSyntax`, `noEmit`,
  `types: ["bun"]` via `@types/bun`). The baseline enables
  `noImplicitOverride` — class members overriding base classes (e.g. Colyseus
  lifecycle methods) must be marked `override`.
- **Commit `bun.lock`** — it pins every dependency for all workspaces.
- **Don't gitignore `node_modules` subtree noise** beyond the root
  `.gitignore` rules; `.next/`, `node_modules/`, and `.env*` are already
  covered.
- Keep secrets out of source; use `.env` files (gitignored, `.env.example`
  can be committed).

Workspace-specific gotchas (Next.js typegen / LAN dev, Colyseus internals,
`transpilePackages`) live in the respective workspace `AGENTS.md`. Non-obvious
bugs and their fixes get a write-up in `discoveries/` — one file per discovery;
see `discoveries/agents.md` for the format and conventions.

## Gameplay simulation & anti-cheat (current state)

The player simulation is **client-side**: the client runs the collision and
run/jump physics every frame with `packages/shared/src/physics.ts` (tile
collision: 57 solid, 65 folds into 57, 110/109/262/287/288 slopes) and renders its own prediction
with no server round-trip. Slope contacts: 110/109 landings rest on the flat
top lip
(never hoist an under-runner walking below a chamfer); 262 climbing rides the
ramp's surface at the box's leading edge; 287 is the half-height 2:1 ramp
(16px run, 8px rise — solid below the bottom-left-corner→right-edge-
midpoint line, base flush with the tile's bottom edge, so a walker steps
straight onto it from the floor; a solid back column under the apex;
underside is a flat ceiling); 288 is the staircase tile — the mirror of 287
(2px treads stepping down from the top-right to the bottom-left) with a
full-height right wall, a left wall from mid-height down, and a solid base
row, hollow between the treads and the base (a pixel mask, not an analytic
wedge), so a 287 + 288 pair forms one continuous ramp to the top of 288 —
its seam binds the walker at 287's apex (dy 8) onto 288's left tread (dy 7)
through a 1px-deep support allowance; see collision.ts's `STAIRS_MASK`) —
documented in
`discoveries/jungle-slope-climb-buries-player-kicks-teleport.md` and
`discoveries/shallow-ramp-tile-287-half-height-diagonal.md`. The Colyseus
room does **no simulation** — it only
validates the client's movement reports (malformed / flood / teleport /
abnormal speed / buried-in-geometry via `validatePositionReport`) and
broadcasts the last accepted report. A failing report **stops the player**
(the broadcast freezes at the last accepted position, velocity zeroed) while
violations count toward a kick. `PlayerInfo` position/velocity fields come
from accepted client reports only (velocity clamped to the physics max) — a
raw client-supplied position is never trusted, and after a stop the player
only moves again once a report passes validation. Wall cling (a grab):
airborne next to a wall, moving into it, pressing jump grabs the wall and
hangs the player (no gravity) until jump again launches them up+away
(wall jump), they press away, or they land — the shared stepPlayer state
machine + `clinging` in the wire reports/broadcast drive it deterministically
on both sides. Details live in the `shared`, `server`, and `web` workspace
guides. **Debug** (`NEXT_PUBLIC_DEBUG`,
off unless "1"/"true"): the collision-debug overlay renders, and R teleports
the player back to its checkpoint (starting at the spawn point) through a
`PLAYER_CHECKPOINT_MESSAGE` the room always accepts (its target is the
server-chosen spawn, so it can't bypass the anti-cheat) — only the R key
itself is debug-gated, on the web side.

**Reconnection**: a dropped client (page reload, tab close, network blip)
holds its seat + world entry for `RECONNECT_GRACE_SECONDS` (default 30,
`JUNGLE_RECONNECT_SECONDS`): the room's `onDrop` calls Colyseus
`allowReconnection()`, so the session rejoins with the **same sessionId** via
`client.reconnect(token)` and its name/last position survive. The web client
stores the reconnect token in sessionStorage and silently resumes after a
reload; mid-session blips are auto-reconnected by the Colyseus SDK's retry
loop while the client freezes its local simulation (no movement reports pile
up to look like a speed hack). `onReconnect` resets the report `seq` gate and
the speed clock, since a reloaded page restarts its `seq` at 0. An explicit
`leave()` (Exit button, anti-cheat kick) still removes the player for good.