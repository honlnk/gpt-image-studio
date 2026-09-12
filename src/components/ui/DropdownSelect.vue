<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

/**
 * 通用自绘下拉选择（替代原生 <select>）。
 *
 * 原生 select 的弹层与选项样式无法定制（macOS 上尤其明显），这里用
 * 触发按钮 + absolute 浮层实现；交互对齐原生：点击外部关闭、Escape 关闭、
 * 方向键移动高亮、Enter 选中。浮层挂在 .relative 容器内，供普通表单
 * （非固定定位的弹窗内容）复用。
 */
const props = withDefaults(
  defineProps<{
    options: ReadonlyArray<{ value: string; label: string }>;
    modelValue: string;
    id?: string;
    ariaLabel?: string;
    disabled?: boolean;
    /** md：表单场景（设置页）；sm：工具条紧凑场景（图片库筛选）。 */
    size?: "md" | "sm";
  }>(),
  { size: "md" },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const activeIndex = ref(0);

const selectedLabel = computed(
  () =>
    props.options.find((option) => option.value === props.modelValue)?.label ??
    props.modelValue,
);

function openMenu() {
  if (props.disabled || open.value) return;
  open.value = true;
  activeIndex.value = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.modelValue),
  );
}

function close() {
  open.value = false;
}

function toggle() {
  if (open.value) close();
  else openMenu();
}

function select(value: string) {
  close();
  if (value !== props.modelValue) emit("update:modelValue", value);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    close();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!open.value) {
      openMenu();
      return;
    }
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const count = props.options.length;
    activeIndex.value = (activeIndex.value + delta + count) % count;
    return;
  }
  if (event.key === "Enter" && open.value) {
    event.preventDefault();
    const option = props.options[activeIndex.value];
    if (option) select(option.value);
  }
}

function onDocumentMousedown(event: MouseEvent) {
  if (root.value?.contains(event.target as Node)) return;
  close();
}

// 仅在展开期间挂 document 监听，避免常驻全局监听。
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener("mousedown", onDocumentMousedown);
  else document.removeEventListener("mousedown", onDocumentMousedown);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentMousedown);
});
</script>

<template>
  <div ref="root" class="relative" @keydown="onKeydown">
    <button
      :id="id"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      class="flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 border bg-white text-left outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
      :class="
        size === 'sm'
          ? 'rounded-md border-gray-200 px-1.5 py-1 text-xs text-gray-700 focus:border-gray-400'
          : 'rounded-lg border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500'
      "
      :disabled="disabled"
      type="button"
      @click="toggle"
    >
      <span class="truncate">{{ selectedLabel }}</span>
      <svg
        aria-hidden="true"
        class="shrink-0 text-gray-400 transition-transform"
        :class="[size === 'sm' ? 'h-3 w-3' : 'h-4 w-4', open ? 'rotate-180' : '']"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        viewBox="0 0 24 24"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <ul
      v-if="open"
      :aria-labelledby="id"
      class="absolute left-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
      :class="size === 'sm' ? 'w-max min-w-full' : 'right-0'"
      role="listbox"
    >
      <li
        v-for="(option, index) in options"
        :key="option.value"
        :aria-selected="option.value === modelValue"
        role="option"
      >
        <button
          class="flex w-full cursor-pointer items-center justify-between gap-2 text-left transition-colors hover:bg-gray-50"
          :class="[
            size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm',
            activeIndex === index ? 'bg-gray-50' : '',
            option.value === modelValue
              ? 'font-medium text-gray-900'
              : 'text-gray-700',
          ]"
          type="button"
          @click="select(option.value)"
          @mousemove="activeIndex = index"
        >
          <span class="truncate">{{ option.label }}</span>
          <svg
            v-if="option.value === modelValue"
            aria-hidden="true"
            class="shrink-0 text-gray-900"
            :class="size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </button>
      </li>
    </ul>
  </div>
</template>
