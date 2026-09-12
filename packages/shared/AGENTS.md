# AGENTS.md — @monkeyluka/shared

Guidance for agents editing `packages/shared`. Repo-wide conventions (Bun
workspaces, installs, commands, tsconfig baseline) live in the root
`AGENTS.md` — read it before this one.

## No build step — raw TypeScript

**Do not build this package; do not add a build step.** It ships raw `.ts`
files because Bun runs TypeScript natively. The `exports` map points straight
at the source:

```jsonc
// packages/shared/package.json
"exports": {
  ".": {
    "types": "./src/index.ts",
    "default": "./src/index.ts"   // Bun loads the .ts directly
  }
}
```

Any Bun-runtime workspace can `import { greeting } from "@monkeyluka/shared"`
and it just works — Bun transpiles on the fly. `tsc --noEmit` typechecks it in
place because every tsconfig here uses `"moduleResolution": "bundler"`
(Turbopack/webpack-style resolution understands `.ts` in `exports`).

## Rules you must respect

- **Never `emit`/compile to `dist/`** — you'd create a duplicate module
  identity and break `instanceof` checks across workspaces.
- Keep this package **framework-agnostic**: no Next.js or Elysia imports.
  The one deliberate exception is `@colyseus/schema` — the jungle room's state
  schema (`JungleState`/`PlayerInfo`, plus `ROOM_NAMES.jungle` and
  `MAX_PLAYER_NAME_LENGTH`) lives here as the single source of truth shared
  between server and web client. It's the serialization format, not server
  logic; don't import anything else Colyseus-related.
- Type-only imports/exports use `import type` / `export type` because
  `verbatimModuleSyntax` is enabled (see `src/index.ts` for the pattern).

## Consumers

- **server** — imports `JungleRoom`'s state, `ROOM_NAMES`, `MAX_PLAYER_NAME_LENGTH`
  directly (Bun handles `.ts`), plus the validation/physics contract
  (`buildTileGrid`, `createPlayerState`, `validatePositionReport`,
  `PLAYER_INPUT_MESSAGE`, `ANTI_CHEAT`). It does **not** run `stepPlayer` —
  movement is client-simulated.
- **web** — imports `JungleState` (as the SDK join root-schema), `ROOM_NAMES`,
  `MAX_PLAYER_NAME_LENGTH`, and the physics contract for local prediction
  (`createPlayerState`, `stepPlayer`, `buildTileGrid`). Turbopack doesn't follow
  bare `.ts` exports on its own, so `@monkeyluka/shared` is in
  `transpilePackages` in `apps/web/next.config.ts`.
- **server + web** — `compileOriginAllowlist(rawHosts)` compiles the shared
  `ALLOWED_ORIGIN_HOST` env var (comma-separated host allowlist; `*`/unset =
  any origin) into the matcher for the Colyseus WebSocket handshake gate and
  the Elysia `/api` CORS. Keep it framework-agnostic (pure string/RegExp).

## Physics & movement validation (`src/physics.ts`)

`physics.ts` is a **barrel entry point** — the code is split into four
framework-agnostic modules in `src/`, re-exported so all existing imports
(`@monkeyluka/shared`, `./physics`) keep working: `tiles.ts` (tile constants,
layer → `SolidGrid`, world bounds), `collision.ts` (point/AABB tests +
penetration helpers + `wallBeside` wall-adjacency probe), `player.ts`
(`stepPlayer` sim — ground/coyote/buffered jumps plus the **wall cling**
state machine (grab/hang/wall-jump/release): config, spawn, speed
ceiling), `validation.ts` (`player:input` contract + anti-cheat). This is the
**single source of truth for gameplay simulation**, imported verbatim by the
browser (authoritative prediction, since movement is client-simulated) and
the server (report validation). It is engine-free and pure — no Phaser, DOM,
or Colyseus imports — so it can also be unit-tested directly.

- Tile constants: `TILE_SIZE` (16), `TILE_SOLID` (57), `TILE_SLOPE_TL_BR` (110),
  `TILE_SLOPE_TR_BL` (109), `TILE_SLOPE_BR` (262, mirror of 109 — solid on the
  bottom-right half), `COLLISION_LAYER_NAME` (`"layer1"`), `PLAYER_SPAWN`.
  The web's `collision-geometry.ts` re-exports its `WALL_TILE`/`DIAGONAL_*`
  names from these so rendering and physics can't drift.
- `buildTileGrid(layer)` → `SolidGrid`; `isPointSolid` / `isBoxSolid` for
  queries; `gridPixelSize` for world bounds.
- Slope contact rules (see
  `discoveries/jungle-slope-climb-buries-player-kicks-teleport.md` for the
  full diagnosis): 110/109 are corner brackets whose top edge is solid across
  the cell — a box landing on one rests on the flat lip (bottom = cell top),
  and the lip only fires for a box genuinely falling from above; a box
  brushing the cell from below (overhang under-runner) must not be hoisted.
  262 is the mirror — the solid hangs below the TR→BL line, so its landing
  surface IS the line, sampled at the box's shallowest extent (rightmost
  side) so a right-moving climber rides the ramp with its bottom-right
  corner and never embeds (sampling the deepest point buried the box and
  tripped the anti-cheat's buried-in-geometry check → teleport kick).
- `createPlayerState()` + `stepPlayer(state, input, grid, dt, config)` — the
  deterministic player step (run accel, gravity, coyote/buffered jump, wall
  cling: airborne + moving into a wall + jump press grabs the wall — the
  player hangs (gravity/lateral drift off, facing away from the wall, the
  mirror of the cling side on the X-axis) until jump again
  (wall jump: up + away), pressing away, or landing — then axis-separated
  AABB-vs-tiles collision with slope surfaces). Runs on the **client** every
  frame; the reported result is what the server validates.
- `PLAYER_INPUT_MESSAGE` / `PlayerInputMessage` — the client→server wire
  contract (predicted position/velocity/grounded/**clinging**/facing). The
  state fields are advisory; only a report that passes
  `validatePositionReport` is broadcast.
- `validatePositionReport(...)` + `ANTI_CHEAT` — server-side trajectory checks
  against the **last accepted report**: teleport (too far from it / buried in
  geometry) and abnormal speed, plus rate/flood limits. A failing report makes
  the room stop the player (freeze the broadcast, zero velocity) and counts
  toward a kick. See
  `discoveries/jungle-anticheat-flags-grounded-players.md` — **never** sample
  collider edge points without an inset.

`PlayerInfo` in `src/index.ts` carries the broadcast movement state
(`x`, `y`, `vx`, `vy`, `grounded`, `clinging`, `facing`) alongside `name`;
the server is the only writer, and it writes accepted client reports
(velocity clamped to the physics max). The two physics bugs found while
building this are written up in
`discoveries/jungle-grounded-persists-off-ledge.md` and
`discoveries/jungle-anticheat-flags-grounded-players.md`.

## Commands

From this dir: `bun run typecheck`, `bun test`. From the repo root:
`bun run typecheck:shared`, `bun test`.