/** prompt 域词条：提示词模式发送给 provider 的包装模板（跟随界面语言）。 */
export default {
  mode: {
    safe: "安全",
    creative: "创意",
    adult: "成人",
  },
  guidance: {
    safe:
      "保持安全、优雅、干净的视觉表达。不要添加成人、裸露、色情或露骨元素，重点强化构图、光影、质感和画面完成度。",
    creative:
      "允许更大胆的时尚表现、性感氛围、暧昧张力和电影感姿态，但不要改写用户主体、场景、动作、构图或风格要求。",
    adult:
      "允许成人向氛围、成熟性感表达和更开放的成人视觉方向。仍然必须保留用户原意，并避免把未明确要求的主体、场景或构图替换成其他内容。",
  },
  wrapper: {
    priorityLine:
      "请把用户原始提示词作为最高优先级。必须保留主体、动作、构图、风格、场景和用户明确提出的要求。",
    supplementLine:
      "下面的模式说明和灵感词只用于补充细节、强化氛围与画面表现，不得覆盖用户原意。",
    currentMode: "当前模式：{mode}",
    modeGuidance: "模式说明：{guidance}",
    inspiration: "灵感词：{terms}",
    inspirationNone: "无",
    userPromptHeader: "用户原始提示词：",
  },
};
