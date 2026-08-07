# Cloudflare CDN 加速方案（反代 GitHub Pages）

> 状态：**待执行**（仓库零改动，操作都在 Cloudflare 控制台 + DNS 服务商侧）
>
> 目的：消除 [`evolution-roadmap.md` CDN 观察项](../plans/evolution-roadmap.md) 担心的 GitHub Pages 100GB/月流量上限风险，用 Cloudflare 免费 CDN 承接 `image.honlnk.com` 的前端流量。

---

## 1. 背景：为什么需要这一步

当前 `image.honlnk.com` 直接指向 GitHub Pages（阶段三的 CDN 嵌入默认入口，见 [`deployment-guide.md` §4.1](./deployment-guide.md)）。GitHub Pages 对免费账户有**软带宽限制（约 100GB/月）**：

- qiankun 嵌入模式下，每个宿主用户打开页面都会从 `image.honlnk.com` 拉取 entry HTML + JS/CSS chunk
- 一旦多个宿主项目采用 CDN 嵌入，流量可能打爆 GH Pages 配额，导致限速 / 429，所有 CDN 嵌入用户集体不可用
- 这个风险在"真实部署、真实用户使用"前无法量化，故在 evolution-roadmap 里标记为观察项

**本方案**用 Cloudflare 免费计划在中间做 CDN 缓存：流量从 CF 边缘节点出，不消耗 GH Pages 配额。CF 免费计划**不限带宽、不限请求数**，彻底消除这个风险。

---

## 2. 方案选型：反代 vs 直托管

两个可选方案，本指南采用**方案 A（反代）**：

| | 方案 A：CF 反代 GH Pages（本指南） | 方案 B：CF Pages 直托管 |
|---|---|---|
| **CI 部署到哪** | 仍部署到 GitHub Pages（`deploy.yml` 不改） | 直接部署到 Cloudflare Pages |
| **谁是源站** | GitHub Pages | Cloudflare Pages 自己 |
| **CDN 缓存** | ✅ CF 边缘节点 | ✅ CF 边沿节点 |
| **仓库改动** | **零** | 改 `deploy.yml` + 删 vite 的 `spa-404-fallback` 插件 |
| **额外能力** | 仅缓存加速 | 预览部署、一键回滚、构建日志 |
| **依赖 GH Pages** | 是（GH Pages 挂了 CF 缓存过期后也挂） | 否（彻底解耦） |

**选方案 A 的理由**：零改动、风险最低、当前没有流量压力，属于"先备好手册，需要时再执行"。如果后续需要 CF Pages 的预览/回滚能力或想彻底解耦 GH Pages，可升级到方案 B（见文末「升级路径」）。

---

## 3. 架构

```
用户访问 image.honlnk.com
  │
  ▼
DNS 解析（指向 Cloudflare）
  │
  ▼
Cloudflare 边缘节点（橙色云朵代理开启）
  ├── 缓存命中 → 直接返回（不回源，不消耗 GH Pages 流量）
  └── 缓存未命中 → 回源 GitHub Pages → 返回内容并缓存到边缘
```

**关键点**：浏览器命中的是 CF 边缘节点的 IP，GH Pages 只在被回源时才出流量。静态资源（带 hash 的 JS/CSS）一旦缓存到 CF 边缘，后续所有用户都不再回源。

---

## 4. 前提条件

1. **`image.honlnk.com` 已在 GitHub Pages 配置自定义域名**
   - 当前配置在 GitHub 仓库 Settings → Pages → Custom domain
   - 仓库内无 `public/CNAME` 文件（已确认），域名绑定全在 GitHub 侧
2. **能管理 `honlnk.com` 的 DNS**
   - 需要能修改 `image.honlnk.com` 的 DNS 记录（A 记录或 CNAME）
   - 通常在域名注册商的 DNS 管理面板，或当前 DNS 服务商处
3. **注册 Cloudflare 账号**（免费）

---

## 5. 执行步骤

以下操作都在 **Cloudflare 控制台 + DNS 服务商** 侧完成，**仓库代码不改**。

### 5.1 Cloudflare 添加站点

1. 登录 Cloudflare Dashboard → **Add a Site**
2. 输入 `honlnk.com`（添加整个根域，CF 会自动接管所有子域 DNS）
   - 若只想管 `image` 子域、不想动根域 NS：用 **CNAME Setup** 方式（Cloudflare for SaaS），但配置更复杂，一般直接添加根域更简单
3. 选择 **Free 计划**
4. Cloudflare 会扫描现有 DNS 记录并导入，确认 `image.honlnk.com` 的记录存在（CNAME 指向 `<github-username>.github.io` 或 A 记录指向 GH Pages IP）

### 5.2 更换 NS（nameserver）

1. Cloudflare 会分配两个 NS，如 `xxx.ns.cloudflare.com`
2. 到 `honlnk.com` 的**域名注册商**处，把 NS 改成 Cloudflare 分配的这两个
3. 等待 NS 生效（通常几分钟到几小时，最长 24 小时）
4. Cloudflare Dashboard 会显示 **Active** 状态

> 注意：换 NS 后，`honlnk.com` 下所有子域的 DNS 都要在 Cloudflare 管理。迁移前先导出当前 DNS 记录备份。

### 5.3 确认 DNS 记录 + 开启代理

1. Cloudflare Dashboard → DNS → Records
2. 确认 `image` 子域记录存在：
   - 类型：`CNAME`，名称：`image`，目标：`<github-username>.github.io`
   - 或类型：`A`，指向 GitHub Pages 的 IP（见 [GitHub 官方 IP 列表](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)）
3. **开启橙色云朵代理**（Proxy status: Proxied）
   - 灰色云朵 = DNS only（仅解析，不走 CF CDN）
   - 橙色云朵 = Proxied（走 CF CDN 缓存，**这是关键**）

### 5.4 SSL/TLS 配置

1. Cloudflare Dashboard → SSL/TLS → Overview
2. 模式设为 **Full**（不是 Full (strict)）
   - 理由：GitHub Pages 的证书是它自己签发的，Full (strict) 会因证书链校验失败而报错
   - Full 模式：CF 到 GH Pages 走 HTTPS，但不强制校验源站证书

### 5.5 缓存规则（保证发版即时生效）

默认 CF 会缓存静态资源，但 `index.html` 如果被长缓存，发版后用户拿到的还是旧 entry。需要配置：

**方案（推荐，用 Cache Rules）**：
1. Cloudflare Dashboard → Caching → Cache Rules
2. 新建两条规则：

   **规则 1：静态资源长缓存**
   - 匹配：`URI Path starts with "/assets/"`
   - 行为：Edge TTL = 1 个月（这些文件名带 hash，内容不变）
   - Browser TTL = 1 个月

   **规则 2：entry HTML 不缓存**
   - 匹配：`URI Path equals "/"` 或文件名匹配 `*.html`
   - 行为：Edge TTL = 绕过缓存（bypass）或短 TTL（如 60 秒）
   - Browser TTL = 不缓存或 60 秒
   - 理由：`index.html` 引用的 JS/CSS 文件名每次发版都变，entry 必须实时拿到最新版

### 5.6 验证

配置完成后，用以下命令验证 CDN 是否生效：

```bash
# 1. 看 DNS 是否解析到 Cloudflare
dig image.honlnk.com
# 应返回 Cloudflare 的 IP（104.x 或 172.x 段），不是 GitHub Pages 的 IP

# 2. 看响应头是否走了 CF 缓存
curl -I https://image.honlnk.com/
# 应看到：
#   server: cloudflare
#   cf-cache-status: HIT / MISS / EXPIRED（HIT = 边缘缓存命中）

curl -I https://image.honlnk.com/assets/index-xxxx.js
# 静态资源应看到 cf-cache-status: HIT（第二次请求起）

# 3. 发版后验证 entry 实时更新
# 触发一次 push main → CI 部署后，立即 curl -I 看 index.html
# 确认 cf-cache-status 不是 HIT（否则用户会拿到旧 entry）
```

**多地区测速**：
- 用 [letsdebug.net](https://letsdebug.net/) 或 [gtmetrix.com](https://gtmetrix.com) 从不同地区测 `image.honlnk.com` 的加载速度
- 用 [cf-cli](https://developers.cloudflare.com/workers/wrangler/commands/) 或浏览器 DevTools Network 面板看 `cf-ray` 头确认命中的边缘节点

---

## 6. 回滚

任何时候想回到直连 GitHub Pages：

1. Cloudflare Dashboard → DNS → 把 `image` 记录的云朵**点成灰色**（DNS only）
2. 立即生效（DNS TTL 内），流量不再经过 CF，直接打 GH Pages

> 不需要删 Cloudflare 站点，灰色云朵即可。这样后续想再开 CDN，点回橙色云朵就行。

---

## 7. 与 Companion CORS 的关系

**域名不变，Companion 配置不动**。

- `companion/src/securityConfig.ts` 的 `STABLE_ORIGINS` 白名单里是 `https://image.honlnk.com`
- CF 反代不改域名，只是 DNS 指向变了，浏览器看到的 Origin 仍是 `https://image.honlnk.com`
- Companion 的 CORS 校验、`--allow-origin` 参数、loopbackGuard 全部不受影响

---

## 8. 什么时候执行

这个方案**不需要现在立刻执行**，适合在以下时机落地：

- **观察期**：server 模式真实部署后，监控 `image.honlnk.com` 的实际流量（GH Pages Insights 或自建统计）
- **触发条件**：
  - 月流量接近 GH Pages 的 100GB 软上限
  - 收到 GitHub 的流量告警
  - 有大型宿主项目准备接入 CDN 嵌入模式
  - 用户反馈国内访问慢（CF 虽然节点在境外，但全球 Anycast 通常比直连 GH Pages 快）

只要上述任一条件触发，照本指南执行即可，仓库零改动、操作可回滚。

---

## 9. 升级路径：方案 B（CF Pages 直托管）

如果后续出现以下需求，可升级到方案 B（彻底脱离 GH Pages）：

### 升级判断标准

- 需要 Cloudflare 的**预览部署**（每个 PR 自动生成预览 URL）
- 需要**一键回滚**到历史版本（CF Pages 原生支持）
- GH Pages 回源不稳定（间歇性 5xx、证书问题）
- 想彻底解耦 GH Pages，不再受其任何限制

### 方案 B 改动概要（届时再展开，现在不实施）

1. **改 `.github/workflows/deploy.yml`**：删除 `configure-pages` / `upload-pages-artifact` / `deploy-pages` 三步，换成 `wrangler pages deploy dist`（或 `cloudflare/pages-action@v1`）。需要配置 `CLOUDFLARE_API_TOKEN` secret
2. **改 `vite.config.ts`**：删除 `spa-404-fallback` 插件（生成 `404.html` 是 GH Pages 专有技巧，CF Pages 原生支持 SPA fallback，在 Pages 项目设置里开 `/* → /index.html`）
3. **域名**：仍绑定 `image.honlnk.com` 到 CF Pages 项目（域名不变，代码硬编码不改）
4. **Docker web 镜像**（`release.yml` 的自部署通道）不受影响，继续作为私有化部署选项

升级到方案 B 是单向的（切过去就不再依赖 GH Pages），但执行成本不高，主要工作量在 CI 改造和验证。
