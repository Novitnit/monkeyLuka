# AGENTS.md — monkeyLuka monorepo

Guidance for humans and AI agents working in this repository. Read this before
editing: it explains how the Bun workspace monorepo works and the conventions
you must follow.

## What this repo is

A single-repo workspace managed by **Bun workspaces**. Everything is
TypeScript and runs on **Bun**. There is **no build step** for internal
packages.

```
monkeyLuka/
├── package.json          # workspace root (scripts, shared dev deps)
├── bun.lock              # single lockfile for the whole repo — commit it
├── AGENTS.md
├── CLAUDE.md             # imports @AGENTS.md (Claude Code)
├── apps/
│   ├── web/              # @monkeyluka/web  — Next.js 16 (App Router) frontend
│   └── server/           # @monkeyluka/server — ElysiaJS (HTTP) + Colyseus (realtime)
└── packages/
    └── shared/           # @monkeyluka/shared — framework-agnostic shared code
```

## Requirements & versions

- **Bun ≥ 1.2** (developed on 1.3.14). Node/npm/pnpm are not used.
- Key packages: `next@16`, `react@19`, `elysia@1.4`, `colyseus@0.18`,
  `@colyseus/schema@5`, `typescript@5`.

## How Bun workspaces work here

- `package.json` at the root declares `"workspaces": ["apps/*", "packages/*"]`.
- **One** `bun.lock` at the root; run `bun install` **only from the root**.
  It installs every workspace's dependencies in ~seconds (Bun installs a
  content-addressed store under `node_modules/.bun` and symlinks each
  workspace's deps into its own `node_modules`).
- **Local dependencies use the `workspace:*` protocol** — e.g.
  `apps/server/package.json` has `"@monkeyluka/shared": "workspace:*"`.
  This symlinks the package, so edits are picked up instantly with no publish
  or rebuild step.
- The root `package.json` holds only **shared dev tooling** (`typescript`,
  `@types/bun`). App-specific deps belong in that app's `package.json`.

### Adding a dependency

CD into the target workspace, then `bun add` (or `bun add -d`):

```sh
cd apps/server && bun add some-package
cd apps/web && bun add -d some-plugin
```

This installs everywhere, updates only that workspace's `package.json`, and
records the resolution in the root `bun.lock`. Do **not** run `bun install`
inside a workspace — run it at the root.

### Adding a new workspace

1. Create `apps/foo/` or `packages/foo/` with its own `package.json`
   (`name`, `type: "module"`, `private: true`, `scripts`).
2. Copy the `tsconfig.json` baseline from `apps/server` or `packages/shared`.
3. Add the workspace name to a consumer's deps with `"workspace:*"`.
4. `bun install` at the root.

## Internal packages: no build, raw TypeScript

**`packages/` do not need to be built, and you should not add build steps to
them.** They ship raw `.ts` files because Bun runs TypeScript natively.

`packages/shared` demonstrates the pattern:

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
and it just works — Bun transpiles on the fly. `tsc --noEmit` typechecks it
in place because every tsconfig here uses `"moduleResolution": "bundler"`
(Turbopack/webpack-style resolution understands `.ts` in `exports`).

Consequences you must respect:

- **Never `emit`/**compile to `dist/` for internal packages**; you'd create a
  duplicate module identity and break `instanceof` checks across workspaces.
- **Next.js caveat:** the web app's bundler (Turbopack) does not follow bare
  `.ts` exports on its own. When a Next.js app needs to import a raw-TS
  package, add it to `transpilePackages` in `apps/web/next.config.ts`:

  ```ts
  const nextConfig: NextConfig = {
    transpilePackages: ["@monkeyluka/shared"],
  };
  ```

  (Not wired up yet — `apps/web` currently has no dependency on `shared`.)
- Keep shared packages **framework-agnostic** (no Next.js or Elysia imports).
- Type-only imports should use `import type { ... }` because `verbatimModuleSyntax`
  is enabled in every tsconfig.

## Commands (run from the repository root)

| Command | What it does |
|---|---|
| `bun install` | Install everything; updates root `bun.lock` |
| `bun run dev` | Run **both** apps: `dev:web` + `dev:server` |
| `bun run dev:web` | Next.js dev server → http://localhost:3000 |
| `bun run dev:server` | Server in watch mode (`bun run --watch`) |
| `bun run build:web` | Production build of the Next.js app |
| `bun run start:server` | Run the server without watch mode |
| `bun run typecheck` | `tsc --noEmit` for web, server, and shared |

Per-workspace scripts also work from inside the app dir (`bun run dev` in
`apps/web`). Don't use `npm run`; Bun's shell runner resolves workspace bins
fine, and Bun is required for `.ts` execution anyway.

## The server app (Elysia + Colyseus)

`apps/server` is **one process** exposing two ports:

- `:3001` — **ElysiaJS** REST API (`GET /`, `GET /health`). Non-greedy: it
  uses `Bun.serve()` under the hood.
- `:2567` — **Colyseus** realtime matchmaker + WebSocket rooms. It runs its
  own `node:http` server and `ws` transport, which **does work on Bun** —
  verified end-to-end (room join + schema state sync).

Defaults: `PORT=3001`, `COLYSEUS_PORT=2567`, `HOST=0.0.0.0`. Override via env
or `.env` files (Bun auto-loads `.env` in the workspace dir).

Room state uses the **functional `schema()` API** from `@colyseus/schema`
(see `apps/server/src/rooms/ExampleRoom.ts`) — no decorators, no special
tsconfig flags. If you ever switch to the legacy `@type()` decorators, enable
`experimentalDecorators` **and** `useDefineForClassFields: false` in
`apps/server/tsconfig.json`.

Client SDK for tests/scripts: `@colyseus/sdk` (install it only where you need
it, e.g. as a devDependency of a smoke-test script).

## Conventions & gotchas

- **TypeScript configs** follow the Bun baseline (`module: "Preserve"`,
  `moduleResolution: "bundler"`, `verbatimModuleSyntax`, `noEmit`,
  `types: ["bun"]` via `@types/bun`). The baseline enables
  `noImplicitOverride` — class members overriding base classes (e.g. Colyseus
  lifecycle methods) must be marked `override`.
- **Next.js typegen:** `LayoutProps` and friend are generated by Next into
  `.next/types/` on first `next dev`/`next build`. Run one of those before
  `tsc --noEmit` in `apps/web`; a clean checkout needs a build before
  `bun run typecheck` will pass.
- **Commit `bun.lock`** — it pins every dependency for all workspaces.
- **Don't gitignore `node_modules` subtree noise** beyond the root
  `.gitignore` rules; `.next/`, `node_modules/`, and `.env*` are already
  covered.
- Keep secrets out of source; use `.env` files (gitignored, `.env.example`
  can be committed).
- Colyseus versions matter: this repo uses 0.18.x where the HTTP matchmaker
  routes are **POST-only** (`POST /matchmake/joinOrCreate/<room>`).