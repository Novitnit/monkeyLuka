# apps/web — Next.js 16 + Elysia /api. Uses `output: "standalone"` so the
# runtime image is just the traced Next server + static assets.
#
# Two runtimes on purpose: deps install with Bun (the repo lockfile is
# bun.lock), but the `next` bin's shebang is `#!/usr/bin/env node`, so the
# build stage also carries an Alpine Node. The runtime stage is plain Node:
# the leaderboard page reads the runs SQLite via node:sqlite.

FROM oven/bun:1.3-alpine AS build
RUN apk add --no-cache nodejs

WORKDIR /app

# Lockfile-first install (full — next build type-checks with the app's
# typescript devDep). All workspace manifests must exist for bun install.
COPY package.json bun.lock ./
COPY patches ./patches
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile

# Full source: the web app, the raw-TS shared package (transpilePackages),
# and the Assets tree that apps/web/public symlinks point at.
COPY apps/web apps/web
COPY packages/shared packages/shared
COPY Assets ./Assets

# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
# Pass the tunnel hostname that maps to server:3001, e.g.
#   docker compose build --build-arg NEXT_PUBLIC_COLYSEUS_ENDPOINT=wss://ws.example.com
# When empty we `unset` it so the client keeps its dev fallback
# (ws://<page-hostname>:2567) instead of wiring in an empty string.
ARG NEXT_PUBLIC_COLYSEUS_ENDPOINT
RUN cd apps/web && \
  if [ -n "$NEXT_PUBLIC_COLYSEUS_ENDPOINT" ]; then export NEXT_PUBLIC_COLYSEUS_ENDPOINT; else unset NEXT_PUBLIC_COLYSEUS_ENDPOINT; fi && \
  bun run build

# --- runtime: the standalone Next server on Node ---
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/Assets ./Assets
COPY --from=build /app/apps/web/public apps/web/public

CMD ["node", "apps/web/server.js"]