# ADR 002：Companion 安全边界

## 状态

本地 companion MVP 方向已接受。

## 背景

计划中的 CLI companion 会在用户本机运行一个本地 HTTP 服务。任何能被浏览器调用的 localhost 服务都需要明确安全边界。

## 决策

Companion 是可选的本地助手，不是通用本地自动化服务。

MVP 阶段至少应该满足：

- 只监听 `127.0.0.1`。
- 首次使用必须配对。
- 配对后每个请求都必须携带 session token。
- 校验 `Origin`。
- 使用白名单 CORS，不使用通配 `*`。
- 不向 Web App 暴露 API key、OAuth access token 或 refresh token。
- 日志脱敏。
- 限制上传图片数量、体积和 MIME 类型。

MVP 只代理图片生成和图片编辑请求。文件系统访问、shell 访问、浏览器自动化和 OAuth 账号流程都不在第一版范围内。

## 影响

- Web App 可以使用本地凭据能力，但不会读取真实凭据。
- Companion 协议需要显式共享类型和版本管理。
- 开发版和正式版需要不同的 origin 策略。
- 后续任何更高权限能力都需要单独设计和决策。
