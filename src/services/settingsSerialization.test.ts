import { describe, expect, it } from "vitest";
import {
  MAX_PROMPT_REWRITE_GUARD_HISTORY,
  addPromptGuardHistoryItem,
  displayApiBaseUrl,
  getPromptWordbankTerms,
  normalizeBackground,
  normalizePromptRewriteGuardHistory,
  setPromptWordbankTerms,
  stripImagesApiPath,
  toPlainFavoritePrompt,
  toPlainPromptRewriteGuardHistoryItem,
} from "./settingsSerialization";
import type {
  FavoritePrompt,
  PromptRewriteGuardHistoryItem,
  PromptWordbanks,
} from "../types/studio";

const WORD_BANKS: PromptWordbanks = {
  pose: { safe: ["a"], creative: ["b"], nsfw: ["c"] },
  adultInspiration: ["d"],
};

describe("getPromptWordbankTerms", () => {
  it("returns pose.safe terms for pose.safe section", () => {
    expect(getPromptWordbankTerms(WORD_BANKS, "pose.safe")).toEqual(["a"]);
  });

  it("returns pose.creative terms for pose.creative section", () => {
    expect(getPromptWordbankTerms(WORD_BANKS, "pose.creative")).toEqual(["b"]);
  });

  it("returns pose.nsfw terms for pose.nsfw section", () => {
    expect(getPromptWordbankTerms(WORD_BANKS, "pose.nsfw")).toEqual(["c"]);
  });

  it("returns adultInspiration terms for adultInspiration section", () => {
    expect(getPromptWordbankTerms(WORD_BANKS, "adultInspiration")).toEqual(["d"]);
  });
});

describe("setPromptWordbankTerms", () => {
  it("returns new wordbanks with updated section (immutably)", () => {
    const next = setPromptWordbankTerms(WORD_BANKS, "pose.safe", ["x", "y"]);
    expect(next.pose.safe).toEqual(["x", "y"]);
    // 原对象不变
    expect(WORD_BANKS.pose.safe).toEqual(["a"]);
  });

  it("leaves other sections unchanged", () => {
    const next = setPromptWordbankTerms(WORD_BANKS, "adultInspiration", ["z"]);
    expect(next.pose.safe).toEqual(["a"]);
    expect(next.adultInspiration).toEqual(["z"]);
  });
});

describe("normalizePromptRewriteGuardHistory", () => {
  it("returns empty-array-derived history with currentText inserted when history is empty", () => {
    const result = normalizePromptRewriteGuardHistory([], "current text");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("current text");
    expect(result[0].id).toBeTruthy();
    expect(result[0].createdAt).toBeTruthy();
  });

  it("dedupes by text and inserts currentText if missing", () => {
    const history: PromptRewriteGuardHistoryItem[] = [
      { id: "1", text: "dup", createdAt: "2024-01-01" },
      { id: "2", text: "dup", createdAt: "2024-01-02" },
      { id: "3", text: "keep", createdAt: "2024-01-03" },
    ];
    const result = normalizePromptRewriteGuardHistory(history, "new");
    // "dup" 去重为 1 条，"keep" 保留，"new" 插到最前
    expect(result.map((i) => i.text)).toEqual(["new", "dup", "keep"]);
  });

  it("does not re-insert currentText if it already exists", () => {
    const history: PromptRewriteGuardHistoryItem[] = [
      { id: "1", text: "existing", createdAt: "2024-01-01" },
    ];
    const result = normalizePromptRewriteGuardHistory(history, "existing");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("existing");
  });

  it("fills missing id / createdAt", () => {
    const result = normalizePromptRewriteGuardHistory(
      [{ id: "", text: "x", createdAt: "" }],
      "x",
    );
    expect(result[0].id).toBeTruthy();
    expect(result[0].createdAt).toBeTruthy();
  });

  it("truncates to MAX_PROMPT_REWRITE_GUARD_HISTORY", () => {
    const long = Array.from({ length: MAX_PROMPT_REWRITE_GUARD_HISTORY + 5 }, (_, i) => ({
      id: `id-${i}`,
      text: `text-${i}`,
      createdAt: "2024-01-01",
    }));
    const result = normalizePromptRewriteGuardHistory(long, "extra-current");
    expect(result).toHaveLength(MAX_PROMPT_REWRITE_GUARD_HISTORY);
  });
});

describe("addPromptGuardHistoryItem", () => {
  it("returns history unchanged when text matches the first item", () => {
    const history: PromptRewriteGuardHistoryItem[] = [
      { id: "1", text: "same", createdAt: "2024-01-01" },
    ];
    expect(addPromptGuardHistoryItem(history, "same")).toBe(history);
  });

  it("prepends new item and dedupes", () => {
    const history: PromptRewriteGuardHistoryItem[] = [
      { id: "1", text: "old1", createdAt: "2024-01-01" },
      { id: "2", text: "dup", createdAt: "2024-01-02" },
    ];
    const result = addPromptGuardHistoryItem(history, "new");
    expect(result.map((i) => i.text)).toEqual(["new", "old1", "dup"]);
  });

  it("truncates to MAX_PROMPT_REWRITE_GUARD_HISTORY", () => {
    const history = Array.from({ length: MAX_PROMPT_REWRITE_GUARD_HISTORY }, (_, i) => ({
      id: `id-${i}`,
      text: `text-${i}`,
      createdAt: "2024-01-01",
    }));
    const result = addPromptGuardHistoryItem(history, "brand-new");
    expect(result).toHaveLength(MAX_PROMPT_REWRITE_GUARD_HISTORY);
    expect(result[0].text).toBe("brand-new");
  });
});

describe("toPlainPromptRewriteGuardHistoryItem", () => {
  it("returns shallow copy with only id/text/createdAt", () => {
    const item = { id: "1", text: "x", createdAt: "2024" };
    const plain = toPlainPromptRewriteGuardHistoryItem(item);
    expect(plain).toEqual(item);
    expect(plain).not.toBe(item);
  });
});

describe("toPlainFavoritePrompt", () => {
  it("returns shallow copy with all fields", () => {
    const item: FavoritePrompt = {
      id: "1",
      title: "T",
      text: "X",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-02",
    };
    const plain = toPlainFavoritePrompt(item);
    expect(plain).toEqual(item);
    expect(plain).not.toBe(item);
  });
});

describe("normalizeBackground", () => {
  it("converts transparent to auto", () => {
    expect(normalizeBackground("transparent")).toBe("auto");
  });

  it("keeps auto / opaque as-is", () => {
    expect(normalizeBackground("auto")).toBe("auto");
    expect(normalizeBackground("opaque")).toBe("opaque");
  });
});

describe("displayApiBaseUrl", () => {
  it("returns url as-is in full mode", () => {
    expect(displayApiBaseUrl("https://api.x.com/v1/images", "full")).toBe(
      "https://api.x.com/v1/images",
    );
  });

  it("strips /v1/images suffix in origin mode", () => {
    expect(displayApiBaseUrl("https://api.x.com/v1/images", "origin")).toBe(
      "https://api.x.com",
    );
  });
});

describe("stripImagesApiPath", () => {
  it("strips trailing /v1/images", () => {
    expect(stripImagesApiPath("https://api.x.com/v1/images")).toBe("https://api.x.com");
  });

  it("strips trailing slashes before /v1/images check", () => {
    expect(stripImagesApiPath("https://api.x.com/v1/images/")).toBe("https://api.x.com");
  });

  it("returns url as-is when no /v1/images suffix", () => {
    expect(stripImagesApiPath("https://api.x.com/v1")).toBe("https://api.x.com/v1");
  });
});
