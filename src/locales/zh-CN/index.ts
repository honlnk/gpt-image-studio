import common from "./common";
import settings from "./settings";
import chat from "./chat";
import library from "./library";
import generation from "./generation";
import errors from "./errors";
import prompt from "./prompt";
import download from "./download";
import companion from "./companion";

/** zh-CN 词库聚合。en-US 侧按模块深层同构（typeof 对应 zh 模块），由 vue-tsc 强制。 */
export const zhCN = {
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

export type MessagesSchema = typeof zhCN;
