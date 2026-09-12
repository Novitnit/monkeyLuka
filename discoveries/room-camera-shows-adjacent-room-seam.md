# Discovery: room-locked camera showed a sliver of the neighboring room

**Date:** 2026-09-12
**Scope:** `apps/web` (jungle map renderer + scene camera)
**Status:** Fixed

## Symptom

With a room-locked camera (camera snaps to the whole room the player is in,
never follows smoothly — see `apps/web/AGENTS.md`), the right edge of the
viewport showed ~9.4px of the **next room** whenever the player stood at the
left edge of a room. The sealed viewport was supposed to show one room and
nothing else; instead a thin vertical seam of the neighbor's tiles peeked in,
with tile, physics, and camera coordinates diverging right at the room
boundary.

## Root cause

A mismatch between the *designed* room width (480px — the map asset is laid
out in 480×272 rooms) and what the canvas can actually display:

1. The renderer scales the whole map grid to fill the 1280×720 canvas
   **height**: `scale = 720 / 272 ≈ 2.6471`.
2. At that scale, a 480px-wide room renders `480 × 2.6471 ≈ 1270.6px` — about
   9.4px **shorter** than the 1280px canvas width.
3. The camera is room-locked at `scroll(x = room origin)`, so the viewport is
   always 1280px wide. 480×272 rooms come out ~1270.6px, so the last ~9.4px
   of the viewport fell past the current room's right edge and showed the
   start of the next room.
4. The map had a default `gap` of 32px between rooms (leftover from when the
   world was a grid of separate rooms with margins); with `gap: 0` the rooms
   abut, so a camera at a room edge cuts straight across the seam.

The physics grid and the server were never affected — they read raw tiles at
unscaled coordinates, so only rendering and the camera disagreed.

## Fix (shipped)

`ROOM_WIDTH` stays **exactly 480 — never wider**: the window is the designed
480px room, so the camera grid and the debug overlay always align with the
room art (no neighbor content pulled into the frame).
`apps/web/src/game/map/map-renderer.ts` scales each room to exactly the
canvas width: `scale = canvasWidth / roomWidth` = 1280/480 ≈ **2.667**
(for stacked room rows, rows > 1, the height rule takes over so the grid
can't overflow the canvas several rooms deep):

- `480 × 2.667 ≈ 1280.0px` — a scaled room is exactly as wide as the
  1280px camera viewport, so the seam to the neighbor lands exactly on the
  viewport edge: no horizontal sliver, no overflow.
- `272 × 2.667 ≈ 725.3px` — the room height is 5.3px taller than the
  720px canvas, so the map's top and bottom rows crop ~2.67px each at the
  world's vertical edges. This is the unavoidable tradeoff of a fixed 480px
  window: no single scale makes 480px exactly 1280px wide *and* 272px fit
  in 720px (1280/480 ≈ 2.667 > 720/272 ≈ 2.647); any wider window would
  exceed ROOM_WIDTH, and the height-filling scale leaves the ~9.4px
  horizontal sliver this discovery is about.
- `apps/web/src/game/jungle-scene.ts` renders with `gap: 0` so room columns
  abut exactly: tile, physics, and camera X coordinates agree across the
  seam (the room-lock camera snaps to `roomView.x`/`roomView.y`, which sit
  exactly at `col × ROOM_WIDTH`).

The window width is **render-only**: `ROOM_WIDTH` is read by the renderer,
the camera room-lock, and the collision-debug overlay grid; the collision
grid and `apps/server` still use raw map tiles, so no gameplay geometry
moved and no tile coordinates shifted.

> History: the width-fit scale was also paired with a 484px window
> (`ROOM_WIDTH = 484`, the smallest window whose width-fit scale keeps the
> room height ≤ 720) — it eliminates even the vertical crop, but the 4px
> wider window desyncs the room grid from the designed rooms and shows 4px
> of the next room's content inside the current frame. Abandoned: the room
> window must stay exactly 480. Also note the original 480→484 commit
> (`a29b893`) only rewrote doc comments — the constant stayed 480, which is
> why the ~9.4px sliver (reported as "~4px of Room 2 visible" in the Room 1
> camera) persisted until the width-fit scale landed.

## Verification

In-browser smoke test of the jungle scene: standing flush at a room's left
edge, the viewport showed only the current room; crossing a boundary snapped
cleanly to the next room with no visible seam or duplicated column at the
edge. `bun run typecheck` clean.

## Related

- `apps/web/AGENTS.md` → "Map & rendering" bullet (room dimensions, `gap: 0`,
  room-locked camera contract).
- `apps/web/src/game/map/map-renderer.ts` — scaling + `gap` layout math.
- `apps/web/src/game/jungle-scene.ts` — room index → `setScroll` camera snap.