/**
 * FileSystemImageStore —— 文件系统图片存储 adapter。
 *
 * 覆盖 D6 的选项 A 和 B：
 * - 选项 A（filesystem-custom）：用户指定目录，opaqueNaming=false，文件名带扩展名，
 *   用户可用文件管理器直接打开。
 * - 选项 B（filesystem-default）：Companion 默认目录（~/.gpt-image-studio/images），
 *   opaqueNaming=true，文件名无扩展名（不透明 Blob），用户无法直接识别内容。
 *
 * 文件命名：
 * - opaqueNaming=false（选项 A）：`${blobKey}.${ext}`，ext 从 mimeType 推导。
 *   load 时按 blobKey 精确匹配文件名主体（不含扩展名）。
 * - opaqueNaming=true（选项 B）：文件名 = `${blobKey}`（无扩展名）。
 *
 * 权限：文件 0600，rootDir 0700（与 credentials.json 同级别保护）。
 * mimeType 语义：选项 A load 时从扩展名反推；选项 B 返回 FALLBACK_MIME，
 * 调用方（路由层）从业务 db imageBlobs 表的元信息补全真实 mimeType。
 */
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import type { ImageStore, LoadedImage, SavedImage } from "./imageStore.js";
import { EXT_TO_MIME, FALLBACK_MIME, MIME_TO_EXT } from "./imageStore.js";
import type { ImageStoreKind } from "./types.js";

export function createFileSystemImageStore(opts: {
  rootDir: string;
  opaqueNaming: boolean;
  kind: Extract<ImageStoreKind, "filesystem-default" | "filesystem-custom">;
}): ImageStore {
  const { rootDir, opaqueNaming, kind } = opts;

  // rootDir 首次写入时创建（避免初始化时空目录报错）
  function ensureRoot(): void {
    if (!existsSync(rootDir)) {
      mkdirSync(rootDir, { recursive: true, mode: 0o700 });
    }
  }

  /** 根据 blobKey + mimeType 推导文件名。 */
  function buildFilename(key: string, mimeType: string): string {
    if (opaqueNaming) {
      return key; // 选项 B：无扩展名
    }
    const ext = MIME_TO_EXT[mimeType] ?? "bin";
    return `${key}.${ext}`;
  }

  return {
    kind,

    async save(key: string, data: Buffer, mimeType: string): Promise<SavedImage> {
      ensureRoot();
      const filename = buildFilename(key, mimeType);
      writeFileSync(join(rootDir, filename), data, { mode: 0o600 });
      return { size: data.byteLength, mimeType };
    },

    async load(key: string): Promise<LoadedImage | undefined> {
      ensureRoot();
      if (opaqueNaming) {
        // 选项 B：文件名 = blobKey，无扩展名，mimeType 无法反推
        const filepath = join(rootDir, key);
        if (!existsSync(filepath)) return undefined;
        return { data: readFileSync(filepath), mimeType: FALLBACK_MIME };
      }
      // 选项 A：blobKey 是文件名主体，需精确匹配 `${key}.${ext}`
      const matched = findFileByKey(rootDir, key);
      if (!matched) return undefined;
      return { data: readFileSync(matched.filepath), mimeType: matched.mimeType };
    },

    async remove(key: string): Promise<void> {
      ensureRoot();
      if (opaqueNaming) {
        safeUnlink(join(rootDir, key));
        return;
      }
      // 选项 A：删匹配 `${key}.${ext}` 的文件
      const matched = findFileByKey(rootDir, key);
      if (matched) safeUnlink(matched.filepath);
    },

    async estimateBytes(): Promise<number> {
      if (!existsSync(rootDir)) return 0;
      let total = 0;
      for (const name of readdirSync(rootDir)) {
        try {
          total += statSync(join(rootDir, name)).size;
        } catch {
          // 文件中途被删或权限问题，跳过
        }
      }
      return total;
    },
  };
}

/** 按 blobKey 精确匹配文件名主体（选项 A 用）。返回 filepath + 从扩展名反推的 mimeType。 */
function findFileByKey(
  rootDir: string,
  key: string,
): { filepath: string; mimeType: string } | undefined {
  for (const name of readdirSync(rootDir)) {
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx <= 0) continue; // 无扩展名或隐藏文件（.xxx）
    const baseName = name.slice(0, dotIdx);
    const ext = name.slice(dotIdx + 1).toLowerCase();
    if (baseName === key) {
      const mimeType = EXT_TO_MIME[ext] ?? FALLBACK_MIME;
      return { filepath: join(rootDir, name), mimeType };
    }
  }
  return undefined;
}

function safeUnlink(filepath: string): void {
  try {
    unlinkSync(filepath);
  } catch {
    // 不存在或权限问题，no-op（语义：remove key 不存在是 no-op）
  }
}

// ─── 选项 A 目录合法性校验（目录选择时调用，非 ImageStore 内部） ───

/** 系统敏感目录黑名单（选项 A 拒绝选这些目录）。 */
const FORBIDDEN_DIRS = [
  "/",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/var",
  "/System",
  "/Library",
  "/private/etc",
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
];

export type DirectoryValidationError = {
  code: "NOT_ABSOLUTE" | "NOT_EXIST" | "NOT_WRITABLE" | "FORBIDDEN_SYSTEM_DIR";
  message: string;
};

/**
 * 校验用户选择的图片目录是否合法（选项 A 专用）。
 *
 * 规则：
 * - 必须绝对路径（避免 cwd 漂移导致数据丢失）。
 * - 必须存在且可写（不自动创建——避免误创建到意外位置）。
 * - 拒绝系统敏感目录。
 *
 * @returns 校验通过返回 undefined；失败返回错误对象。
 */
export function validateCustomDirectory(
  dir: string,
): DirectoryValidationError | undefined {
  if (!isAbsolute(dir)) {
    return { code: "NOT_ABSOLUTE", message: "目录必须是绝对路径" };
  }
  // normalize 后去掉尾部分隔符：normalize("/etc/") = "/etc/"，
  // 需统一成 "/etc" 才能命中黑名单（根目录 "/" 保留不剥）
  const normalized = normalize(dir);
  const cleaned =
    normalized.length > 1 && (normalized.endsWith("/") || normalized.endsWith("\\"))
      ? normalized.replace(/[\\/]+$/, "")
      : normalized;
  if (FORBIDDEN_DIRS.includes(cleaned)) {
    return { code: "FORBIDDEN_SYSTEM_DIR", message: "不允许选择系统敏感目录" };
  }
  if (!existsSync(normalized)) {
    return { code: "NOT_EXIST", message: "目录不存在，请先创建" };
  }
  let stat;
  try {
    stat = statSync(normalized);
  } catch {
    return { code: "NOT_EXIST", message: "目录不存在，请先创建" };
  }
  if (!stat.isDirectory()) {
    return { code: "NOT_EXIST", message: "路径不是目录" };
  }
  try {
    accessSync(normalized, constants.W_OK);
  } catch {
    return { code: "NOT_WRITABLE", message: "目录不可写" };
  }
  return undefined;
}
