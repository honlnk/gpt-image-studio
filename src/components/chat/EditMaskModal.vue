<script setup lang="ts">
import { computed, ref } from "vue";
import type { ImageAsset } from "../../types/studio";

type EditMode = "brush" | "rect" | "ellipse";

type Point = { x: number; y: number };

type BrushSelection = {
  kind: "brush";
  points: Point[];
  radius: number;
};

type ShapeSelection = {
  kind: "rect" | "ellipse";
  start: Point;
  end: Point;
};

type Selection = BrushSelection | ShapeSelection;
type RenderedSelection =
  | {
    type: "brush";
    path: string;
    radius: number;
  }
  | {
    type: "rect" | "ellipse";
    left: number;
    top: number;
    width: number;
    height: number;
  };

const props = defineProps<{
  image?: ImageAsset;
}>();

const emit = defineEmits<{
  close: [];
  apply: [maskBlob: Blob];
}>();

const imageRef = ref<HTMLImageElement | null>(null);
const mode = ref<EditMode>("brush");
const brushRadius = ref(24);
const selections = ref<Selection[]>([]);
const draftSelection = ref<Selection | null>(null);
const isPointerDown = ref(false);

const allSelections = computed(() =>
  draftSelection.value ? [...selections.value, draftSelection.value] : [...selections.value],
);
const renderedSelections = computed<RenderedSelection[]>(() =>
  allSelections.value.map((selection) => shapeStyle(selection)),
);
const hasSelection = computed(() => allSelections.value.length > 0);
const canApply = computed(() => hasSelection.value);

function startSelection(event: PointerEvent) {
  if (!imageRef.value) return;
  const point = pointerPosition(event);
  isPointerDown.value = true;

  if (mode.value === "brush") {
    draftSelection.value = {
      kind: "brush",
      points: [point],
      radius: brushRadius.value,
    };
    return;
  }

  draftSelection.value = {
    kind: mode.value,
    start: point,
    end: point,
  };
}

function updateSelection(event: PointerEvent) {
  if (!isPointerDown.value || !draftSelection.value) return;
  const point = pointerPosition(event);

  if (draftSelection.value.kind === "brush") {
    draftSelection.value.points.push(point);
    return;
  }

  draftSelection.value.end = point;
}

function stopSelection() {
  if (!draftSelection.value) {
    isPointerDown.value = false;
    return;
  }

  if (isSelectionRenderable(draftSelection.value)) {
    selections.value.push(draftSelection.value);
  }
  draftSelection.value = null;
  isPointerDown.value = false;
}

function resetSelection() {
  selections.value = [];
  draftSelection.value = null;
  isPointerDown.value = false;
}

function removeLastSelection() {
  selections.value = selections.value.slice(0, -1);
}

function pointerPosition(event: PointerEvent) {
  const bounds = imageRef.value?.getBoundingClientRect();
  if (!bounds) return { x: 0, y: 0 };
  const x = clamp(event.clientX - bounds.left, 0, bounds.width);
  const y = clamp(event.clientY - bounds.top, 0, bounds.height);
  return { x, y };
}

async function applyMask() {
  if (!props.image?.previewUrl || !imageRef.value || !canApply.value) return;

  const displayRect = imageRef.value.getBoundingClientRect();
  const naturalWidth = imageRef.value.naturalWidth;
  const naturalHeight = imageRef.value.naturalHeight;
  const scaleX = naturalWidth / displayRect.width;
  const scaleY = naturalHeight / displayRect.height;

  const canvas = document.createElement("canvas");
  canvas.width = naturalWidth;
  canvas.height = naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const imageData = ctx.createImageData(naturalWidth, naturalHeight);
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0, 0, 0, 1)";
  ctx.strokeStyle = "rgba(0, 0, 0, 1)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  allSelections.value.forEach((selection) => {
    drawSelection(ctx, selection, scaleX, scaleY);
  });
  ctx.restore();

  const blob = await canvasToBlob(canvas);
  emit("apply", blob);
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  selection: Selection,
  scaleX: number,
  scaleY: number,
) {
  if (selection.kind === "brush") {
    const points = selection.points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    }));
    if (!points.length) return;

    ctx.beginPath();
    ctx.lineWidth = selection.radius * 2 * ((scaleX + scaleY) / 2);
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    if (points.length === 1) {
      ctx.lineTo(points[0].x + 0.01, points[0].y + 0.01);
    }
    ctx.stroke();
    return;
  }

  const left = Math.min(selection.start.x, selection.end.x) * scaleX;
  const top = Math.min(selection.start.y, selection.end.y) * scaleY;
  const width = Math.abs(selection.end.x - selection.start.x) * scaleX;
  const height = Math.abs(selection.end.y - selection.start.y) * scaleY;
  if (width < 1 || height < 1) return;

  if (selection.kind === "rect") {
    ctx.fillRect(left, top, width, height);
    return;
  }

  ctx.beginPath();
  ctx.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法生成遮罩图片。"));
    }, "image/png");
  });
}

function isSelectionRenderable(selection: Selection) {
  if (selection.kind === "brush") {
    return selection.points.length >= 1;
  }

  const width = Math.abs(selection.end.x - selection.start.x);
  const height = Math.abs(selection.end.y - selection.start.y);
  return width > 2 && height > 2;
}

function shapeStyle(selection: Selection): RenderedSelection {
  if (selection.kind === "brush") {
    const path = selection.points.map((point) => `${point.x},${point.y}`).join(" ");
    return {
      type: "brush" as const,
      path,
      radius: selection.radius,
    };
  }

  const left = Math.min(selection.start.x, selection.end.x);
  const top = Math.min(selection.start.y, selection.end.y);
  const width = Math.abs(selection.end.x - selection.start.x);
  const height = Math.abs(selection.end.y - selection.start.y);
  return {
    type: selection.kind,
    left,
    top,
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="image?.previewUrl"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <div class="w-full max-w-5xl rounded-xl bg-white p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-sm font-semibold text-gray-900">选择要编辑的区域</div>
            <div class="text-xs text-gray-500">支持画笔、矩形、圆形，多次叠加选区</div>
          </div>
          <div class="flex items-center gap-2">
            <button
              :class="[
                'rounded-lg px-2.5 py-1.5 text-sm',
                mode === 'brush' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100',
              ]"
              type="button"
              @click="mode = 'brush'"
            >
              画笔
            </button>
            <button
              :class="[
                'rounded-lg px-2.5 py-1.5 text-sm',
                mode === 'rect' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100',
              ]"
              type="button"
              @click="mode = 'rect'"
            >
              方框
            </button>
            <button
              :class="[
                'rounded-lg px-2.5 py-1.5 text-sm',
                mode === 'ellipse' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100',
              ]"
              type="button"
              @click="mode = 'ellipse'"
            >
              圆框
            </button>
            <div v-if="mode === 'brush'" class="ml-2 flex items-center gap-2">
              <span class="text-xs text-gray-500">画笔</span>
              <input v-model.number="brushRadius" type="range" min="6" max="80" step="1" />
            </div>
          </div>
        </div>
        <div class="mb-3 flex items-center justify-end gap-2">
          <button
            class="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="!selections.length"
            @click="removeLastSelection"
          >
            撤销一步
          </button>
          <button
            class="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="!hasSelection"
            @click="resetSelection"
          >
            重置选区
          </button>
          <button
            class="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            type="button"
            @click="emit('close')"
          >
            取消
          </button>
          <button
            class="rounded-lg bg-black px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="!canApply"
            @click="applyMask"
          >
            应用区域
          </button>
        </div>
        <div class="relative mx-auto flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg bg-gray-50 p-2">
          <div class="relative shrink-0">
            <img
              ref="imageRef"
              class="max-h-[66vh] max-w-full select-none rounded object-contain"
              :src="image.previewUrl"
              :alt="image.name"
              @pointerdown.prevent="startSelection"
              @pointermove.prevent="updateSelection"
              @pointerup.prevent="stopSelection"
              @pointerleave.prevent="stopSelection"
            />
            <svg
              class="pointer-events-none absolute inset-0 h-full w-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              <template v-for="(selection, index) in renderedSelections" :key="index">
                <polyline
                  v-if="selection.type === 'brush'"
                  :points="selection.path"
                  fill="none"
                  stroke="rgba(0, 0, 0, 0.35)"
                  :stroke-width="selection.radius * 2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <rect
                  v-else-if="selection.type === 'rect'"
                  :x="selection.left"
                  :y="selection.top"
                  :width="selection.width"
                  :height="selection.height"
                  fill="rgba(0, 0, 0, 0.2)"
                  stroke="rgba(0, 0, 0, 0.6)"
                  stroke-width="2"
                />
                <ellipse
                  v-else
                  :cx="selection.left + selection.width / 2"
                  :cy="selection.top + selection.height / 2"
                  :rx="selection.width / 2"
                  :ry="selection.height / 2"
                  fill="rgba(0, 0, 0, 0.2)"
                  stroke="rgba(0, 0, 0, 0.6)"
                  stroke-width="2"
                />
              </template>
            </svg>
          </div>
        </div>
        <div class="mt-2 text-xs text-gray-500">
          预览说明：覆盖区域会作为编辑区域写入 mask，可叠加多个选区。
        </div>
      </div>
    </div>
  </Teleport>
</template>
