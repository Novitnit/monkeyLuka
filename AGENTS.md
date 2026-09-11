# AGENTS.md — monkeyLuka monorepo

If any changes are made, update AGENTS.md every time.

Guidance for humans and AI agents working in this repository. Read this before
editing: it explains how the Bun workspace monorepo works and the conventions
you must follow.

## Docs navigation

Start here, then follow the link that matches what you're working on:

| Doc | What it's for |
|---|---|
| `AGENTS.md` | Monorepo dev guide (this file) — conventions, commands, gotchas |
| `architecture.md` | System architecture — processes, workspaces, data flow |
| `CLAUDE.md` | Claude Code entry stub → points at `AGENTS.md` |
| `apps/web/AGENTS.md` | `@monkeyluka/web` — Next.js 16 frontend + Elysia REST API under `/api` |
| `apps/server/AGENTS.md` | `@monkeyluka/server` — Colyseus realtime only, `defineServer` format |
| `packages/shared/AGENTS.md` | `@monkeyluka/shared` — framework-agnostic shared code |
| `map/AGENTS.md` | Tiled game-map data + art (not a Bun workspace) |

Read the workspace `AGENTS.md` before editing inside that workspace; read
`architecture.md` for a system-level view of how the pieces fit together.

## What this repo is

A single-repo workspace managed by **Bun workspaces**. Everything is
TypeScript and runs on **Bun**. There is **no build step** for internal
packages.

```
monkeyLuka/
├── package.json          # workspace root (scripts, shared dev deps)
├── bun.lock              # single lockfile for the whole repo — commit it
├── AGENTS.md             # monorepo dev guide (this file); per-workspace AGENTS.md for details
├── architecture.md       # system architecture: processes, data flow, design decisions
├── CLAUDE.md             # navigation entry point → AGENTS.md (Claude Code compat)
├── map/                  # tracked Tiled game-map data + art → map/AGENTS.md
├── apps/
│   ├── web/              # @monkeyluka/web  — Next.js 16 (App Router) frontend + Elysia REST API under /api → apps/web/AGENTS.md
│   └── server/           # @monkeyluka/server — Colyseus realtime matchmaker + rooms (defineServer) → apps/server/AGENTS.md
└── packages/
    └── shared/           # @monkeyluka/shared — framework-agnostic shared code → packages/shared/AGENTS.md
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
5. Give the new workspace its own `AGENTS.md` (mirror `apps/server/AGENTS.md`
   or `packages/shared/AGENTS.md`) and link it from this file.

## Internal packages: no build, raw TypeScript

**`packages/` do not need to be built, and you should not add build steps to
them.** They ship raw `.ts` files because Bun runs TypeScript natively. The
pattern and its rules are documented in `packages/shared/AGENTS.md`; the rules
every consumer must respect:

- **Never `emit`/compile to `dist/` for internal packages** — you'd create a
  duplicate module identity and break `instanceof` checks across workspaces.
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

## Conventions & gotchas (repo-wide)

- **TypeScript configs** follow the Bun baseline (`module: "Preserve"`,
  `moduleResolution: "bundler"`, `verbatimModuleSyntax`, `noEmit`,
  `types: ["bun"]` via `@types/bun`). The baseline enables
  `noImplicitOverride` — class members overriding base classes (e.g. Colyseus
  lifecycle methods) must be marked `override`.
- **Commit `bun.lock`** — it pins every dependency for all workspaces.
- **Don't gitignore `node_modules` subtree noise** beyond the root
  `.gitignore` rules; `.next/`, `node_modules/`, and `.env*` are already
  covered.
- Keep secrets out of source; use `.env` files (gitignored, `.env.example`
  can be committed).

Workspace-specific gotchas (Next.js typegen / LAN dev, Colyseus internals,
`transpilePackages`) live in the respective workspace `AGENTS.md`.