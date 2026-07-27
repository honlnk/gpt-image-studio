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

# ---- Stage 3: companion server (phase 3) ----
# Companion 现已支持 --host/--deployment-mode（阶段三 PR1），可绑定 0.0.0.0 供容器外访问。
# 数据持久化走 /data 卷（SQLite + 图片 + 凭据），由 GPT_IMAGE_STUDIO_CONFIG_DIR 指向。
FROM node:20-alpine AS companion

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY companion/package.json ./companion/package.json

RUN pnpm install --frozen-lockfile --filter @honlnk/image-studio-companion...

COPY companion ./companion

RUN pnpm --filter @honlnk/image-studio-companion build

# 数据持久化挂载点（SQLite master db + 业务 db + 图片文件 + 凭据）
ENV GPT_IMAGE_STUDIO_CONFIG_DIR=/data
RUN mkdir -p /data

EXPOSE 19750

# 默认监听 0.0.0.0 让容器外可访问；部署形态 local（PR2 起 server 模式接入 JWT）
CMD ["node", "dist/main.js", "serve", "--host", "0.0.0.0", "--port", "19750"]
