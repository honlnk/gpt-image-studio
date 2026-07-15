<script setup lang="ts">
import { useRepoStars } from "../../composables/useRepoStars";
import { QQ_GROUP_NUMBER } from "../../shared/community";

const emit = defineEmits<{
  copyText: [text: string];
}>();

const { stars, failed: starsFailed } = useRepoStars();

const features = [
  "本地 Companion 配对，API key 不落浏览器",
  "提示词四档模式，灵感词库可自定义",
  "图片库七色标签，一按即筛同类作品",
  "流式预览，生成过程边出图边看",
  "行为日志本地留存，提示词可脱敏采集",
];
</script>

<template>
  <div class="flex h-full items-center justify-center px-4 py-8">
    <div class="w-full max-w-md text-center">
      <svg
        class="mx-auto h-14 w-14 rounded-2xl"
        viewBox="0 0 64 64"
        role="img"
        aria-label="GPT Image Studio"
      >
        <defs>
          <linearGradient
            id="empty-mark-fill"
            x1="10"
            y1="8"
            x2="52"
            y2="56"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stop-color="#22D3EE" />
            <stop offset="0.52" stop-color="#34D399" />
            <stop offset="1" stop-color="#F59E0B" />
          </linearGradient>
          <linearGradient
            id="empty-panel-fill"
            x1="16"
            y1="15"
            x2="48"
            y2="49"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stop-color="#FFFFFF" />
            <stop offset="1" stop-color="#ECFEFF" />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="52" height="52" rx="14" fill="#111827" />
        <path
          d="M20 16H44C46.2091 16 48 17.7909 48 20V44C48 46.2091 46.2091 48 44 48H20C17.7909 48 16 46.2091 16 44V20C16 17.7909 17.7909 16 20 16Z"
          fill="url(#empty-panel-fill)"
        />
        <path
          d="M19.5 39.5L26.25 32.75C27.3546 31.6454 29.1454 31.6454 30.25 32.75L34 36.5L36.75 33.75C37.8546 32.6454 39.6454 32.6454 40.75 33.75L46.5 39.5V44C46.5 45.3807 45.3807 46.5 44 46.5H20C18.6193 46.5 17.5 45.3807 17.5 44V41.5C18.245 41.0752 18.9142 40.408 19.5 39.5Z"
          fill="url(#empty-mark-fill)"
        />
        <circle cx="39.5" cy="24.5" r="4.5" fill="#F97316" />
        <path
          d="M32 9L34.116 14.884L40 17L34.116 19.116L32 25L29.884 19.116L24 17L29.884 14.884L32 9Z"
          fill="#FFFFFF"
        />
        <path
          d="M32 11.75L33.221 15.779L37.25 17L33.221 18.221L32 22.25L30.779 18.221L26.75 17L30.779 15.779L32 11.75Z"
          fill="#111827"
        />
        <path d="M50 40L55 45L49 47L50 40Z" fill="#FFFFFF" />
        <path
          d="M50.641 42.406L52.734 44.499L50.222 45.337L50.641 42.406Z"
          fill="#111827"
        />
      </svg>

      <h2 class="mt-4 text-lg font-semibold text-gray-900">
        开始你的第一张图片
      </h2>
      <p class="mt-1.5 text-sm leading-relaxed text-gray-500">
        在下方输入框描述你想要的画面即可生成或编辑图片
      </p>

      <div
        class="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400"
      >
        <span v-for="feature in features" :key="feature">{{ feature }}</span>
      </div>

      <div
        class="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400"
      >
        <span
          >输入
          <kbd
            class="rounded border border-gray-300 bg-gray-50 px-1 py-0.5 font-sans text-gray-500"
            >@</kbd
          >
          插入常用提示词</span
        >
        <span>拖拽图片到此处可编辑</span>
      </div>

      <a
        href="https://github.com/honlnk/gpt-image-studio"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-6 inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700"
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 16 16"
          fill="#facc15"
          aria-hidden="true"
        >
          <path
            d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"
          />
        </svg>
        <template v-if="starsFailed">求个 Star 鼓励一下嘛</template>
        <template v-else-if="stars === null">求个 Star 鼓励一下嘛</template>
        <template v-else
          >求个 Star 鼓励一下嘛（{{ stars }} 位好心人已点亮）</template
        >
      </a>

      <p class="mt-3 text-xs text-gray-400">
        欢迎加入 QQ 交流群
        <button
          class="inline-flex cursor-pointer items-center gap-1 align-middle font-medium text-gray-500 transition-colors hover:text-gray-900"
          type="button"
          title="点击复制群号"
          @click="emit('copyText', QQ_GROUP_NUMBER)"
        >
          {{ QQ_GROUP_NUMBER }}
          <svg
            class="h-3 w-3"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
          </svg>
        </button>
        ，交流使用心得、反馈问题
      </p>
    </div>
  </div>
</template>
