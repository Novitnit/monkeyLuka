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

## Fix

`apps/web/src/game/map/tiled-map.ts` widened the render window from 480 to
**484px** (`ROOM_WIDTH = 484`):

- `484 × 2.6471 ≈ 1281.2px`, so a scaled room now overflows the 1280px
  viewport by ~1.2px instead of under-filling by ~9.4px — the seam is pushed
  fully off-screen and the neighbor room can never peek in.
- `apps/web/src/game/jungle-scene.ts` renders with `gap: 0` so room columns
  abut exactly: tile, physics, and camera X coordinates agree across the
  seam (the room-lock camera snaps to `roomView.x`/`roomView.y`, which sit
  exactly at `col × ROOM_WIDTH`).
- The +4px is **render-only**: `ROOM_WIDTH` is read by the renderer and the
  camera room-lock; the collision grid and `apps/server` still use raw map
  tiles, so no gameplay geometry moved and no tile coordinates shifted.

`height` stays 272: vertical fits exactly (`272 × 2.6471 = 720`), so no
vertical equivalent of the seam exists.

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