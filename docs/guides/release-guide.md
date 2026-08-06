# 发布指南

本文件面向维护者，记录 npm 包与 Docker 镜像的发布流程。

## 发布约定

- **版本号**：companion 子包独立版本，遵循 SemVer。
- **Git tag**：`companion-v<X.Y.Z>`（如 `companion-v1.0.0`），与 `companion/package.json` 的 `version` 一致。
- **触发方式**：推送 `companion-v*` tag → GitHub Actions（`.github/workflows/release.yml`）自动发布 npm 包 + Docker 镜像。

## 发版步骤

### 1. 改版本号

编辑 `companion/package.json`，将 `version` 改为目标版本号（如 `1.1.0`）。

### 2. 提交并打 tag

```bash
git add companion/package.json
git commit -m "chore(companion): bump version to 1.1.0"
git tag companion-v1.1.0
git push origin companion-v1.1.0   # 推 tag 触发 CI
```

### 3. CI 自动执行（`.github/workflows/release.yml`）

推 tag 后 GitHub Actions 会执行两个 job：

| Job | 行为 |
|-----|------|
| `publish-npm` | 幂等：若该版本已在 npm registry 则跳过；否则 `npm publish --provenance` |
| `publish-docker` | 构建 `web` + `companion` 双镜像（multi-arch amd64/arm64），推 ghcr.io + docker.io，tag 为版本号 + `latest` |

### 4. 验证

```bash
# npm
npm view @honlnk/image-studio-companion@1.1.0

# Docker
docker pull ghcr.io/honlnk/gpt-image-studio-companion:1.1.0
docker pull honlnk/gpt-image-studio-companion:1.1.0
```

## 所需 Secrets

仓库 Settings → Secrets and variables → Actions：

| Secret | 用途 | 获取方式 |
|--------|------|----------|
| `NPM_TOKEN` | npm publish | npmjs.com → Access Tokens → 新建 publish token |
| `DOCKERHUB_USERNAME` | Docker Hub 登录 | Docker Hub 账号名（`honlnk`） |
| `DOCKERHUB_TOKEN` | Docker Hub 推送 | Docker Hub → Account Settings → Security → New Access Token |

> `GITHUB_TOKEN`（推送 ghcr.io）由 Actions 自动注入，无需手动配。

## 首次发布（已完成的 1.0.0）

1.0.0 是首次走 CI 的版本，npm 包由本地手动 `npm publish` 先行发布，确保 scoped 包 `access: public` 配置生效。之后推 tag 时 `publish-npm` job 检测到版本已存在会自动跳过，只走 Docker 镜像构建。

后续版本（1.1.0+）全流程由 tag 驱动，无需手动 npm publish。

## 产物清单

每次发版产出：

| 产物 | 地址 |
|------|------|
| npm 包 | `@honlnk/image-studio-companion@<ver>` |
| Companion 镜像 (ghcr) | `ghcr.io/honlnk/gpt-image-studio-companion:<ver>` / `:latest` |
| Companion 镜像 (dockerhub) | `docker.io/honlnk/gpt-image-studio-companion:<ver>` / `:latest` |
| Web 镜像 (ghcr) | `ghcr.io/honlnk/gpt-image-studio-web:<ver>` / `:latest` |
| Web 镜像 (dockerhub) | `docker.io/honlnk/gpt-image-studio-web:<ver>` / `:latest` |
| Web 前端（CDN） | GitHub Pages（push main 自动部署，无版本号） |

## 不在本流程内

- **桌面端 dmg**：Tauri 打包 + 签名/公证，见 `docs/desktop-packaging.md`，暂未接入 CI。
- **Web 前端版本号**：根 `package.json` 保持 `0.0.0`，Web 通过 GitHub Pages 按提交部署，不做 npm/镜像版本化。
