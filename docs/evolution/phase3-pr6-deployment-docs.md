# 阶段三 PR6：部署文档

> 状态：✅ 已完成
> 依赖：PR1-PR5（全部代码已就位）
> 纲领：[`./phase3-overview.md`](./phase3-overview.md) §四 PR6

## 一、交付物

[`docs/deployment-guide.md`](../deployment-guide.md) —— 完整部署教程，覆盖：

1. **部署形态总览**：local vs server 模式对比表。
2. **本机模式部署**：阶段二默认行为的安装/启动/凭据管理。
3. **服务器模式 Companion 部署**：
   - Docker 部署（docker-compose.yml 完整模板 + 环境变量配置）
   - 非 Docker 部署（Node 直跑）
   - Nginx 反向代理示例（TLS + 限流 + 流式支持）
   - 环境变量速查表
4. **前端嵌入**：
   - CDN 嵌入（qiankun 注册示例，默认免部署）
   - 自部署（Docker Web 镜像 + 私有化）
   - 独立运行模式（非嵌入）
5. **宿主侧改造指引**：
   - JWT 签发（claim 约定 + HS256 密钥共享）
   - 令牌刷新（前端↔宿主）
   - SLO 吊销（/admin/revoke 触发时机 + 请求示例）
   - OSS STS 签发接口契约
   - JWT claim 速查表
6. **故障排查**：CORS、资源 404、JWT 验签、SLO 未生效、多租户隔离验证、OSS 上传失败、数据持久化、本机模式回归。

## 二、验收门槛

- [x] 文档完整覆盖 Companion Docker 部署（按文档操作可从零部署成功）
- [x] 前端嵌入两种方式（CDN + 自部署）有 qiankun 注册示例
- [x] 宿主侧需开发的接口清单明确（STS 签发 + /admin/revoke webhook）
- [x] JWT claim 约定 + 共享密钥配置说明
- [x] 故障排查覆盖常见问题（CORS/404/JWT/SLO/隔离/STS/持久化）
- [x] 环境变量速查表

## 三、实施记录

部署文档 `docs/deployment-guide.md` 已创建，覆盖全部 6 章节。文档作为「验收脚本」——按文档操作可从零部署成功（Docker 拉镜像 + 填环境变量 + qiankun 注册）。
