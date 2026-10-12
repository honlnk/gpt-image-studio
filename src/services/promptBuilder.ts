import { t } from "../i18n";
import type { PromptMode, PromptWordbanks } from "../types/studio";
import { promptWordbanks as defaultPromptWordbanks } from "./promptWordbanks";

export type BuildPromptInput = {
  prompt: string;
  mode: PromptMode;
  seed?: string;
  wordbanks?: PromptWordbanks;
};

// 模式标签与说明跟随界面语言（用户拍板：提示词模板跟随 locale），
// 词表见 src/locales/{zh-CN,en-US}/prompt.ts。
function modeLabel(mode: Exclude<PromptMode, "default">) {
  return t(`prompt.mode.${mode}`);
}

function modeGuidance(mode: Exclude<PromptMode, "default">) {
  return t(`prompt.guidance.${mode}`);
}

export function buildImagePrompt(input: BuildPromptInput) {
  if (input.mode === "default") return input.prompt;

  const mode = input.mode;
  const inspirationTerms = selectInspirationTerms(
    mode,
    input.seed ?? input.prompt,
    input.wordbanks,
  );
  const inspirationBlock = inspirationTerms.length
    ? inspirationTerms.join(", ")
    : t("prompt.wrapper.inspirationNone");

  return [
    t("prompt.wrapper.priorityLine"),
    t("prompt.wrapper.supplementLine"),
    "",
    t("prompt.wrapper.currentMode", { mode: modeLabel(mode) }),
    t("prompt.wrapper.modeGuidance", { guidance: modeGuidance(mode) }),
    "",
    t("prompt.wrapper.inspiration", { terms: inspirationBlock }),
    "",
    t("prompt.wrapper.userPromptHeader"),
    input.prompt,
  ].join("\n");
}

export function selectInspirationTerms(
  mode: Exclude<PromptMode, "default">,
  seed: string,
  wordbanks: PromptWordbanks = defaultPromptWordbanks,
) {
  const poseTerms =
    mode === "safe"
      ? wordbanks.pose.safe
      : mode === "creative"
        ? [...wordbanks.pose.safe, ...wordbanks.pose.creative]
        : [
            ...wordbanks.pose.safe,
            ...wordbanks.pose.creative,
            ...wordbanks.pose.nsfw,
          ];
  const selectedPoseTerms = pickDeterministic(poseTerms, mode === "safe" ? 2 : 3, `${seed}:pose`);

  if (mode !== "adult") return selectedPoseTerms;

  return [
    ...selectedPoseTerms,
    ...pickDeterministic(wordbanks.adultInspiration, 2, `${seed}:adult`),
  ];
}

function pickDeterministic(items: readonly string[], count: number, seed: string) {
  if (!items.length || count <= 0) return [];

  const scored = items.map((item, index) => ({
    item,
    score: hashString(`${seed}:${item}:${index}`),
  }));

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.min(count, items.length))
    .map(({ item }) => item);
}

function hashString(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
}
