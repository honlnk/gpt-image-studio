# GPT Image Studio Companion CLI

本地 CLI 助手，为 GPT Image Studio 网页端提供安全的 API 凭据代理服务。

## 安装

项目使用 pnpm workspace，在仓库根目录执行：

```bash
pnpm install
```

## 命令

### `serve` — 启动本地服务

```bash
pnpm dev:companion
# 或指定端口
npx tsx companion/src/main.ts serve --port 19750
```

启动后监听 `127.0.0.1:19750`，等待网页端发起配对连接。

### `login` — 配置 API 凭据

```bash
npx tsx companion/src/main.ts login
```

交互式输入：

1. **API Base URL** — 回车使用默认值 `https://api.openai.com/v1/images`
2. **API Key** — 输入时不回显

凭据保存到 `~/.gpt-image-studio/credentials.json`。

### `status` — 查看状态

```bash
npx tsx companion/src/main.ts status
```

显示：
- 凭据配置情况（Base URL + 脱敏后的 API Key）
- 配对状态
- 服务是否运行

### `logout` — 清除凭据

```bash
npx tsx companion/src/main.ts logout
```

删除本地保存的 API 凭据文件。

## 配对流程

1. 启动 companion 服务（`pnpm dev:companion`）
2. 在网页端设置中切换到「本地 Companion」模式
3. 点击配对，终端会显示 6 位配对码
4. 在网页端输入配对码完成连接

配对码有效期 5 分钟。配对成功后，session token 保存在 `~/.gpt-image-studio/session.json`，下次启动服务时自动恢复。

## 数据目录

所有本地状态保存在 `~/.gpt-image-studio/`：

| 文件 | 内容 |
|------|------|
| `credentials.json` | API Base URL + API Key |
| `session.json` | 配对 session token |

## 安全说明

- 服务仅监听 `127.0.0.1`，不对外暴露
- CORS 白名单限制为 `https://gpt-image.honlnk.com` 和本地开发地址
- 非公开端点需要配对后的 Bearer token 鉴权
- 网页端无法读取真实 API Key，只能通过代理发起请求
- 凭据当前以明文 JSON 保存，请确保在个人设备上使用
