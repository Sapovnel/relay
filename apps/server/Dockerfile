# syntax=docker/dockerfile:1.7
# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install with full workspace graph so the server's deps (including dev deps
# for tsc) resolve. We only keep prod artifacts in the final stage.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/executor/package.json ./apps/executor/
COPY apps/web/package.json ./apps/web/
RUN npm ci

COPY apps/server ./apps/server
RUN npm run build --workspace @codee/server

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# Install ONLY prod deps for a small image.
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/executor/package.json ./apps/executor/
COPY apps/web/package.json ./apps/web/
RUN npm ci --omit=dev --workspace @codee/server --include-workspace-root

COPY --from=builder /app/apps/server/dist ./apps/server/dist

RUN addgroup -S codee && adduser -S codee -G codee
USER codee
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/health >/dev/null || exit 1
CMD ["node", "apps/server/dist/index.js"]
