# ADR 002：Companion 安全边界

## 状态

已接受，2026-07-16 修订。

## 背景

CLI Companion 会在用户本机运行一个可被浏览器调用的 HTTP 服务。即使服务只监听
localhost，也需要明确哪些网页、本机进程和接口可以访问，以及哪些能力需要连接密钥。

早期方案要求 Web 永远不读取 Companion 保存的真实凭据，并使用一次性配对码和短期
session token。当前产品已经改为持久化连接密钥，并在设置面板中提供 Provider 凭据管理。
本 ADR 修订为与当前实现和产品信任模型一致。

## 决策

Companion 是可选的本地助手，不是通用本地自动化服务。

### 网络边界

- 只监听 `127.0.0.1`。
- 不监听 `0.0.0.0`。
- 浏览器请求必须校验 `Origin`。
- 使用白名单 CORS，不使用通配 `*`。
- 正式渠道默认只信任 `https://image.honlnk.com`。
- 开发渠道可以额外信任明确配置的 localhost Origin。
- 额外 Origin 必须是完整 Origin，不支持通配符或模糊域名匹配。

### 连接密钥

Companion 使用持久化连接密钥作为 Bearer token。连接密钥用于保护：

- `/auth/status`
- `/images/generations`
- `/images/edits`
- `/logs/*`
- 后续新增的普通受保护接口

连接密钥的主要目标是阻止未获授权的网页调用本地生成、编辑和日志能力。它不用于防御
同一用户权限下的本机进程，因为这类进程本来就可以读取用户目录中的 Companion 配置。

### Provider 凭据管理

Provider 凭据管理接口采用独立信任模型：

- 无 `Origin` 的本机 CLI 或本机进程可以访问。
- loopback Origin 可以访问。
- Companion 白名单中的受信 Origin 可以访问。
- 凭据接口不要求连接密钥。
- 受信 Web Origin 可以读取、显示、新增、修改、激活和删除明文 Provider API Key。

这是明确接受的产品决策。官方 Web 站点被视为本地 Provider 凭据的受信主体，而不仅是
一个只能调用代理接口的非特权客户端。

### 数据和日志

- Provider 凭据和连接密钥保存在用户本机，并使用收紧的文件权限。
- 普通项目备份不导出 Companion 凭据和连接密钥。
- 日志脱敏。
- 日志不记录 Authorization、完整 prompt、上传图片内容或图片 base64。
- 限制上传图片数量、体积和 MIME 类型。
- Provider 返回的 URL 在由 Companion 下载前必须经过协议、地址、重定向、内容类型和
  响应大小校验。

### 能力范围

当前 Companion 只代理图片生成、图片编辑和相关配置管理。文件系统访问、shell 访问、
浏览器自动化等更高权限能力不属于当前安全边界；引入时必须单独设计权限模型并新增 ADR。

OAuth access token 和 refresh token 比普通 Provider API Key 具有更复杂的生命周期和账号
权限。在正式引入 OAuth 前，需要重新评估其是否允许被受信 Web Origin 读取，不能自动
沿用本 ADR 对普通 Provider API Key 的决定。

## 影响

- 正式 Web App 可以读取和管理 Companion 中保存的普通 Provider API Key。
- Origin 白名单成为凭据管理接口的关键安全边界。
- 连接密钥保护图片代理、状态和日志接口，但不保护凭据管理接口。
- 正式站点发生 XSS、前端依赖供应链污染或部署内容被篡改时，可能读取本地 Provider
  凭据；这是当前产品明确接受的剩余风险。
- Companion 和正式站点的发布、依赖和内容安全策略需要按“可接触用户 Provider 凭据”
  的级别维护。
- Companion 协议需要显式类型和版本意识；当前类型分别保留在 Web App 和 companion 内部，不单独发布共享协议包。
- 开发版和正式版需要不同的 origin 策略。
- 后续任何更高权限能力都需要单独设计和决策。

## 非目标

- 不防御已经获得同一用户本机权限的恶意进程。
- 不允许任意第三方网站或任意 localhost 开发页面访问 Companion。
- 不把 Origin 白名单扩展为通配域名。
- 不因为普通 Provider API Key 可被受信 Web 读取，就默认允许 OAuth refresh token、
  文件系统或 shell 能力采用相同信任模型。
