# Discovery: stale Colyseus dev server — respawn teleports to the wrong position

**Date:** 2026-09-14
**Scope:** `apps/server` (dev process) × `packages/shared` (shared spawn/checkpoint constant) × `apps/web` (client checkpoint)
**Status:** Fixed (operationally)

## Symptom

While developing the jungle level, the player respawned at the **wrong
position** instead of the checkpoint: pressing R (debug) or dying teleported
the monkey somewhere else — and repeated respawns escalated to anti-cheat
kicks (`[jungle:anti-cheat] ... teleport ...`).

A fresh Colyseus client revealed the smoking gun: a brand-new room placed the
new player at **(952, 208)** while the web client's compiled bundle carried
**PLAYER_SPAWN = (56, 192)**:

```
joined. spawn broadcast: (952.0, 208.0) PLAYER_SPAWN: {"x":56,"y":192}
```

The two processes disagreed on the spawn constant, so the checkpoint flow
could never converge.

## Root cause

The respawn flow requires the client and the server to agree on the
checkpoint position:

1. The client teleports to its compiled-in `PLAYER_SPAWN` (the
   scene-level `state.checkpoint`, `apps/web/src/game/scene/state.ts`) and
   sends `PLAYER_CHECKPOINT_MESSAGE`.
2. The server re-baselines its anti-cheat state at **its own**
   `createPlayerState()` spawn (`apps/server/src/rooms/jungle/jungle-room.ts`
   `onCheckpointReturn`) and broadcasts it.
3. The client's reconcile gate
   (`apps/web/src/game/scene/update.ts`) only clears `checkpointPending`
   when the broadcast is within `SNAP_DISTANCE` (32 px) of the checkpoint.
   With client=56,192 and server=952,208 the gap is ~896 px → the gate never
   clears, reconciliation stays frozen, and every report from the client's
   spawn reads against a server baselined 900 px away → teleport violations
   → stopped player, then a kick at 12.

That constant is shared (`@monkeyluka/shared`, `PLAYER_SPAWN` in
`packages/shared/src/physics/player/config.ts`), so the disagreement can only
come from **one side running stale code**. In this session:

- The web's Turbopack dev bundle had recompiled and carried the current
  `PLAYER_SPAWN = { x: 3*16+8, y: 12*16 }` (56, 192).
- The Colyseus dev server (`bun run --watch src/index.ts`, started 16:55)
  had **not** reloaded the shared module after `config.ts` was edited at
  18:33 (a `PLAYER_SPAWN` experiment had been reverted to the committed
  value right before the commit). Its pid was unchanged hours later, and a
  fresh room still spawned at (952, 208) — the experiment value
  `{ x: 59*16+8, y: 13*16 }` that existed in the working tree when the
  server started.
- A second stuck `bun run start` (started 18:59, the user's own restart
  attempt) never bound the port (already held by the stale process) and
  lingered.

### Why `--watch` missed it: atomic saves

`bun run --watch` **does not reload a file that was replaced atomically
(write a temp file, then rename it over the original)** — which is how most
editors save. Reproduced in isolation with a scratch package symlinked into
`node_modules` exactly like the workspace package:

- in-place write (`echo ... > mod.ts`, same inode) → watcher restarted
  (`one` → `two`);
- atomic save (`printf ... > .mod.ts.tmp && mv .mod.ts.tmp mod.ts`) → **no
  restart**, and the watcher then stopped reacting to further writes entirely.

The workspace symlink is therefore a red herring — the same miss happens for
any watched file. Turbopack (the web dev server) uses a different watch
mechanism and did pick the change up, which is why only the server stayed
stale.

## Fix

Restart the Colyseus dev server so it executes the current `packages/shared`:

```sh
# stop the stale `bun run --watch src/index.ts` (and any stuck `bun run start`
# left holding no port), then:
bun run dev            # from the repo root — or, from apps/server:
bun run start          # current code, no watch
```

No source change was needed — both sides of the checkpoint flow already
agree once the server loads the current constant.

## Verification

Fresh server (`bun run start`, current code), full death→checkpoint→revive
cycle over the real WebSocket:

```
joined. spawn broadcast: (56.0, 192.0) == PLAYER_SPAWN? {"x":56,"y":192}
after death msgs, broadcast: (56.0, 192.0)   # was (952.0, 208.0) before
death question: death: d((ln(x)))/dx
body settled at checkpoint — broadcast: (56.0, 192.0)
quiz result: correct=false                    # grading works (server-side key)
FINAL after revive+move: (57.1, 185.0)        # moves from the checkpoint, no violations
```

Same probe before the restart: spawn (952,208), checkpoint return stayed at
(952,208), client-stopping teleport violations.

## Related

- `AGENTS.md` → "Conventions & gotchas (repo-wide)" — new bullet: restart
  both dev processes after changing shared constants.
- `apps/web/AGENTS.md` → "Player movement & netcode" (checkpoint flow).
- `packages/shared/src/physics/player/config.ts` — `PLAYER_SPAWN` is the
  single agreement point for the respawn/checkpoint flow.
- `discoveries/checkpoint-return-race-stale-snapshot-teleport-violations.md`
  — the earlier client/server interaction, fixed in code; this one is the
  process-skew variant.