<script setup lang="ts">
import type { StudioErrorBanner } from "../../stores/feedbackStore";

defineProps<{
  banner: StudioErrorBanner | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

// 动作点击视为用户已开始处理（去设置/重试），横幅随之收起。
function runAction(handler: () => void) {
  handler();
  emit("close");
}
</script>

<template>
  <!-- 阻断性错误（生成失败/网络中断）的顶部横幅：暖橙配色降低攻击性，带可点动作 -->
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="-translate-y-3 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="-translate-y-3 opacity-0"
  >
    <div
      v-if="banner"
      class="pointer-events-none fixed inset-x-0 top-4 z-70 flex justify-center px-4"
      role="alert"
    >
      <div
        class="pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-lg"
      >
        <div
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600"
          aria-hidden="true"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clip-rule="evenodd"
            />
          </svg>
        </div>
        <p class="min-w-0 flex-1 text-sm leading-relaxed text-amber-800">
          {{ banner.message }}
        </p>
        <div
          v-if="banner.actions.length"
          class="flex shrink-0 items-center gap-2"
        >
          <button
            v-for="action in banner.actions"
            :key="action.label"
            class="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            :class="
              action.tone === 'solid'
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'border border-amber-300 bg-white text-amber-700 hover:bg-amber-100'
            "
            type="button"
            @click="runAction(action.handler)"
          >
            {{ action.label }}
          </button>
        </div>
        <button
          class="shrink-0 cursor-pointer rounded p-0.5 text-amber-400 transition-colors hover:bg-amber-100 hover:text-amber-600"
          :aria-label="$t('common.toast.closeNotice')"
          type="button"
          @click="emit('close')"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
            />
          </svg>
        </button>
      </div>
    </div>
  </Transition>
</template>
