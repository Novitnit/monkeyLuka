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

- Tile constants: `TILE_SIZE` (16), `TILE_SOLID` (57), `TILE_SOLID_65` (65,
  a plain full block with the same footprint as 57 — `buildTileGrid` folds
  it into `TILE_SOLID` so the physics sees one solid kind, since the
  penetration code treats every non-57 kind as a slope), `TILE_SLOPE_TL_BR` (110),
  `TILE_SLOPE_TR_BL` (109), `TILE_SLOPE_BR` (262, mirror of 109 — solid on the
  bottom-right half), `TILE_SLOPE_SHALLOW` (287, the 2:1 ramp — 16px run, 8px
  rise, solid below the line from the bottom-left corner (0, 16) to the
  right edge's midpoint (16, 8)), `TILE_STAIRS` (288, the staircase tile — a
  pixel-mask shape in `collision.ts`'s `STAIRS_MASK`, not an analytic wedge:
  eight 2px treads stepping down from the top-right to the bottom-left — the
  mirror of 287 — plus a full-height right wall, a left wall from mid-height
  down, and a solid base row, hollow between the treads and the base), `COLLISION_LAYER_NAME` (`"layer1"`), `PLAYER_SPAWN`.
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
  287 is 262 at half the rise, anchored to the cell's BOTTOM edge — the
  face runs from the bottom-left corner (0, 16) to the right edge's
  midpoint (16, 8) (solid below it: dx + 2·dy ≥ 32): so its landing
  surface is its own 2:1 line (sampled at the shallowest extent, same
  ride-on-the-corner rule); its base is flush with the bottom edge, so a
  floor-level walker steps straight onto it (a ground-level walk-on ramp —
  the dir>0 lift guard is 262's "below the cell" one, there is no hollow
  wing to hoist from); its underside is FLAT (the base row is solid at
  every column — a rising box hits a ceiling at the cell bottom, not the
  face); the right-mover face is `32 − 2·dyBottom`, clamped to the tile's
  left edge once a box's bottom is below the cell (the unclamped face
  would shove a low box ~24px back); and the right column below the apex
  is the solid BACK SIDE — the ramp's top-right corner is a wall a
  left-mover meets like 262's right column. See
  `discoveries/shallow-ramp-tile-287-half-height-diagonal.md`.
  288 is the staircase tile — a **pixel mask** (`STAIRS_MASK` in
  collision.ts), so all five queries (point, AABB, slope support,
  horizontal/vertical penetration) branch on the mask directly: the tread
  tops are the landing surface, sampled at the box's rightmost column
  (`topRow = 7 − ⌊c/2⌋`, same ride-on-the-leading-corner rule as 262/287); a
  full-height right wall and a mid-height left wall block lateral motion via
  the nearest solid column; the base row makes the underside a flat ceiling
  and the interior (between treads and base) reads OPEN to point/AABB tests.
  Its support band allows a box ~1px BELOW the left foot (a walker arriving
  from a sealing 287 ramp sits at 287's apex, dy 8, while 288's left tread
  is dy 7) so the 287 → 288 seam settles instead of jamming the walker at
  the left wall's top row — a 287 + 288 pair is one continuous ramp to the
  top of 288.
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