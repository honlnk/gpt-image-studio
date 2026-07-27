import type {
  AppSettings,
  FavoritePrompt,
  GenerationParams,
  PromptRewriteGuardHistoryItem,
  PromptWordbankSectionKey,
  PromptWordbanks,
} from "../types/studio";
import { isoTimestamp } from "../shared/dateTime";
import { createId } from "../shared/id";
import { normalizePromptRewriteGuardText } from "./promptRewriteGuard";
import { clonePromptWordbanks } from "./promptWordbanks";

/**
 * settingsStore 的纯序列化 / 归一化 helper。
 *
 * 历史上内联在 settingsStore.ts 模块级，与 store 状态无关，是纯函数。
 * 抽出后 store 只管响应式状态，序列化逻辑走本模块（便于单测）。
 */

export const MAX_PROMPT_REWRITE_GUARD_HISTORY = 20;

/** 读取某个词库分区的当前词条。 */
export function getPromptWordbankTerms(
  wordbanks: PromptWordbanks,
  section: PromptWordbankSectionKey,
) {
  if (section === "pose.safe") return wordbanks.pose.safe;
  if (section === "pose.creative") return wordbanks.pose.creative;
  if (section === "pose.nsfw") return wordbanks.pose.nsfw;
  return wordbanks.adultInspiration;
}

/** 不可变更新某个词库分区，返回新的 wordbanks 对象。 */
export function setPromptWordbankTerms(
  wordbanks: PromptWordbanks,
  section: PromptWordbankSectionKey,
  terms: string[],
) {
  const next = clonePromptWordbanks(wordbanks);
  if (section === "pose.safe") next.pose.safe = [...terms];
  if (section === "pose.creative") next.pose.creative = [...terms];
  if (section === "pose.nsfw") next.pose.nsfw = [...terms];
  if (section === "adultInspiration") next.adultInspiration = [...terms];
  return next;
}

/**
 * 归一化 prompt rewrite guard 历史记录。
 *
 * - 给缺失 id/createdAt 的条目补默认值
 * - 按文案去重
 * - 确保当前文案在历史里（若不在则插入到最前）
 * - 截断到 MAX_PROMPT_REWRITE_GUARD_HISTORY 条
 */
export function normalizePromptRewriteGuardHistory(
  history: PromptRewriteGuardHistoryItem[] | undefined,
  currentText: string,
) {
  const seen = new Set<string>();
  const normalizedItems = (Array.isArray(history) ? history : [])
    .map((item) => ({
      id: item.id || createId("prompt-guard"),
      text: normalizePromptRewriteGuardText(item.text),
      createdAt: item.createdAt || isoTimestamp(),
    }))
    .filter((item) => {
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    });

  if (!seen.has(currentText)) {
    normalizedItems.unshift({
      id: createId("prompt-guard"),
      text: currentText,
      createdAt: isoTimestamp(),
    });
  }

  return normalizedItems.slice(0, MAX_PROMPT_REWRITE_GUARD_HISTORY);
}

/** 把新文案加到历史最前（去重 + 截断）。 */
export function addPromptGuardHistoryItem(
  history: PromptRewriteGuardHistoryItem[],
  text: string,
) {
  if (history[0]?.text === text) return history;

  return [
    {
      id: createId("prompt-guard"),
      text,
      createdAt: isoTimestamp(),
    },
    ...history.filter((item) => item.text !== text),
  ].slice(0, MAX_PROMPT_REWRITE_GUARD_HISTORY);
}

/** 深拷贝单条历史记录（剥离响应式引用）。 */
export function toPlainPromptRewriteGuardHistoryItem(
  item: PromptRewriteGuardHistoryItem,
): PromptRewriteGuardHistoryItem {
  return {
    id: item.id,
    text: item.text,
    createdAt: item.createdAt,
  };
}

/** 深拷贝单条收藏 prompt（剥离响应式引用）。 */
export function toPlainFavoritePrompt(item: FavoritePrompt): FavoritePrompt {
  return {
    id: item.id,
    title: item.title,
    text: item.text,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * 把透明背景归一化成 auto（provider 不支持 transparent 时回退）。
 */
export function normalizeBackground(background: GenerationParams["background"]) {
  if (background === "transparent") return "auto";
  return background;
}

/** 按 apiBaseUrlMode 显示 API 地址：full 模式原样，其它模式剥离 /v1/images 后缀。 */
export function displayApiBaseUrl(
  apiBaseUrl: string,
  mode: AppSettings["apiBaseUrlMode"],
) {
  if (mode === "full") return apiBaseUrl;
  return stripImagesApiPath(apiBaseUrl);
}

/** 剥离 apiBaseUrl 末尾的 /v1/images（用于 origin 模式下的可读显示）。 */
export function stripImagesApiPath(apiBaseUrl: string) {
  return apiBaseUrl.trim().replace(/\/+$/, "").replace(/\/v1\/images$/i, "");
}
