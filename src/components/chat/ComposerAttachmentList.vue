<script setup lang="ts">
import { computed } from "vue";
import type { ImageAsset } from "../../types/studio";

type EditingPairAttachment = {
  kind: "editingPair";
  id: string;
  source: ImageAsset;
  mask: ImageAsset;
};

type SingleAttachment = {
  kind: "single";
  id: string;
  image: ImageAsset;
};

type AttachmentRow = EditingPairAttachment | SingleAttachment;

const props = defineProps<{
  activeAttachments: ImageAsset[];
  activeEditMaskImageId: string;
  activeEditSourceImageId: string;
}>();

const emit = defineEmits<{
  removeAttachment: [id: string];
}>();

const attachmentRows = computed(() =>
  createAttachmentRows(
    props.activeAttachments,
    props.activeEditSourceImageId,
    props.activeEditMaskImageId,
  ),
);

function createAttachmentRows(
  attachments: ImageAsset[],
  sourceId: string,
  maskId: string,
): AttachmentRow[] {
  const editingPair = createEditingPair(attachments, sourceId, maskId);
  const hiddenIds = new Set<string>();

  if (editingPair) {
    hiddenIds.add(editingPair.source.id);
    hiddenIds.add(editingPair.mask.id);
  }

  const singles = attachments
    .filter((image) => !hiddenIds.has(image.id))
    .map(createSingleAttachment);

  return editingPair ? [editingPair, ...singles] : singles;
}

function createEditingPair(
  attachments: ImageAsset[],
  sourceId: string,
  maskId: string,
): EditingPairAttachment | null {
  const source = attachments.find((image) => image.id === sourceId);
  const mask = attachments.find((image) => image.id === maskId);

  if (!source || !mask) return null;

  return {
    kind: "editingPair",
    id: source.id,
    source,
    mask,
  };
}

function createSingleAttachment(image: ImageAsset): SingleAttachment {
  return {
    kind: "single",
    id: image.id,
    image,
  };
}
</script>

<template>
  <div v-if="activeAttachments.length" class="mb-2 flex flex-wrap gap-2">
    <div
      v-for="item in attachmentRows"
      :key="item.id"
      class="relative flex max-w-55 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-sm"
    >
      <template v-if="item.kind === 'editingPair'">
        <span
          class="absolute -left-1 -top-1 rounded bg-black px-1 py-0.5 text-[10px] text-white"
        >
          编辑
        </span>
        <div class="flex shrink-0 items-center gap-1">
          <img
            v-if="item.source.previewUrl"
            class="h-7 w-7 rounded object-cover"
            :alt="item.source.name"
            :src="item.source.previewUrl"
          />
          <span class="text-[18px] text-gray-400">+</span>
          <span
            v-if="item.mask.previewUrl"
            class="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded border border-black bg-black"
          >
            <img
              class="h-full w-full object-cover"
              :alt="item.mask.name"
              :src="item.mask.previewUrl"
            />
          </span>
        </div>
        <span class="truncate text-gray-700">{{ item.source.name }}</span>
      </template>
      <template v-else>
        <img
          v-if="item.image.previewUrl"
          class="h-7 w-7 shrink-0 rounded object-cover"
          :alt="item.image.name"
          :src="item.image.previewUrl"
        />
        <span class="truncate text-gray-700">{{ item.image.name }}</span>
      </template>
      <button
        class="shrink-0 cursor-pointer rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
        type="button"
        aria-label="移除引用图片"
        @click="emit('removeAttachment', item.id)"
      >
        <svg
          class="h-3.5 w-3.5"
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
</template>
