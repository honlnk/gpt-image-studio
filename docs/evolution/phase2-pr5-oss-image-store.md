# 阶段二 PR5：OssImageStore（选项 C）+ OSS 凭据录入

> **状态：🚧 进行中**
>
> 依赖：PR1-4（storage 路由、datasetRegistry、imageStore 接口）
>
> 目标：实现选项 C（阿里云 OSS）图片存储，完成 D6 三选项的最后一块。OSS 凭据单独存 `oss-credentials.json`，与 provider 凭据分离。

## 1. 改造范围

### 依赖引入
`companion/package.json` 新增 `ali-oss`（纯 JS SDK，无原生编译）。

### 新增文件
- `companion/src/storage/ossImageStore.ts` —— OssImageStore 实现
- `companion/src/storage/ossCredentials.ts` —— OSS 凭据读写（独立文件）
- `companion/src/storage/ossImageStore.test.ts` —— 单测（mock OSS SDK）
- `companion/src/routes/storageOss.ts` —— OSS 凭据管理路由（loopbackGuard 保护）

### 改动文件
- `companion/src/storage/datasetRegistry.ts` —— buildImageStore 的 oss 分支填充
- `companion/src/server.ts` —— 注册 storageOssRoutes
- `companion/package.json` —— 加 ali-oss + @types/ali-oss

## 2. OSS 凭据设计

独立文件 `~/.gpt-image-studio/oss-credentials.json`（0600），不与 provider credentials.json 混：
```json
{
  "endpoint": "oss-cn-hangzhou.aliyuncs.com",
  "bucket": "my-bucket",
  "accessKeyId": "...",
  "accessKeySecret": "...",
  "configuredAt": "..."
}
```

本机模式长期 AK（阶段三改为 STS 临时凭证 D11）。不进项目备份。

## 3. OssImageStore

用 ali-oss SDK：save = put, load = get, remove = delete, estimateBytes = list + sum。

## 4. OSS 路由
- `GET /storage/oss/config`（loopback，返回 endpoint/bucket，**不返回 AK**）
- `PUT /storage/oss/config`（loopback，写入 + 连通性测试）
- `DELETE /storage/oss/config`（loopback）
- `POST /storage/oss/test`（loopback，连通性测试不保存）

## 5. 验收
- typecheck + test 全绿
- OssImageStore 单测 mock SDK
- 连通性测试在错误凭据下返回错误
