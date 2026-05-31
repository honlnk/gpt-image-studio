<script setup lang="ts">
defineProps<{
  durationLabel: string;
  previewUrl?: string;
  retryAttempt?: number;
}>();
</script>

<template>
  <figure
    class="generation-skeleton-card overflow-hidden rounded-xl border border-gray-200 bg-white"
    aria-label="图片生成中"
  >
    <div
      :class="[
        'generation-skeleton-media flex h-48 items-center justify-center text-gray-300',
        previewUrl ? 'generation-skeleton-media--preview bg-gray-900' : 'bg-gray-50',
      ]"
    >
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt=""
        class="h-full w-full object-cover"
      />
      <div
        v-if="!previewUrl"
        class="generation-orbit flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm"
      >
        <span class="h-2 w-2 rounded-full bg-gray-300"></span>
      </div>
      <div
        :class="[
          'generation-duration-badge absolute left-1/2 top-[66%] z-1 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium shadow-sm backdrop-blur',
          previewUrl
            ? 'border border-black/10 bg-white/92 text-gray-700'
            : 'border border-gray-200 bg-white/90 text-gray-500',
        ]"
      >
        {{ previewUrl ? "预览更新中" : "正在生成" }}：{{ durationLabel }}
      </div>
      <div
        v-if="retryAttempt"
        class="absolute right-3 top-3 z-1 rounded-lg border border-blue-200 bg-white/95 px-2.5 py-1 text-xs font-medium text-blue-600 shadow-sm backdrop-blur"
      >
        正在重试第 {{ retryAttempt }} 次
      </div>
    </div>
    <figcaption class="px-3 py-2">
      <div class="flex items-center justify-between gap-3">
        <div class="generation-skeleton-line h-4 w-20 rounded"></div>
        <div class="generation-skeleton-line h-3 w-24 rounded"></div>
      </div>
      <div class="generation-skeleton-line mt-2 h-3 w-28 rounded"></div>
      <div class="mt-3 flex items-center justify-between gap-2">
        <div class="generation-skeleton-line h-7 w-16 rounded-lg"></div>
        <div class="flex items-center gap-2">
          <div class="generation-skeleton-line h-6 w-6 rounded-md"></div>
          <div class="generation-skeleton-line h-6 w-6 rounded-md"></div>
          <div class="generation-skeleton-line h-6 w-6 rounded-md"></div>
          <div class="generation-skeleton-line h-6 w-6 rounded-md"></div>
        </div>
      </div>
    </figcaption>
  </figure>
</template>

<style scoped>
.generation-skeleton-card {
  animation: generation-card-rise 0.28s ease-out both;
}

.generation-skeleton-media {
  position: relative;
  overflow: hidden;
}

.generation-skeleton-media--preview::before,
.generation-skeleton-media--preview::after {
  display: none;
}

.generation-skeleton-media::before,
.generation-skeleton-line::before {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-120%);
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.76),
    transparent
  );
  animation: generation-shimmer 1.75s ease-in-out infinite;
}

.generation-skeleton-media::after {
  content: "";
  position: absolute;
  inset: 18px;
  border-radius: 9999px;
  background:
    radial-gradient(
      circle at center,
      rgba(255, 255, 255, 0.9),
      transparent 34%
    ),
    conic-gradient(
      from 90deg,
      transparent,
      rgba(156, 163, 175, 0.22),
      transparent 42%
    );
  filter: blur(18px);
  opacity: 0.8;
  animation: generation-glow 2.8s ease-in-out infinite;
}

.generation-orbit {
  position: relative;
  z-index: 1;
  animation: generation-orbit 1.45s linear infinite;
}

.generation-orbit::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  border: 2px solid transparent;
  border-top-color: rgba(75, 85, 99, 0.62);
  border-right-color: rgba(75, 85, 99, 0.18);
}

.generation-skeleton-line {
  position: relative;
  overflow: hidden;
  background: rgb(243, 244, 246);
}

@keyframes generation-card-rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes generation-shimmer {
  0% {
    transform: translateX(-120%);
  }

  100% {
    transform: translateX(120%);
  }
}

@keyframes generation-glow {
  0%,
  100% {
    transform: scale(0.96);
    opacity: 0.5;
  }

  50% {
    transform: scale(1.04);
    opacity: 0.9;
  }
}

@keyframes generation-orbit {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .generation-skeleton-card,
  .generation-skeleton-media::before,
  .generation-skeleton-media::after,
  .generation-skeleton-line::before,
  .generation-orbit {
    animation: none;
  }
}
</style>
