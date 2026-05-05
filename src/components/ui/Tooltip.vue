<script setup lang="ts">
import { ref } from "vue";

const props = withDefaults(
  defineProps<{
    text: string;
  }>(),
  {},
);

const placement = ref({ x: "center", y: "bottom" });

function updatePosition(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const estW = 280;
  const estH = 40;

  const x =
    rect.left + estW / 2 > vpW
      ? "right"
      : rect.right - estW / 2 < 0
        ? "left"
        : "center";
  const y = rect.bottom + estH > vpH ? "top" : "bottom";

  placement.value = { x, y };
}
</script>

<template>
  <span
    class="group relative inline-flex"
    @mouseenter="(e) => updatePosition(e.currentTarget as HTMLElement)"
  >
    <slot />
    <span
      class="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-gray-800 px-3 py-1.5 text-[11px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
      :class="[
        placement.y === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
        placement.x === 'center'
          ? 'left-1/2 -translate-x-1/2'
          : placement.x === 'right'
            ? 'right-0'
            : 'left-0',
      ]"
    >
      <span
        class="absolute border-4 border-transparent"
        :class="[
          placement.y === 'bottom'
            ? 'bottom-full border-b-gray-800'
            : 'top-full border-t-gray-800',
          placement.x === 'center'
            ? 'left-1/2 -translate-x-1/2'
            : placement.x === 'right'
              ? 'right-2'
              : 'left-2',
        ]"
      ></span>
      {{ text }}
    </span>
  </span>
</template>
