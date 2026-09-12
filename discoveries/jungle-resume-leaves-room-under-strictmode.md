# Discovery: reconnect succeeds then immediately leaves (React StrictMode kills the resume)

**Date:** 2025-07-15
**Scope:** `apps/web` (`src/components/play-screen.tsx`)
**Status:** Fixed

## Symptom

Reloading `/play` with a live session in dev produced, on the server:

```
novit in daQsjrFTx drop
novit in daQsjrFTx reconnect
novit in daQsjrFTx leave
```

The reconnect was accepted (`onReconnect` fired, seat reused, same sessionId),
but the client then sent a **consented leave** moments later — the player
never actually got back into the game, and the browser sat on the
"Reconnecting…" spinner forever. No anti-cheat warnings appeared, so it was
not a kick. The same path also stuck the screen on the spinner when the seat
had genuinely expired.

## Root cause

The server was doing the right thing; the client killed the room it had just
reconnected to. In `apps/web/src/components/play-screen.tsx`, the resume
effect closed over a `cancelled` flag:

```ts
useEffect(() => {
  const session = loadJungleSession();
  if (!session || resumeStartedRef.current) return;
  resumeStartedRef.current = true;

  let cancelled = false;
  void colyseusClient.reconnect(session.reconnectionToken, JungleState)
    .then((room) => {
      if (cancelled) { room.leave().catch(() => {}); return; }
      adoptRoom(room, session.name);
    })
    ...
  return () => { cancelled = true; };
}, []);
```

Next.js enables **React StrictMode by default in dev**, which runs every
effect as `setup → cleanup → setup` ("mount → unmount → mount"). The layers:

1. Setup #1: session found, reconnect starts (server logs `reconnect`).
2. Cleanup phase (all effects): the unmount-teardown effect runs its
   cleanup, which calls `clearJungleSession()` — the stored token is wiped.
   The resume effect's cleanup sets `cancelled = true`.
3. Setup #2: `loadJungleSession()` now returns `null`, so the guard
   early-returns — no second reconnect is started, and `resumeStartedRef`
   (which is intentionally never reset) also blocks a re-attempt.
4. The in-flight reconnect from step 1 resolves: `cancelled` is `true` →
   `room.leave()` → server logs `leave`. The room is never adopted.

The `.catch` fallback path had the same flaw: `if (cancelled) return;` meant
an expired seat also left the user stuck on the spinner instead of falling
back to the menu. Production builds are unaffected (StrictMode is dev-only);
this only bit `bun run dev`.

## Fix

Replaced the closure snapshot with a live liveness ref that every effect run
re-arms:

```ts
const mountedRef = useRef(true);

useEffect(() => {
  mountedRef.current = true;   // re-armed on the StrictMode remount
  const session = loadJungleSession();
  if (!session || resumeStartedRef.current) return;
  resumeStartedRef.current = true;

  void colyseusClient.reconnect(session.reconnectionToken, JungleState)
    .then((room) => {
      if (!mountedRef.current) { room.leave().catch(() => {}); return; }
      adoptRoom(room, session.name);
    })
    .catch((err) => {
      console.warn("Could not resume the jungle session:", err);
      if (!mountedRef.current) return;
      clearJungleSession();
      setName(session.name);
      setPhase("idle");
    });

  return () => { mountedRef.current = false; };
}, []);
```

Because the reconnect resolves asynchronously, by the time it settles under
StrictMode the remount's effect run has already set `mountedRef` back to
`true` — so the room is adopted normally. On a **real** unmount (navigating
away while the reconnect is in flight) the ref stays `false` and the room is
still left, which preserves the deliberate-exit semantics. The `resumeStartedRef`
guard still allows exactly one reconnect attempt per mount, so the remount
re-arms the flag without starting a second connection to the same seat.

The teardown effect's `clearJungleSession()` firing during the synthetic
unmount is harmless: on success `adoptRoom` re-saves the session, and on
failure the `.catch` clears it again and drops to the menu.

## Verification

- `bun run typecheck:web` passes.
- Dev-mode reload (`bun run dev`) with a live session now logs
  `drop` → `reconnect` only; `adoptRoom` runs, the game boots, and no
  `leave` follows. The seat-expired path falls back to the menu with the
  name pre-filled instead of hanging on the spinner.

## Related

- `apps/web/AGENTS.md` → the **Reconnection** bullet under the Play screen.
- `apps/web/src/components/play-screen.tsx` (resume effect + `mountedRef`).
- Prior session-handling notes: `discoveries/play-screen-hydration-mismatch-sessionstorage.md`,
  `discoveries/jungle-reconnect-holds-seat-and-resets-report-seq.md`.