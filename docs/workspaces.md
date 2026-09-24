# Bun workspace mechanics (monkeyLuka)

How dependencies, patches, and new workspaces are managed in this monorepo.
Read the root `AGENTS.md` first — this file holds the mechanics behind the
Commands table there.

### Adding a dependency

CD into the target workspace, then `bun add` (or `bun add -d`):

```sh
cd apps/server && bun add some-package
cd apps/web && bun add -d some-plugin
```

This installs everywhere, updates only that workspace's `package.json`, and
records the resolution in the root `bun.lock`. Do **not** run `bun install`
inside a workspace — run it at the root.

### Patching a dependency

When a dependency has an upstream bug we can't wait for, patch it with
`bun patch` (committed to `patches/`, pinned via `patchedDependencies` in the
root `package.json` + `bun.lock`, applied automatically on `bun install`):

```sh
EDITOR=true bun patch <pkg>        # switches it to editable mode
# edit the extracted copy under node_modules/<pkg>
bun patch --commit 'node_modules/<pkg>'   # writes patches/… and pins it
bun install                        # relinks the patched copy (run from root)
```

Notes: the editable copy alone can't resolve its own deps (they live in the
`.bun` store) — always `bun install` after `--commit`; patch both the `.mjs`
and `.cjs` build outputs when both exist. Every patch needs a write-up in
`discoveries/` and a pointer from the owning workspace's `AGENTS.md`.

### Adding a new workspace

1. Create `apps/foo/` or `packages/foo/` with its own `package.json`
   (`name`, `type: "module"`, `private: true`, `scripts`).
2. Copy the `tsconfig.json` baseline from `apps/server` or `packages/shared`.
3. Add the workspace name to a consumer's deps with `"workspace:*"`.
4. `bun install` at the root.
5. Give the new workspace its own `AGENTS.md` (mirror `apps/server/AGENTS.md`
   or `packages/shared/AGENTS.md`) and link it from this file.

