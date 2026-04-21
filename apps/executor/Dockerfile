# syntax=docker/dockerfile:1.7
# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/executor/package.json ./apps/executor/
COPY apps/web/package.json ./apps/web/
RUN npm ci

COPY apps/executor ./apps/executor
RUN npm run build --workspace @codee/executor

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4100

# IMPORTANT: this container needs access to the host's Docker socket so it can
# spawn sibling containers. Mount -v /var/run/docker.sock:/var/run/docker.sock
# when running (or pass DOCKER_HOST). Running the executor with socket access
# is effectively root-equivalent on the host — only acceptable because the
# executor itself is not exposed to untrusted input beyond its own /run API
# (which is behind the auth-gated collab server in production).
RUN apk add --no-cache curl

COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/executor/package.json ./apps/executor/
COPY apps/web/package.json ./apps/web/
RUN npm ci --omit=dev --workspace @codee/executor --include-workspace-root

COPY --from=builder /app/apps/executor/dist ./apps/executor/dist

EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:4100/health >/dev/null || exit 1
CMD ["node", "apps/executor/dist/index.js"]
