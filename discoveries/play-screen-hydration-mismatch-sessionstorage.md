# Discovery: /play hydration failed — sessionStorage read in a SSR'd client component

**Date:** 2026-09-12
**Scope:** `apps/web` — `src/components/play-screen.tsx`, `src/lib/jungle-session.ts`
**Status:** Fixed

## Symptom

Reloading `http://localhost:3000/play` with a live jungle session in
`sessionStorage` logged in the browser console:

```
Uncaught Error: Hydration failed because the server rendered HTML didn't match the client.
```

The diff showed the server tree with the idle menu (`header … sticky top-0 z-40 …`)
vs. the client tree with the "Reconnecting…" full-screen loader — two different
top-level `div`s in `PlayScreen` (played as `novit in <id> reconnect`/`leave` in
the room logs afterwards).

## Root cause

`PlayScreen` seeded its phase with a lazy `useState` initializer:

```tsx
const [phase, setPhase] = useState<Phase>(() =>
  loadJungleSession() ? "resuming" : "idle",
);
```

`loadJungleSession()` reads `sessionStorage`. A `"use client"` component still
SSR-renders in the App Router, so:

1. **Server render:** `sessionStorage` doesn't exist → try/catch returns `null`
   → phase `"idle"` → server emits the menu tree.
2. **Client hydration render:** `sessionStorage` holds a live
   `reconnectionToken` (a page reload keeps it) → phase `"resuming"` → client
   emits the "Reconnecting…" tree.

React hydrates the client tree onto the server HTML; the trees disagree at the
first `div` and the whole subtree is regenerated (state thrown away, plus a
console error on every reload while a session is live).

## Fix

Split "compute the phase" from "render it". The phase can only be trusted
post-hydration, so `PlayScreen` now holds a `booted` flag set in a mount
`useEffect`, and renders a neutral loader (same markup on server and client)
until it flips:

```tsx
const [booted, setBooted] = useState(false);
useEffect(() => setBooted(true), []);

// ...
if (!booted || phase === "resuming") {
  return ( /* loader; label = booted ? "Reconnecting…" : "Loading…" */ );
}
```

The server and the client's first (hydration) render both produce the loader,
so they always match — regardless of what the `useState` initializer computed
(the initializer's client-side value simply becomes visible once `booted`
flips, preserving the "menu never flashes for a resuming player" behavior).

Why this lever and not another:

- `useSyncExternalStore` with a `getServerSnapshot` would also work but needs
  subscribe plumbing for a value that is read once, not a changing store.
- `next/dynamic(..., { ssr: false })` would work (`/play` is inherently
  client-only) but changes page-level SSR for the whole screen instead of the
  one client-only branch, and costs the menu's streamed first paint.

## Verification

- `curl -s http://localhost:3000/play | grep -o 'Loading…\|Reconnecting…\|Ready to play?'` →
  exactly one `Loading…`, no menu markers — server output now matches the
  client's hydration frame.
- Reloaded `/play` in a browser with a live session: no hydration error in the
  console; flow was Loading… → Reconnecting… → game, as before the regression.
- `bun run typecheck:web` passes.

## Related

- `apps/web/AGENTS.md` → "Play flow & realtime client" → Reconnection bullet
  (documents the `booted` gate).
- `apps/web/src/components/play-screen.tsx`, `apps/web/src/lib/jungle-session.ts`.
- React docs: https://react.dev/link/hydration-mismatch