# apps/server — the Colyseus realtime server. Bun runs the raw-TS source
# directly (packages/shared ships no build step, so there is nothing to
# compile — no dist/, no typecheck in the image).
FROM oven/bun:1.3-alpine

WORKDIR /app

# Lockfile-first install: root manifests + all workspace package.jsons + the
# `bun patch` diffs (patchedDependencies in the root package.json).
COPY package.json bun.lock ./
COPY patches ./patches
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile --production

# Source, the raw-TS shared workspace package, and the map/question assets
# (the defaults resolve four levels up from src/game/ → /app/Assets).
COPY apps/server/src apps/server/src
COPY packages/shared/src packages/shared/src
COPY Assets ./Assets

# bun:sqlite cannot create a missing parent dir on open; dev creates this
# locally and the compose named volume mounts over it at runtime.
RUN mkdir -p apps/server/data

ENV NODE_ENV=production
EXPOSE 3001

WORKDIR /app/apps/server
CMD ["bun", "run", "src/index.ts"]