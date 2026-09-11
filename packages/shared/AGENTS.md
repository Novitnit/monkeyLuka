# AGENTS.md — @monkeyluka/shared

Guidance for agents editing `packages/shared`. Repo-wide conventions (Bun
workspaces, installs, commands, tsconfig baseline) live in the root
`AGENTS.md` — read it before this one.

## No build step — raw TypeScript

**Do not build this package; do not add a build step.** It ships raw `.ts`
files because Bun runs TypeScript natively. The `exports` map points straight
at the source:

```jsonc
// packages/shared/package.json
"exports": {
  ".": {
    "types": "./src/index.ts",
    "default": "./src/index.ts"   // Bun loads the .ts directly
  }
}
```

Any Bun-runtime workspace can `import { greeting } from "@monkeyluka/shared"`
and it just works — Bun transpiles on the fly. `tsc --noEmit` typechecks it in
place because every tsconfig here uses `"moduleResolution": "bundler"`
(Turbopack/webpack-style resolution understands `.ts` in `exports`).

## Rules you must respect

- **Never `emit`/compile to `dist/`** — you'd create a duplicate module
  identity and break `instanceof` checks across workspaces.
- Keep this package **framework-agnostic**: no Next.js or Elysia imports.
  The one deliberate exception is `@colyseus/schema` — the jungle room's state
  schema (`JungleState`/`PlayerInfo`, plus `ROOM_NAMES.jungle` and
  `MAX_PLAYER_NAME_LENGTH`) lives here as the single source of truth shared
  between server and web client. It's the serialization format, not server
  logic; don't import anything else Colyseus-related.
- Type-only imports/exports use `import type` / `export type` because
  `verbatimModuleSyntax` is enabled (see `src/index.ts` for the pattern).

## Consumers

- **server** — imports `JungleRoom`'s state, `ROOM_NAMES`, `MAX_PLAYER_NAME_LENGTH`
  directly (Bun handles `.ts`).
- **web** — imports `JungleState` (as the SDK join root-schema), `ROOM_NAMES`,
  `MAX_PLAYER_NAME_LENGTH`. Turbopack doesn't follow bare `.ts` exports on its
  own, so `@monkeyluka/shared` is in `transpilePackages` in `apps/web/next.config.ts`.
- **server + web** — `compileOriginAllowlist(rawHosts)` compiles the shared
  `ALLOWED_ORIGIN_HOST` env var (comma-separated host allowlist; `*`/unset =
  any origin) into the matcher for the Colyseus WebSocket handshake gate and
  the Elysia `/api` CORS. Keep it framework-agnostic (pure string/RegExp).

## Commands

From this dir: `bun run typecheck`. From the repo root: `bun run typecheck:shared`.