<script setup lang="ts">
import { computed } from "vue";
import type { ImageAsset, Message } from "../../types/studio";

const props = defineProps<{
  attachedImageIds: string[];
  imageById: (id: string) => ImageAsset | undefined;
  message: Message;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  continueEdit: [id: string];
  previewImage: [id: string];
  retryMessage: [message: Message];
}>();

const attachedImageIds = computed(() => new Set(props.attachedImageIds));

function imageExtension(image?: ImageAsset) {
  if (image?.mimeType === "image/jpeg") return "jpeg";
  if (image?.mimeType === "image/webp") return "webp";
  return "png";
}

function imageDownloadName(image?: ImageAsset) {
  return `${image?.name || "image"}.${imageExtension(image)}`;
}

function isImageAttached(id: string) {
  return attachedImageIds.value.has(id);
}
</script>

<template>
  <article
    :class="[
      'mb-6 rounded-2xl px-5 py-4',
      message.role === 'user' ? 'bg-gray-50' : '',
      message.status === 'error' ? 'bg-red-50' : '',
    ]"
  >
    <div class="mb-1.5 flex items-center gap-2 text-xs text-gray-500">
      <span class="font-semibold text-gray-700">
        {{ message.role === "user" ? "你" : "Image Studio" }}
      </span>
      <span>{{ message.createdAt }}</span>
    </div>

    <p class="text-[15px] leading-relaxed text-gray-800">
      {{ message.content }}
    </p>

    <div
      v-if="message.referencedImageIds.length"
      class="mt-3 flex flex-wrap gap-2"
    >
      <button
        v-for="imageId in message.referencedImageIds"
        :key="imageId"
        :class="[
          'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
          imageById(imageId)
            ? 'cursor-pointer border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            : 'cursor-not-allowed border-dashed border-gray-300 bg-gray-50 text-gray-400',
        ]"
        type="button"
        :disabled="!imageById(imageId)"
        @click="imageById(imageId) && emit('attachImage', imageId)"
      >
        {{ imageById(imageId)?.name || "图片已删除，无法显示" }}
      </button>
    </div>

    <div v-if="message.status === 'pending'" class="mt-3">
      <span class="inline-flex items-center gap-1.5 text-sm text-gray-400">
        <span
          class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400"
        ></span>
        生成中...
      </span>
    </div>

    <div
      v-if="message.resultImageIds.length"
      class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <figure
        v-for="imageId in message.resultImageIds"
        :key="imageId"
        class="overflow-hidden rounded-xl border border-gray-200"
      >
        <div
          class="group relative flex h-48 items-center justify-center bg-gray-100 text-sm text-gray-400"
        >
          <button
            v-if="imageById(imageId)?.previewUrl"
            class="h-full w-full cursor-pointer"
            type="button"
            @click="emit('previewImage', imageId)"
          >
            <img
              class="h-full w-full object-contain"
              :alt="imageById(imageId)?.name"
              :src="imageById(imageId)?.previewUrl"
            />
            <span
              class="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              点击查看
            </span>
          </button>
          <div
            v-else
            class="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-gray-300 bg-gray-50 px-4 text-center"
          >
            <span class="text-sm font-medium text-gray-500">图片已删除</span>
            <span class="text-xs text-gray-400">
              这张图片已从图片库移除，无法显示预览
            </span>
          </div>
        </div>
        <figcaption class="px-3 py-2">
          <div class="min-w-0">
            <div class="truncate text-sm font-medium">
              {{ imageById(imageId)?.name || "图片已删除" }}
            </div>
            <div class="truncate text-xs text-gray-500">
              {{ imageById(imageId)?.prompt || "原图片资产已从图片库中删除" }}
            </div>
          </div>
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button
              class="cursor-pointer rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800"
              type="button"
              :disabled="!imageById(imageId)"
              :class="
                !imageById(imageId)
                  ? 'cursor-not-allowed opacity-30 hover:bg-black'
                  : ''
              "
              @click="emit('continueEdit', imageId)"
            >
              继续编辑
            </button>
            <div class="flex shrink-0 items-center gap-1">
              <button
                :class="[
                  'cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  isImageAttached(imageId)
                    ? 'bg-gray-100 text-gray-400'
                    : 'text-gray-600 hover:bg-gray-100',
                ]"
                type="button"
                :disabled="!imageById(imageId)"
                @click="emit('attachImage', imageId)"
              >
                {{
                  imageById(imageId)
                    ? isImageAttached(imageId)
                      ? "已引用"
                      : "加入引用"
                    : "不可引用"
                }}
              </button>
              <a
                v-if="imageById(imageId)?.previewUrl"
                class="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                :download="imageDownloadName(imageById(imageId))"
                :href="imageById(imageId)?.previewUrl"
              >
                下载
              </a>
            </div>
          </div>
        </figcaption>
      </figure>
    </div>

    <button
      v-if="message.status === 'error'"
      class="mt-3 cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
      type="button"
      @click="emit('retryMessage', message)"
    >
      重试
    </button>
  </article>
</template>
