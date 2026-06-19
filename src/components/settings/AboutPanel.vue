<script setup lang="ts">
import { useRepoStars } from "../../composables/useRepoStars";

const { stars: starCount, failed: starFailed } = useRepoStars();

const appLinks = [
  {
    label: "在线体验",
    href: "https://image.honlnk.com",
    icon: "globe",
  },
  {
    label: "源代码仓库",
    href: "https://github.com/honlnk/gpt-image-studio",
    icon: "github",
  },
];

const authorLinks = [
  {
    label: "个人网站",
    href: "https://honlnk.com",
    icon: "globe",
  },
  {
    label: "GitHub @honlnk",
    href: "https://github.com/honlnk",
    icon: "github",
  },
  {
    label: "邮箱",
    href: "mailto:jihongshen1@outlook.com",
    icon: "mail",
  },
];

const techStack = ["Vue 3", "TypeScript", "Tailwind CSS v4", "Tauri"];
</script>

<template>
  <section aria-labelledby="aboutSettingsTitle" class="space-y-8">
    <div>
      <h3
        id="aboutSettingsTitle"
        class="text-base font-semibold text-gray-900"
      >
        关于
      </h3>
      <p class="mt-1 text-sm leading-relaxed text-gray-500">
        本地优先的 AI 图片创作工作台，通过聊天式界面调用 OpenAI 兼容 Images API
        生成与编辑图片。所有数据保存在浏览器本地，无需后端服务。
      </p>

      <div class="mt-5 grid gap-2 sm:grid-cols-2">
        <a
          v-for="link in appLinks"
          :key="link.href"
          :href="link.href"
          target="_blank"
          rel="noopener noreferrer"
          class="flex cursor-pointer items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
        >
          <svg
            v-if="link.icon === 'globe'"
            class="h-4 w-4 shrink-0 text-gray-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm5.36 7.5H12.5a13.6 13.6 0 0 0-.7-3.92 6.53 6.53 0 0 1 3.56 3.92ZM10 3.55c.62.86 1.27 2.18 1.42 3.95H8.58C8.73 5.73 9.38 4.41 10 3.55ZM4.64 7.5a6.53 6.53 0 0 1 3.56-3.92c-.34 1.05-.58 2.4-.7 3.92H4.64Zm0 5h2.86c.12 1.52.36 2.87.7 3.92a6.53 6.53 0 0 1-3.56-3.92ZM10 16.45c-.62-.86-1.27-2.18-1.42-3.95h2.84c-.15 1.77-.8 3.09-1.42 3.95Zm1.84-3.95h2.88a6.53 6.53 0 0 1-3.56 3.92c.34-1.05.58-2.4.7-3.92ZM7.3 8.5a12 12 0 0 1 .7-3.92 6.53 6.53 0 0 0-3.56 3.92H7.3Z"
            />
          </svg>
          <svg
            v-else
            class="h-4 w-4 shrink-0 text-gray-500"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
            />
          </svg>
          <span class="font-medium text-gray-900">{{ link.label }}</span>
          <svg
            class="ml-auto h-3.5 w-3.5 text-gray-400"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M11 3a1 1 0 1 0 0 2h2.59l-6.3 6.29a1 1 0 0 0 1.42 1.42L15 6.41V9a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-5Z"
            />
            <path
              d="M5 5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3a1 1 0 1 0-2 0v3H5V7h3a1 1 0 0 0 0-2H5Z"
            />
          </svg>
        </a>
      </div>

      <div class="mt-4 flex flex-wrap gap-1.5">
        <span
          v-for="tech in techStack"
          :key="tech"
          class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600"
        >
          {{ tech }}
        </span>
      </div>

      <a
        href="https://github.com/honlnk/gpt-image-studio"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-600 transition-colors hover:bg-gray-100"
      >
        <svg
          class="h-4 w-4"
          viewBox="0 0 16 16"
          fill="#facc15"
          aria-hidden="true"
        >
          <path
            d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"
          />
        </svg>
        GitHub Stars：
        <span v-if="starFailed" class="text-gray-400">—</span>
        <span v-else-if="starCount === null" class="text-gray-400">加载中…</span>
        <span v-else class="font-semibold text-gray-900">{{ starCount }}</span>
      </a>

      <p class="mt-4 text-xs text-gray-400">
        开源协议：MIT · 本应用不收集任何数据，所有内容仅保存在你的浏览器本地。
      </p>
    </div>

    <div class="border-t border-gray-200 pt-6">
      <h4 class="text-sm font-semibold text-gray-900">作者</h4>

      <div class="mt-4 flex items-center gap-4">
        <img
          src="https://avatars.githubusercontent.com/u/235359418?v=4"
          alt="鸿影"
          class="h-14 w-14 rounded-full ring-2 ring-gray-100"
          loading="lazy"
        />
        <div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-gray-900">鸿影</span>
            <span class="text-xs text-gray-400">@honlnk</span>
          </div>
          <p class="mt-0.5 text-xs text-gray-500">
            The waste is lazy and leaves nothing behind
          </p>
          <p class="mt-0.5 text-xs text-gray-400">山东 · 济南</p>
        </div>
      </div>

      <div class="mt-4 grid gap-2 sm:grid-cols-3">
        <a
          v-for="link in authorLinks"
          :key="link.href"
          :href="link.href"
          :target="link.icon === 'mail' ? undefined : '_blank'"
          :rel="link.icon === 'mail' ? undefined : 'noopener noreferrer'"
          class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
        >
          <svg
            v-if="link.icon === 'globe'"
            class="h-4 w-4 shrink-0 text-gray-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm5.36 7.5H12.5a13.6 13.6 0 0 0-.7-3.92 6.53 6.53 0 0 1 3.56 3.92ZM10 3.55c.62.86 1.27 2.18 1.42 3.95H8.58C8.73 5.73 9.38 4.41 10 3.55ZM4.64 7.5a6.53 6.53 0 0 1 3.56-3.92c-.34 1.05-.58 2.4-.7 3.92H4.64Zm0 5h2.86c.12 1.52.36 2.87.7 3.92a6.53 6.53 0 0 1-3.56-3.92ZM10 16.45c-.62-.86-1.27-2.18-1.42-3.95h2.84c-.15 1.77-.8 3.09-1.42 3.95Zm1.84-3.95h2.88a6.53 6.53 0 0 1-3.56 3.92c.34-1.05.58-2.4.7-3.92ZM7.3 8.5a12 12 0 0 1 .7-3.92 6.53 6.53 0 0 0-3.56 3.92H7.3Z"
            />
          </svg>
          <svg
            v-else-if="link.icon === 'github'"
            class="h-4 w-4 shrink-0 text-gray-500"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
            />
          </svg>
          <svg
            v-else
            class="h-4 w-4 shrink-0 text-gray-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M3 4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H3Zm0 2h14a.5.5 0 0 1 .21.95l-7 4a.5.5 0 0 1-.42 0l-7-4A.5.5 0 0 1 3 6Z"
            />
          </svg>
          <span class="truncate font-medium text-gray-900">{{ link.label }}</span>
        </a>
      </div>
    </div>
  </section>
</template>
