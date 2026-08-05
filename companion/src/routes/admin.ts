import type { FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import { loopbackGuard } from "../middleware/loopback.js";
import { buildAuthStatus } from "./auth.js";
import { readLogsTail } from "./logs.js";
import {
  handleStorageStoreError,
  validateActivateBody,
  type ActivateDatasetBody,
} from "./storage.js";
import {
  listDatasetViews,
  resolveAndActivate,
} from "../storage/datasetRegistry.js";
import { closeAllBusinessDbs } from "../storage/businessDb.js";
import { LOCAL_USER_ID } from "../storage/db.js";
import { pickDirectoryNative } from "../storage/directoryPicker.js";
import { validateCustomDirectory } from "../storage/fileSystemImageStore.js";
import type { CompanionAuthStatus, CompanionLogsTailResponse } from "../types.js";

/**
 * Companion 自带管理页（阶段零：边界正本清源）。
 *
 * 替代 Web 项目历史遗留的 /companion 路由页面，让 provider 凭据管理回到 Companion 自己手里。
 * 详见 docs/evolution-roadmap.md 第四章。
 *
 * 三部分组成：
 *   1) loopbackGuard：保护整个 /admin 命名空间（只允许本机浏览器/白名单 origin）。
 *   2) /admin/api/status、/admin/api/logs：管理页专用的状态/日志接口。
 *      复用 auth.ts/logs.ts 抽取的核心逻辑，但不走 accessKey（loopbackGuard 已足够）。
 *   3) @fastify/static：serve admin/ 目录下的原生 HTML/CSS/JS 资源到 /admin。
 *
 * 注册顺序（见 server.ts）：必须比 authMiddleware 更早注册，
 * 否则浏览器直接访问 /admin 会被 bearer 守卫拦成 401（浏览器导航不会带 Authorization 头）。
 * /admin/* 前缀在 authMiddleware 里被显式跳过，鉴权交给本 plugin 内的 loopbackGuard。
 *
 * API 路由必须在 @fastify/static 之前注册：Fastify 按"先注册先匹配"，
 * static 是兜底处理（无精确匹配时才回退到 index.html），不会吞掉 /admin/api/*。
 */
type AdminRoutesOptions = {
  allowedOrigins?: string[];
};

// admin 资源目录解析：dev（tsx 跑 src/routes/admin.ts）和 prod（dist/routes/admin.js）
// 都通过 import.meta.url 定位，回到同级的 ../admin/。
// 编译产物布局：dist/routes/admin.js + dist/admin/*（build 脚本 cp -r src/admin dist/admin）。
const ADMIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "admin");

export async function adminRoutes(app: FastifyInstance, opts?: AdminRoutesOptions) {
  // 1) loopback 守卫：保护 /admin 命名空间下所有路由（API + 静态资源）。
  await loopbackGuard(app, opts?.allowedOrigins ?? []);

  // 2) 管理页专用 API：复用 auth/logs 的核心逻辑，但不走 accessKey。
  //    与 /auth/status、/logs/tail 行为一致，只是鉴权模型不同（loopbackGuard 替代 bearer）。
  app.get<{ Reply: CompanionAuthStatus }>("/admin/api/status", async () => buildAuthStatus());

  app.get<{
    Querystring: { lines?: string; date?: string };
    Reply: CompanionLogsTailResponse;
  }>("/admin/api/logs", async (req) => {
    return readLogsTail({
      lines: Number(req.query?.lines) || undefined,
      date: req.query?.date,
    });
  });

  // 数据集（存储位置）管理：web 端设置页不再提供，归管理页（loopbackGuard 本机信任）。
  // userId 固定 __local__——管理页是本机单用户管理面，server 模式多租户不经过这里。
  app.get("/admin/api/datasets", async () => {
    return { datasets: listDatasetViews(LOCAL_USER_ID) };
  });

  app.post("/admin/api/datasets/activate", async (req, reply) => {
    const body = req.body as ActivateDatasetBody;
    const validation = validateActivateBody(body);
    if (validation) {
      return reply.status(400).send({ error: validation });
    }
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
        userId: LOCAL_USER_ID,
      });
      // 切换数据集后关闭该用户的业务 db 连接，避免连接泄漏（新数据集的连接按需建立）
      closeAllBusinessDbs();
      return { dataset: result.dataset, created: result.created };
    } catch (error) {
      if (handleStorageStoreError(error, reply)) return;
      throw error;
    }
  });

  // 原生目录选择框：管理页「选择文件夹…」按钮（浏览器拿不到绝对路径，由同机的 Companion 代弹）。
  // 结构化返回 { ok, path? , canceled? , error? }，恒 200，错误由前端展示。
  app.post("/admin/api/pick-directory", async () => {
    return pickDirectoryNative();
  });

  // 3) 静态资源 serve。开发期 admin/ 可能还没构建，缺失时给清晰错误而非崩溃。
  if (!existsSync(ADMIN_DIR)) {
    app.get("/admin", async () => ({
      error:
        "admin 资源目录未找到。开发期请确认 companion/src/admin/ 存在；" +
        "发布包请重新 build（pnpm build 会 cp -r src/admin dist/admin）。",
    }));
    return;
  }

  await app.register(fastifyStatic, {
    root: ADMIN_DIR,
    prefix: "/admin",
    // 访问 /admin（无尾斜杠）时重定向到 /admin/，让浏览器正确解析相对资源路径。
    redirect: true,
    // 不暴露目录列表
    list: false,
    decorateReply: true,
  });
}
