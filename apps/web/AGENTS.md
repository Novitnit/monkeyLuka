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
- **Mobile / short-viewport responsiveness**: the whole `/play` flow is sized
  to the viewport and never scrolls vertically. The screen's menu, loader,
  and playing states all use fixed `h-dvh` wrappers with `overflow-hidden`
  (no `min-h-dvh`: a growing wrapper is what let the menu spill past the
  viewport on landscape phones); `globals.css` defines the `compact`
  (≤560px tall), `short` (≤440px tall), and `micro` (≤312px tall)
  `@custom-variant`s — the site header stays visible at every size but
  compacts (`SiteHeader`'s `h-16` → `short:h-12`) and the menu card
  tightens at `short`, then visually shrinks (`micro:scale-[0.78]` on a
  wrapper, never on the `animate-rise` card itself) at `micro` (fold-cover
  screens ~280px tall) so nothing is ever cropped; the menu's `main` uses
  `clamp()`-based padding so the full-size card also fits the 561–582px
  band just above `compact` without cropping. The in-game canvas already
  fills the viewport height via Phaser `Scale.FIT` + `CENTER_BOTH`
  (letterboxed horizontally on wide screens), and the Exit button sits at
  `max(1rem, env(safe-area-inset-*))` so it clears phone notches;
  `overscroll-behavior: none` on `body` stops mobile rubber-band/
  pull-to-refresh from fighting the fixed-height screen. The placeholder
  screens (`/how-to-play`, `/leaderboard`) follow the same fixed-height +
  clamp-padding pattern.
- **On-screen touch controls**: when the primary pointer is coarse (mobile
  — the same `(pointer: coarse)` check as the GameGate), the playing state
  renders `src/components/touch-controls.tsx` over the canvas: a bottom-left
  left/right pad and a bottom-right interact+jump cluster, safe-area
  anchored and `pointer-events-none` around the buttons so taps elsewhere
  (quest rows, etc.) reach Phaser. The HUD writes into a shared
  `TouchControlsState` (`src/game/touch/touch-input.ts`, one instance per
  game, created by `play-screen.tsx` and handed to the game via
  `JungleGameOptions.touchControls`), and `scene/update.ts` merges it into
  the same player-input path as the keyboard: left/right held, jump/interact
  tap edges consumed exactly like `Keyboard.JustDown` (one tap = one
  press; a tap under the quest modal/death freeze stays buffered until the
  gates drop, and a mid-air interact tap is consumed once the feet land).
  No separate physics/touch code path — reports and validation are
  identical to keyboard play.
- The jungle client is split for focus: `src/game/jungle-game.ts` is the thin
  boot (dynamic `await import("phaser")` + game config) and the scene lives
  in `src/game/scene/` — `scene/index.ts` builds the scene config by wiring
  `create.ts` (loads + renders the Tiled map into room containers, spawns
  the player via `createPlayer()` from `src/game/player/player.ts`, keyboard)
  and `update.ts` (input, ~20 Hz reports, snapshot reconciliation,
  room-locked camera, remote easing) over the mutable world in `state.ts`,
  with `constants.ts` (asset locations, report cadence) and `debug.ts`
  (NEXT_PUBLIC_DEBUG gates + window handles). Remote players are rendered by
  `src/game/player/remote-players.ts` (one sprite per other session, eased
  toward the server position, animated from the `idle`/`cling`/`jog`/`jump`
  sprite sheets in `Assets/player/sheets`, served via the `public/player`
  symlink;
  spawn **56,192** inside the first room). Local and remote sprites are
  children of a scene-level **player layer** — a transform twin of room 0
  (same position/scale) created after all the room containers — so they
  draw on top of every room's background/tiles while keeping room-local
  coordinates. (Parenting them to `rooms[0]` instead would hide the player
  under the next room's art: Phaser renders a container's children at the
  container's display-list slot, and each room after the first is added
  later and drawn above it.)
  Player animations are registered by `src/game/player/animations.ts`
  (16×16 cells: `jog` uses 8 of a 3×3 sheet, `jump` 5 of a 2×3 sheet,
  row-major; the jump arc plays once, the rest loop) and driven from state —
  airborne → jump, grounded + moving → jog, grounded + still → idle — via
  the shared physics for the local monkey and the `PlayerInfo` broadcast
  (`grounded`/`vx`) for remotes. Tiled loading lives in `src/game/map/tiled-map.ts`
  (engine-free: fetches `Assets/map/main.json` + `.tsx` tilesets via the
  `public/map` symlink, and parses the objectgroups — the `room` group's
  annotations are the door links, see below) with the tileset
  fetch/parse/image helpers in
  `src/game/map/tileset-loader.ts`; the Phaser rendering in
  `src/game/map/map-renderer.ts` (rooms are `ROOM_WIDTH`×`ROOM_HEIGHT` —
  480×272, exactly the designed rooms, cropped at room
  edges; `scene/create.ts` passes `gap: 0` so room columns abut exactly and
  the map renders as one continuous world — tile, physics, and camera
  coordinates agree across the room seams). Image layers (`imagelayer` in
  `main.json`, e.g. the 480×272 `background`) are resolved by
  `resolveTiledMap` into `TiledMap.imageLayers` and rendered by the
  map-renderer first (behind the tiles): the image is preloaded + registered
  as a Phaser texture per layer, then drawn once per room, tiled per
  `repeatx`/`repeaty` and cropped to the room bounds exactly like tiles —
  the background is room-sized at (0,0) with `repeatx`, so it lands
  seam-aligned in every room. The scene camera is room-locked:
  every frame it snaps to the whole `ROOM_WIDTH`×`ROOM_HEIGHT` room the
  local monkey is in (never a smooth follow), so only the current room is
  ever visible and neighbors stay off-screen until the player crosses a
  boundary. `ROOM_WIDTH` stays exactly 480 (never wider — the window is the
  designed room, so the camera grid always aligns with the room art); the
  renderer scales each room to exactly the canvas width (`scale =
  canvasWidth/ROOM_WIDTH ≈ 1280/480 ≈ 2.667`), so a scaled room is exactly
  1280px wide and the seam lands exactly on the viewport edge — no sliver.
  Tradeoff: at that scale the 272px room height renders ≈ 725.3px, 5.3px
  over the 720px canvas, so the map's top/bottom rows crop ~2.67px each at
  the world's vertical edges — see
  `discoveries/room-camera-shows-adjacent-room-seam.md`.
  The game config (`src/game/jungle-game.ts`) sets `pixelArt: true` —
  nearest-neighbor filtering + rounded pixels: the default linear filtering
  made the tightly-packed 16px atlas cells (player sheets, tilesets) bleed
  ~1px of the adjacent frame at the ~2.667x magnification, and sub-pixel
  tile placement showed seams between neighbors.
  `tsconfig.json` excludes `public` so the symlinked assets aren't
  typechecked.
- Collision prep: `src/game/collision/collision-geometry.ts` (engine-free,
  like `tiled-map.ts`)
  extracts collision geometry from the `layer1` tiles —
  57/65/109/110/262/287/288/289/290
  tiles form one solid block wherever adjacent (a 57 side bordering a slope
  emits no straight edge; the slope line takes over that boundary) plus the
  464 dead-zone tiles, which have no wall geometry (an OPEN pit, see
  `DEAD_ZONE_MASK`) and instead emit their outline as `kind: "hazard"`
  segments: the mouth rim, the side walls down to the 3px basin floor, and
  the floor line, tracing the perimeter of each connected 464 group — a
  face is covered only by an adjacent 464 neighbor (adjacent pits merge
  into one trench outline); other collision types are ignored, so a pit
  bordering a wall/floor still emits its own full outline. Blocks
  are traced to boundary edges (`kind: "floor"` for horizontal runs, `"wall"`
  for vertical; `side` tells which side the solid is on) plus the
  109/110/262/287/288/289/290 diagonal lines (288's staircase line is drawn
  as the top-aligned 2:1 segment (0, 8) → (16, 0); 289, its left-right
  mirror, as (16, 8) → (0, 0)). 287/288/289/290 also emit their solid
  back wall and bottom base row as straight boundary edges where they face
  open space (a solid neighbor — another ramp tile or a 57 floor — covers
  the face and renders no line), so the debug overlay outlines the
  ramp/staircase shapes completely. **Collision ignores a layer's `visible`
  flag** — the
  hidden `layer1` is still parsed by `resolveTiledMap` and used; the renderer
  (`map-renderer.ts`) is what skips `visible: false` layers. The room grid
  (`roomGridSize` in `tiled-map.ts`) is shared by the renderer and the debug
  overlay so both slice the map into rooms identically.
  `src/game/collision/collision-debug.ts` draws those as a Phaser overlay (green
  vertical walls, blue horizontal floors, orange slopes, RED dead-zone pit
  outlines via the `hazard` kind, PURPLE door-entity perimeters — each
  door's lines on their own graphics, so the overlay can drop an opened
  door's perimeter via `CollisionDebug.hideDoor`), toggleable via
  `__jungleCollisionDebug.setEnabled(false)`; `createJungleGame` takes
  `{ collisionDebug?: boolean }` (defaults to the `NEXT_PUBLIC_DEBUG` flag —
  off unless it's "1"/"true").

- **Door links, opening doors & their debug lines**: `tiled-map.ts` also
  parses the map's objectgroups, and the `room` group's rectangles are
  turned into door-link groups by `groupRoomObjectsByName` in
  `@monkeyluka/shared`: each named
  rect collects the entities whose centers fall inside it (a 315 signpost
  tile, a 2×2 door block) — the real map's two `room1` rects (one over the
  signpost, one over the door) collate into one group that thus links its
  sole signpost to its sole door. The room's `QuestGate` reads
  the very same groups: once every showquest interaction linked to a door
  has been answered correctly it opens the door, flipping the synced
  `JungleState.doors` entry to `open`. The client applies opened doors via
  `scene/update.ts` → `src/game/door/door-open.ts`, driven by that schema
  every frame: `clearDoorFromGrid` zeroes the door's four cells in the
  local prediction grid (the mirror of what the room does to its
  validation grid, so the doorway is passable on both sides), while the
  door's tile art keeps rendering as usual — only its PURPLE debug
  perimeter is dropped (`CollisionDebug.hideDoor` in
  `src/game/collision/collision-debug.ts`, which draws each door's lines
  on their own graphics so an opened door's lines come off without
  touching the overlay's other segments), so the debug lines stop drawing
  collision at the passable doorway. Tracked in `state.openDoors` so each
  open applies exactly once; because it is schema state, a client that
  joins after a door opened still finds it passable. The
  groups ride on `state.doorGroups` (`scene/state.ts`) and, when
  `NEXT_PUBLIC_DOOR_DEBUG` is "1"/"true" (`scene/debug.ts`
  `isDoorDebugEnabled`, option `{ doorDebug?: boolean }`),
  `src/game/door/door-debug.ts` draws one CYAN line from every showquest to
  every door in the same group, clipped per room like the collision overlay,
  and logs each group's counts; runtime toggle `__jungleDoorDebug`.

- **Movable traps (trap objectgroup)**: `src/game/trap/trap-spike-run-render.ts`
  renders the map's `trap` objectgroup — each `Trap_Spike_Run` object
  (patrol rect + `speedMin`/`speedMax`/`time2change_speed` props, parsed by
  `buildTrapSpikeRuns` in @monkeyluka/shared after `tiled-map.ts` picks up object
  `properties`; the object's own Tiled id distinguishes instances) as a
  **sprite from the `Assets/trap/Trap_Spike_Run.png` sheet** that sweeps
  the rect back and forth (`updateTrapSpikeRunViews` → shared
  `stepTrapSpikeRun`, called
  every frame from `scene/update.ts` independent of the connection state,
  since traps never report to the server). The sheet is a 32×48 image — a
  2×3 grid of 16×16 cells like the jump sheet, one frame per cell,
  row-major; frames 0–4 hold the spike strip (the near-identical copies
  are the author's subtle idle shimmer) and the last cell is a stray
  base sliver, so the looping idle animation (`registerTrapSpikeRunAnimations`,
  also in trap-spike-run-render.ts, called by create.ts right before the views are
  built) uses 5 of 6 frames and skips it. The sheet is preloaded by
  create.ts (`TRAP_SPIKE_RUN_TEXTURE`, served via the `public/trap` symlink — the
  same `Assets` → `public` symlink pattern as `map` and `player`) and
  passed to each view as the default texture; the 16×16 frame matches the
  trap's 16px patrol strip, so the sprite footprint is identical to the
  old red-circle placeholder. Views live in `state.trapSpikeRunViews`
  inside the shared `state.trapLayer` — a
  transform twin of room 0 inserted after the rooms but before the player
  layer, so markers draw over the map art and under the player sprites.
  Touching a marker is lethal: `scene/update.ts` probes the player's own
  simulated AABB against every marker (`isBoxTouchingTrapSpikeRun`, shared) and
  hands the kill to `onDead` (`death.ts`, cause `"trap"`) — the same
  freeze + death-question + checkpoint-return flow the 464 pit uses, with
  the body teleported to the checkpoint at kill time so the revived
  player never re-touches the sweeping spike.
  `JungleGameOptions.trapSpikeRunTexture` can still swap each marker for a
  different caller-loaded sheet (static frame 0 — only the built-in sheet
  has its 2×3 layout + idle animation registered); with no texture at all
  the marker falls back to the red circle.
  With `NEXT_PUBLIC_DEBUG` on (or `options.trapSpikeRunDebug`), a red
  **attack-radius box** outlines each marker's lethal footprint — the
  exact `isBoxTouchingTrapSpikeRun` `trap.height`-square AABB — drawn by
  `createTrapSpikeRunDebug` (also in trap-spike-run-render.ts) as one
  Graphics per trap child of the trap layer, redrawn every frame from
  update.ts right after
  `updateTrapSpikeRunViews` so it follows the sweep; runtime toggle
  `__jungleTrapSpikeRunDebug.setEnabled(...)`.
  The naming is per-type because more trap types are coming: a future
  `Trap_Saw` gets its own shared model + render module beside
  `trap-spike-run.ts` / `trap-spike-run-render.ts`, sharing the `trap`
  objectgroup, the `public/trap` assets dir, and the scene's trap layer,
  with its own `state.trapSaw*` fields and kill probe.

- **Player movement & netcode**: `src/game/player/player.ts` drives the
  monkey with the **shared physics** (`createPlayerState`/`stepPlayer` from
  `@monkeyluka/shared`; the grid comes from building `layer1` with
  `buildTileGrid` — the same gids the server validates against, so prediction
  and collision share geometry). Movement is **client-simulated**: the scene
  (`scene/update.ts`) reads arrows/WASD + Space/Up, predicts the local monkey
  every frame, and renders that prediction directly — no server round-trip
  before movement appears. It streams `PLAYER_INPUT_MESSAGE` at ~20 Hz (the
  predicted `px/py/vx/vy/grounded/clinging/facing`), and reconciles
  against the broadcast `PlayerInfo` snapshot (snap beyond 32 px, else a
  clamped lean-in) so a report the server rejected visibly stops the monkey;
  other players render directly from server positions (eased). The sprite is
  flipped to `facing`; both local and remote sprites live in the scene-level
  player layer (above every room's art) so coordinates are room-local and
  the player stays visible in rooms after the first. While `clinging` the
  shared physics hangs the monkey on the wall and the sprite plays the
  `cling` frame (`Assets/player/sheets/cling.png`), flipped to face away
  from the wall (the mirror of `clingDir` on the X-axis); remote cling comes
  from the broadcast `clinging` field. **Debug only** (`NEXT_PUBLIC_DEBUG`):
  R teleports the local monkey back to its checkpoint — a scene-level
  `checkpoint` starting at `PLAYER_SPAWN` (update it there when real
  checkpoints land) — via `player.teleportTo()` plus a
  `PLAYER_CHECKPOINT_MESSAGE` to the room, whose always-registered handler
  re-baselines validation at the spawn so the jump isn't a teleport
  violation (the room accepts it unconditionally: the target is the
  server-chosen spawn, so it can't bypass the anti-cheat). Touching a 464
  dead-zone pit runs the **same flow automatically** (not debug-gated):
  `scene/update.ts` probes the local simulated position with
  `isBoxInDeadZone` every frame (the AABB must reach the basin floor —
  bottom at/within 1px above the 3px base) and, on touch, teleports to
  the checkpoint, freezes reconciliation, and sends the same
  `PLAYER_CHECKPOINT_MESSAGE` — a pit is a one-way trap back to spawn.
  Snapshot reconciliation is **frozen until the server confirms the jump**
  (`checkpointPending`): the broadcast is ~one RTT stale and snapping to it
  would undo the teleport and read as a teleport+speed violation — see
  `discoveries/checkpoint-return-race-stale-snapshot-teleport-violations.md`.
  **E (edge-triggered `keyE`, grounded only) triggers interaction tiles**:
  `scene/update.ts` probes the local simulated position with the shared
  `interactionTileUnderFeet` (the feet cell, plus the cell just above when
  the feet sit at/within 2px of a cell boundary — the 315 signpost's base
  is flush with the standing floor's top, i.e. the cell above the feet)
  against the `InteractionGrid` built from the same `layer1` the collision
  grid reads, and sends `PLAYER_INTERACTION_MESSAGE` with the found gid.
  The sent `gid` is advisory only: the room re-probes its own last accepted
  position with the same rule before running the action, so a stale/forged
  press is a no-op — and a signpost already answered correctly is
  completed: the room silently refuses every future press on it (the
  completion gate lives server-side, see quest-gate in @monkeyluka/server).
  315 → "showquest" opens the **quest box**
  (`src/game/quest/`): the room sends `quest:question` `{question,
  choices}` (a random question from `Assets/question.json`, choices
  shuffled + unlabeled server-side — the answer key never reaches the
  client, so no number or position leaks it), and `quest-box.ts` renders it
  as a screen-fixed modal — the question and each choice typeset
  mathematically by `math-format.ts` from the shared parser
  (`@monkeyluka/shared` `parseMathExpression` → `MathExpr`): fractions
  stack numerator over a rule over the denominator, `^` becomes an
  superscript, `-` renders as −, explicit `*` as a middle dot, implicit
  multiplication as juxtaposition; malformed strings fall back to plain
  text. The player answers by clicking a row (mouse only — no on-screen
  numbers: the row order is the shuffle, and a number key would be an
  unlabeled guess); `quest:answer` `{choice}` is
  graded server-side and `quest:result` `{correct}` flashes
  Correct!/Wrong before the box auto-closes; a correct answer completes the
  signpost tile (never asks again) and, once every signpost linked to a
  door is done, the room opens that door — the schema-synced
  `JungleState.doors` state makes the client clear the doorway's collision
  and drop its purple debug perimeter on the next frame (see the
  door-opening bullet above).
  While the box is up it is
  modal: `state.questOpen` freezes movement input and the E key in
  `scene/update.ts`, and the box closes itself 3s after an unanswered
  answer (a blip can't wedge the player in the modal).

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
  (`!room.connection.isOpen`) `scene/update.ts` **freezes local simulation**
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