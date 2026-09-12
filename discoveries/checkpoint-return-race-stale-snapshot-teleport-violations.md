# Discovery: checkpoint return (R key) kicked the player with teleport+speed violations

**Date:** 2026-07-25
**Scope:** `apps/web` (jungle scene netcode) × `apps/server` (anti-cheat)
**Status:** Fixed

## Symptom

Even with the `player:checkpoint` handler registered (see the sibling note
`checkpoint-message-drops-player-unregistered-handler.md` for the drop bug
that came first), every R press logged
`[jungle:anti-cheat] <session> teleport+speed (N/12)` on the server, and
pressing R enough times reached 12/12 and kicked the player:

```
[jungle:anti-cheat] z4v77wYvS teleport+speed (1/12)
...
[jungle:anti-cheat] z4v77wYvS teleport+speed (12/12)
[jungle:anti-cheat] kicking z4v77wYvS (teleport+speed)
```

Reproduced headlessly by emulating the scene's update() ordering against the
real server (`mode=always`): the R press produced exactly one `teleport+speed`
violation per press.

## Root cause

A race between the local teleport and the server's ~one-RTT-stale broadcast:

1. Frame N: R pressed → `player.teleportTo(spawn)` → `PLAYER_CHECKPOINT_MESSAGE`
   sent → the ~20 Hz report goes out from the spawn point (fine).
2. Later in the **same** update, the scene reconciles against
   `room.state.players.get(...)` — the schema still holds the **pre-teleport**
   position until the server processes the checkpoint message and the patch
   round-trips. `applyServerSnapshot` sees error > `SNAP_DISTANCE` (32 px) and
   **snaps the local physics back to the old position**, undoing the teleport.
3. Next report is sent from the old position — but the server has by now
   re-baselined at the spawn (`onCheckpointReturn`), so the report is
   `maxPositionError` away → `teleport` + speed-vs-dt → `teleport+speed`
   violation. The monkey also *visibly* bounces spawn ↔ old position for a
   frame each way, which invites more R presses → 12 violations → kick.

The snapshot-reconciliation snap (the >32 px "trust the server" path in
`player.ts`) is normally the correct behavior — it is exactly what undoes a
rejected report. The checkpoint jump is the one legitimate case where the
local prediction is deliberately ahead of the broadcast.

## Fix

`apps/web/src/game/jungle-scene.ts` freezes snapshot reconciliation between
the R press and the server's confirmation:

- `checkpointPending` is set when R fires (teleport → pending → send).
- In the reconcile block, while `checkpointPending` is true,
  `applyServerSnapshot` is skipped; it resumes as soon as the broadcast
  position is within `SNAP_DISTANCE` of the checkpoint (the server's patch
  arrived, the jump is confirmed).
- Reports keep flowing meanwhile: they are all sent from the spawn point and
  are ordered **after** the checkpoint message on the same WebSocket, so the
  re-baselined server accepts them — which is what makes the confirmation
  patch arrive and clear the pending flag.

`SNAP_DISTANCE` was exported from `player.ts` so the scene gates on the same
constant the snap path uses.

## Verification

Throwaway smoke (removed after): emulated the scene's update() ordering
against the real server using the real shared physics + the real collision
grid (`parseJungleMap`), walking right for ~4 s then pressing R:

- `mode=always` (pre-fix): `teleport+speed (1/12)` on the server per press.
- `mode=pending` (fix): **no anti-cheat lines**, broadcast back at the spawn
  point (x=96; y settles on the platform below the in-air spawn).

`bun run typecheck` clean.

## Related

- `apps/web/AGENTS.md` → "Player movement & netcode" bullet.
- `apps/server/AGENTS.md` → "Checkpoint return (R key, debug)".
- `discoveries/checkpoint-message-drops-player-unregistered-handler.md` — the
  unregistered-message drop that this feature's first revision hit.
- `player.ts` `applyServerSnapshot` — the snap path that caused the snap-back.
