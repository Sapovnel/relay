# syntax=docker/dockerfile:1.7
# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/executor/package.json ./apps/executor/
COPY apps/web/package.json ./apps/web/
RUN npm ci

COPY apps/web ./apps/web
RUN npm run build --workspace @relay/web

# ---- runner ----
FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
