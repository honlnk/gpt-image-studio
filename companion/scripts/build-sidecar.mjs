/**
 * 把 Companion 编译成 Tauri sidecar 单文件二进制（bun build --compile）。
 *
 * 产物：
 *   desktop/src-tauri/binaries/companion-<host-triple>   ← Tauri externalBin 约定命名
 *   desktop/src-tauri/resources/companion-admin/          ← admin 管理页静态资源
 *
 * 说明：
 * - 运行时 SQLite 走 bun:sqlite（见 src/storage/sqliteDriver.ts），better-sqlite3
 *   的 V8 专用 addon 在 Bun 运行时无法加载。
 * - proxy-agent 是 ali-oss → urllib 的可选传递依赖（运行时仅在配置了代理环境变量
 *   时才会 require），pnpm 布局下本就不可解析，标记 external 与 npm 版行为一致。
 * - 版本号通过 --define 注入 COMPANION_BUILD_VERSION（二进制内 createRequire 读不到
 *   真实的 package.json）。
 * - Windows triple 的产物名带 .exe 后缀（Tauri externalBin 约定）；跨平台交叉编译
 *   用 SIDECAR_TRIPLE 显式指定目标。
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const companionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(companionRoot, "..");
const pkg = JSON.parse(readFileSync(join(companionRoot, "package.json"), "utf8"));

function requireBun() {
  try {
    execFileSync("bun", ["--version"], { stdio: "pipe" });
  } catch {
    console.error(
      "❌ 未找到 bun。安装：brew install bun（或见 https://bun.com/docs/installation）",
    );
    process.exit(1);
  }
}

function hostTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const match = out.match(/^host:\s*(\S+)$/m);
    if (match) return match[1];
  } catch {
    // rustc 不在 PATH（纯前端环境只想构建 web）时允许显式指定
  }
  if (process.env.SIDECAR_TRIPLE) return process.env.SIDECAR_TRIPLE;
  throw new Error(
    "无法解析 host triple：需要 Rust toolchain（rustc -vV），或显式设置 SIDECAR_TRIPLE",
  );
}

requireBun();
const triple = hostTriple();
// Tauri externalBin 约定：Windows 产物必须带 .exe 后缀（如 companion-x86_64-pc-windows-msvc.exe）
const exeSuffix = triple.includes("windows") ? ".exe" : "";
const binariesDir = join(repoRoot, "desktop", "src-tauri", "binaries");
const target = join(binariesDir, `companion-${triple}${exeSuffix}`);
const staging = join(binariesDir, `.sidecar-staging-${process.pid}`);

mkdirSync(binariesDir, { recursive: true });
rmSync(target, { force: true });
rmSync(staging, { force: true });
rmSync(staging + ".exe", { force: true });

execFileSync(
  "bun",
  [
    "build",
    "--compile",
    join(companionRoot, "src", "main.ts"),
    "--external",
    "proxy-agent",
    "--define",
    `process.env.COMPANION_BUILD_VERSION=${JSON.stringify(pkg.version)}`,
    "--outfile",
    staging,
  ],
  { stdio: "inherit", cwd: companionRoot },
);

// bun 面向 Windows 目标时可能自动给输出补 .exe 后缀，两种产物名都兼容
const staged = existsSync(staging)
  ? staging
  : existsSync(staging + ".exe")
    ? staging + ".exe"
    : null;
if (!staged) {
  console.error(`❌ bun build 未产出二进制（期望 ${staging}${exeSuffix}）`);
  process.exit(1);
}
renameSync(staged, target);

// admin 管理页资源 → Tauri resources（sidecar 通过 COMPANION_ADMIN_DIR 指向这里）
const adminSrc = join(companionRoot, "src", "admin");
const adminDst = join(repoRoot, "desktop", "src-tauri", "resources", "companion-admin");
rmSync(adminDst, { recursive: true, force: true });
cpSync(adminSrc, adminDst, { recursive: true });

console.log(`✅ sidecar binary: ${target}`);
console.log(`✅ admin resources: ${adminDst}`);
