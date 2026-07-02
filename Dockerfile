# syntax=docker/dockerfile:1

# ---- Stage 1: build the web frontend ----
FROM node:20-alpine AS builder

RUN corepack enable

WORKDIR /app

# Copy lockfile + workspace manifest first for cache-friendly install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY companion/package.json ./companion/package.json

RUN pnpm install --frozen-lockfile

# Copy the rest of the source (web app only; companion/desktop not needed for static build)
COPY . .

RUN pnpm build

# ---- Stage 2: serve static dist with nginx ----
FROM nginx:alpine AS web

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA-friendly fallback (project uses base: './' so deep links resolve relatively)
RUN printf 'server {\n\
  listen 80;\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / { try_files $uri $uri/ /index.html; }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

# ---- Stage 3 (optional): companion CLI ----
# NOTE: companion/src/server.ts hardcodes host 127.0.0.1. To use it inside a
# container you must first add a --host option and bind 0.0.0.0, otherwise the
# host browser cannot reach 127.0.0.1:19750 (that points at the host, not the
# container). See docker-compose.yml for the optional companion service.
FROM node:20-alpine AS companion

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY companion/package.json ./companion/package.json

RUN pnpm install --frozen-lockfile --filter @honlnk/image-studio-companion...

COPY companion ./companion

RUN pnpm --filter @honlnk/image-studio-companion build

EXPOSE 19750
