# GPT Image Studio Companion CLI

本地 CLI 助手，为 GPT Image Studio 网页端提供安全的 API 凭据代理服务。

## 安装与运行

### npm 安装

推荐用户通过 npm 全局安装：

```bash
npm install -g @honlnk/image-studio-companion
gpt-image-studio provider add
gpt-image-studio start
```

已安装 pnpm 的用户也可以使用：

```bash
pnpm add -g @honlnk/image-studio-companion
gpt-image-studio provider add
gpt-image-studio start
```

### 从源码开发运行

项目使用 pnpm workspace。在仓库根目录执行：

```bash
pnpm install
pnpm dev:companion
```

`pnpm dev:companion` 会以开发渠道启动服务，默认允许本地 Web App origin。

### 从源码构建后运行

```bash
pnpm --filter @honlnk/image-studio-companion build
pnpm --filter @honlnk/image-studio-companion start
```

也可以直接调用入口文件：

```bash
npx tsx companion/src/main.ts serve --port 19750
```

### 生产渠道运行

通过 npm 安装后，生产渠道默认只允许正式站点访问本地 companion：

```bash
gpt-image-studio start
```

如需临时允许额外调试页面，必须显式提供完整 origin：

```bash
gpt-image-studio start --channel stable --allow-origin http://localhost:5173
```

启动后监听 `127.0.0.1:19750`。`start` 启动后台服务后即退出，后台服务持续运行。

## 命令

### `serve` — 启动本地服务

```bash
gpt-image-studio serve
# 源码开发时也可以直接调用入口文件
npx tsx companion/src/main.ts serve
```

常用参数：

| 参数 | 说明 |
|------|------|
| `--port <port>` | 指定监听端口，默认 `19750` |
| `--host <host>` | 指定监听地址，默认 `127.0.0.1`（server 模式默认 `0.0.0.0`） |
| `--deployment-mode local|server` | 部署形态；local 监听 loopback + 连接密钥认证，server 可远程监听 + JWT 多租户 |
| `--channel stable|dev` | 指定安全渠道；stable 只允许正式站点，dev 额外允许本地开发 origin |
| `--allow-origin <origin...>` | 追加允许的完整 origin，不支持通配符 |

### `start` — 后台启动服务

```bash
gpt-image-studio start
```

后台启动 companion 服务，日志写入 `<dataDir>/logs/`，PID 信息写入 `~/.gpt-image-studio/companion.pid`。`<dataDir>` 默认按部署形态隔离：`local` 模式为 `~/.gpt-image-studio`，`server` 模式为 `~/.gpt-image-studio-docker`，可用 `GPT_IMAGE_STUDIO_CONFIG_DIR` 覆盖。`start` 只负责启动服务。

`start` 支持和 `serve` 相同的端口、host、deployment-mode、channel 和 origin 参数。

### `stop` / `restart` — 管理后台服务

```bash
gpt-image-studio stop
gpt-image-studio restart
```

`stop` 只会停止由 `start` 记录的 companion 后台进程，不会按端口杀掉未知进程。

### `logs` — 查看后台日志

```bash
gpt-image-studio logs
gpt-image-studio logs --lines 200
gpt-image-studio logs --follow
gpt-image-studio logs --date 2026-05-25
```

默认显示当前后台日志最后 100 行。每次 `start` 时会自动清理 7 天前的 companion 日志。

### `provider` — 管理 Provider 凭据

```bash
gpt-image-studio provider add       # 交互式添加凭据
gpt-image-studio provider list      # 列出所有凭据
gpt-image-studio provider show      # 查看当前激活凭据详情
gpt-image-studio provider edit <id> # 编辑指定凭据
gpt-image-studio provider remove <id> # 删除指定凭据
gpt-image-studio provider activate <id> # 切换激活凭据
```

`provider add` 交互式输入：label → 选择 provider 预设（openai/glm/doubao/qwen/wan/grok/gemini/gemini-openai/deepinfra）→ API Base URL（回车用预设默认值）→ model → API Key（不回显）。

凭据保存到 `~/.gpt-image-studio/credentials.json`（多配置结构 `{ entries, activeId }`）。

### `status` — 查看状态

```bash
gpt-image-studio status
# 源码开发时
npx tsx companion/src/main.ts status
```

显示：
- 凭据配置情况（provider + 脱敏后的 API Key）
- 连接密钥（access key，用于在网页端粘贴连接）
- 服务是否运行

### `reset-key` — 重置连接密钥

```bash
gpt-image-studio reset-key
```

重新生成持久化连接密钥（`access-key.json`）。重置后需在网页端重新粘贴新密钥。

## 数据目录

所有本地状态保存在 `<dataDir>/`，默认按部署形态隔离：

- `local` 模式（默认）：`~/.gpt-image-studio`
- `server` 模式：`~/.gpt-image-studio-docker`
- 可用环境变量 `GPT_IMAGE_STUDIO_CONFIG_DIR` 覆盖（Docker 部署固定为 `/data`）

| 文件 | 内容 |
|------|------|
| `credentials.json` | Provider 凭据（多配置结构 `{ entries, activeId }`） |
| `access-key.json` | 持久化连接密钥（0600，`status` 查看 / `reset-key` 重置） |
| `oss-credentials.json` | OSS AccessKey（仅配置 OSS 存储时存在，0600） |
| `companion.pid` | 后台进程 PID（固定放 `~/.gpt-image-studio/`） |
| `logs/` | 后台服务日志 |

> PID 控制文件 `companion.pid` 固定放在 `~/.gpt-image-studio/`，便于 `stop`/`status` 在未指定 mode 时也能定位后台进程。

## 升级

### npm 安装升级

使用全局安装的用户可以通过同一包管理器升级：

```bash
npm update -g @honlnk/image-studio-companion
# 或
pnpm update -g @honlnk/image-studio-companion
```

升级后建议运行：

```bash
gpt-image-studio status
```

### 源码升级

从源码升级时，在仓库根目录拉取最新代码并重新安装依赖：

```bash
git pull
pnpm install
pnpm --filter @honlnk/image-studio-companion build
```

升级不会自动删除 `~/.gpt-image-studio/` 中的凭据和连接密钥。升级后建议运行：

```bash
npx tsx companion/src/main.ts status
```

如果服务端口、正式站点 origin 或连接密钥发生变化，重启 `serve` 后在网页端重新粘贴连接密钥即可。

## 卸载与清理

### npm 卸载

使用全局安装的用户可以执行：

```bash
npm uninstall -g @honlnk/image-studio-companion
# 或
pnpm remove -g @honlnk/image-studio-companion
```

卸载 npm 包不会自动删除 `~/.gpt-image-studio/` 中的凭据和连接密钥。

### 本地状态清理

停止 companion 进程后，可以按需要清理本地状态：

```bash
# 重置连接密钥（网页端需重新粘贴新密钥）
gpt-image-studio reset-key
# 源码开发时
npx tsx companion/src/main.ts reset-key

# 完整删除 companion 本地状态
rm -rf ~/.gpt-image-studio
```

如果只是切换 API key，运行 `provider add` 添加新凭据并 `provider activate <id>` 切换即可，不需要删除整个目录。

## 安全说明

- local 模式（默认）服务仅监听 `127.0.0.1`，不对外暴露
- server 模式（`--deployment-mode server`）可监听 `0.0.0.0` 以支持远程/容器部署，此时依赖 JWT 认证（HS256，`JWT_SECRET`）+ Origin 白名单 + CORS
- CORS 白名单默认只允许 `https://image.honlnk.com`
- `--channel dev` 会额外允许 `http://127.0.0.1:8888` 和 `http://localhost:8888`
- `--allow-origin` 只接受完整 origin，不支持通配符
- 非公开端点需要 Bearer token 鉴权（local 模式为持久化连接密钥，server 模式为 JWT）
- 网页端无法读取真实 API Key，只能通过代理发起请求
- 代理请求会限制 body 大小、引用图片数量和图片 MIME 类型
- 日志会脱敏 Authorization、API key 和图片 base64 字段
- 凭据和连接密钥文件会以 `0600` 权限写入
- 凭据当前以明文 JSON 保存，请确保在个人设备上使用
