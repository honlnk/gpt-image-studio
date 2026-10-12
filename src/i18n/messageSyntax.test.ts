import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import { zhCN } from "../locales/zh-CN";
import { enUS } from "../locales/en-US";

/**
 * vue-i18n 消息语法守卫：词库文案在首次 t() 时才懒编译，typecheck / keys
 * 相等性测试都不覆盖语法错误（裸 `@`、不配对花括号、复数管道误用等只有
 * 编译期才炸，阶段 5 曾因此 SSG build 失败）。这里强制编译两个词库的全部
 * 叶子键，把该类错误拦在测试门禁。
 */

function collectLeafKeys(node: unknown, prefix = ""): string[] {
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      collectLeafKeys(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return prefix ? [prefix] : [];
}

describe("vue-i18n 词库消息语法", () => {
  it.each([
    ["zh-CN", zhCN],
    ["en-US", enUS],
  ] as const)("%s 全部叶子键可编译", (_locale, messages) => {
    const i18n = createI18n({
      legacy: false,
      locale: "probe",
      messages: { probe: messages },
    });
    const failures: string[] = [];
    for (const key of collectLeafKeys(messages)) {
      try {
        i18n.global.t(key);
      } catch (error) {
        failures.push(`${key}: ${(error as Error).message.split("\n")[0]}`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
