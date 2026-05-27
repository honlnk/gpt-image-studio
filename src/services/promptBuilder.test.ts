import { describe, expect, it } from "vitest";
import { buildImagePrompt, selectInspirationTerms } from "./promptBuilder";
import { promptWordbanks } from "./promptWordbanks";

describe("buildImagePrompt", () => {
  it("returns the original prompt unchanged in default mode", () => {
    expect(buildImagePrompt({
      prompt: "画一张雨夜街头照片",
      mode: "default",
    })).toBe("画一张雨夜街头照片");
  });

  it("wraps safe mode prompts with safe guidance and inspiration", () => {
    const prompt = buildImagePrompt({
      prompt: "画一张雨夜街头照片",
      mode: "safe",
      seed: "fixed",
    });

    expect(prompt).toContain("当前模式：安全");
    expect(prompt).toContain("不要添加成人、裸露、色情或露骨元素");
    expect(prompt).toContain("用户原始提示词：\n画一张雨夜街头照片");
  });

  it("wraps creative mode prompts with creative guidance", () => {
    const prompt = buildImagePrompt({
      prompt: "画一张赛博朋克肖像",
      mode: "creative",
      seed: "fixed",
    });

    expect(prompt).toContain("当前模式：创意");
    expect(prompt).toContain("性感氛围");
    expect(prompt).toContain("灵感词：");
  });

  it("adds adult inspiration terms in adult mode", () => {
    const terms = selectInspirationTerms("adult", "fixed");
    const adultInspiration = promptWordbanks.adultInspiration as readonly string[];

    expect(terms.length).toBe(5);
    expect(terms.some((term) => adultInspiration.includes(term))).toBe(true);
  });
});
