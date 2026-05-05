<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

const props = withDefaults(
  defineProps<{
    text: string;
  }>(),
  {},
);

const triggerRef = ref<HTMLElement | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);
const isVisible = ref(false);
const placement = ref({ x: "center", y: "bottom" });
const position = ref({ left: 0, top: 0, arrowLeft: 0 });
const tooltipStyle = computed(() => ({
  left: `${position.value.left}px`,
  top: `${position.value.top}px`,
}));

async function updatePosition() {
  isVisible.value = true;
  await nextTick();

  if (!triggerRef.value || !tooltipRef.value) return;

  const rect = triggerRef.value.getBoundingClientRect();
  const tooltipRect = tooltipRef.value.getBoundingClientRect();
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const margin = 8;
  const gap = 8;
  const width = tooltipRect.width;
  const height = tooltipRect.height;
  const triggerCenter = rect.left + rect.width / 2;
  const unclampedLeft = triggerCenter - width / 2;
  const left = Math.min(
    Math.max(margin, unclampedLeft),
    Math.max(margin, vpW - width - margin),
  );
  const y = rect.bottom + gap + height > vpH ? "top" : "bottom";
  const top =
    y === "bottom"
      ? rect.bottom + gap
      : Math.max(margin, rect.top - height - gap);
  const arrowLeft = Math.min(Math.max(12, triggerCenter - left), width - 12);

  placement.value = {
    x:
      left === margin
        ? "left"
        : left === Math.max(margin, vpW - width - margin)
          ? "right"
          : "center",
    y,
  };
  position.value = { left, top, arrowLeft };
}

function hideTooltip() {
  isVisible.value = false;
}
</script>

<template>
  <span
    ref="triggerRef"
    class="inline-flex"
    @focusin="updatePosition"
    @focusout="hideTooltip"
    @mouseenter="updatePosition"
    @mouseleave="hideTooltip"
  >
    <slot />
  </span>
  <Teleport to="body">
    <span
      v-if="isVisible"
      ref="tooltipRef"
      class="pointer-events-none fixed z-50 max-w-[calc(100vw-16px)] rounded-lg bg-gray-800 px-3 py-1.5 text-[11px] leading-snug text-white shadow-lg"
      :class="{ 'whitespace-nowrap': placement.x === 'center' }"
      :style="tooltipStyle"
    >
      <span
        class="absolute border-4 border-transparent"
        :style="{ left: `${position.arrowLeft}px` }"
        :class="[
          placement.y === 'bottom'
            ? 'bottom-full border-b-gray-800'
            : 'top-full border-t-gray-800',
          '-translate-x-1/2',
        ]"
      ></span>
      {{ text }}
    </span>
  </Teleport>
</template>
