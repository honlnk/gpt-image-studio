<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { ImageAsset } from "../../types/studio";
import Tooltip from "../ui/Tooltip.vue";

type EditTool = "brush" | "eraser" | "rect" | "ellipse" | "pan";
type SelectionOperation = "add" | "erase";

type Point = { x: number; y: number };

type BrushSelection = {
  kind: "brush";
  operation: SelectionOperation;
  points: Point[];
  radius: number;
  feather: number;
};

type ShapeSelection = {
  kind: "rect" | "ellipse";
  operation: SelectionOperation;
  start: Point;
  end: Point;
  feather: number;
};

type Selection = BrushSelection | ShapeSelection;
type RenderedSelection =
  | {
    type: "brush";
    path: string;
    radius: number;
    operation: SelectionOperation;
  }
  | {
    type: "rect" | "ellipse";
    left: number;
    top: number;
    width: number;
    height: number;
    operation: SelectionOperation;
  };

const props = defineProps<{
  image?: ImageAsset;
}>();

const emit = defineEmits<{
  close: [];
  apply: [maskBlob: Blob];
}>();

const imageRef = ref<HTMLImageElement | null>(null);
const tool = ref<EditTool>("brush");
const brushRadius = ref(24);
const edgeSoftness = ref(0);
const zoom = ref(1);
const panX = ref(0);
const panY = ref(0);
const selections = ref<Selection[]>([]);
const redoSelections = ref<Selection[]>([]);
const draftSelection = ref<Selection | null>(null);
const isPointerDown = ref(false);
const isPanning = ref(false);
const panStartPointer = ref<Point | null>(null);
const panStartOffset = ref<Point>({ x: 0, y: 0 });

const allSelections = computed(() =>
  draftSelection.value ? [...selections.value, draftSelection.value] : [...selections.value],
);
const renderedSelections = computed<RenderedSelection[]>(() =>
  allSelections.value.map((selection) => shapeStyle(selection)),
);
const hasSelection = computed(() => allSelections.value.length > 0);
const canApply = computed(() => hasSelection.value);
const canUndo = computed(() => selections.value.length > 0);
const canRedo = computed(() => redoSelections.value.length > 0);
const contentTransform = computed(() =>
  `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
);

function closeModal() {
  resetSelection();
  emit("close");
}

function handleKeydown(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "z") {
    event.preventDefault();
    redoSelection();
  } else if ((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    undoSelection();
  }
}

onMounted(() => window.addEventListener("keydown", handleKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleKeydown));

function startSelection(event: PointerEvent) {
  if (tool.value === "pan") {
    isPanning.value = true;
    panStartPointer.value = { x: event.clientX, y: event.clientY };
    panStartOffset.value = { x: panX.value, y: panY.value };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    return;
  }

  if (!imageRef.value) return;
  const point = pointerPosition(event);
  isPointerDown.value = true;
  if (tool.value === "brush" || tool.value === "eraser") {
    draftSelection.value = {
      kind: "brush",
      operation: tool.value === "eraser" ? "erase" : "add",
      points: [point],
      radius: brushRadius.value,
      feather: edgeSoftness.value,
    };
    return;
  }

  draftSelection.value = {
    kind: tool.value,
    operation: "add",
    start: point,
    end: point,
    feather: edgeSoftness.value,
  };
}

function updateSelection(event: PointerEvent) {
  if (isPanning.value && panStartPointer.value) {
    panX.value = panStartOffset.value.x + (event.clientX - panStartPointer.value.x);
    panY.value = panStartOffset.value.y + (event.clientY - panStartPointer.value.y);
    return;
  }
  if (!isPointerDown.value || !draftSelection.value) return;
  const point = pointerPosition(event);

  if (draftSelection.value.kind === "brush") {
    draftSelection.value.points.push(point);
    return;
  }

  draftSelection.value.end = point;
}

function stopSelection() {
  if (isPanning.value) {
    isPanning.value = false;
    panStartPointer.value = null;
    return;
  }
  if (!draftSelection.value) {
    isPointerDown.value = false;
    return;
  }

  if (isSelectionRenderable(draftSelection.value)) {
    selections.value.push(draftSelection.value);
    redoSelections.value = [];
  }
  draftSelection.value = null;
  isPointerDown.value = false;
}

function resetSelection() {
  selections.value = [];
  draftSelection.value = null;
  isPointerDown.value = false;
  isPanning.value = false;
  panStartPointer.value = null;
  redoSelections.value = [];
}

function undoSelection() {
  const last = selections.value.at(-1);
  if (!last) return;
  selections.value = selections.value.slice(0, -1);
  redoSelections.value = [...redoSelections.value, last];
}

function redoSelection() {
  const last = redoSelections.value.at(-1);
  if (!last) return;
  redoSelections.value = redoSelections.value.slice(0, -1);
  selections.value = [...selections.value, last];
}

function zoomIn() {
  applyZoom(clamp(Number((zoom.value + 0.1).toFixed(2)), 0.5, 3));
}

function zoomOut() {
  applyZoom(clamp(Number((zoom.value - 0.1).toFixed(2)), 0.5, 3));
}

function applyZoom(newZoom: number) {
  const ratio = newZoom / zoom.value;
  panX.value *= ratio;
  panY.value *= ratio;
  zoom.value = newZoom;
}

function resetViewport() {
  zoom.value = 1;
  panX.value = 0;
  panY.value = 0;
}

function handleWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const delta = event.deltaY > 0 ? -0.1 : 0.1;
  applyZoom(clamp(Number((zoom.value + delta).toFixed(2)), 0.5, 3));
}

function pointerPosition(event: PointerEvent) {
  const bounds = imageRef.value?.getBoundingClientRect();
  const width = imageRef.value?.clientWidth ?? bounds?.width ?? 1;
  const height = imageRef.value?.clientHeight ?? bounds?.height ?? 1;
  if (!bounds) return { x: 0, y: 0 };
  const x = clamp(
    ((event.clientX - bounds.left) / bounds.width) * width,
    0,
    width,
  );
  const y = clamp(
    ((event.clientY - bounds.top) / bounds.height) * height,
    0,
    height,
  );
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

  allSelections.value.forEach((selection) => {
    drawSelection(ctx, selection, scaleX, scaleY);
  });

  const blob = await canvasToBlob(canvas);
  resetSelection();
  emit("apply", blob);
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  selection: Selection,
  scaleX: number,
  scaleY: number,
) {
  if (selection.kind === "brush") {
    ctx.save();
    applySelectionOperation(ctx, selection.operation);
    ctx.filter = selection.feather > 0
      ? `blur(${selection.feather * ((scaleX + scaleY) / 2)}px)`
      : "none";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = selection.operation === "erase"
      ? "rgba(255, 255, 255, 1)"
      : "rgba(0, 0, 0, 1)";

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
    ctx.restore();
    return;
  }

  ctx.save();
  applySelectionOperation(ctx, selection.operation);
  ctx.filter = selection.feather > 0
    ? `blur(${selection.feather * ((scaleX + scaleY) / 2)}px)`
    : "none";
  ctx.fillStyle = selection.operation === "erase"
    ? "rgba(255, 255, 255, 1)"
    : "rgba(0, 0, 0, 1)";
  const left = Math.min(selection.start.x, selection.end.x) * scaleX;
  const top = Math.min(selection.start.y, selection.end.y) * scaleY;
  const width = Math.abs(selection.end.x - selection.start.x) * scaleX;
  const height = Math.abs(selection.end.y - selection.start.y) * scaleY;
  if (width < 1 || height < 1) return;

  if (selection.kind === "rect") {
    ctx.fillRect(left, top, width, height);
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function applySelectionOperation(
  ctx: CanvasRenderingContext2D,
  operation: SelectionOperation,
) {
  ctx.globalCompositeOperation = operation === "erase" ? "source-over" : "destination-out";
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
      operation: selection.operation,
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
    operation: selection.operation,
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
      @mousedown.self="closeModal"
    >
      <div class="w-full max-w-5xl rounded-xl bg-white p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-sm font-semibold text-gray-900">选择要编辑的区域</div>
            <div class="text-xs text-gray-500">支持画笔、矩形、圆形，多次叠加选区</div>
          </div>
          <div class="flex items-center gap-1">
            <div v-if="tool === 'brush' || tool === 'eraser'" class="mr-2 flex items-center gap-2 whitespace-nowrap">
              <span class="text-xs text-gray-500">{{ tool === "eraser" ? "橡皮" : "画笔" }}</span>
              <input
                v-model.number="brushRadius"
                class="styled-range w-40"
                type="range"
                min="6"
                max="80"
                step="1"
              />
            </div>
            <div class="mr-2 flex items-center gap-2">
              <span class="text-xs text-gray-500">软边</span>
              <input v-model.number="edgeSoftness" class="styled-range" type="range" min="0" max="24" step="1" />
            </div>
            <Tooltip text="画笔" :delay="2000">
              <button
                :class="[
                  'rounded-lg p-2',
                  tool === 'brush' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100',
                ]"
                type="button"
                @click="tool = 'brush'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/><path d="M14.5 17.5 4.5 15"/></svg>
              </button>
            </Tooltip>
            <Tooltip text="橡皮" :delay="2000">
              <button
                :class="[
                  'rounded-lg p-2',
                  tool === 'eraser' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100',
                ]"
                type="button"
                @click="tool = 'eraser'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>
              </button>
            </Tooltip>
            <Tooltip text="方框" :delay="2000">
              <button
                :class="[
                  'rounded-lg p-2',
                  tool === 'rect' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100',
                ]"
                type="button"
                @click="tool = 'rect'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              </button>
            </Tooltip>
            <Tooltip text="圆框" :delay="2000">
              <button
                :class="[
                  'rounded-lg p-2',
                  tool === 'ellipse' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100',
                ]"
                type="button"
                @click="tool = 'ellipse'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>
              </button>
            </Tooltip>
            <Tooltip text="移动" :delay="2000">
              <button
                :class="[
                  'rounded-lg p-2',
                  tool === 'pan' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100',
                ]"
                type="button"
                @click="tool = 'pan'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>
              </button>
            </Tooltip>
          </div>
        </div>
        <div class="mb-3 flex items-center justify-end gap-1">
          <Tooltip text="撤销" :delay="2000">
            <button
              class="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              :disabled="!canUndo"
              @click="undoSelection"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            </button>
          </Tooltip>
          <Tooltip text="重做" :delay="2000">
            <button
              class="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              :disabled="!canRedo"
              @click="redoSelection"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
            </button>
          </Tooltip>
          <Tooltip text="重置选区" :delay="2000">
            <button
              class="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              :disabled="!hasSelection"
              @click="resetSelection"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </Tooltip>
          <div class="mx-1 h-5 w-px bg-gray-200"></div>
          <Tooltip text="缩小" :delay="2000">
            <button
              class="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
              type="button"
              @click="zoomOut"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
          </Tooltip>
          <span class="min-w-10 text-center text-xs text-gray-500">{{ Math.round(zoom * 100) }}%</span>
          <Tooltip text="放大" :delay="2000">
            <button
              class="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
              type="button"
              @click="zoomIn"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
          </Tooltip>
          <Tooltip text="复位视图" :delay="2000">
            <button
              class="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
              type="button"
              @click="resetViewport"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>
            </button>
          </Tooltip>
          <div class="mx-1 h-5 w-px bg-gray-200"></div>
          <button
            class="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            type="button"
            @click="closeModal"
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
        <div
          class="relative mx-auto flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg bg-gray-50 p-2"
          :class="tool === 'pan' ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'"
          @wheel="handleWheel"
          @pointerdown.prevent="startSelection"
          @pointermove.prevent="updateSelection"
          @pointerup.prevent="stopSelection"
          @pointerleave.prevent="stopSelection"
        >
          <div class="relative shrink-0" :style="{ transform: contentTransform, transformOrigin: 'center center' }">
            <img
              ref="imageRef"
              class="max-h-[66vh] max-w-full select-none rounded object-contain"
              :src="image.previewUrl"
              :alt="image.name"
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
                  :stroke="selection.operation === 'erase' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(0, 0, 0, 0.35)'"
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
                  :fill="selection.operation === 'erase' ? 'rgba(34, 197, 94, 0.18)' : 'rgba(0, 0, 0, 0.2)'"
                  :stroke="selection.operation === 'erase' ? 'rgba(34, 197, 94, 0.7)' : 'rgba(0, 0, 0, 0.6)'"
                  stroke-width="2"
                />
                <ellipse
                  v-else
                  :cx="selection.left + selection.width / 2"
                  :cy="selection.top + selection.height / 2"
                  :rx="selection.width / 2"
                  :ry="selection.height / 2"
                  :fill="selection.operation === 'erase' ? 'rgba(34, 197, 94, 0.18)' : 'rgba(0, 0, 0, 0.2)'"
                  :stroke="selection.operation === 'erase' ? 'rgba(34, 197, 94, 0.7)' : 'rgba(0, 0, 0, 0.6)'"
                  stroke-width="2"
                />
              </template>
            </svg>
          </div>
        </div>
        <div class="mt-2 text-xs text-gray-500">
          预览说明：黑色区域=编辑区域，绿色区域=擦除已选区域；支持多选区、撤销重做、缩放平移。
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.styled-range {
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: #374151;
  outline: none;
  cursor: pointer;
}

.styled-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  border: 2px solid #6366f1;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.styled-range::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
}

.styled-range::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: #374151;
}

.styled-range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  border: 2px solid #6366f1;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.styled-range::-moz-range-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
}
</style>
