# Discovery: Docker tunnel rounds trip + batching reads as speed/teleport hacks — server stops and kicks honest players ("severe lag")

**Date:** 2025-09-25
**Scope:** `apps/server` (jungle room anti-cheat), `apps/web` (player reconcile), `compose.yaml` / Cloudflare tunnel deployment
**Status:** Fixed

## Symptom

Playing the game through the Docker+Cloudflare-tunnel deployment
(`monkeyluka.online`) feels *severely* laggy while the same code on `bun run
dev` (localhost) is smooth. The player freezes in place, then rubber-bands,
and after a burst of freezes gets disconnected. Server logs showed:

```
[jungle:anti-cheat] eko49hO-T speed (1/12) … speed (5/12)
[jungle:anti-cheat] v6Tbxvr7t speed (1/12) … input-flood … kicking v6Tbxvr7t (input-flood)
```

Straight-line `/api/health` round trips through the tunnel measured
**0.42–0.75 s** (vs ~0.16 s to the Cloudflare edge directly), and
`cloudflared` connected to `bkk07/bkk09/sin12/sin14` (`protocol=quic`).

## Root cause

Two things layered:

1. **The deployment routes every client through the tunnel, whose RTT is
   dominated by two full internet round trips to the Cloudflare edge**
   (browser → edge → cloudflared → origin; this host's own edge path is
   already ~160–210 ms). A client-simulated game can live with that IF the
   anti-cheat doesn't punish latency and the client doesn't snap to stale
   server state. Both of those were out of whack.

2. **The server's speed check used wall-clock *arrival* spacing as the
   report's own `dt`** (`apps/server/src/rooms/jungle/jungle-room.ts` →
   `onPlayerInput`, `validatePositionReport` in
   `packages/shared/src/physics/validation.ts`). The client genuinely sends
   every `INPUT_INTERVAL_MS` (50 ms), but the tunnel delivers WebSocket
   frames in bursts. Several 50 ms-spaced reports arrive back-to-back, so the
   measured gap collapses to ~1 ms while the reported positions are a full
   cadence apart. The allowance `maxPlayerSpeed*dt + slack*dt` then drops to
   ~0.5 px while an honest jog moves 2.75 px/report and a fall moves up to
   17 px/report → **false `speed` flags → freeze → further flags cascade**
   (window grows past the 80 px teleport tolerance) → kick at 12/12.
   Reproduced with a probe that ran the *shared* `stepPlayer` over the tunnel:

   ```
   [jungle:debug] seq=88 reported=(1837.0,137.0) accepted=(1839.8,137.0) dt=0.001 flags=speed …
   [jungle:debug] seq=89 reported=(1834.3,137.0) accepted=(1839.8,137.0) dt=0.001 flags=speed …
   ```

3. **Separate deployment bug on top:** the running images were stale vs the
   repo — the built images had `PLAYER_SPAWN = (114*16)+8, (8*16)` (1832,128)
   while the repo had moved on to `(4*16)+8, (11*16)` (72,176). Two images
   built at different times (or one before the spawn change) made a web
   client that spawns at (72,176) read as a **1760 px teleport** against a
   server that spawns at (1832,128) → immediate kick. Verified by diffing
   the container's copied source against the repo: `packages/shared/.../config.ts`
   differed in exactly the `PLAYER_SPAWN` line.

## Fix

1. **Floor the speed-check `dt` by the client's own report cadence**
   (`apps/server/src/rooms/jungle/jungle-room.ts`): the report stream has a
   documented minimum spacing — the browser sends every `INPUT_INTERVAL_MS`
   and `seq` must rise by exactly 1 per report — so

   ```ts
   const wallDt = player.lastValidAt > 0 ? (now - player.lastValidAt) / 1000 : null;
   const cadenceDt = (payload.seq - player.lastSeq) * (INPUT_INTERVAL_MS / 1000);
   const dt = player.lastValidAt > 0 ? Math.max(wallDt ?? 0, cadenceDt) : null;
   ```

   A burst can therefore never under-count the time a legitimately-spaced
   trajectory took. `INPUT_INTERVAL_MS` is now a shared constant
   (`packages/shared/src/physics/validation.ts`) re-exported by
   `apps/web/src/game/scene/constants.ts` so the cadence can't drift between
   sides. The 80 px teleport cap still hard-bounds any single report, so a
   cheat can't exploit the (slightly looser) speed allowance beyond what the
   teleport bound already allowed.

2. **Absorb a single isolated failing report** (`jungle-room.ts`,
   `server-player.ts`): only `FAILING_REPORTS_TO_STOP = 2` **consecutive**
   failures stop the player and count a violation (`failStreak`).
   One-off stalled/burst reports (a long delivery stall mid-fall) no longer
   freeze an honest player; sustained abnormal movement still escalates.

3. **Client: render the local prediction directly; adopt the broadcast only
   when it is authoritative** (`apps/web/src/game/player/player.ts`
   `applyServerSnapshot`/`render`): the sprite was drawn at
   `physics + correction` where the correction chased the stale broadcast
   (≈ −20 px, ~0.3 s, under tunnel RTT) — every press/turn/stop visibly
   trailed, and trap/pit kill probes (which run on the true sim position)
   hit before the sprite reached the hazard, so dodges read as early/unfair.
   Now the sprite renders the prediction exactly; the broadcast is adopted
   only when the server has *stopped* us (zeroed velocities — violation
   halt / checkpoint) or the offset is beyond `HARD_SNAP_LIMIT` (240 px,
   teleport-scale). Boot/resume adoption is an unconditional
   `adoptServerState()` (called from `scene/create.ts`) so a resumed session
   still starts exactly where the server placed it. Follow-up: `target`/`correction`
   and `CORRECTION_RATE`/`MAX_CORRECTION` removed along the way.

4. **Rebuilt the stale images** (`docker compose build server next`); both
   now carry the repo's current spawn/physics/anti-cheat. Note this moves
   the in-game spawn from the (114,8) endgame-area trial point back to
   (4,11) — the repo's intended spawn — so the run now starts at the map's
   left edge, not near the finish tile.

## Verification

- Pre-fix probe over the tunnel (honest `stepPlayer` jog + hops from the
  deployed spawn): `teleport` ×12 → **kick**; with the mismatched (stale)
  images it was `teleport` against a 1760 px-away `lastValid`.
- Post-fix probe (same honest jog, matching images, same tunnel): **zero**
  `[jungle:anti-cheat]` / `[jungle:debug]` lines across 4 consecutive 8 s
  runs.
- `bun run typecheck` and `bun test` (143 tests) pass.
- Deployment health: `https://monkeyluka.online/api/health` → 200.

## Related

- `apps/server/AGENTS.md` (anti-cheat contract), `docs/gameplay.md`
  (client-simulated movement + validation flow).
- `compose.yaml` — the tunnel is mandatory for remote play without a public
  IP; for same-machine/LAN Docker play, publish
  `server`'s ports and point `NEXT_PUBLIC_COLYSEUS_ENDPOINT` (or the
  `ws://<hostname>:2567` fallback) at the LAN address to skip the ~2× edge RTT
  entirely. `cloudflared --protocol http2` was tried and did **not** improve
  the tunnel RTT; the cost is the ISP↔Cloudflare-edge path, not the protocol.

## Follow-ups

- `PLAYER_SPAWN` changes are baked into **both** images independently (server
  runs raw TS, web bundles it). Rebuild both with `docker compose build
  server next` whenever shared constants change, or a repaired server and a
  stale web image will teleport-kick every fresh run again.