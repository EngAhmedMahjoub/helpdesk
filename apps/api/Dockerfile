# The API image (task 8.2). Build from the repo root, since the API imports the
# packages/shared workspace and installs against the root lockfile:
#
#   docker build -f apps/api/Dockerfile -t helpdesk-api .
#
# Migrations are not run here: the pipeline runs `prisma migrate deploy` against
# Neon before deploying (8.7), so the image carries no Prisma CLI.

# Pinned to the Bun the repo is developed and tested on, not a floating tag.
FROM oven/bun:1.4.2-slim AS base
WORKDIR /app

# Every workspace's package.json, not just the API's: --frozen-lockfile checks
# the lockfile against all of them and refuses a set with one missing.
FROM base AS manifests
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/e2e/package.json apps/e2e/
COPY packages/shared/package.json packages/shared/

# All of the API's dependencies, for the Prisma CLI that generates the client.
FROM manifests AS build
RUN bun install --frozen-lockfile --filter '@helpdesk/api'
COPY packages/shared packages/shared
COPY apps/api apps/api
# The client is gitignored, so it is generated here. prisma.config.ts reads
# DATABASE_URL, but generating never connects, so any well-formed URL will do.
RUN cd apps/api && DATABASE_URL=postgresql://build@localhost/build bun --bun run prisma generate

# Production dependencies only: no Prisma CLI, TypeScript or test tools.
FROM manifests AS prod-deps
RUN bun install --frozen-lockfile --production --filter '@helpdesk/api'

FROM base AS release
ENV NODE_ENV=production
# Bun's isolated installs keep packages in the root node_modules/.bun and link
# each workspace's node_modules into it, so both levels come across.
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules packages/shared/node_modules
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
COPY --from=build /app/apps/api/src/generated apps/api/src/generated
# Read from disk at startup; the API refuses to start without it.
COPY apps/api/knowledge-base apps/api/knowledge-base

# The commit's short SHA, passed by the deploy workflow, so a Sentry event
# names the deploy it came from. Empty in an image built by hand.
ARG SENTRY_RELEASE=
ENV SENTRY_RELEASE=$SENTRY_RELEASE
WORKDIR /app/apps/api
USER bun
EXPOSE 3000
CMD ["bun", "src/index.ts"]
