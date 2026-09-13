# Discovery: player still clings to a door's side face at the seam where the door sits on a wall

**Date:** 2025-07-08
**Scope:** `packages/shared/src/physics` (collision + player simulation)
**Status:** Fixed

## Symptom

The wall-cling (grab) was supposed to skip doors — `grabableWallBeside`
excluded `TILE_DOOR` cells — but the player could still stick to the door.
Concretely, in the real map (`Assets/map/main.json`), the door block (gids
375/376/401/402 at tiles 29-30 × rows 8-9) sits **flush on top of a solid
wall column** (rows 10+). Jumping at the door's left/right face and holding
the grab key made the monkey hang on the door's lower face right at the seam
instead of sliding off.

Repro (synthetic grid mirroring the map: 2×2 door at cols 4-5 rows 8-9,
`TILE_SOLID` wall below at rows 10-12, player flush beside the left face at
y=156, holding right+jump):

```
grabable at start: true
step 0: x=57.50 y=156.13 clinging=true hitWall=1   ← grabs the door's face
```

## Root cause

`grabableWallBeside` (in `packages/shared/src/physics/collision/box.ts`)
probes a **2px strip just past the box's side edge, spanning the box's full
height** (player is 13×14 → strip is 14px tall). The old fold was:

```ts
forEachOverlappedCell(grid, cx, y, half, hh, (tx, ty) => {
  const kind = grid.kinds[ty * grid.width + tx] ?? 0;
  return kind !== 0 && kind !== TILE_DOOR && aabbTouchesSolid(...);
});
```

That treats a door cell as "not solid" but lets every *other* solid in the
strip count. Beside the door's bottom row the strip overlaps **two cells**:
the door cell (row 9) *and* the wall cell directly below (row 10, y 160-176)
— the door and the wall's faces are flush, one continuous surface. The wall
cell made the strip "grabable", so the player grabbed the door's face at the
seam and hung there frozen (the release probe, `wallBeside`, still sees the
wall and keeps the cling). It took a synthetic 13-row grid to see this: the
existing "cannot grab a closed door" test used a *pure* door column with
nothing under the probe band, so no non-door cell ever shared the strip.

## Fix

`grabableWallBeside` now vetoes the entire grab when **any** door cell the
strip touches is found — a door touch no longer just drops that cell from
the "any solid" fold:

```ts
let doorTouched = false;
let solid = false;
forEachOverlappedCell(grid, cx, y, half, hh, (tx, ty) => {
  const kind = grid.kinds[ty * grid.width + tx] ?? 0;
  if (kind === 0) return false;
  const touches = aabbTouchesSolid(grid, tx, ty, cx, y, half, hh);
  if (kind === TILE_DOOR) {
    if (touches) doorTouched = true;
  } else if (touches) {
    solid = true;
  }
  return false;
});
return solid && !doorTouched;
```

Why this lever: the door's side faces are the whole 2×2 block's thickness, so
the non-sticky zone must be the door's vertical span, including the transition
band where the strip still grazes the door's bottom row (up to 2px above the
seam). The wall *below* the door remains a normal grabable wall once the strip
has fully cleared the door's bottom edge (y ≥ door bottom + half-height) —
removing that would have nuked legitimate wall-cling on the pillar. The fix is
in shared code, so the web client's prediction and the server's report
validation see identical geometry; `stepPlayer` is the only caller of
`grabableWallBeside`.

## Verification

- New regression test in `packages/shared/src/physics.test.ts` ("a player
  cannot cling to a closed door's face where it continues onto a wall"):
  probe-level asserts (strip touching door+wall → false; strip just grazing
  the door's bottom 2px → false; strip fully below the door → true) plus an
  integration run that first clings only once the box clears the door bottom.
- The synthetic repro now reports no grab at the seam; the first cling
  happens at y≈168 (box fully below the door's bottom at 160).
- `bun test` (94 pass, 0 fail) and `bun run typecheck` (web/server/shared)
  are green.

## Related

- `AGENTS.md` → "Door entities" bullet (non-sticky doors: updated to describe
  the probe-level veto).
- `packages/shared/src/physics/collision/box.ts` →
  `grabableWallBeside` (+ doc comment with the seam explanation).
- `packages/shared/src/physics/player/step.ts` → the grab check that calls it.
- Door model: `packages/shared/src/physics/door.ts`, `packages/shared/src/physics/tiles.ts`.