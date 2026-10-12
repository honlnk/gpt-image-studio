import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CJK 硬编码扫描（i18n 防回潮门禁，docs/plans/i18n-plan.md「守护机制」）。
 *
 * 剥离注释后在 src 的 .vue/.ts 源码中查找残留的中文字符（模板文本节点 +
 * 字符串字面量都会命中）。已迁移文件从基线（scripts/cjk-baseline.json）
 * 移除；阶段 2 收尾后基线清零，任何新增硬编码中文都会在此失败。
 *
 * 白名单（结构性排除，不进基线）：
 * - *.test.ts / *.test.tsx —— 测试断言允许中文（断言词库内容本身）
 * - src/locales/** —— 词库本体
 * - src/i18n/** —— i18n 基建（本测试自身）
 */

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const SCAN_ROOT = join(ROOT, "src");
const BASELINE_FILE = join(ROOT, "scripts/cjk-baseline.json");

const CJK = /[\u4e00-\u9fff]/;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(?<![:'"])\/\/.*$/gm, "");
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
      continue;
    }
    if (/\.(vue|ts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function isWhitelisted(relPath: string): boolean {
  return (
    relPath.startsWith("src/locales/") ||
    relPath.startsWith("src/i18n/") ||
    /\.test\.tsx?$/.test(relPath)
  );
}

function findOffenders(): string[] {
  const offenders: string[] = [];
  for (const file of collectFiles(SCAN_ROOT)) {
    const relPath = relative(ROOT, file);
    if (isWhitelisted(relPath)) continue;
    const stripped = stripComments(readFileSync(file, "utf8"));
    if (CJK.test(stripped)) offenders.push(relPath);
  }
  return offenders.sort();
}

describe("CJK 硬编码扫描", () => {
  it("残留中文的文件必须全部在基线内（迁移完成后基线清零）", () => {
    const baseline: string[] = existsSync(BASELINE_FILE)
      ? JSON.parse(readFileSync(BASELINE_FILE, "utf8"))
      : [];
    const baselineSet = new Set(baseline);
    const offenders = findOffenders();

    const notInBaseline = offenders.filter((f) => !baselineSet.has(f));
    expect(
      notInBaseline,
      `以下文件含硬编码中文但不在基线中（新文案必须走词库 t()）：\n${notInBaseline.join("\n")}`,
    ).toEqual([]);
  });
});
