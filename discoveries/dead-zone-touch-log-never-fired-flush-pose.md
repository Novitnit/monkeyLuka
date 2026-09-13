# Discovery: dead-zone touch log never fired — the probe missed the flush resting pose

**Date:** 2026-09-13
**Scope:** `packages/shared/src/physics/collision.ts` (`isBoxInDeadZone`), server room logging
**Status:** Fixed

## Symptom

The room was supposed to log `[jungle:deadZone] …` (now `<name>_touch_DEAD_ZONE`)
once when a player enters a 464 dead-zone pit — it never fired. A player could
walk off the floor, fall into a trench, and stand on the basin floor forever
with zero log lines. The rest of the room's logging (anti-cheat violations,
drop/leave/reconnect) worked fine, so the report pipeline was healthy.

## Root cause

The probe `isBoxInDeadZone` tested the player AABB against the pit's pixel
mask via the shared `aabbTouchesSolid`, requiring the overlap rect to actually
**enter** a solid mask pixel (the base, rows 13-15). A player at rest in a pit
doesn't do that:

- `stepPlayer` resolves the fall so the box's bottom edge sits **exactly
  flush** with the base top (`dyBottom == DEAD_ZONE_BASE_ROW`, i.e. 13; the
  resting posse is asserted to 3 decimals in
  `physics.test.ts`), e.g. center `(6.5, 262)` with the 13×14 collider.
- The overlap rect with the pit cell is `[oy0, oy1) = [0, 13)` — it reaches
  row 13 but never enters the pixel `[13, 14)`.
- The mask branch computes rows `[⌊oy0⌋, ⌈oy1⌉−1] = [0, 12]` — all open mouth
  rows → `false`.

Since every *reported* position is post-resolve (the client sends reports after
`stepPlayer`, never mid-penetration), the probe **structurally** never saw a
touching position: the `touch → log` edge was dead code for real players. The
existing `isBoxInDeadZone` tests passed because they either used a box whose
bottom penetrated the base by ≥1px (`(24,12,10,10)`, bottom at 17) or asserted
`false` for mid-air boxes.

A walker who hovers 1px above the floor on the last fall frame is also missed:
`⌈oy1⌉−1` with `oy1 = 12.9999` truncates to row 12.

## Fix

`packages/shared/src/physics/collision.ts` — `isBoxInDeadZone` now calls a
dedicated `aabbTouchesDeadZoneFloor` instead of the shared mask overlap. It
computes the same overlap rect but decides with a **1px support allowance**
(borrowed from the stairs-seam convention): touching iff the rect exists *and*
`oy1 >= DEAD_ZONE_BASE_ROW - 1`. So a box resting flush on the base, or
hovering up to 1px above it, reads as touching; flights far above the mouth
(`oy1` small) and bodies beside the trench (no vertical overlap, or a nearby
non-464 cell) still read as not touching. The shared `aabbTouchesSolid` mask
semantics are untouched — only the hazard probe changes.

## Verification

- New regression test in `packages/shared/src/physics.test.ts`:
  "a player at rest on the basin floor IS in the dead zone (flush-bottom bug)"
  — direct probe of the resting pose (true), the same pose on an ordinary 57
  floor beside the pit (false), and a full `stepPlayer` walk-off-the-rim into
  the pit then probe (true).
- One-off probe driving `loadJungleMap()` + `stepPlayer` + the room's exact
  `validatePositionReport` acceptance chain at a realistic 20 Hz report rate:
  before the fix `isBoxInDeadZone at rest = false`, log never fired; after it,
  exactly one log on the false→true edge (`LOG FIRES at (6.5, 262.0)`), 0
  rejected reports.
- `bun test` — 65 pass / 0 fail.

## Related

- `packages/shared/src/physics/collision.ts` — `isBoxInDeadZone`,
  `aabbTouchesDeadZoneFloor`, `DEAD_ZONE_MASK`, `aabbTouchesSolid`.
- `apps/server/src/rooms/jungle/jungle-room.ts` — the `inDeadZone` latch and
  `<name>_touch_DEAD_ZONE` log on the accepted report (both later removed).
- Root `AGENTS.md` ("Gameplay simulation & anti-cheat") and
  `apps/server/AGENTS.md` — dead-zone probe + logging contract.

## Update (what happened after this discovery)

This file documents why the probe needs its 1px support allowance, which is
still the exact semantics the probe uses today — the flush resting pose must
read as touching. What consumed the probe changed since: the
`<name>_touch_DEAD_ZONE` log and the `ServerPlayer.inDeadZone` latch were
removed, and the web client now probes its own simulated position with
`isBoxInDeadZone` every frame to return the player to its checkpoint on pit
touch (via `PLAYER_CHECKPOINT_MESSAGE`). The probe itself is untouched;
see `apps/web/src/game/scene/update.ts`.