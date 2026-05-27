import type { PromptMode } from "../types/studio";
import { promptWordbanks } from "./promptWordbanks";

export type BuildPromptInput = {
  prompt: string;
  mode: PromptMode;
  seed?: string;
};

const MODE_LABELS: Record<Exclude<PromptMode, "default">, string> = {
  safe: "安全",
  creative: "创意",
  adult: "成人",
};

const MODE_GUIDANCE: Record<Exclude<PromptMode, "default">, string> = {
  safe:
    "保持安全、优雅、干净的视觉表达。不要添加成人、裸露、色情或露骨元素，重点强化构图、光影、质感和画面完成度。",
  creative:
    "允许更大胆的时尚表现、性感氛围、暧昧张力和电影感姿态，但不要改写用户主体、场景、动作、构图或风格要求。",
  adult:
    "允许成人向氛围、成熟性感表达和更开放的成人视觉方向。仍然必须保留用户原意，并避免把未明确要求的主体、场景或构图替换成其他内容。",
};

export function buildImagePrompt(input: BuildPromptInput) {
  if (input.mode === "default") return input.prompt;

  const mode = input.mode;
  const inspirationTerms = selectInspirationTerms(mode, input.seed ?? input.prompt);
  const inspirationBlock = inspirationTerms.length
    ? inspirationTerms.join(", ")
    : "无";

  return [
    "请把用户原始提示词作为最高优先级。必须保留主体、动作、构图、风格、场景和用户明确提出的要求。",
    "下面的模式说明和灵感词只用于补充细节、强化氛围与画面表现，不得覆盖用户原意。",
    "",
    `当前模式：${MODE_LABELS[mode]}`,
    `模式说明：${MODE_GUIDANCE[mode]}`,
    "",
    `灵感词：${inspirationBlock}`,
    "",
    "用户原始提示词：",
    input.prompt,
  ].join("\n");
}

export function selectInspirationTerms(mode: Exclude<PromptMode, "default">, seed: string) {
  const poseTerms =
    mode === "safe"
      ? promptWordbanks.pose.safe
      : mode === "creative"
        ? [...promptWordbanks.pose.safe, ...promptWordbanks.pose.creative]
        : [
            ...promptWordbanks.pose.safe,
            ...promptWordbanks.pose.creative,
            ...promptWordbanks.pose.nsfw,
          ];
  const selectedPoseTerms = pickDeterministic(poseTerms, mode === "safe" ? 2 : 3, `${seed}:pose`);

  if (mode !== "adult") return selectedPoseTerms;

  return [
    ...selectedPoseTerms,
    ...pickDeterministic(promptWordbanks.adultInspiration, 2, `${seed}:adult`),
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
