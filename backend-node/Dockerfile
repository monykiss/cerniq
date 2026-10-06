# CERNIQ Backend Node.js Dockerfile
#
# Security posture (FAANG baseline, 2026-04-17):
#   - Multi-stage build so the final image only contains production deps.
#   - Final image runs as the `node` user (uid 1000) shipped by the
#     node:alpine base, NOT root. If an RCE slips past validation, the
#     attacker lands in a non-root sandbox.
#   - dumb-init is PID 1 so SIGTERM/SIGINT reach the node process cleanly
#     and `app.enableShutdownHooks()` can drain in-flight requests during
#     Railway redeploys.
#   - Only the app bundle + required node_modules are copied into the
#     final image; no source, .env, or dev tooling.

FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (includes dev deps for prisma generate + build)
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY . .
RUN npx prisma generate && npm run build

# ─── Production image ───────────────────────────────────────────────
FROM node:20-alpine AS production

# dumb-init: a tiny init that forwards signals to the app so SIGTERM
# during a Railway redeploy triggers NestJS's graceful shutdown hooks
# instead of a hard SIGKILL that drops in-flight requests.
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy Prisma schema, config + migrations for runtime migrate
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy built application
COPY --from=builder /app/dist ./dist

# Fail the BUILD if a runtime data asset is missing from the image.
#
# `nest build` copies nest-cli.json `assets` relative to sourceRoot, but tsconfig
# emits compiled JS under dist/src/ (no explicit rootDir), so an asset can land in
# dist/ while its consumer reads join(__dirname, ...) under dist/src/ — the image
# builds and pushes fine, then the container dies at import time with ENOENT and
# Railway only surfaces it as "1/1 replicas never became healthy" after a 5-minute
# healthcheck window. Asserting here turns that into an immediate, legible failure.
RUN test -f dist/src/alm/data/registry/pr-cooperativas-q2-2025.json \
  || (echo "FATAL: cooperativa registry JSON missing from dist/src — check nest-cli.json assets outDir" && exit 1)

# Transfer file ownership to the non-root `node` user (uid 1000). The
# chown happens here once rather than in each COPY to keep image layers
# cache-friendly.
RUN chown -R node:node /app

# Drop root. Every subsequent RUN/CMD/ENTRYPOINT executes as `node`.
USER node

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check — wget is present in alpine; spider mode hits /health
# without downloading the body. Thresholds tuned for Railway's 5-minute
# deployment window.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

# dumb-init as PID 1 + prisma migrate deploy at boot + node server.
# Note: with horizontal scaling, prisma migrate deploy races across
# replicas. Prisma's _prisma_migrations table uses row-level locking
# to serialize — first-to-acquire-lock applies, others no-op. Safe
# but slow on large migrations; consider separating into a one-shot
# deploy job if migrations exceed 30s.
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
