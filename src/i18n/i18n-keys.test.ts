import { describe, expect, it } from "vitest";
import { zhCN } from "../locales/zh-CN";
import { enUS } from "../locales/en-US";

/** 深遍历词库对象，收集所有叶子 key 的点路径。 */
function collectKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("i18n 词库完整性", () => {
  it("zh-CN 与 en-US 的 key 集合完全一致", () => {
    const zhKeys = new Set(collectKeys(zhCN));
    const enKeys = new Set(collectKeys(enUS));

    const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key));
    const extraInEn = [...enKeys].filter((key) => !zhKeys.has(key));

    expect(
      missingInEn,
      `en-US 缺少这些 key：${missingInEn.join(", ")}`,
    ).toEqual([]);
    expect(
      extraInEn,
      `en-US 多出这些 key（zh-CN 没有）：${extraInEn.join(", ")}`,
    ).toEqual([]);
  });
});
