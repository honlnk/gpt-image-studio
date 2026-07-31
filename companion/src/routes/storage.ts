import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  deleteDatasetCascade,
  ensureDefaultDataset,
  getActiveImageStore,
  listDatasetViews,
  renameDatasetView,
  resolveAndActivate,
} from "../storage/datasetRegistry.js";
import {
  clearTable,
  deleteRecord,
  estimateMetadataBytes,
  getRecord,
  listTable,
  putRecord,
  closeAllBusinessDbs,
} from "../storage/businessDb.js";
import { isBusinessTable } from "../storage/schema.js";
import { StorageStoreError } from "../storage/errors.js";
import { validateCustomDirectory } from "../storage/fileSystemImageStore.js";
import type {
  DatasetView,
  ImageStoreKind,
  StorageConfig,
  StorageKind,
} from "../storage/types.js";

/**
 * 存储路由：把 Companion 的 SQLite + 图片存储能力通过 HTTP 暴露给前端 CompanionStorage。
 *
 * 对应 evolution-roadmap.md 第七章「关键工作 1-2」：
 * - 7 张业务表 CRUD（/storage/:table/*）
 * - 图片二进制读写（/storage/blobs/*）
 * - 配置读写（/storage/config/*）
 * - 数据集管理（/storage/datasets/*）
 * - 容量估算（/storage/usage）
 *
 * 鉴权：全部走 bearer accessKey（authMiddleware 在 server.ts 注册本 plugin 之前生效）。
 * 阶段二本机单用户场景，连上 Companion 即持有 accessKey，无需额外管理面区分。
 *
 * 表名安全：:table 参数走 isBusinessTable 白名单校验，防 SQL 注入（表名无法参数化）。
 *
 * 错误边界：StorageStoreError → 400/500 + { error }；其余异常重新抛出交 Fastify 默认处理。
 */

/** 把 StorageStoreError 转成 HTTP 响应。返回 true 表示已处理。 */
export function handleStorageStoreError(error: unknown, reply: FastifyReply): boolean {
  if (error instanceof StorageStoreError) {
    const status =
      error.code === "STORAGE_INVALID_TABLE" || error.code === "STORAGE_INVALID_KEY"
        ? 400
        : 500;
    reply.status(status).send({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

/** 解析当前用户激活数据集，拿 dbPath + imageStore。无 active 时返回 503 引导前端初始化。 */
async function requireActive(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ dataset: DatasetView; dbPath: string; imageStore: NonNullable<Awaited<ReturnType<typeof getActiveImageStore>>>["imageStore"] } | undefined> {
  const userId = req.user?.userId;
  if (!userId) {
    // authMiddleware 应已挂载 req.user，这里防御性检查
    reply.status(401).send({ error: "未授权" });
    return undefined;
  }
  const active = await getActiveImageStore(userId);
  if (!active) {
    reply.status(503).send({
      error: "无激活数据集，请先调用 POST /storage/datasets/activate 初始化",
    });
    return undefined;
  }
  return { dataset: active.dataset, dbPath: active.dataset.db_path, imageStore: active.imageStore };
}

export async function storageRoutes(app: FastifyInstance) {
  // ─── 数据集管理（多租户：从 req.user.userId 定位用户） ───

  app.get("/storage/datasets", async (req) => {
    const userId = req.user?.userId ?? "__local__";
    return { datasets: listDatasetViews(userId) };
  });

  app.get("/storage/datasets/active", async (req, reply) => {
    const userId = req.user?.userId ?? "__local__";
    const active = await getActiveImageStore(userId);
    if (!active) {
      return reply.status(404).send({ error: "无激活数据集" });
    }
    return { dataset: active.dataset };
  });

  app.post("/storage/datasets/activate", async (req, reply) => {
    const userId = req.user?.userId ?? "__local__";
    const body = req.body as ActivateDatasetBody;
    const validation = validateActivateBody(body);
    if (validation) {
      return reply.status(400).send({ error: validation });
    }

    // 选项 A（自定义目录）需校验目录合法性
    if (body.imageStoreKind === "filesystem-custom") {
      const dirError = validateCustomDirectory(
        (body.storageConfig as { directory: string }).directory,
      );
      if (dirError) {
        return reply.status(400).send({ error: dirError.message, code: dirError.code });
      }
    }

    try {
      const result = await resolveAndActivate({
        storageKind: body.storageKind,
        storageConfig: body.storageConfig,
        imageStoreKind: body.imageStoreKind,
        label: body.label,
        userId,
      });
      // 切换数据集后关闭该用户的业务 db 连接，避免连接泄漏（新数据集的连接按需建立）
      closeAllBusinessDbs();
      return { dataset: result.dataset, created: result.created };
    } catch (error) {
      if (handleStorageStoreError(error, reply)) return;
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/storage/datasets/:id",
    async (req, reply) => {
      const userId = req.user?.userId ?? "__local__";
      try {
        await deleteDatasetCascade(req.params.id, userId);
        closeAllBusinessDbs();
        return { ok: true };
      } catch (error) {
        if (handleStorageStoreError(error, reply)) return;
        throw error;
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/storage/datasets/:id",
    async (req, reply) => {
      const userId = req.user?.userId ?? "__local__";
      const body = req.body as { label?: string };
      if (!body.label || typeof body.label !== "string") {
        return reply.status(400).send({ error: "缺少 label 字段" });
      }
      try {
        renameDatasetView(req.params.id, body.label, userId);
        return { ok: true };
      } catch (error) {
        if (handleStorageStoreError(error, reply)) return;
        throw error;
      }
    },
  );

  // ─── 业务表 CRUD ───

  app.get<{ Params: { table: string } }>(
    "/storage/:table",
    async (req, reply) => {
      if (!isBusinessTable(req.params.table)) {
        return reply.status(400).send({ error: `未知表名：${req.params.table}` });
      }
      const active = await requireActive(req, reply);
      if (!active) return;
      try {
        return { data: listTable(active.dbPath, req.params.table) };
      } catch (error) {
        if (handleStorageStoreError(error, reply)) return;
        throw error;
      }
    },
  );

  app.get<{ Params: { table: string; key: string } }>(
    "/storage/:table/:key",
    async (req, reply) => {
      if (!isBusinessTable(req.params.table)) {
        return reply.status(400).send({ error: `未知表名：${req.params.table}` });
      }
      const active = await requireActive(req, reply);
      if (!active) return;
      try {
        const record = getRecord(active.dbPath, req.params.table, req.params.key);
        if (record === undefined) {
          return reply.status(404).send({ error: "记录不存在" });
        }
        return record;
      } catch (error) {
        if (handleStorageStoreError(error, reply)) return;
        throw error;
      }
    },
  );

  app.put<{ Params: { table: string; key: string } }>(
    "/storage/:table/:key",
    async (req, reply) => {
      if (!isBusinessTable(req.params.table)) {
        return reply.status(400).send({ error: `未知表名：${req.params.table}` });
      }
      const active = await requireActive(req, reply);
      if (!active) return;
      try {
        putRecord(active.dbPath, req.params.table, req.params.key, req.body);
        return { ok: true };
      } catch (error) {
        if (handleStorageStoreError(error, reply)) return;
        throw error;
      }
    },
  );

  app.delete<{ Params: { table: string; key: string } }>(
    "/storage/:table/:key",
    async (req, reply) => {
      if (!isBusinessTable(req.params.table)) {
        return reply.status(400).send({ error: `未知表名：${req.params.table}` });
      }
      const active = await requireActive(req, reply);
      if (!active) return;
      try {
        deleteRecord(active.dbPath, req.params.table, req.params.key);
        return { ok: true };
      } catch (error) {
        if (handleStorageStoreError(error, reply)) return;
        throw error;
      }
    },
  );

  app.delete<{ Params: { table: string } }>(
    "/storage/:table",
    async (req, reply) => {
      if (!isBusinessTable(req.params.table)) {
        return reply.status(400).send({ error: `未知表名：${req.params.table}` });
      }
      const active = await requireActive(req, reply);
      if (!active) return;
      try {
        clearTable(active.dbPath, req.params.table);
        return { ok: true };
      } catch (error) {
        if (handleStorageStoreError(error, reply)) return;
        throw error;
      }
    },
  );

  // ─── 图片二进制 ───

  // multipart 解析：与 images.ts 的 /images/edits 同模式，累积 Buffer
  app.addContentTypeParser("multipart/form-data", function (_req, payload, done) {
    const chunks: Buffer[] = [];
    payload.on("data", (chunk: Buffer) => chunks.push(chunk));
    payload.on("end", () => done(null, Buffer.concat(chunks)));
    payload.on("error", done);
  });

  app.post<{ Params: { key: string } }>(
    "/storage/blobs/:key",
    async (req, reply) => {
      const active = await requireActive(req, reply);
      if (!active) return;

      const contentType = req.headers["content-type"] ?? "";
      let fileBuffer: Buffer;
      let mimeType: string;

      if (contentType.startsWith("multipart/form-data")) {
        const parsed = parseBlobMultipart(req.body as Buffer, contentType);
        if (!parsed) {
          return reply.status(400).send({ error: "multipart 缺少 file 字段" });
        }
        fileBuffer = parsed.file;
        mimeType = parsed.mimeType;
      } else {
        // 允许直接 PUT 原始二进制 + Content-Type 头
        fileBuffer = req.body as Buffer;
        mimeType = contentType || "application/octet-stream";
      }

      try {
        const result = await active.imageStore.save(req.params.key, fileBuffer, mimeType);
        // 同时在 imageBlobs 表记元信息（用于 load 时补 mimeType + 容量估算）
        putRecord(active.dbPath, "imageBlobs", req.params.key, {
          key: req.params.key,
          size: result.size,
          mimeType: result.mimeType,
          createdAt: new Date().toISOString(),
        });
        return { size: result.size, mimeType: result.mimeType };
      } catch (error) {
        if (handleStorageStoreError(error, reply)) return;
        throw error;
      }
    },
  );

  app.get<{ Params: { key: string } }>(
    "/storage/blobs/:key",
    async (req, reply) => {
      const active = await requireActive(req, reply);
      if (!active) return;
      const loaded = await active.imageStore.load(req.params.key);
      if (!loaded) {
        return reply.status(404).send({ error: "图片不存在" });
      }
      // 优先用 imageBlobs 表记录的 mimeType（选项 B 不透明 Blob 模式下 imageStore 返回 FALLBACK_MIME）
      const meta = getRecord<{ mimeType?: string }>(
        active.dbPath,
        "imageBlobs",
        req.params.key,
      );
      const mimeType = meta?.mimeType ?? loaded.mimeType;
      reply.header("Content-Type", mimeType);
      reply.header("Content-Length", loaded.data.byteLength);
      return reply.send(loaded.data);
    },
  );

  app.delete<{ Params: { key: string } }>(
    "/storage/blobs/:key",
    async (req, reply) => {
      const active = await requireActive(req, reply);
      if (!active) return;
      await active.imageStore.remove(req.params.key);
      // 同步删 imageBlobs 元信息（key 不存在是 no-op）
      deleteRecord(active.dbPath, "imageBlobs", req.params.key);
      return { ok: true };
    },
  );

  app.get<{ Params: { key: string } }>(
    "/storage/blobs/:key/size",
    async (req, reply) => {
      const active = await requireActive(req, reply);
      if (!active) return;
      const meta = getRecord<{ size?: number }>(
        active.dbPath,
        "imageBlobs",
        req.params.key,
      );
      if (!meta) {
        return reply.status(404).send({ error: "图片不存在" });
      }
      return { size: meta.size ?? 0 };
    },
  );

  // ─── 配置读写（settings 表的 __config__: 命名空间） ───

  const CONFIG_PREFIX = "__config__:";

  app.get<{ Params: { key: string } }>(
    "/storage/config/:key",
    async (req, reply) => {
      const active = await requireActive(req, reply);
      if (!active) return;
      const value = getRecord(active.dbPath, "settings", `${CONFIG_PREFIX}${req.params.key}`);
      if (value === undefined) {
        return reply.status(404).send({ error: "配置项不存在" });
      }
      // 用 { value } 包装：value 可能是任意类型（字符串/对象/数字），
      // 直接 return 会让 Fastify 对字符串值原样发送（不带 JSON 引号），前端无法 JSON.parse。
      return { value };
    },
  );

  app.put<{ Params: { key: string } }>(
    "/storage/config/:key",
    async (req, reply) => {
      const active = await requireActive(req, reply);
      if (!active) return;
      try {
        putRecord(active.dbPath, "settings", `${CONFIG_PREFIX}${req.params.key}`, req.body);
        return { ok: true };
      } catch (error) {
        if (handleStorageStoreError(error, reply)) return;
        throw error;
      }
    },
  );

  // ─── 容量估算 ───

  app.get("/storage/usage", async (req, reply) => {
    const active = await requireActive(req, reply);
    if (!active) return;
    const imageBytes = await active.imageStore.estimateBytes();
    const metadataBytes = estimateMetadataBytes(active.dbPath);
    return { imageBytes, metadataBytes };
  });
}

// ─── 请求体类型与校验 ───

export type ActivateDatasetBody = {
  storageKind: StorageKind;
  storageConfig: StorageConfig;
  imageStoreKind: ImageStoreKind;
  label?: string;
};

export function validateActivateBody(body: Partial<ActivateDatasetBody>): string | undefined {
  if (!body) return "请求体为空";
  if (body.storageKind !== "filesystem" && body.storageKind !== "oss") {
    return "storageKind 必须是 filesystem 或 oss";
  }
  if (
    body.imageStoreKind !== "filesystem-default" &&
    body.imageStoreKind !== "filesystem-custom" &&
    body.imageStoreKind !== "oss"
  ) {
    return "imageStoreKind 非法";
  }
  // storageKind 与 imageStoreKind 一致性
  if (body.storageKind === "filesystem" && body.imageStoreKind === "oss") {
    return "storageKind=filesystem 时 imageStoreKind 不能是 oss";
  }
  if (body.storageKind === "oss" && body.imageStoreKind !== "oss") {
    return "storageKind=oss 时 imageStoreKind 必须是 oss";
  }
  if (!body.storageConfig || typeof body.storageConfig !== "object") {
    return "storageConfig 缺失";
  }
  if (body.storageKind === "filesystem") {
    // filesystem-default 的 directory 由 Companion 决定（resolveAndActivate 回填默认目录），
    // 前端传空串占位即可，不做非空校验。
    if (body.imageStoreKind !== "filesystem-default") {
      const dir = (body.storageConfig as { directory?: unknown }).directory;
      if (typeof dir !== "string" || dir.length === 0) {
        return "filesystem 模式需要 directory 字段";
      }
    }
  } else {
    const oss = body.storageConfig as { endpoint?: unknown; bucket?: unknown; prefix?: unknown };
    if (typeof oss.endpoint !== "string" || typeof oss.bucket !== "string") {
      return "oss 模式需要 endpoint 和 bucket 字段";
    }
  }
  return undefined;
}

/** 简易 multipart/form-data 解析：提取 name="file" 的二进制 + name="mimeType" 的文本。 */
function parseBlobMultipart(
  body: Buffer,
  contentType: string,
): { file: Buffer; mimeType: string } | undefined {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return undefined;

  // 算法对齐 providers/multipart.ts 的 parseMultipart：用 \r\n--boundary 作为 part 结束标记。
  const dashBoundary = Buffer.from(`--${boundary}`);
  const crlfBoundary = Buffer.from(`\r\n--${boundary}`);
  let file: Buffer | undefined;
  let mimeType = "application/octet-stream";

  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(dashBoundary, cursor);
    if (start === -1) break;
    const afterBoundary = start + dashBoundary.length;
    // 结束标记 --boundary--
    if (body[afterBoundary] === 0x2d && body[afterBoundary + 1] === 0x2d) break;

    // 跳过 boundary 后的 \r\n
    let partStart = afterBoundary;
    if (body[partStart] === 0x0d && body[partStart + 1] === 0x0a) {
      partStart += 2;
    } else {
      cursor = afterBoundary;
      continue;
    }

    // 找 \r\n--boundary 作为本 part 结束
    const partEnd = body.indexOf(crlfBoundary, partStart);
    if (partEnd === -1) break;

    // header/body 分界
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd === -1 || headerEnd > partEnd) {
      cursor = partEnd;
      continue;
    }

    const headerStr = body.subarray(partStart, headerEnd).toString("latin1");
    const bodyStart = headerEnd + 4;
    const content = body.subarray(bodyStart, partEnd);

    const nameMatch = /name="([^"]*)"/.exec(headerStr);
    const name = nameMatch?.[1];
    if (name === "file") {
      file = content;
    } else if (name === "mimeType") {
      mimeType = content.toString("utf-8");
    }
    cursor = partEnd;
  }
  if (!file) return undefined;
  return { file, mimeType };
}

/** 暴露 ensureDefaultDataset 供 server.ts 启动时调用。 */
export { ensureDefaultDataset };
