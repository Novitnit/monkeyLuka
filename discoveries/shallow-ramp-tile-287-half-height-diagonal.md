# Discovery: shallow ramp tile 287 — a bottom-aligned 2:1 diagonal with a back side

**Date:** 2026-09-12 (revised)
**Scope:** `packages/shared/src/physics/` (tiles.ts + collision.ts),
`packages/shared/src/physics.test.ts`,
`apps/web/src/game/collision/collision-geometry.ts`
**Status:** Implemented

## Symptom

`Assets/map/BlockTileSet.png` gid 287 (placed at `layer1` tile `(7,12)` in
`Assets/map/main.json`, with the sibling ramp tile 288 at `(8,12)` as art) is
a **16px-wide, 8px-tall 2:1 ramp**: the face runs from the cell's
**bottom-left corner (0, 16)** up to the **right edge's midpoint (16, 8)**,
solid **below** the line (15 rows of x, the bottom row fully filled, the edge
stepping two pixels up per row, and the right column filled below the apex —
the back side).

The first implementation read the sprite as the mirror: *"solid below the
line from (0, 8) to the top-right (16, 0)"* (`dx + 2·dy ≥ 16`). That model is
the correct shape **flipped into the top half of the cell** — its base hangs
8px above the tile's bottom edge at the left and its apex reaches the top
edge at the right. In-game the ramp played wrong in two ways the user called
out:

1. **A gap at the base.** The collision's bottom left edge sits at y = mid-cell
   while the visible ramp's base sits on the tile's bottom edge — a floor
   walker at the ramp's foot hit an invisible face 8px above the visible
   2px step instead of stepping onto the ramp.
2. **The collision height is higher than it should be.** On the right the
   collision rose all the way to the cell's top edge (dy = 0) while the art
   tops out at mid-height (dy = 8) — the player stood on invisible ground
   above the visible ramp.

The fix: anchor the wedge to the bottom edge — solid below the line from
**(0, 16) to (16, 8)** (`dx + 2·dy ≥ 32`) — with the right column below the
apex as the solid **back side**. This is exactly the sprite's filled shape.

## Root cause

`collision.ts` encodes each slope tile as an inequality in cell-local coords
and a few sampled extremes. The 287 branch reused the 262 family (solid
below a descending line) but with the wrong anchors: `dx + 2·dy ≥ 16` is the
face through (0, 8) and (16, 0) — the same 2:1 wedge mirrored across the
cell's horizontal midline. Every formula that descends from the inequality
(landing surface `(16 − dx)/2`, the `dir > 0` mid-wing lift guard, the
right-mover face `16 − 2·dy`) inherits the vertical offset, so the collision
floated 8px too high and left the visible ramp base uncovered.

## Fix

`packages/shared/src/physics/tiles.ts`, `index.ts`:
- 287 documented as the 2:1 ramp solid below the bottom-aligned line
  (0, 16) → (16, 8); `dx + 2·dy ≥ 32`; the right column below the apex is
  the back side.

`packages/shared/src/physics/collision.ts`:
- `pointInTileSolid`: `dx + 2 * dy >= 2 * TILE_SIZE` (32).
- `aabbTouchesSolid`: the overlap's bottom-right corner decides
  (`ox1 + 2 * oy1 >= 2 * TILE_SIZE`).
- `slopeSupportsBox`: the surface band across the span now runs
  `[16 − dx1/2, 16 − dx0/2]` (the old `(16 − dx)/2` was 8px too shallow).
- `horizontalPenetration`: the right-mover face is `32 − 2·dyBottom`,
  clamped ≥ 0 (a low box below the cell meets the left edge, or the push
  would shove it ~24px back); the left-mover meets the solid right column
  (`16 − dx0`) — the back side — like 262.
- `verticalPenetration`: the landing surface binds the 2:1 line at the
  shallowest extent (`top + 16 − edgeMax/2`, ride-on-the-leading-corner);
  the underside stays the flat cell bottom (`top + 16` — the base row is
  solid at every column); and the `dir > 0` lift guard reverts to 262's
  "below the cell" form (`bottomRel > 16.5`) because the foot is flush with
  the bottom edge — there is no hollow left wing left to hoist a floor box
  from, and a floor-level walker steps straight onto the ramp (a
  ground-level walk-on, not a hop-on step).

`apps/web/src/game/collision/collision-geometry.ts`:
- `DIAGONAL_SHALLOW` emits the face as a `DiagonalSegment` from
  `(left, top + th)` to `(left + tw, top + th/2)` — it is not
  corner-to-corner, so the segment ends at the right edge's midpoint.

## Verification

- `packages/shared/src/physics.test.ts` reworks the `shallow ramp (287,
  2:1)` block: point solidity on the bottom-aligned half-plane (the
  top-right corner is now OPEN where the old mirror was solid; the left
  base is ON the bottom edge), box solidity, landing on the ramp surface
  (bottom = 32 + (16 − 14.5/2) = 40.75, not the cell's flat top), a
  floor-level walker stepping straight onto the flush foot, walking up the
  ramp to the apex with zero anti-cheat violations, a ground-level box on
  the right being wall-blocked by the back side, and the rising box
  bouncing off the flat underside.
- The real-map suite adds "walks up the jungle 287 ramp from the floor" —
  the actual (7,12) tile on its row-13 base — with `validatePositionReport`
  sampling every 3 steps.
- `bun test`: 51 pass (48 shared + 3 server), 0 fail.
- `bun run typecheck`: web, server, shared all clean.

## Related

- `packages/shared/AGENTS.md` (tile constants + slope contact rules),
  root `AGENTS.md` (gameplay simulation section), `apps/server/AGENTS.md`.
- `discoveries/jungle-slope-climb-buries-player-kicks-teleport.md` — the 262
  work this extends; the ride-on-the-corner rule and its anti-cheat
  rationale.
- Note: the sibling tile 288 at (8,12) is the ramp's continuation (art only
  — its gid is not in the solid set), so the walker rides 287 up to the
  apex and then falls off into the unwalled 288 area; making 288 solid is a
  follow-up if the full 32px ramp should be walkable.