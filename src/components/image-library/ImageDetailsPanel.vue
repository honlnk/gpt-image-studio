<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useNow } from "../../composables/useNow";
import { formatRelativeTime } from "../../shared/dateTime";
import type { ImageAsset } from "../../types/studio";
import Tooltip from "../ui/Tooltip.vue";
import {
  fileSize,
  imageDownloadName,
  imageFormat,
  imageSize,
  sourceLabel,
} from "./imageLibraryFormatters";
import { IMAGE_TAG_COLORS, imageTagDotColor } from "./imageTagColors";

const props = defineProps<{
  image: ImageAsset;
  isAttached: boolean;
}>();

const emit = defineEmits<{
  clearSelection: [];
  deleteImage: [id: string];
  renameImage: [id: string];
  setTagColor: [id: string, color: ImageAsset["tagColor"] | undefined];
}>();

const now = useNow();

const { t } = useI18n();

const createdAtLabel = computed(() =>
  formatRelativeTime(props.image.createdAt, now.value),
);

function toggleTagColor(nextColor: ImageAsset["tagColor"]) {
  if (props.image.tagColor === nextColor) {
    emit("setTagColor", props.image.id, undefined);
    return;
  }
  emit("setTagColor", props.image.id, nextColor);
}
</script>

<template>
  <div class="border-t border-gray-200 px-4 py-3">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="truncate text-sm font-semibold text-gray-900">
          {{ image.name }}
        </div>
        <div class="mt-0.5 text-xs text-gray-500">
          {{ sourceLabel(image) }} · {{ createdAtLabel }}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <a
          v-if="image.previewUrl"
          v-track="{ name: 'image.downloaded', payload: { imageId: image.id, location: 'details' } }"
          class="rounded-lg px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100"
          :download="imageDownloadName(image)"
          :href="image.previewUrl"
        >
          {{ $t("library.preview.download") }}
        </a>
        <button
          class="cursor-pointer rounded-lg px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100"
          type="button"
          @click="emit('renameImage', image.id)"
        >
          {{ $t("library.details.rename") }}
        </button>
        <button
          v-track="{ name: 'image.deleted', payload: { imageId: image.id, location: 'details' } }"
          class="cursor-pointer rounded-lg px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
          type="button"
          @click="emit('deleteImage', image.id)"
        >
          {{ $t("common.delete") }}
        </button>
        <button
          class="cursor-pointer rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          type="button"
          @click="emit('clearSelection')"
        >
          <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
            />
          </svg>
        </button>
      </div>
    </div>

    <div class="mb-3 flex items-center gap-2">
      <span class="text-xs text-gray-400">{{ $t("library.details.tagColor") }}</span>
      <button
        v-for="color in IMAGE_TAG_COLORS"
        :key="color"
        :aria-label="$t('library.details.markTagColor', { color })"
        :class="[
          'h-3 w-3 cursor-pointer rounded-full border transition-transform hover:scale-105',
          image.tagColor === color
            ? 'border-gray-700 ring-2 ring-gray-400/60'
            : 'border-gray-300',
        ]"
        :style="{ backgroundColor: imageTagDotColor(color) }"
        type="button"
        @click="toggleTagColor(color)"
      />
    </div>

    <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
      <div>
        <dt class="text-gray-400">{{ $t("library.details.format") }}</dt>
        <dd class="mt-0.5 text-gray-700">
          {{ imageFormat(image) }}
        </dd>
      </div>
      <div>
        <dt class="text-gray-400">{{ $t("library.details.size") }}</dt>
        <dd class="mt-0.5 text-gray-700">{{ imageSize(image) }}</dd>
      </div>
      <div>
        <dt class="text-gray-400">{{ $t("library.details.file") }}</dt>
        <dd class="mt-0.5 text-gray-700">{{ fileSize(image) }}</dd>
      </div>
      <div>
        <dt class="text-gray-400">{{ $t("library.details.status") }}</dt>
        <dd class="mt-0.5 text-gray-700">
          {{
            isAttached
              ? $t("library.details.attached")
              : $t("library.details.notAttached")
          }}
        </dd>
      </div>
    </dl>

    <div class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
      <div class="min-w-0">
        <div class="text-xs text-gray-400">
          {{ $t("library.details.originalPrompt") }}
        </div>
        <Tooltip
          :text="image.prompt"
          :delay="500"
          :hide-delay="300"
          hoverable
          multiline
          preferred-placement="top"
        >
          <p class="mt-1 line-clamp-2 text-left text-xs leading-relaxed text-gray-600">
            {{ image.prompt }}
          </p>
        </Tooltip>
      </div>
      <div class="min-w-0">
        <div class="text-xs text-gray-400">
          {{ $t("library.details.revisedPrompt") }}
        </div>
        <Tooltip
          v-if="image.revisedPrompt"
          :text="image.revisedPrompt"
          :delay="500"
          :hide-delay="300"
          hoverable
          multiline
          preferred-placement="top"
        >
          <p class="mt-1 line-clamp-2 text-left text-xs leading-relaxed text-gray-600">
            {{ image.revisedPrompt }}
          </p>
        </Tooltip>
        <p v-else class="mt-1 text-xs leading-relaxed text-gray-400">
          {{ $t("library.details.notReturned") }}
        </p>
      </div>
    </div>
  </div>
</template>
