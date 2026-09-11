# Discovery: Playground says "server is down." when creating a room from localhost — `ALLOWED_ORIGIN_HOST` only allowed one host

**Date:** 2026-09-11
**Scope:** `apps/server` (Colyseus WebSocket origin gate) + `apps/web` (Elysia CORS) + `packages/shared` (new `compileOriginAllowlist`)
**Status:** Fixed, verified in a headless browser

## Symptom

Opening the Colyseus Playground at `http://localhost:2567/playground/` and
clicking **"Join or Create"** (or Create) against the `jungle` room showed the
error **"server is down."** — no room was created. The same error appeared for
any room creation from the Playground.

Bounding the problem: the page itself loaded (after the earlier
better-call/static-assets fix), `GET /playground/rooms` returned
`{"rooms":["jungle"],…}`, and `POST /matchmake/joinOrCreate/jungle` returned
200 with a fresh `{name, sessionId, roomId, processId}`. Only the actual join
failed.

## Root cause

Three layers stack up:

1. **The Playground's error fallback is misleading.** `JoinRoomForm.tsx` in
   `@colyseus/playground` (built SPA) reports
   `e.target?.statusText || e.message || "server is down."` — so a WebSocket
   handshake failure whose SDK error has no message surfaces as the generic
   "server is down.".
2. **The origin gate rejected the browser's WebSocket, silently.** `apps/server/src/index.ts`
   built the handshake allow-list as a single-host regex:
   ```ts
   const ALLOWED_ORIGIN = new RegExp(
     `^https?://${allowedOriginHost.replaceAll(".", "\\.")}(?::\\d+)?$`,
   );
   ```
   With `ALLOWED_ORIGIN_HOST=192.168.1.109` in `apps/server/.env` (LAN dev),
   `WebSocketTransport.beforeUpgrade` returned 403 for the Playground's own
   page origin `http://localhost:2567`. The upgrade died with `CLOSE 1006`
   (verified with a raw `ws://localhost:2567/<processId>/<roomId>?sessionId=…`
   connection carrying `Origin: http://localhost:2567`).
3. **The env var was only ever meant to hold one host**, yet
   `apps/web/next.config.ts` already parsed it comma-separated into
   `allowedDevOrigins` — so the "same env var" contract was already plural in
   one consumer. (Latent bug in the same regex: `"*"` — the documented
   default — compiled to the literal host `\*`, matching nothing, so the
   gate would have blocked every browser origin with the env unset.)

The Playground works from the LAN IP (`Origin: http://192.168.1.109:2567`
matched) — which is why it looked like an intermittent/host-specific failure.

## Fix

Added a shared, framework-agnostic helper in `packages/shared/src/index.ts`:

```ts
export function compileOriginAllowlist(raw: string | undefined): RegExp | true
```

- accepts a **comma-separated** host list (`localhost,192.168.1.109`), each
  entry matched against `http(s)://<host>[:port]`;
- a literal `*` entry (or empty/unset) returns `true` = allow any origin
  (fixes the broken `"*"` default too);
- escapes regex metacharacters per host instead of only `.`

Consumers now share one matcher:
- `apps/server/src/index.ts` — `beforeUpgrade` checks
  `origin && ALLOWED_ORIGIN !== true && !ALLOWED_ORIGIN.test(origin)` → 403.
- `apps/web/src/app/api/[[...slugs]]/route.ts` — `cors({ origin: ALLOWED_ORIGIN })`
  (`@elysia/cors` accepts `boolean | RegExp`).
- `apps/server/.env` + `apps/web/.env` (and both `.env.example`) now set
  `ALLOWED_ORIGIN_HOST=localhost,192.168.1.109`.

Why this lever: the gate is the actual 403; adding the port/browser-local
handling elsewhere wouldn't help, and there's no field to relax on
`beforeUpgrade` without loosening the allow-list. The `allRepeatedWildcards`/
regex approach in the Colyseus core isn't exposed, so the app-level helper is
the right seam — and putting it in `@monkeyluka/shared` keeps the two
consumers from drifting again.

## Verification

- Raw WebSocket upgrade with `Origin: http://localhost:2567` → now `CLOSE 1000`
  (was 1006); `Origin: http://192.168.1.109:2567` still 1000; `Origin:
  http://evil.example.com` still rejected (1006).
- Full `@colyseus/sdk` `joinOrCreate("jungle", {name}, JungleState)` from
  localhost resolves.
- Headless Chromium against `http://localhost:2567/playground/`: clicked
  "Join or Create", connection registered (no "server is down.", no page
  errors), and `GET /playground/rooms` afterwards reported
  `roomsByType: {"jungle":1}`.
- Elysia CORS: `GET /api/health` with `Origin: http://localhost:3000` →
  `access-control-allow-origin: http://localhost:3000`; with a non-allowlisted
  Origin → no ACAO header.
- `bun run typecheck` clean (web + server + shared).

## Related

- `packages/shared/src/index.ts` — `compileOriginAllowlist()`.
- `apps/server/src/index.ts` — `beforeUpgrade` origin gate.
- `apps/web/src/app/api/[[...slugs]]/route.ts` — Elysia CORS.
- `apps/server/AGENTS.md`, `apps/web/AGENTS.md`, `architecture.md` (§6, §7.3,
  §7.4, §8) — updated to document the comma-separated allowlist semantics.
- `@colyseus/playground` built SPA, `src/components/JoinRoomForm.tsx` (sourcemap
  source): `e.target?.statusText || e.message || "server is down."`.
- Previous layer that made the Playground reachable at all:
  `discoveries/playground-assets-stall-better-call-res-end.md`.