# 阶段三总览：服务化与可嵌入（多用户 SaaS 形态）

> 纲领来源：[`../evolution-roadmap.md`](../evolution-roadmap.md) 第八章 + 决策 D8–D14。
> 本文档是阶段三的**施工总图**：定调关键技术决策、给出 PR 拆分顺序、定义全局验收门槛。每个 PR 的细节落到 `phase3-prN-*.md`。

## 一、目标

把项目从"单机本地工具"升级为"可部署到服务器、多用户共享的 SaaS 后端 + 可嵌入宿主前端页面的子应用"：

- **后端**：Companion 从本机 loopback 升级为可远程访问的网络服务，支持多用户，对接宿主用户体系（完整 SSO）。
- **前端**：用 qiankun 嵌入到 Vben / RuoYi-Plus 等宿主项目的页面中；同时保留独立运行模式。

**关键认知（D8）**：后端做"服务化"（独立服务部署 + HTTP/JSON 对接），不做"物理嵌入"（不拆 package、不包装成 SpringBoot controller、不混部 Node 子进程）。前端做 qiankun 嵌入值得（运行时 UI 组合、松耦合），后端物理嵌入不值得（代码级紧耦合、反模式）。

## 二、前置条件

- ✅ 阶段一完成（`StudioStorage` 接口 + 工厂注入已就位）
- ✅ 阶段二完成（Companion 已是完整后端：SQLite + D7 主/业务双层 db + 7 张业务表 + FileSystem/OSS 存储 adapter + `/storage/*` 路由 + 前端 `CompanionStorage` + 存储位置切换 UI）

## 三、核心设计决策（阶段三启动时定调）

> 这些决策在 `evolution-roadmap.md` 第八章与 D8–D14 已有方向，本节给出**实施层面的最终选型**，把第十二章的未决项逐条收敛。

### D9 多租户隔离 —— 复用 D7 文件目录隔离

阶段二 D7 的"主 db + 业务 db 双层结构"天然升级为多租户，**业务表 schema 完全不动**。

```
阶段二（单用户本机）：
~/.gpt-image-studio/
├── studio.db                      ← dataset_registry: id, storage_config, db_path, ...
└── datasets/
    └── <dataset-id>.db            ← 业务 db（7 张表，无 user_id 字段）

阶段三（多用户服务器）：
<server-data-dir>/                 ← 由 DATA_DIR 环境变量指定（Docker 挂卷点）
├── studio.db                      ← 升级后的主 db
│   ├── users                      ← 新增用户表（本地数据归属索引，不存密码）
│   └── dataset_registry           ← 加 user_id 外键，指向 users
└── users/
    └── <user-id>/
        └── datasets/
            └── <dataset-id>.db    ← 业务 db schema 完全不变（沿用阶段二 7 张表）
```

**否决方案**：共享库 + `user_id` 字段过滤（破坏 D7 的 schema 零侵入原则，让所有业务表查询带过滤，反向污染 `StudioStorage` 接口）。

**实施关键**：
- `users` 表只存 `id`(来自 JWT sub) / `display_name`(来自 JWT claim) / `created_at`。**不存密码/邮箱/权限**，不与宿主用户表强一致。
- 用户首次带 JWT 访问时**懒创建** user 记录 + 建用户目录，不需要宿主预先通知。
- `dataset_registry` 加 `user_id` 列（`NOT NULL`，指向 users.id）。
- 业务 db 路径改为 `users/<user-id>/datasets/<dataset-id>.db`。
- 所有 storage 路由在打开业务 db 前，先从 JWT 拿 `user_id` 定位用户目录。

### D10 完整 SSO —— 单点登录 + 单点登出 + 令牌刷新

实现生产级 SSO，三个能力全部覆盖：

| 能力 | 机制 | 责任方 |
|---|---|---|
| **单点登录（SSO）** | 宿主签发 JWT，前端带 `Authorization: Bearer <jwt>` 访问 Companion，Companion 验签放行 | 宿主=IdP，Companion=RS |
| **单点登出（SLO）** | 宿主调 `POST /admin/revoke`（平台级管理密钥鉴权），Companion 把 user_id/jti 加入吊销黑名单 | 宿主→Companion webhook |
| **令牌刷新** | JWT 短有效期（30min~1h），过期前前端静默调宿主 refresh 接口拿新 JWT，Companion 不参与 | 前端↔宿主 |

**JWT 验签方案（未决项收敛）**：采用 **HS256 对称密钥**（共享密钥，环境变量 `JWT_SECRET` 配置）。
- 理由：宿主（RuoYi-Plus 等 Java 栈）与 Companion（Node）对接时，对称密钥配置最简单（一个 env var），验签性能好。非对称 RS256 的公钥分发收益在本场景不大（Companion 是唯一验签方）。
- claim 约定：`sub`=user_id（必填）、`display_name`（可选，避免反查宿主）、`jti`（可选，支持单 JWT 吊销）、`exp`/`iat`（标准）。

**JWT 有效期与刷新（未决项收敛）**：默认 `exp` 由宿主决定（Companion 只验不签），文档建议宿主设 30min~1h。Companion 侧不做刷新（刷新是前端↔宿主的事）。

**吊销黑名单持久化（未决项收敛）**：采用**纯内存 + TTL 自动清理**。
- 理由：重启清空，但 JWT 有效期短（≤1h），重启后残留风险窗口 = 剩余有效期，可接受。落盘持久化增加 IO 与一致性复杂度，收益不大。
- 实现：`Map<jti|userId, expireAt>`，每条记录带 TTL，后台定时清理过期项；请求时 O(1) 查询。

### D11 服务器模式 OSS 平台统一 + STS 凭证

- 平台配置一个 OSS bucket，所有用户图片传到同一 bucket，按 `users/<user-id>/datasets/<dataset-id>/<blobKey>` 划分前缀隔离。
- **长期 AccessKey 只存宿主**，Companion 调宿主的 STS 签发接口（`MAIN_APP_URL/api/sts/upload-token`，平台级密钥鉴权）拿临时凭证（15min~1h 有效期），用完自动续期。
- 宿主可随时停止签发新凭证，立即收回用户上传能力。
- 阶段二的"用户自配 OSS"（`oss-credentials.json`）在服务器模式下不再启用；本机 loopback 模式仍保留（向后兼容阶段二）。

**STS 契约（未决项收敛）**：
```
# Companion → 宿主
GET {MAIN_APP_URL}/api/sts/upload-token
Authorization: Bearer {MAIN_APP_API_KEY}     ← 平台级密钥（区别于用户 JWT）
X-User-Id: <user-id>                          ← 透传当前用户，宿主据此签发限定该用户前缀的 STS

# 宿主 → Companion（响应）
{
  "accessKeyId": "STS.xxx",
  "accessKeySecret": "xxx",
  "securityToken": "xxx",
  "expiration": "2026-07-27T12:30:00Z",       ← ISO8601，Companion 据此判断续期
  "bucket": "platform-bucket",
  "region": "oss-cn-hangzhou",
  "prefix": "users/<user-id>/"                ← 宿主限定该用户只能写此前缀
}
```
Companion 缓存 STS 到 `expiration - 5min`，过期前自动重新获取。

### D12 Companion 不连宿主数据库

所有跨服务信息交换走 JWT + HTTP API：
- 用户身份：JWT `sub` claim，Companion 懒创建本地 user 记录。
- 用户显示名：JWT `display_name` claim（或首次访问调宿主 API 查询并缓存）。
- OSS 凭证：STS API 临时获取。
- 用户删除等事件：宿主 webhook 调 `/admin/revoke`。

### D14 前端双模式分发

- **默认：CDN 嵌入**。宿主通过 qiankun 加载 `https://image.honlnk.com`（GitHub Pages）构建产物，用户免部署前端。
- **可选：自部署**。用户从 DockerHub 拉 Web 镜像部署到自己的 nginx，适用于内网/私有化。
- 两种模式共用同一份构建产物（qiankun 兼容改造后同时支持独立运行和嵌入）。

### 部署形态开关：本机模式 vs 服务器模式

阶段三引入**部署形态（deployment mode）**概念，由环境变量 `COMPANION_DEPLOYMENT_MODE` 控制：
- `local`（默认，向后兼容阶段二）：监听 `127.0.0.1`，accessKey 信任模型，loopbackGuard 启用，OSS 走 `oss-credentials.json`，admin 页启用。**行为与阶段二完全一致**。
- `server`：监听地址可配置（默认 `0.0.0.0`），JWT 认证启用，多租户层启用，OSS 走 STS，admin 页默认关闭，loopbackGuard 收紧。

这样阶段二的本地用户体验零变化，阶段三的能力按需启用。

## 四、PR 拆分顺序

> 依赖链：PR1（地基：可配置监听 + Docker）→ PR2（JWT + 多租户）→ PR3（SLO 吊销）→ PR4（STS）。PR5（前端 qiankun）与 PR6（部署文档）相对独立，可在 PR2 之后并行。

| PR | 内容 | 依赖 | 文档 |
|---|---|---|---|
| **PR1** | Companion 监听地址可配置 + Docker 化（部署形态开关 local，Dockerfile 完善，compose 启用） | 无 | [phase3-pr1-listen-address-docker.md](./phase3-pr1-listen-address-docker.md) |
| **PR2** | JWT 认证中间件 + users 表多租户隔离（D9 + D10 SSO 登录部分） | PR1 | [phase3-pr2-jwt-multitenant.md](./phase3-pr2-jwt-multitenant.md) |
| **PR3** | 吊销黑名单 SLO + `/auth/me` + `/admin/revoke`（D10 完整 SSO） | PR2 | [phase3-pr3-revocation-slo.md](./phase3-pr3-revocation-slo.md) |
| **PR4** | OSS STS 临时凭证机制（D11 平台统一 OSS） | PR2 | [phase3-pr4-oss-sts.md](./phase3-pr4-oss-sts.md) |
| **PR5** | 前端 qiankun 嵌入改造（生命周期 + 资源相对化 + 运行环境感知 + 认证态联动） | PR2 | [phase3-pr5-frontend-qiankun.md](./phase3-pr5-frontend-qiankun.md) |
| **PR6** | 部署文档 `docs/deployment-guide.md`（Companion Docker + 前端嵌入 + 宿主侧指引 + 故障排查） | PR1-PR5 | [phase3-pr6-deployment-docs.md](./phase3-pr6-deployment-docs.md) |

### 拆分原则

1. **每个 PR 可独立合并、独立验证、独立回滚**。PR1 不引入任何阶段三行为变化（只是让监听地址可配 + Docker 能跑），合并后阶段二功能 100% 回归通过。
2. **PR2 是核心**：JWT 中间件 + 多租户隔离。完成后数据隔离已生效，但 SLO 还没做（PR3 补）。
3. **PR3/PR4 是 PR2 的能力补全**：SLO 补认证完整性，STS 补 OSS 安全。
4. **PR5 前端改造可独立验证**：qiankun 嵌入态 vs 独立态行为对比，不依赖后端多租户（用 mock JWT 即可测）。
5. **PR6 收尾**：所有代码就位后写部署文档，文档即验收脚本（按文档操作能从零部署成功）。

## 五、全局验收门槛

> 阶段三完成的充要条件：以下 12 项全部满足（对应 roadmap §8 验收标准）。

### 后端服务化

- [ ] Companion 可通过 Docker 部署到服务器，配置即用（拉镜像 + 填环境变量 + `docker compose up -d`）
- [ ] 宿主签发的 JWT 能被 Companion 正确验证（HS256 验签 + exp 过期检查）
- [ ] **完整 SSO 验证**：用户在宿主登出后，Companion 立即拒绝该用户的 JWT（SLO 生效）
- [ ] 用户改密码/被封禁后，旧 JWT 立即失效（`/admin/revoke` 吊销机制生效）
- [ ] JWT 过期前静默刷新成功，用户无感知（前端调宿主 refresh，Companion 不参与）
- [ ] 不同用户的数据完全隔离（A 用户看不到 B 用户的任何数据 —— 业务 db 物理隔离验证）
- [ ] OSS 上传走 STS 临时凭证，长期 AK 不出现在 Companion 配置中（`grep -r AccessKey companion/` 无明文）

### 前端嵌入

- [ ] 前端可通过 CDN（`image.honlnk.com`）或自部署两种方式嵌入宿主（qiankun register 验证）
- [ ] 前端嵌入态从宿主获取配置和 JWT，不需要用户单独登录 Companion
- [ ] 前端独立运行模式（非 qiankun）行为不受影响（阶段二功能回归通过）

### 架构纯洁性

- [ ] 业务 db schema 与阶段二完全一致（多租户零 schema 改动验证：`schema.ts` 的 `BUSINESS_DB_DDL` 不变）
- [ ] 部署文档完整，按文档操作可从零部署成功

## 六、风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| JWT 验签密钥泄露 | 任意人可伪造 JWT 访问所有用户数据 | 密钥只走环境变量（不进代码/日志/备份）；宿主侧可轮换密钥 |
| 多租户隔离边界破缺 | A 用户能读 B 用户数据 | 业务 db 物理路径隔离（`users/<uid>/datasets/<did>.db`），路由层强制从 JWT 取 user_id 定位目录，不接受请求体里的 user_id |
| STS 凭证缓存失效导致上传失败 | 用户上传中断 | STS 过期前 5min 自动续期；续期失败时返回明确错误让前端重试 |
| qiankun 沙箱与 Vue 实例冲突 | 嵌入态白屏 | qiankun JS 沙箱已处理大部分；资源路径相对化 + external 共享 Vue 降低冲突 |
| 阶段二本地模式回归破缺 | 本机用户功能受影响 | `COMPANION_DEPLOYMENT_MODE=local`（默认）时行为完全等同阶段二，PR1 验收强制回归 |

**全局回滚策略**：每个 PR 独立 commit，回滚即 `git revert`。PR1 是地基，若 PR2 多租户出问题，revert PR2-PR4 即回到 PR1（可远程访问但单用户）。若 PR1 出问题，revert PR1 即回到阶段二（纯本地）。

## 七、与阶段四的衔接

- 前端打包格式已支持独立/嵌入两种形态 → 阶段四 Tauri 可复用嵌入形态的运行环境感知能力。
- Companion 已具备完整服务化能力（监听、认证、多租户）→ 阶段四 APP 内化时按需裁剪（APP 单用户，去掉多租户层即可）。
- 多租户的"用户隔离下沉到文件目录"设计 → 阶段四 APP 单用户场景直接退化为单层目录（`<app-data>/datasets/<id>.db`，去掉 `users/<uid>/` 一层）。
