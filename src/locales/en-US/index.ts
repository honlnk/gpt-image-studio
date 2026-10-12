import common from "./common";
import settings from "./settings";
import chat from "./chat";
import library from "./library";
import generation from "./generation";
import errors from "./errors";
import prompt from "./prompt";
import download from "./download";
import companion from "./companion";

/** en-US 词库聚合：每个模块深层同构于 zh-CN 对应模块，缺 key 在 typecheck 阶段暴露。 */
export const enUS = {
  common,
  settings,
  chat,
  library,
  generation,
  errors,
  prompt,
  download,
  companion,
};
