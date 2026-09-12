# Discovery: pressing the debug R key dropped the player from the server

**Date:** 2026-07-25
**Scope:** `apps/server` (Colyseus room message handling) × `apps/web` (jungle scene)
**Status:** Fixed

## Symptom

With the debug checkpoint feature enabled in the browser (`NEXT_PUBLIC_DEBUG`
in `apps/web/.env`), pressing **R** (return to checkpoint) disconnected the
player from the room — the Colyseus client fired `onLeave` with code 4002 and
the player vanished from the leaderboard. Reproduced deterministically with a
smoke client:

```
joined room=PRNBr6eWx session=OHlYHYqKk
RESULT: DROPPED (left code=4002)
```

and the room log showed the non-consented path (`smoke in PRNBr6eWx drop` —
`onDrop`, not the Exit-button `onLeave`).

## Root cause

The first implementation registered the `player:checkpoint` handler **only
when the server's `NEXT_PUBLIC_DEBUG` was set**:

```ts
if (CHECKPOINT_DEBUG) {
  this.onMessage(PLAYER_CHECKPOINT_MESSAGE, (client) => { ... });
}
```

Two failure modes stack up from that:

1. **Colyseus drops clients that send unregistered messages.** In
   `@colyseus/core` 0.18.11, `RoomMessages.ts` → `onData()` falls through to
   `#noHandler()`, which in non-dev mode calls
   `client.leave(CloseCode.WITH_ERROR, ...)` (dev mode only sends an error).
   So with the server flag off, the very first R press closed the socket.
   The web and server workspaces load env from **different `.env` files**
   (`apps/web/.env` vs `apps/server/.env`), so "the flag is set" on one side
   says nothing about the other — the mismatch was the normal case, not an
   edge case.
2. Even without the drop, the mismatch would have kicked the player: the
   client teleports locally and keeps reporting at ~20 Hz, and every report
   lands >`ANTI-CHEAT.maxPositionError` (5 tiles) from the last accepted
   position → `teleport` violations at ~20/s → `maxViolations` (12) reached
   and `client.leave(4000, "movement violation")` in well under a second.

## Fix

`apps/server/src/rooms/jungle/jungle-room.ts` now registers
`onMessage(PLAYER_CHECKPOINT_MESSAGE, ...)` **unconditionally**. That is safe
because the handler's teleport target is the **server-chosen** `PLAYER_SPAWN`
— the server never reads a position from the message, so a forged message can
only reset the *sender* to spawn (a self-penalty; the anti-cheat is not
bypassed). The handler re-baselines `lastValid`/`lastValidAt`, so subsequent
reports validate normally instead of storming violations.

The debug gate stays where it belongs: the **client** only registers the R key
when `NEXT_PUBLIC_DEBUG` is on (`isDebugEnabled()` in
`apps/web/src/game/jungle-scene.ts`), so normal players never send the message.

Why this lever and not the alternatives:

- *Gate server-side, ignore unknown messages when off* — still kicks the
  player through the violation storm whenever the two `.env` flags disagree.
- *Skip teleport when server debug unknown* — the client cannot know the
  server's flag, so it would either never teleport or need a capability
  handshake (over-engineering for a debug key).
- *Always accept, server-chosen target* — removes both failure modes at once
  with no new trust in client input.

## Verification

Smoke script (throwaway `apps/web/tmp-smoke-checkpoint.ts`, removed after):
joined the room via `@colyseus/sdk`, walked away legitimately in 4 × 80 px
reports (~1.5 s apart, under the speed ceiling), sent
`PLAYER_CHECKPOINT_MESSAGE`, then reported being at the spawn:

```
walked away: x=416 y=176
RESULT: STAYED
final position: x=96 y=176 (expected 96/176 if re-baselined)
REBASELINED: yes
```

— with the server running **without** `NEXT_PUBLIC_DEBUG`, i.e. the previously
dropping configuration. Before the fix the same script printed
`RESULT: DROPPED (left code=4002)`. No `[jungle:anti-cheat]` lines appeared in
the server log. `bun run typecheck` clean.

## Related

- `apps/server/AGENTS.md` → "Checkpoint return (R key, debug)" (also documents
  the Colyseus unregistered-message drop gotcha).
- `apps/web/AGENTS.md` → "Player movement & netcode" bullet.
- Colyseus core: `@colyseus/core/src/RoomMessages.ts` (`#noHandler`).
