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
    <Tooltip v-for="item in attachmentRows" :key="item.id" :text="attachmentName(item)">
      <div
        class="group relative h-16 cursor-pointer overflow-hidden rounded-lg border border-gray-200"
        @click="handleClick(item)"
      >
        <img
          v-if="attachmentPreviewUrl(item)"
          class="h-full w-auto object-cover"
          :alt="attachmentName(item)"
          :src="attachmentPreviewUrl(item)"
        />
        <span
          v-if="item.kind === 'editingPair'"
          class="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white"
        >
          编辑
        </span>
        <button
          class="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
          type="button"
          aria-label="移除引用图片"
          @click="handleRemove($event, item)"
        >
          <svg
            class="h-3 w-3"
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
