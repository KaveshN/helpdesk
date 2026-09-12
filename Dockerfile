# syntax=docker/dockerfile:1
# Two useful targets:
#   dev    -> hot-reloading Next dev server, full node_modules (incl. prisma CLI)
#   runner -> slim production image built from Next's standalone output
#
# Prisma 7 uses the WASM query compiler plus the `pg` driver adapter, so there is
# no Rust query engine binary to copy between stages -- alpine is safe here.

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependencies ----------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- dev image -------------------------------------------------------------
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# -H 0.0.0.0 is not optional in a container: bound to localhost only, the
# published port maps to nothing and you get a silent connection refused.
# The port itself stays in package.json so there is one place to change it.
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]

# --- production build ------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# The build must not need a live database: every authenticated page is
# force-dynamic, so nothing is prerendered against Postgres.
RUN npm run build

# --- migration runner -----------------------------------------------------
# Separate image because the Prisma CLI needs the full dependency tree, and
# cherry-picking node_modules subdirectories into the runtime image silently
# misses transitive deps. Migrations are an explicit job in production, never
# implicit on container start: concurrent replicas racing `migrate deploy` is a
# real outage.
#
#   docker build --target migrator -t helpdesk-migrate .
#   docker run --rm --env-file .env helpdesk-migrate
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY prisma.config.ts package.json ./
CMD ["npx", "prisma", "migrate", "deploy"]

# --- background worker ----------------------------------------------------
# Runs src/worker via tsx on the full dependency tree. Small enough for now;
# a bundled build can replace it if image size ever matters.
FROM base AS worker
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
USER node
CMD ["npx", "tsx", "src/worker/index.ts"]

# --- production runtime ---------------------------------------------------
FROM base AS runner
# 3001 rather than Next's default 3000: the container, the host dev server and
# AUTH_URL all use one port, so there is a single Entra redirect URI to register.
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3001
CMD ["node", "server.js"]
