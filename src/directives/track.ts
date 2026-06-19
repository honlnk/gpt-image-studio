import type { Directive } from "vue";
import { track } from "../features/analytics/useAnalyticsTracker";

type TrackBinding =
  | string
  | {
      name: string;
      payload?: Record<string, unknown>;
    };

function normalizeBinding(value: TrackBinding) {
  if (typeof value === "string") return { name: value, payload: undefined };
  return { name: value.name, payload: value.payload };
}

/**
 * v-track 指令：在元素 click 时记录一条 ui_click 事件。
 *
 * 用法：
 *   <button v-track="'chat.submit'">发送</button>
 *   <button v-track="{ name: 'image.delete', payload: { location: 'library' } }">删除</button>
 *
 * 指令通过模块级 track() 记录事件，不依赖 Pinia 实例。
 */
export const trackDirective: Directive<HTMLElement, TrackBinding> = {
  beforeMount(el, binding) {
    el.addEventListener("click", () => {
      const { name, payload } = normalizeBinding(binding.value);
      track(name, payload, "ui_click");
    });
  },
};
