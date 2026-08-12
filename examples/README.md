# 嵌入方案示例（examples/）

本目录收录 GPT Image Studio 两种前端嵌入方案的**极简本地宿主**，用于开发联调和回归验证。两者都是纯静态文件，不进构建产物。

| 示例 | 嵌入方式 | 配置注入 | 子应用后端 |
|------|---------|---------|-----------|
| `iframe-embed/` | iframe + URL query 参数 | `?settings=<json>` 或独立参数 | 浏览器直连（apiUrl/apiKey） |
| `qiankun-host/` | qiankun 微前端 + props | `props: { companionUrl, jwt }` | Companion server 模式（JWT 鉴权） |

## iframe-embed（iframe 方案）

对应 `src/main.ts` 之外的 URL 参数注入能力（见根 README「iframe 嵌入」一节）。

```bash
pnpm dev
# 浏览器打开 http://127.0.0.1:8888/examples/iframe-embed/
```

左侧表单修改平台地址、API URL/Key、接口模式、流式预览、尺寸等参数，提交后拼成 URL query 刷新右侧 iframe。注意跨站 iframe 的 IndexedDB 会被浏览器按顶层站点分区，看到的数据可能与直接打开平台不同。

## qiankun-host（qiankun 微前端方案）

对应 `src/main.ts` 的 qiankun 生命周期导出与嵌入态逻辑（契约测试见 `src/qiankun-embed.test.ts`，部署细节见 `docs/deployment-guide.md`）。

宿主是 `index.html` + 轻量宿主服务 `serve.mjs`（qiankun 2.x UMD 已 vendor 到 `vendor/qiankun-2.10.5.umd.js`，本地加载不走 CDN）。带一个**一键登录页**：点登录按钮后，宿主服务在服务端签发 JWT（`/api/login`）→ 检查/激活 OSS 数据集 → 挂载子应用，JWT 缓存 localStorage（30 天），未过期则跳过登录页直接进主界面。配置全部走 `.env`，不再手工编辑 config.json。

> 安全说明：与正式部署一致——JWT 由宿主服务 `serve.mjs` 在服务端用 `JWT_SECRET` 签发，
> ADMIN_API_KEY 由 `serve.mjs` 代理 `/admin/**` 时注入，**浏览器全程不持有任何 secret**。
> 共享密钥存于仓库根 `gpt-image-studio/.env`（与 companion 容器共享），demo 专属配置存于
> `examples/qiankun-host/.env`。

性能说明：`qiankun.start({ sandbox: false })`——demo 只有一个子应用、无隔离需求，关掉沙箱可避免 LegacySandbox 对子应用所有 `window` 全局读写的 Proxy 损耗（嵌入态明显慢于独立态 8888 的最大单一因素）。真实宿主若需隔离，可用提速沙箱 `{ speedy: true }`（qiankun 2.x 实验特性）。

### 启动步骤（共 4 个进程/端口）

```bash
# 0. 准备 .env（一次性，已 gitignore 不进仓库）
#    仓库根：共享密钥（与 companion 容器共享）
cat > .env <<'EOF'
JWT_SECRET=<32+字符随机串>
ADMIN_API_KEY=<平台管理密钥>
EOF
#    demo 目录：demo 专属配置（可从 .env.example 复制后改）
cp examples/qiankun-host/.env.example examples/qiankun-host/.env

# 1. 子应用产物（entry，端口 4173）
pnpm build && pnpm preview

# 2. Companion server 模式（端口 19751，读仓库根 .env，--allow-origin 放行宿主 origin）
#    用 Docker（推荐，见下一节）或直跑：
cd companion && pnpm build
set -a; . ../.env; set +a   # source 仓库根 .env，避免命令行内联密钥
node dist/main.js serve --port 19751 --deployment-mode server \
  --allow-origin http://127.0.0.1:5599

# 3. 宿主服务（端口 5599，读两个 .env，托管页面 + 服务端签 JWT + 代理 /admin）
cd examples/qiankun-host && node serve.mjs
# 浏览器打开 http://127.0.0.1:5599 → 点「登录」即可
```

宿主顶栏会显示子应用挂载状态（MOUNTED）；「重新挂载子应用」按钮实际是整页刷新。

### 用 Docker 跑 Companion（推荐，替代上面的第 2 步）

项目根目录的 `docker-compose.yml` 提供了 `companion-server` 服务（server 模式专用），
共享密钥直接读仓库根 `.env`（docker compose 自动加载），无需命令行内联：

```bash
# 准备独立数据目录（与 local 模式的 ~/.gpt-image-studio 隔离），
# 把 OSS 长期 AK 和 provider 凭据放进去
mkdir -p ~/.gpt-image-studio-docker
cp ~/.gpt-image-studio/oss-credentials.json ~/.gpt-image-studio/credentials.json \
  ~/.gpt-image-studio-docker/

# 启动（端口 19751，JWT_SECRET / ADMIN_API_KEY 由仓库根 .env 注入）
docker compose --profile companion-server up -d companion-server
```

- 数据目录映射：`~/.gpt-image-studio-docker` → 容器 `/data`
- compose 里开了 `COMPANION_OSS_LONG_TERM_AK=1` 逃生门：server 模式的 OSS 存储
  允许用 `oss-credentials.json` 里的长期 AK（**仅本地调试**，违背 D11——生产环境
  OSS 必须走宿主 STS 签发，见 `docs/deployment-guide.md` §5.4）。没有宿主后端的
  本地演示才需要它。多用户共享同一把 AK 时按 `users/<userId>/` 前缀隔离。
- 各用户首次登录时没有激活数据集，宿主登录流程检测到 404 会自动调
  `POST /storage/datasets/activate` 激活 `examples/qiankun-host/.env` 里配置的 OSS 数据集，
  无需手动 curl。
  注意：Companion 自带管理页（`/admin`）是本机单用户管理面，server 模式下
  已禁用（404）——多租户存储由宿主/API 按用户管理。

### 注意

- **必须用 `http://127.0.0.1:5599` 打开宿主页，不能用 `localhost:5599`**——二者在浏览器看来是两个不同 origin，Companion 的 CORS 白名单（`--allow-origin http://127.0.0.1:5599`）只放行前者。用 localhost 打开会导致所有 Companion 请求报 `Failed to fetch`（CORS 拦截），表现为子应用"离线"、toast"读取本地数据失败"、宿主列表"加载失败"。
- JWT 由宿主服务 `serve.mjs` 服务端签发（`/api/login`），有效期 30 天并缓存 localStorage；过期后回到登录页再点一次即可。「退出登录」按钮清除缓存并刷新。`sign-jwt.mjs` 仍保留，供绕过页面手动签 token 调试用（如 `JWT_SECRET=xxx node sign-jwt.mjs` 给 curl 用）。
- 改完 `src/main.ts` 的嵌入逻辑后必须重新 `pnpm build`，preview 才会 serve 新产物。
- 嵌入态 CSS 由子应用 `main.ts` 的 `injectEmbeddedCss` 通过 `__INJECTED_PUBLIC_PATH_BY_QIANKUN__` 注入宿主 document.head，不依赖 qiankun 的样式处理。
