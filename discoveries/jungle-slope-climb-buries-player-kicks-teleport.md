# Discovery: walking into the 262 ramp buried the player and the anti-cheat kicked them for "teleport"

**Date:** 2026-02-13
**Scope:** `packages/shared` (`packages/shared/src/physics/collision.ts` — the slope rework) + the jungle anti-cheat
**Status:** Fixed

## Symptom

Walking right along platform B's top (y=192) into the rising 262 ramp at
`Assets/map/main.json` tile `(19,11)` (x=304, rising to y=176 at x=320 where
a solid block continues) stopped the player at `(313.5, 182)` with velocity
zero, and every movement report after that was flagged `teleport` by
`validatePositionReport`'s buried-in-geometry sample — the room kicked the
client at 12 violations (~0.6s):

```
[jungle:anti-cheat] kicking t_r7aDNIj (teleport)
```

A related symptom: walking under the overhanging 110/109 chamfers on a lower
floor made the player "bounce" — a recurring ~16px hoist onto the slope's
top lip, then eject, then fall back (~15 dead input frames).

## Root cause

Movement is client-simulated; the server only validates reports. The WIP
slope rework in `collision.ts` (uncommitted at the time) had two coupled
defects in the penetration helpers:

1. **262 vertical sampling used the deepest point under the box's span.**
   `verticalPenetration` computed the 262's surface as
   `top + TILE_SIZE − edgeMin` (the line's deepest point, at the box's LEFT
   edge). A right-moving climber was therefore lifted only at its bottom-left
   corner; its trailing right side stayed up to 13px embedded under the
   rising slope. `slopeSupportsBox` (the WIP's ride check, tolerance
   `SLOPE_RIDE_TOL = 8`) certified that embedding as "riding", so the
   horizontal pass let it slide — until the abutting solid tile at x=320
   stopped it dead (vx=0) at `(313.5, 182)`. The box was then inside the 262
   solid half, every report failed `isPointSolid` (teleport), and the room
   kicked it. (At the previous commit the 262 was treated as a full cell —
   an impassable wall — so players stopped at x=297.5 with no violations;
   the wall-turned-kick appeared with the WIP.)

2. **The 110/109 "flat lip" override fired for any falling box overlapping
   the cell** — including a walker on a lower floor whose TOP pokes into the
   bracket's open corner. `if (dir > 0 && kind !== TILE_SLOPE_BR) surfaceY =
   top` hoisted such a box the whole 16px onto the lip, the horizontal pass
   ejected it, and it fell back: a recurring bounce. The ride check was also
   one-sided (`dyBottom >= deepest − tol`) — it certified a box *below* the
   slope's surface line (an under-runner) as "supported", so its head
   clipped the face with no collision response at all.

## Fix

`packages/shared/src/physics/collision.ts`:

- **262 samples the surface at the box's shallowest extent** (`surfaceY =
  top + TILE_SIZE − edgeMax`) for landing AND climbing, so a right-moving
  climber rides with its bottom-right corner on the line and never embeds.
  A `dir > 0` guard skips boxes whose bottom is below the cell (overhang
  under-runners), with a small epsilon so a grounded walker's gravity dip
  (~0.13px below the cell's bottom edge at the ramp's foot) still reads as
  landing on it — without it the box never started climbing.
- **110/109 lip landing is gated**: the flat-lip surface only applies when
  the box's bottom is within a substep of the cell top (`bottomRel ≤
  SLOPE_RIDE_TOL + SLOPE_TOUCH_EPS`) — a genuine fall from above. A box
  brushing the cell from below (under-runner) is skipped entirely.
- **`slopeSupportsBox` now takes the unclamped bottom depth and requires the
  bottom to sit ON the surface band** `[minSurf − SLOPE_RIDE_TOL,
  maxSurf + eps]` (where the surface depth across the span runs dx0→dx1 for
  110 and 16−dx1→16−dx0 for 109/262). A rider or climber passes; a box whose
  bottom is below the deepest surface point under its span (under-runner
  clipping the face from the side) is a wall, so its head never enters the
  triangle (no buried-in-solid violations).

## Verification

- `bun test` (43 tests across shared + server) green, including new
  regressions: "walks up the 262 ramp onto the block without tripping the
  anti-cheat" (real 60×17 map), "walking under a 110 chamfer … not hoisted",
  "walking under a 109 cap … not hoisted", plus corrected slope-landing
  expectations (110/109 rest on the flat lip, center 3·16−7; 262 rests on
  the line at the shallowest span point, center 42.5).
- `bun run typecheck` green (web, server, shared).
- `/tmp/repro/repro6.ts` (end-to-end, real map): previously stuck at
  `(313.5,182)` with 814 teleport violations → now `passed ramp →
  (328.1,169.0) validation OK`.
- `/tmp/repro/trace110.ts` + `/tmp/repro/repro3.ts`: the 110/109 under-chamfer
  hop (16px hoist + ~15 dead frames) is gone; walkers stop cleanly at the
  face, grounded.
- `/tmp/repro/repro2.ts` scenario matrix: strictly better than both the
  previous commit (ramp = wall) and the WIP (ramp = jam + kick); broad
  walking scenarios now complete on the far side of the map.
- The shared test grid was rebuilt to load `Assets/map/main.json` (60×17)
  instead of a hand-built 30×17 approximation; the stale server
  `jungle-map.test.ts` snapshot (30 wide / 77 solids / 4 slopes) was updated
  to the real map (60 wide / 109 solids / 8 slopes).

## Related

- `packages/shared/AGENTS.md` — physics & movement validation section
  (slope contact rules now documented).
- `packages/shared/src/physics/collision.ts` — `slopeSupportsBox`,
  `horizontalPenetration`, `verticalPenetration`; constants
  `SLOPE_TOUCH_EPS`, `SLOPE_RIDE_TOL`.
- `packages/shared/src/physics/validation.ts` — `validatePositionReport`
  buried-in-geometry samples (1px inset).
- The fix keeps the inset check as-is: with the simulation correct there is
  no legal embedding to exempt, so the anti-cheat needs no loosening.