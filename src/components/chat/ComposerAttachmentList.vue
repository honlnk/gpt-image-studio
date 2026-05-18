<script setup lang="ts">
import { computed } from "vue";
import type { ImageAsset } from "../../types/studio";
import Tooltip from "../ui/Tooltip.vue";

type EditingPairAttachment = {
  kind: "editingPair";
  id: string;
  source: ImageAsset;
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
  previewImage: [id: string];
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
  const editingPair = createEditingPair(attachments, sourceId);
  const hiddenIds = new Set<string>();

  if (editingPair) {
    hiddenIds.add(editingPair.source.id);
    const mask = attachments.find((image) => image.id === maskId);
    if (mask) hiddenIds.add(mask.id);
  }

  const singles = attachments
    .filter((image) => !hiddenIds.has(image.id))
    .map(createSingleAttachment);

  return editingPair ? [editingPair, ...singles] : singles;
}

function createEditingPair(
  attachments: ImageAsset[],
  sourceId: string,
): EditingPairAttachment | null {
  const source = attachments.find((image) => image.id === sourceId);
  if (!source) return null;

  return { kind: "editingPair", id: source.id, source };
}

function createSingleAttachment(image: ImageAsset): SingleAttachment {
  return { kind: "single", id: image.id, image };
}

function attachmentName(item: AttachmentRow): string {
  return item.kind === "editingPair" ? item.source.name : item.image.name;
}

function attachmentPreviewUrl(item: AttachmentRow): string | undefined {
  return item.kind === "editingPair"
    ? item.source.previewUrl
    : item.image.previewUrl;
}

function handleClick(item: AttachmentRow) {
  const id = item.kind === "editingPair" ? item.source.id : item.image.id;
  emit("previewImage", id);
}

function handleRemove(event: Event, item: AttachmentRow) {
  event.stopPropagation();
  emit("removeAttachment", item.id);
}
</script>

<template>
  <div v-if="activeAttachments.length" class="mb-2 flex flex-wrap gap-2">
    <Tooltip
      v-for="item in attachmentRows"
      :key="item.id"
      :text="attachmentName(item)"
      preferred-placement="top"
    >
      <div
        class="group relative h-20 cursor-pointer overflow-hidden rounded-lg border border-gray-200"
        @click="handleClick(item)"
      >
        <img
          v-if="attachmentPreviewUrl(item)"
          class="h-full w-auto object-cover"
          :alt="attachmentName(item)"
          :src="attachmentPreviewUrl(item)"
        />
        <!-- 左上角编辑三角标识 -->
        <span v-if="item.kind === 'editingPair'" class="absolute left-0 top-0">
          <svg class="h-7 w-7" viewBox="0 0 28 28" aria-hidden="true">
            <polygon points="0,0 28,0 0,28" fill="rgba(0,0,0,0.75)" />
          </svg>
          <svg
            class="absolute left-0.75 top-0.75 h-3 w-3 text-white"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M3 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H3zm1 2h4v1H4V4zm0 2.5h4v1H4v-1zm0 2.5h3v1H4V9z"
            />
            <path
              d="M11.5 5.5l1.5-1.5a1 1 0 0 1 1.414 1.414L12.5 7l-1.5-1.5z"
            />
            <path d="M11 6.5L8.5 9 8 11l2-0.5L12.5 8 11 6.5z" />
          </svg>
        </span>
        <button
          class="absolute right-0.5 top-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
          type="button"
          aria-label="移除引用图片"
          @click="handleRemove($event, item)"
        >
          <svg
            class="h-4 w-4"
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
    </Tooltip>
  </div>
</template>
