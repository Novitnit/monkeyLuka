# Discovery: Playground loads index.html but stalls forever — `better-call`'s `setResponse` never ends large bodies

**Date:** 2026-09-11
**Scope:** `apps/server` — every HTTP route served through `@colyseus/better-call`'s Node adapter (playground static assets)
**Status:** Fixed, verified, documented in `AGENTS.md` + `apps/server/AGENTS.md`

## Symptom

After the trailing-slash fix, `http://localhost:2567/playground/` served HTML but
the SPA **stalled loading indefinitely** — "stuck loading, never finishes". The
browser got `index.html` (829 b), then `GET /playground/assets/index-DNp_Ao96.js`
hung: curl reported `HTTP 200` with `Content-Length: 2195939` but only ever
received **exactly 16384 bytes** before the connection went silent.

Bounding the problem: everything under 16 KiB worked (`manifest.json` 493 b,
`favicon.ico` 15 KiB, `__healthcheck`), everything above stalled at the same
16 384-byte mark (`index.css` 80 831 b, `index.js` 2 195 939 b,
`index.js.map` 6 767 892 b). The matchmaker (`POST /matchmake/joinOrCreate/jungle`)
was unaffected (small bodies).

## Root cause

A `res.end()` placement bug in `@colyseus/better-call@1.3.3`
(`dist/adapters/node/request.mjs` and `request.cjs`, `setResponse`):

```js
async function next() {
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT) continue;
      else {
        res.once("drain", next);
        return;
      }
      res.end();   // ← wrong: only reached when the FIRST write returns true
    }
  } catch (error) { ... }
}
```

Two broken paths, both triggered by `servesStatic`'s single-chunk
`new Response(new Uint8Array(buf))`:

1. **Body > 16 KiB** (`res.write`'s first call returns `false` — backpressure):
   the function returns on the `drain` waiter without ever ending. On
   drain, the follow-up `next()` call sees `done: true` and `break`s — still
   no `res.end()`. The response is never finalized, so the browser waits
   forever. (The 16 384-byte cutoff is the write buffer watermark: the first
   `res.write(value)` flush succeeds for anything below it.)
2. **Small body, many chunks**: `res.end()` is called after the *first*
   successful write, so later chunks hit `write-after-end`.

The playground tries to paper over exactly this ("`connection: close` ... so
a keep-alive response is left unterminated and browsers spin" — comment in
`@colyseus/playground/src-backend/index.ts`) — and it does not help: with
`res.end()` never called the socket is never finalized either way. The
`AWS_LAMBDA` branch is the author's escape hatch for serverless, which never
hits the stall.

Reproduced standalone with the installed packages:

```ts
import { createServer } from "node:http";
import { toNodeHandler } from "@colyseus/better-call/node";
const big = new Uint8Array(2 * 1024 * 1024).fill(65);
createServer(toNodeHandler(async () => new Response(big))).listen(3999);
// → curl: 200, size=16384, then hangs
```

## Fix

`bun patch @colyseus/better-call` — shift `res.end()` out of the read loop so
it runs exactly once, after the body is fully drained (kept outside the loop
for both `.mjs` and `.cjs` builds; the AWS-Lambda backpressure bypass is
preserved):

```js
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  if (!res.write(value)) {
    if (!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT)) {
      res.once("drain", next);
      return;
    }
  }
}
res.end();
```

Applied via the repo's new dependency-patch mechanism (see `AGENTS.md` →
"Patching a dependency"): `bun patch --commit` wrote
`patches/@colyseus%2Fbetter-call@1.3.3.patch` and pinned it through
`patchedDependencies` in the root `package.json` + `bun.lock`. Because the
editable copy can't resolve its own deps (they live in the `.bun` store), a
root `bun install` is required after `--commit` — a clean `rm -rf node_modules &&
bun install` was used to re-verify the patched layout from scratch.

Why not another lever:

- No upstream fix exists — `@colyseus/better-call@1.3.3` is the latest
  published version.
- No app-level workaround is possible: every HTTP response from the Colyseus
  transport flows through `toNodeHandler` → `setResponse`, including custom
  playground routes we'd add ourselves, and `defineServer` exposes no hook to
  bypass the node adapter.

## Verification

After a clean install with the patch applied:

```
200  GET /playground/assets/index-DNp_Ao96.js         2195939/2195939 bytes, 0.014s, cmp-identical
200  GET /playground/assets/index-BvbHcjwZ.css         80831b
200  GET /playground                                    829b
200  GET /playground/                                   829b
200  GET /playground/rooms                              106b
200  GET /playground/__apidocs                          776b
200  GET /playground/favicon.ico                      15086b
200  GET /playground/manifest.json                      493b
200  POST /matchmake/joinOrCreate/jungle                     (matchmaker unaffected)
$ bun run typecheck   # clean (web + server + shared)
```

The standalone repro (2 MiB body) also now returns the full payload, byte for
byte.

## Related

- `AGENTS.md` — "Patching a dependency" section documents the `bun patch`
  workflow (editable copy → `--commit` → root `bun install`).
- `apps/server/AGENTS.md` — "Colyseus 0.18 quirks" documents the better-call
  patch requirement and warns against "fixing" it back.
- Patched source: `node_modules/.bun/@colyseus+better-call@1.3.3+*/node_modules/@colyseus/better-call/dist/adapters/node/request.{mjs,cjs}`
- Playground backend (the `connection: close` workaround that doesn't suffice):
  `node_modules/.bun/@colyseus+playground@0.18.4+*/node_modules/@colyseus/playground/src-backend/index.ts`
- Previous layer — the trailing-slash 404 (routes never registering the bare
  `/playground` path) was fixed in `apps/server/src/index.ts` via
  `skipTrailingSlashes: true`, documented in `apps/server/AGENTS.md`.