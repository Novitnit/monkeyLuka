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
- Keep this package **framework-agnostic**: no Next.js, Elysia, or Colyseus
  imports. It's shared between server and (potentially) client.
- Type-only imports/exports use `import type` / `export type` because
  `verbatimModuleSyntax` is enabled (see `src/index.ts` for the pattern).

## Consumers

- **server** — imports directly (Bun handles `.ts`), e.g. `APP_NAME`,
  `greeting`, `HealthStatus`.
- **web** — does **not** import this package yet. When it does: Turbopack does
  not follow bare `.ts` exports on its own, so add `@monkeyluka/shared` to
  `transpilePackages` in `apps/web/next.config.ts` (details in
  `apps/web/AGENTS.md`).

## Commands

From this dir: `bun run typecheck`. From the repo root: `bun run typecheck:shared`.