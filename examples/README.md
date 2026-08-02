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

宿主是单个 `index.html`（从 CDN 加载 qiankun 2.x UMD），`registerMicroApps` 注册子应用并把 `companionUrl`/`jwt` 通过 props 注入。

### 启动步骤（共 4 个进程/端口）

```bash
# 1. 子应用产物（entry，端口 4173）
pnpm build && pnpm preview

# 2. Companion server 模式（端口 19751，与宿主共享 JWT_SECRET，
#    --allow-origin 必须允许宿主页面的 origin）
cd companion && pnpm build
JWT_SECRET=<32+字符随机串> node dist/main.js serve \
  --port 19751 --deployment-mode server \
  --allow-origin http://127.0.0.1:5599

# 3. 签发 JWT 并生成 config.json（config.json 已 gitignore，不进仓库）
cd examples/qiankun-host
cp config.example.json config.json
JWT_SECRET=<同上密钥> node sign-jwt.mjs 30d  # 签发 JWT 填进 config.json，默认 1h，可传 7d/30d 等

# 4. 启动宿主静态服务（端口 5599，任意静态服务器均可）
python3 -m http.server 5599
# 浏览器打开 http://127.0.0.1:5599
```

宿主顶栏会显示子应用挂载状态（MOUNTED）；「重新挂载子应用」按钮实际是整页刷新。

### 用 Docker 跑 Companion（可选，替代上面的第 2 步）

项目根目录的 `docker-compose.yml` 提供了 `companion-server` 服务（server 模式专用）：

```bash
# 准备独立数据目录（与 local 模式的 ~/.gpt-image-studio 隔离），
# 把 OSS 长期 AK 和 provider 凭据放进去
mkdir -p ~/.gpt-image-studio-docker
cp ~/.gpt-image-studio/oss-credentials.json ~/.gpt-image-studio/credentials.json \
  ~/.gpt-image-studio-docker/

# 构建并启动（端口 19751）
JWT_SECRET=<32+字符随机串> ADMIN_API_KEY=<平台管理密钥> \
  docker compose --profile companion-server up -d --build companion-server
```

- 数据目录映射：`~/.gpt-image-studio-docker` → 容器 `/data`
- compose 里开了 `COMPANION_OSS_LONG_TERM_AK=1` 逃生门：server 模式的 OSS 存储
  允许用 `oss-credentials.json` 里的长期 AK（**仅本地调试**，违背 D11——生产环境
  OSS 必须走宿主 STS 签发，见 `docs/deployment-guide.md` §5.4）。没有宿主后端的
  本地演示才需要它。多用户共享同一把 AK 时按 `users/<userId>/` 前缀隔离。
- 启动后各用户的默认数据集仍是 filesystem-default，需调
  `POST /storage/datasets/activate`（带 JWT）切换存储位置到 OSS。
  注意：Companion 自带管理页（`/admin`）是本机单用户管理面，server 模式下
  已禁用（404）——多租户存储由宿主/API 按用户管理。

### 注意

- **必须用 `http://127.0.0.1:5599` 打开宿主页，不能用 `localhost:5599`**——二者在浏览器看来是两个不同 origin，Companion 的 CORS 白名单（`--allow-origin http://127.0.0.1:5599`）只放行前者。用 localhost 打开会导致所有 Companion 请求报 `Failed to fetch`（CORS 拦截），表现为子应用"离线"、toast"读取本地数据失败"、宿主列表"加载失败"。
- JWT 有效期由 `sign-jwt.mjs` 的第一个参数控制（如 `30d`，默认 1h），过期后 Companion 请求会 401，重新签发替换 `config.json` 即可。
- 改完 `src/main.ts` 的嵌入逻辑后必须重新 `pnpm build`，preview 才会 serve 新产物。
- 嵌入态 CSS 由子应用 `main.ts` 的 `injectEmbeddedCss` 通过 `__INJECTED_PUBLIC_PATH_BY_QIANKUN__` 注入宿主 document.head，不依赖 qiankun 的样式处理。
