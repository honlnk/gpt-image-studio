type ZhPrompt = typeof import("../zh-CN/prompt").default;

/** Prompt-mode wrapper templates sent to providers (follows UI locale). */
const prompt: ZhPrompt = {
  mode: {
    safe: "Safe",
    creative: "Creative",
    adult: "Adult",
  },
  guidance: {
    safe:
      "Keep the visual expression safe, elegant, and clean. Do not add adult, nude, pornographic, or explicit elements; focus on strengthening composition, lighting, texture, and overall image quality.",
    creative:
      "Allow bolder fashion expression, sensual atmosphere, ambiguous tension, and cinematic poses, but do not rewrite the user's subject, scene, action, composition, or style requirements.",
    adult:
      "Allow adult-oriented atmosphere, mature sensual expression, and more open adult visual directions. The user's original intent must still be preserved, and subjects, scenes, or compositions not explicitly requested must not be replaced with other content.",
  },
  wrapper: {
    priorityLine:
      "Treat the user's original prompt as the highest priority. Preserve the subject, action, composition, style, scene, and every requirement the user explicitly stated.",
    supplementLine:
      "The mode guidance and inspiration terms below only add detail and enhance mood and visual quality; they must not override the user's intent.",
    currentMode: "Current mode: {mode}",
    modeGuidance: "Mode guidance: {guidance}",
    inspiration: "Inspiration terms: {terms}",
    inspirationNone: "none",
    userPromptHeader: "User's original prompt:",
  },
};

export default prompt;
