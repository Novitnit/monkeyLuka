# Discovery: jungle reconnect needs a held seat, a seq reset, and a freeze while disconnected

**Date:** 2025-09-12
**Scope:** `apps/server` (JungleRoom lifecycle) + `apps/web` (play screen, scene)
**Status:** Fixed

## Symptom

Two reconnection features were asked for: re-enter the same room after a page
reload, and auto-reconnect after a transient drop. Naively wiring Colyseus'
`client.reconnect()` + the SDK's built-in retry loop produced three distinct
failures, each invisible until you watched the room state:

1. After a reload the player reconnected but **never moved again** — every
   movement report was silently dropped (the server freezes the player, no
   error anywhere server- or client-side).
2. After a mid-session network blip the player was kicked after ~12 reports.
3. A reloaded page briefly popped back to the spawn point before snapping to
   the old position.

## Root cause

All three come from Colyseus 0.18's reconnection semantics interacting with
this repo's custom `PLAYER_INPUT_MESSAGE` seq/validation pipeline:

- **Seat + world entry are not free.** Reconnection requires the room to call
  `allowReconnection(client, seconds)` inside the non-consented leave path
  (`onDrop`, NOT `onLeave` — core `_onLeave` routes non-consented closes to
  `onDrop || onLeave`). Without it, `client.reconnect(token)` fails with
  `MATCHMAKE_EXPIRED`. With it, the session rejoins with the **same
  sessionId**, `onJoin` is *not* called again (only `onReconnect`), and the
  player's `sim`/`JungleState.players` entries survive untouched — that is
  exactly the state we want preserved. The reserved seat also keeps the room
  from auto-disposing (`#_disposeIfEmpty` requires
  `Object.keys(_reservedSeats).length === 0`), which is why a solo player can
  reload at all.
- **`seq` is not monotonic across a reload.** The room drops any report whose
  `seq` is ≤ the last accepted one ("WebSocket is ordered, so that means
  retransmit/forgery"). A reloaded page starts its counter at 0 while the
  server still holds the pre-reload `lastSeq` — so *every* report after a
  reload is dropped forever. The player was reconnected but permanently
  frozen. Fix: `onReconnect` resets `lastSeq = -1`.
- **Buffered reports flush as a burst.** While the socket is down the SDK
  keeps accepting `room.send()` and buffers up to 10 messages
  (`Reconnection.ts enqueueMessage`), flushing them all on reconnect. Our
  speed check compares reported movement against wall-clock `dt` since the
  last accepted report — a burst of ~20 Hz-simulated reports arriving with
  `dt ≈ 0` looks like moving ~17 px in 1 ms, i.e. a speed hack, one violation
  per report → kick. Fixing it server-side only (reset `lastValidAt` on
  reconnect) still leaks violations for reports 2..N of the burst, so the
  client must stop *producing* reports while disconnected: the scene freezes
  local simulation when `!room.connection.isOpen`.
- **Spawn pop**: the scene always spawned at `PLAYER_SPAWN`; on resume it must
  seed the local physics from the player's own broadcast `PlayerInfo` so the
  first report starts from the *last accepted* position (also avoids a fake
  teleport violation).

## Fix

- `apps/server/src/rooms/jungle/jungle-room.ts`: added `onDrop` →
  `allowReconnection(client, RECONNECT_GRACE_SECONDS)` with
  `reconnection.catch(() => this.removePlayer(sessionId))` (the deferred
  rejects on seat expiry/room disposal — `onLeave` is never called again, so
  this timer is the only cleanup hook); `onReconnect` resets
  `lastSeq`/`inputStamps`/`lastValidAt`; `onLeave` (consented only) and
  `onDispose` share an idempotent `removePlayer`. Grace default 30 s, env
  `JUNGLE_RECONNECT_SECONDS`; the seat counts toward `maxClients` while held.
- `apps/web/src/lib/jungle-session.ts` (new): `reconnectionToken` + name in
  sessionStorage (survives reloads, dropped on tab close).
- `apps/web/src/components/play-screen.tsx`: starts in a `"resuming"` phase on
  mount when a session exists, `colyseusClient.reconnect(token, JungleState)`,
  persists the fresh token on join/resume, and returns to the menu on a
  terminal `room.onLeave` (deliberate exits clear the session first).
- `apps/web/src/game/jungle-scene.ts`: freezes local simulation while
  `!room.connection.isOpen` (the SDK auto-reconnects); seeds the local player
  from its own broadcast position on create.

## Verification

Standalone smoke scripts against a real server (then deleted): join → drop the
socket non-consented → reconnect → same sessionId + name + position; first
report with `seq: 0` accepted (position updated, no kick); explicit leave
refuses a later reconnect; with `JUNGLE_RECONNECT_SECONDS=2`, a dropped player
vanishes from other clients' state after the grace window and the room
survives. All 12 + 4 checks passed; `bun run typecheck`, `bun test` (3
pre-existing physics failures unrelated), `bun run lint` clean.