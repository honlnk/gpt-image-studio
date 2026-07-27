<script setup lang="ts">
/**
 * 通用 Modal 外壳：Teleport + 居中遮罩 + 内容容器。
 *
 * 收敛 ConfirmDialog / ConfirmInputModal / RenameDialog / SettingsModal 里
 * 字节级重复的"Teleport to body + fixed inset-0 居中遮罩 + mousedown.self 关闭"骨架。
 *
 * 设计原则：
 * - 不改变现有行为（不擅自加 ESC 关闭、不改 emit 名），只收敛骨架。
 * - 通过 props 透传 z-index / 背景色 / padding / 内容尺寸等差异。
 * - 默认点击遮罩（mousedown.self）触发 close 事件，可被 closeOnBackdrop 关闭。
 *
 * 不适用场景（保持各自实现）：
 * - QqGroupModal（lightbox 形态，内容是 img 非卡片）
 * - ImagePreviewModal（全屏沉浸式查看器，关闭需防拖拽误触）
 * - EditMaskModal（画布编辑器，关闭耦合 resetSelection 副作用）
 */
const props = withDefaults(
  defineProps<{
    /** 是否显示。 */
    isOpen: boolean;
    /** 遮罩层附加 class（覆盖 bg 透明度 / padding 等差异）。 */
    backdropClass?: string;
    /** 内容容器附加 class（覆盖 max-width / padding / rounded 等差异）。 */
    contentClass?: string;
    /** z-index class，默认 z-60（普通 dialog）。大型面板可传 z-50。 */
    zClass?: string;
    /** 点击遮罩是否触发 close。默认 true。 */
    closeOnBackdrop?: boolean;
    /** 内容容器标签。默认 section。 */
    contentTag?: string;
    /** aria-labelledby 指向的 id（可访问性）。 */
    ariaLabelledby?: string;
  }>(),
  {
    backdropClass: "bg-black/50 px-4",
    contentClass: "max-w-md rounded-lg bg-white p-5 shadow-xl",
    zClass: "z-60",
    closeOnBackdrop: true,
    contentTag: "section",
    ariaLabelledby: undefined,
  },
);

const emit = defineEmits<{
  close: [];
}>();

function handleBackdrop(event: MouseEvent) {
  // 只在点击遮罩自身（非冒泡到内容容器）时触发，与历史 mousedown.self 行为一致。
  if (!props.closeOnBackdrop) return;
  if (event.target !== event.currentTarget) return;
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 flex items-center justify-center"
      :class="[zClass, backdropClass]"
      role="presentation"
      @mousedown="handleBackdrop"
    >
      <component
        :is="contentTag"
        class="w-full"
        :class="contentClass"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="ariaLabelledby"
      >
        <slot />
      </component>
    </div>
  </Teleport>
</template>
