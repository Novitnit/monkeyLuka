# Discovery: jungle anti-cheat kicked players who were standing still

**Date:** 2026-02-13
**Scope:** `packages/shared` (`validatePositionReport`) + `apps/server` (JungleRoom)
**Status:** Fixed

## Symptom

A headless smoke client that walked the monkey legitimately was force-kicked
from the jungle room within ~0.6 s. The server log showed one `teleport`
violation per accepted input message until the kick threshold:

```
[jungle:anti-cheat] <sessionId> teleport (1/12)
...
[jungle:anti-cheat] <sessionId> teleport (12/12)
[jungle:anti-cheat] kicking <sessionId> (teleport)
```

The client's reported position matched the server's simulated position to
within a few pixels, so the "teleport" verdict was wrong.

## Root cause

`validatePositionReport` in `packages/shared/src/physics.ts` rejected any
reported AABB whose **outline points** touched solid geometry. It sampled the
collider center plus the four edge midpoints at the full half-extents:

```ts
isPointSolid(grid, reported.px, reported.py + config.height / 2)
```

A player resting on a platform has its feet *exactly* on the floor tile's top
boundary (`y = tileRow * 16`), and `isPointSolid` treats that boundary as
solid (`dy <= dx` / full tile). So every single input report from a grounded
player was flagged `teleport`, and the kick counter drained in 12 messages.

The same class of false positive applies to a player pressed flush against a
wall: `px ± width / 2` lands exactly on the wall tile's face.

## Fix

Inset the edge samples by 1 px so "resting on" and "leaning against" read as
open space, while a collider genuinely buried in geometry still trips the
check (`packages/shared/src/physics.ts`):

```ts
const inset = 1;
const halfW = Math.max(0, config.width / 2 - inset);
const halfH = Math.max(0, config.height / 2 - inset);
if (
  isPointSolid(grid, reported.px, reported.py) ||
  isPointSolid(grid, reported.px - halfW, reported.py) ||
  ...
)
```

The center sample still uses the exact point, and the authoritative-simulation
comparison plus the displacement check are untouched — this only removes the
boundary false positive.

## Verification

- Regression tests in `packages/shared/src/physics.test.ts`:
  - "a player resting exactly on a floor boundary is not a violation"
  - "a player pressed against a wall boundary is not a violation"
- End-to-end smoke run (`apps/web`, real `@colyseus/sdk` client against a
  server on `COLYSEUS_PORT=2599`): the same walk that previously kicked now
  completes with no `teleport` violations, while deliberate teleport/speed
  reports still log `teleport+speed` and leave the player in place.

## Related

- `packages/shared/AGENTS.md` — physics/validation contract.
- `apps/server/AGENTS.md` — anti-cheat rules and kick threshold.
- `packages/shared/src/physics.ts` — `validatePositionReport`, `isPointSolid`.
