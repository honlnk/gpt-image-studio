import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPANION_EDIT_FIELDS,
  COMPANION_GENERATE_FIELDS,
} from "./companion";

/**
 * Web ↔ Companion 已知字段镜像契约测试。
 *
 * 背景：Web 侧的 `COMPANION_GENERATE_FIELDS` / `COMPANION_EDIT_FIELDS`
 * 与 `companion/src/shared/knownFields.ts` 的 `KNOWN_*` 是一份手工镜像
 * （软共享：没让 Web 直接 import companion 包，避免引入 companion 构建依赖）。
 *
 * 本测试读 companion 源文件并提取字段集合，断言两端完全一致——任何一端
 * 漏改新增字段，都会让本测试在 CI 失败，把「能力静默失效」转化为显式报错。
 *
 * 详见 docs/companion-provider-adapter-review.md P1 第 5 项「系统性风险」。
 */

const thisDir = dirname(fileURLToPath(import.meta.url));
const companionKnownFieldsFile = resolve(
  thisDir,
  "../../companion/src/shared/knownFields.ts",
);

const companionSrc = readFileSync(companionKnownFieldsFile, "utf-8");

/**
 * 从 companion/src/shared/knownFields.ts 源码里提取某个 `as const` 数组的字段名。
 *
 * 约束：常量必须保持 `export const NAME = [ "a", "b", ... ] as const;` 的字面量格式。
 * 本函数的脆弱性是软共享方案的固有代价——任何格式变更（如改成对象键、多行注释）
 * 都要同步更新这里的正则；这本身也是「两端同步」承诺的一部分。
 */
function extractFieldsFromSource(source: string, constName: string): string[] {
  // 匹配 `const NAME = [ ... ] as const`，中括号内容跨行
  const arrayRegex = new RegExp(
    `export\\s+const\\s+${constName}\\s*=\\s*\\[s*([\\s\\S]*?)\\s*\\]\\s*as\\s+const`,
  );
  const match = source.match(arrayRegex);
  if (!match) {
    throw new Error(
      `无法在 companion/src/shared/knownFields.ts 里找到常量 ${constName}。\n` +
        `可能是格式被改动（如改成对象、移除 as const 等），请同步更新本测试的正则。`,
    );
  }
  // 提取所有 "..." 字符串字面量
  const fields = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (fields.length === 0) {
    throw new Error(`常量 ${constName} 解析到 0 个字段，正则或源文件可能有误。`);
  }
  return fields;
}

describe("companion known fields contract (web mirror ↔ companion source)", () => {
  it("COMPANION_GENERATE_FIELDS 与 companion KNOWN_GENERATE_FIELDS 完全一致", () => {
    const companionFields = extractFieldsFromSource(
      companionSrc,
      "KNOWN_GENERATE_FIELDS",
    );
    expect([...COMPANION_GENERATE_FIELDS].sort()).toEqual(
      [...companionFields].sort(),
    );
  });

  it("COMPANION_EDIT_FIELDS 与 companion KNOWN_EDIT_FIELDS 完全一致", () => {
    const companionFields = extractFieldsFromSource(
      companionSrc,
      "KNOWN_EDIT_FIELDS",
    );
    expect([...COMPANION_EDIT_FIELDS].sort()).toEqual(
      [...companionFields].sort(),
    );
  });

  it("companion knownFields.ts 文件存在且可读", () => {
    // 防御：如果 companion 目录被移走或文件被删，给出明确诊断而不是神秘正则失败
    expect(companionSrc.length).toBeGreaterThan(0);
    expect(companionSrc).toContain("KNOWN_GENERATE_FIELDS");
    expect(companionSrc).toContain("KNOWN_EDIT_FIELDS");
  });
});
