# 部署指南

> 本文档覆盖 GPT Image Studio 的两种部署形态：**本机模式**（单用户本地工具）与**服务器模式**（多用户 SaaS 后端 + qiankun 嵌入前端）。
>
> 架构背景见 [`evolution-roadmap.md`](./evolution-roadmap.md) 第六~八章 + [`evolution/phase3-overview.md`](./evolution/phase3-overview.md)。

---

## 目录

1. [部署形态总览](#1-部署形态总览)
2. [本机模式（单用户）](#2-本机模式单用户)
3. [服务器模式：Companion 部署](#3-服务器模式companion-部署)
4. [服务器模式：前端嵌入](#4-服务器模式前端嵌入)
5. [宿主侧改造指引](#5-宿主侧改造指引)
6. [故障排查](#6-故障排查)

---

## 1. 部署形态总览

| 形态 | Companion 监听 | 认证模型 | 多租户 | 适用场景 |
|---|---|---|---|---|
| **本机模式（local）** | `127.0.0.1` | accessKey（loopback 信任） | 否（虚拟用户 `__local__`） | 个人本地工具，阶段二默认 |
| **服务器模式（server）** | `0.0.0.0`（可配） | JWT（HS256，宿主签发） | 是（users 表 + 目录隔离） | 多用户 SaaS，对接宿主用户体系 |

部署形态由环境变量 `COMPANION_DEPLOYMENT_MODE` 控制（默认 `local`）。

---

## 2. 本机模式（单用户）

本机模式是阶段二的默认行为，无需特殊配置。

### 2.1 安装与启动

```bash
# 安装依赖
pnpm install

# 启动 Companion（前台，监听 127.0.0.1:19750）
pnpm dev:companion

# 或用 CLI 后台启动
cd companion && pnpm build && node dist/main.js start
```

### 2.2 启动前端

```bash
pnpm dev    # Vite dev server，http://127.0.0.1:8888
```

打开 `http://127.0.0.1:8888`，在设置 → API 中选择「本地 Companion」连接模式，粘贴启动日志里的连接密钥。

### 2.3 凭据管理

- Provider 凭据（OpenAI/GLM/Doubao 等）：访问 `http://127.0.0.1:19750/admin` 管理。
- OSS 凭据（本机模式选项 C）：同在管理页配置，存 `~/.gpt-image-studio/oss-credentials.json`（0600）。

---

## 3. 服务器模式：Companion 部署

服务器模式让 Companion 可远程访问、支持多用户、对接宿主 JWT 认证。

> **管理页边界**：Companion 自带管理页（`/admin` 页面 + `/admin/api/*`）是本机
> 单用户管理面（数据集视图固定 `__local__` 虚拟用户），**server 模式下不注册（404）**。
> 多租户的存储位置/数据集由宿主或 `POST /storage/datasets/activate`（带用户 JWT）按
> 用户管理；平台级操作走 `/admin/revoke`（`ADMIN_API_KEY`，§5.3）。

### 3.1 Docker 部署（推荐）

#### 3.1.1 拉取镜像 + 配置

创建 `docker-compose.yml`：

```yaml
services:
  companion:
    build:
      context: .
      target: companion
    # 或用预构建镜像：image: honlnk/gpt-image-studio-companion:latest
    container_name: gpt-image-studio-companion
    ports:
      - "19750:19750"
    volumes:
      - companion-data:/data    # 持久化 SQLite + 图片 + 凭据
    environment:
      # ─── 部署形态 ───
      - COMPANION_DEPLOYMENT_MODE=server
      - COMPANION_HOST=0.0.0.0          # 监听所有网卡（容器内）

      # ─── JWT 认证（必填）───
      - JWT_SECRET=<与宿主共享的 HS256 密钥>      # 32+ 字符随机串
      - ADMIN_API_KEY=<平台级管理密钥>             # 宿主调 /admin/revoke 用

      # ─── 宿主对接（OSS STS 用，filesystem 模式可不填）───
      - MAIN_APP_URL=https://your-host.example.com   # 宿主地址
      - MAIN_APP_API_KEY=<Companion 调宿主的凭证>

      # ─── 数据持久化 ───
      - GPT_IMAGE_STUDIO_CONFIG_DIR=/data            # 挂载点

      # ─── CORS（允许宿主前端域名）───
      # 通过 --allow-origin 传入（见 command）
    restart: unless-stopped
    command: >
      node dist/main.js serve
      --host 0.0.0.0
      --port 19750
      --deployment-mode server
      --allow-origin https://your-host.example.com

volumes:
  companion-data:
```

#### 3.1.2 启动

```bash
docker compose up -d
docker compose logs -f companion   # 查看启动日志
```

#### 3.1.3 验证

```bash
# 健康检查（无需认证）
curl http://localhost:19750/health
# {"app":"gpt-image-studio-companion","version":"x.y.z"}

# 带 JWT 访问（用宿主签发的 JWT）
curl -H "Authorization: Bearer <jwt>" http://localhost:19750/auth/me
# {"userId":"user-1","displayName":"Alice"}
```

### 3.2 非 Docker 部署（Node 直跑）

```bash
cd companion
pnpm build

export COMPANION_DEPLOYMENT_MODE=server
export JWT_SECRET="<与宿主共享的密钥>"
export ADMIN_API_KEY="<平台管理密钥>"
export MAIN_APP_URL="https://your-host.example.com"
export MAIN_APP_API_KEY="<宿主凭证>"

node dist/main.js serve --host 0.0.0.0 --port 19750 \
  --deployment-mode server \
  --allow-origin https://your-host.example.com
```

### 3.3 Nginx 反向代理（生产推荐）

生产环境前置 nginx，负责 TLS 终止、限流、日志：

```nginx
server {
    listen 443 ssl http2;
    server_name companion.your-domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 限流：每 IP 每秒 10 请求
    limit_req zone=companion burst=20 nodelay;

    location / {
        proxy_pass http://127.0.0.1:19750;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 图片编辑是长请求，加大超时
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # WebSocket / 流式响应支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 3.4 环境变量速查

| 变量 | 必填 | 说明 |
|---|---|---|
| `COMPANION_DEPLOYMENT_MODE` | 是（server） | `local` 或 `server` |
| `COMPANION_HOST` | 否 | 监听地址（server 默认 `0.0.0.0`） |
| `JWT_SECRET` | 是（server） | HS256 验签密钥，与宿主共享 |
| `ADMIN_API_KEY` | 是（server） | 平台级管理密钥，宿主调 `/admin/revoke` |
| `MAIN_APP_URL` | OSS 模式必填 | 宿主地址（STS 签发接口） |
| `MAIN_APP_API_KEY` | OSS 模式必填 | Companion 调宿主的凭证 |
| `GPT_IMAGE_STUDIO_CONFIG_DIR` | 否（Docker 默认 `/data`） | 数据根目录 |
| `COMPANION_OSS_LONG_TERM_AK` | 否（默认关闭，**仅本地调试**） | `1`/`true` 时 server 模式的 OSS 允许用 `oss-credentials.json` 长期 AK（违背 D11，生产禁用；无宿主 STS 时的本地演示逃生门） |

---

## 4. 服务器模式：前端嵌入

前端提供两种分发方式（D14）。

### 4.1 CDN 嵌入（默认，免部署）

宿主直接通过 qiankun 加载 `https://image.honlnk.com`（GitHub Pages）的构建产物。

**宿主侧 qiankun 注册**（以 Vben/RuoYi-Plus 为例）：

```ts
// 宿主 micro-app 注册配置
{
  name: 'gpt-image-studio',
  entry: 'https://image.honlnk.com',   // CDN 入口
  container: '#image-studio-container',
  activeRule: '/image-studio',
  props: {
    // 嵌入态注入：Companion 地址 + 当前用户 JWT
    companionUrl: 'https://companion.your-domain.com',
    jwt: getCurrentUserJwt(),           // 宿主签发的 JWT
  },
}
```

前端检测到 `__POWERED_BY_QIANKUN__` 后，从 `props` 读取 `companionUrl` + `jwt`，注入 settingsStore，固定 `localCompanion` 模式。

### 4.2 自部署（私有化）

适用于内网/对 CDN 不信任的场景。

```bash
# 构建 Web 镜像
docker build --target web -t gpt-image-studio-web:latest .

# 运行（nginx 静态托管）
docker run -d -p 8080:80 gpt-image-studio-web:latest
```

宿主 qiankun 入口改为自部署地址：

```ts
{
  name: 'gpt-image-studio',
  entry: 'https://your-internal-domain/image-studio',  // 自部署
  // ...其余同上
}
```

### 4.3 独立运行模式（非嵌入）

前端不嵌入宿主时，直接访问 `https://image.honlnk.com`（或自部署地址），行为同本机模式——用户自行配置 Companion 地址 + 连接密钥。

---

## 5. 宿主侧改造指引

宿主（如 RuoYi-Plus）需要开发/配置以下内容。

### 5.1 JWT 签发（SSO 登录）

宿主作为 IdP，登录成功后签发 JWT 给前端：

```json
// JWT Header
{ "alg": "HS256", "typ": "JWT" }

// JWT Payload
{
  "sub": "user-12345",              // 必填：用户 id
  "display_name": "张三",            // 可选：显示名（避免 Companion 反查）
  "jti": "uuid-abc",                // 可选：JWT 唯一 id（单 JWT 吊销用）
  "iat": 1753600000,
  "exp": 1753601800                 // 建议有效期 30min~1h
}
```

**签名密钥**：与 Companion 的 `JWT_SECRET` 共享同一 HS256 密钥。

前端拿到 JWT 后，通过 qiankun props 传给子应用（见 §4.1）。

### 5.2 令牌刷新（前端 ↔ 宿主）

JWT 过期前，前端静默调宿主的 refresh 接口拿新 JWT：

```
POST {宿主}/auth/refresh
Authorization: Bearer <refresh_token>
→ { "jwt": "<新 JWT>" }
```

Companion 不参与刷新流程。刷新失败（用户已登出）时，前端跳转宿主登录页。

### 5.3 单点登出（SLO）—— /admin/revoke

宿主在以下场景调 Companion 的吊销端点：

```
POST {Companion}/admin/revoke
Authorization: Bearer <ADMIN_API_KEY>     ← 平台级管理密钥（区别于用户 JWT）
Content-Type: application/json

{
  "user_id": "user-12345",      // 按用户吊销（登出/封禁/改密）
  "jwt_jti": "uuid-abc",        // 可选：按单个 JWT 吊销（单设备登出）
  "ttl_seconds": 3600           // 可选：黑名单保留时长
}
```

**触发时机**：
- 用户主动登出 → `{ "user_id": "xxx" }`
- 用户被管理员封禁 → `{ "user_id": "xxx" }`
- 用户改密码 → `{ "user_id": "xxx" }`（让旧 JWT 失效，强制重新登录）
- 单设备登出（其他设备保持）→ `{ "jwt_jti": "xxx" }`

响应：`{ "ok": true, "revoked": ["user:user-12345"] }`

### 5.4 OSS STS 签发接口（OSS 模式）

如果使用 OSS 存储（非 filesystem），宿主需提供 STS 签发接口：

```
GET {宿主}/api/sts/upload-token
Authorization: Bearer <MAIN_APP_API_KEY>    ← 平台级密钥
X-User-Id: user-12345                        ← 当前用户

响应：
{
  "accessKeyId": "STS.xxx",           // 临时 AK
  "accessKeySecret": "xxx",           // 临时 SK
  "securityToken": "xxx",             // STS token
  "expiration": "2026-07-27T12:30:00Z",  // ISO8601，建议 15min~1h
  "bucket": "platform-bucket",
  "region": "oss-cn-hangzhou",
  "prefix": "users/user-12345/"       // 限定该用户前缀（隔离）
}
```

**关键**：
- 长期 AccessKey 只存宿主，Companion 永远不持有。
- `prefix` 必须限定到当前用户（`users/<user-id>/`），实现 OSS 层面的用户隔离。
- 宿主可随时停止对该用户签发 STS，立即收回上传能力。
- Companion 缓存 STS 到 `expiration - 5min`，过期前自动续期。

### 5.5 JWT claim 约定速查

| claim | 必填 | 说明 |
|---|---|---|
| `sub` | 是 | 用户 id（Companion 据此定位用户数据目录） |
| `display_name` | 否 | 显示名（避免 Companion 反查宿主） |
| `jti` | 否 | JWT 唯一 id（单 JWT 吊销用） |
| `exp` | 否 | 过期时间（Unix 秒）。无 exp 视为长期有效 |
| `iat` | 否 | 签发时间 |

---

## 6. 故障排查

### 6.1 CORS 错误

**症状**：浏览器控制台报 `Access-Control-Allow-Origin` 错误。

**原因**：Companion 的 CORS 白名单不含宿主域名。

**解决**：启动时加 `--allow-origin https://your-host.example.com`，或检查 `securityConfig.ts` 的 origin 列表。

### 6.2 资源 404（嵌入态）

**症状**：qiankun 加载子应用后，JS/CSS 资源 404。

**原因**：构建产物资源路径是绝对路径（`/assets/xxx.js`），从 CDN 加载时请求到了宿主域名。

**解决**：确认使用 qiankun 的 `import-entry` 机制（默认会重写资源路径）。若仍 404，检查宿主 qiankun 配置的 `entry` 是否指向正确的入口 HTML。

### 6.3 qiankun 加载后子应用空白 / 报「生命周期未导出」

**症状**：qiankun 注册并激活子应用后，容器空白，控制台报 `qiankun: need a lifecycle (bootstrap/mount/unmount)` 之类错误。

**原因**：Vite 按「应用入口」打包，产物是 IIFE 脚本，顶层 `export` 会被剥离，qiankun 的 import-entry 无法从产物里发现生命周期。

**解决**：本项目已用 `window[appName]` 全局挂载兜底（见 `src/main.ts` 末尾）。**宿主 `registerMicroApps({ name })` 的 `name` 必须与子应用约定的 `gpt-image-studio` 完全一致**，否则 import-entry 在 `window[name]` 上找不到生命周期。

### 6.4 JWT 验签失败

**症状**：`/auth/me` 返回 401「JWT 签名不匹配」。

**排查**：
1. 确认宿主签发 JWT 用的密钥 = Companion 的 `JWT_SECRET`。
2. 确认 JWT 的 `alg` 是 `HS256`（不支持 `none`/`RS256`）。
3. 用 [jwt.io](https://jwt.io) 解码 JWT，检查 header 的 alg 字段。

```bash
# 快速验证：用宿主的密钥签发测试 JWT，curl 调 /auth/me
curl -H "Authorization: Bearer <jwt>" https://companion.your-domain.com/auth/me
```

### 6.5 用户登出后仍能访问（SLO 未生效）

**症状**：用户在宿主登出后，Companion 仍接受其 JWT。

**原因**：宿主登出时未调 `/admin/revoke`。

**解决**：宿主登出逻辑里加：
```ts
await fetch(`${companionUrl}/admin/revoke`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${ADMIN_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ user_id: userId }),
});
```

### 6.6 多租户数据隔离验证

**验证方法**：用两个不同用户的 JWT，各自访问 `/storage/datasets`，确认只能看到自己的数据集。

```bash
# 用户 A
curl -H "Authorization: Bearer <jwtA>" https://companion.../storage/datasets
# {"datasets":[{...A的数据集...}]}

# 用户 B
curl -H "Authorization: Bearer <jwtB>" https://companion.../storage/datasets
# {"datasets":[{...B的数据集...}]}   ← 不含 A 的
```

**物理隔离验证**：服务器数据目录下，每个用户有独立的 `users/<user-id>/datasets/` 子目录。

### 6.7 OSS 上传失败

**症状**：图片上传报错「宿主 STS 签发失败」。

**排查**：
1. 确认 `MAIN_APP_URL` + `MAIN_APP_API_KEY` 已配置。
2. 确认宿主的 `/api/sts/upload-token` 接口可达，返回 200。
3. 检查 Companion 启动日志有无 warning（server 模式缺 MAIN_APP_URL 会 warning）。
4. 若用 filesystem 模式（非 OSS），确认服务器数据目录可写。

### 6.8 数据持久化丢失（Docker）

**症状**：容器重启后数据消失。

**原因**：未挂载 `/data` 卷。

**解决**：docker-compose.yml 的 `volumes` 必须包含 `- companion-data:/data`（对应容器内 `GPT_IMAGE_STUDIO_CONFIG_DIR=/data`）。

### 6.9 本机模式回归（local 模式不工作）

**症状**：本机模式（不设 `COMPANION_DEPLOYMENT_MODE`）行为异常。

**排查**：确认未误设 `COMPANION_DEPLOYMENT_MODE=server`。本机模式应不设此变量（或显式设为 `local`），此时监听恒为 `127.0.0.1`，认证走 accessKey，行为同阶段二。
