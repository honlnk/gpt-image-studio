<script setup lang="ts">
import { onMounted } from "vue";
import type { AnalyticsInsights } from "../../services/analyticsAnalysis";

const props = defineProps<{
  insights: AnalyticsInsights | null;
}>();

const emit = defineEmits<{
  refresh: [];
}>();

onMounted(() => {
  // 打开面板即刷新一次，保证数据是最新的。
  emit("refresh");
});

const PROMPT_MODE_LABELS: Record<string, string> = {
  default: "默认",
  safe: "安全",
  creative: "创意",
  adult: "成人",
  unknown: "未知",
};

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function promptModeLabel(mode: string): string {
  return PROMPT_MODE_LABELS[mode] ?? mode;
}

// 趋势柱状图：以最大值为标尺计算每根柱高度百分比。
function maxRequested(buckets: AnalyticsInsights["timeSeries"]): number {
  let max = 0;
  for (const b of buckets) {
    if (b.requested > max) max = b.requested;
  }
  return max || 1;
}
</script>

<template>
  <section aria-labelledby="analyticsDashboardTitle">
    <div class="flex items-center justify-between">
      <h3
        id="analyticsDashboardTitle"
        class="text-base font-semibold text-gray-900"
      >
        数据分析
      </h3>
      <button
        class="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
        type="button"
        @click="emit('refresh')"
      >
        刷新
      </button>
    </div>
    <p class="mt-1 text-sm leading-relaxed text-gray-500">
      基于本设备记录的行为日志计算的聚合指标，仅用于本地可用性分析，不上传。
    </p>

    <!-- 空状态 -->
    <div
      v-if="!props.insights || props.insights.overview.totalEvents === 0"
      class="mt-8 rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400"
    >
      暂无数据，使用产品产生行为日志后查看。
    </div>

    <div v-else class="mt-5 space-y-6">
      <!-- 概览 -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-lg bg-gray-50 px-3 py-2.5">
          <div class="text-xs text-gray-500">总事件</div>
          <div class="mt-0.5 text-lg font-semibold text-gray-900">
            {{ props.insights.overview.totalEvents }}
          </div>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2.5">
          <div class="text-xs text-gray-500">会话数</div>
          <div class="mt-0.5 text-lg font-semibold text-gray-900">
            {{ props.insights.overview.sessionCount }}
          </div>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2.5">
          <div class="text-xs text-gray-500">对话数</div>
          <div class="mt-0.5 text-lg font-semibold text-gray-900">
            {{ props.insights.overview.conversationCount }}
          </div>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2.5">
          <div class="text-xs text-gray-500">图片数</div>
          <div class="mt-0.5 text-lg font-semibold text-gray-900">
            {{ props.insights.overview.imageCount }}
          </div>
        </div>
      </div>
      <p class="text-xs text-gray-400">
        时间范围：{{ formatDateTime(props.insights.overview.startAt) }} ~
        {{ formatDateTime(props.insights.overview.endAt) }}
      </p>

      <!-- 生成漏斗 -->
      <div>
        <h4 class="text-sm font-medium text-gray-700">生成漏斗</h4>
        <div class="mt-2 space-y-1.5">
          <div class="flex items-center gap-2 text-sm">
            <span class="w-16 shrink-0 text-gray-500">请求</span>
            <div class="flex-1">
              <div
                class="h-5 rounded bg-gray-800"
                :style="{ width: '100%' }"
              ></div>
            </div>
            <span class="w-10 shrink-0 text-right font-medium text-gray-900">
              {{ props.insights.funnel.requested }}
            </span>
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span class="w-16 shrink-0 text-gray-500">成功</span>
            <div class="flex-1">
              <div
                class="h-5 rounded bg-green-500"
                :style="{
                  width: percent(
                    props.insights.funnel.requested > 0
                      ? props.insights.funnel.succeeded /
                        props.insights.funnel.requested
                      : 0,
                  ),
                }"
              ></div>
            </div>
            <span class="w-10 shrink-0 text-right font-medium text-gray-900">
              {{ props.insights.funnel.succeeded }}
            </span>
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span class="w-16 shrink-0 text-gray-500">失败</span>
            <div class="flex-1">
              <div
                class="h-5 rounded bg-red-400"
                :style="{
                  width: percent(
                    props.insights.funnel.requested > 0
                      ? props.insights.funnel.failed /
                        props.insights.funnel.requested
                      : 0,
                  ),
                }"
              ></div>
            </div>
            <span class="w-10 shrink-0 text-right font-medium text-gray-900">
              {{ props.insights.funnel.failed }}
            </span>
          </div>
        </div>
        <p class="mt-1.5 text-xs text-gray-500">
          成功率
          <span class="font-medium text-gray-900">{{
            percent(props.insights.funnel.successRate)
          }}</span>
        </p>
      </div>

      <!-- 满意度代理 -->
      <div>
        <h4 class="text-sm font-medium text-gray-700">满意度代理</h4>
        <p class="mt-0.5 text-xs text-gray-400">
          以生成成功的图片为基准，统计其后的下载、打标、删除行为占比。
        </p>
        <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-lg border border-gray-200 px-3 py-2">
            <div class="text-xs text-gray-500">生成</div>
            <div class="mt-0.5 text-base font-semibold text-gray-900">
              {{ props.insights.satisfaction.generated }}
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 px-3 py-2">
            <div class="text-xs text-gray-500">下载率</div>
            <div class="mt-0.5 text-base font-semibold text-gray-900">
              {{ percent(props.insights.satisfaction.downloadRate) }}
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 px-3 py-2">
            <div class="text-xs text-gray-500">打标率</div>
            <div class="mt-0.5 text-base font-semibold text-gray-900">
              {{ percent(props.insights.satisfaction.tagRate) }}
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 px-3 py-2">
            <div class="text-xs text-gray-500">保留率</div>
            <div class="mt-0.5 text-base font-semibold text-gray-900">
              {{ percent(props.insights.satisfaction.keptRate) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Prompt 模式对比 -->
      <div v-if="props.insights.promptModes.length > 0">
        <h4 class="text-sm font-medium text-gray-700">提示词模式对比</h4>
        <div class="mt-2 overflow-hidden rounded-lg border border-gray-200">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th class="px-3 py-2 font-medium">模式</th>
                <th class="px-3 py-2 text-right font-medium">请求</th>
                <th class="px-3 py-2 text-right font-medium">成功</th>
                <th class="px-3 py-2 text-right font-medium">成功率</th>
                <th class="px-3 py-2 text-right font-medium">满意度</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr
                v-for="row in props.insights.promptModes"
                :key="row.promptMode"
              >
                <td class="px-3 py-2 text-gray-900">
                  {{ promptModeLabel(row.promptMode) }}
                </td>
                <td class="px-3 py-2 text-right text-gray-700">
                  {{ row.requested }}
                </td>
                <td class="px-3 py-2 text-right text-gray-700">
                  {{ row.succeeded }}
                </td>
                <td class="px-3 py-2 text-right text-gray-900">
                  {{ percent(row.successRate) }}
                </td>
                <td class="px-3 py-2 text-right text-gray-900">
                  {{ percent(row.satisfactionRate) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 趋势（最近 14 天） -->
      <div v-if="props.insights.timeSeries.length > 0">
        <h4 class="text-sm font-medium text-gray-700">生成趋势（最近 14 天）</h4>
        <div
          class="mt-3 flex h-28 items-stretch gap-1"
          :title="`最大日请求 ${maxRequested(props.insights.timeSeries)}`"
        >
          <div
            v-for="bucket in props.insights.timeSeries"
            :key="bucket.date"
            class="group relative flex h-full flex-1 flex-col justify-end"
            :title="`${bucket.date}：请求 ${bucket.requested}，成功 ${bucket.succeeded}`"
          >
            <!-- 成功层（绿）叠在请求层（灰）上：用两段柱表达 -->
            <div
              class="w-full rounded-t bg-gray-300 transition-colors group-hover:bg-gray-400"
              :style="{
                height: `${
                  (bucket.requested / maxRequested(props.insights.timeSeries)) *
                  100
                }%`,
              }"
            ></div>
            <div
              v-if="bucket.succeeded > 0"
              class="absolute bottom-0 w-full rounded-t bg-green-500/70"
              :style="{
                height: `${
                  (bucket.succeeded / maxRequested(props.insights.timeSeries)) *
                  100
                }%`,
              }"
            ></div>
          </div>
        </div>
        <div class="mt-1 flex justify-between text-xs text-gray-400">
          <span>{{ props.insights.timeSeries[0]?.date }}</span>
          <span>{{ props.insights.timeSeries[props.insights.timeSeries.length - 1]?.date }}</span>
        </div>
        <div class="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
          <span class="flex items-center gap-1">
            <span class="inline-block h-2.5 w-2.5 rounded-sm bg-gray-300"></span>
            请求
          </span>
          <span class="flex items-center gap-1">
            <span class="inline-block h-2.5 w-2.5 rounded-sm bg-green-500/70"></span>
            成功
          </span>
        </div>
      </div>

      <!-- 事件分布 Top 10 -->
      <div v-if="props.insights.topEvents.length > 0">
        <h4 class="text-sm font-medium text-gray-700">事件分布（Top 10）</h4>
        <div class="mt-2 space-y-1">
          <div
            v-for="row in props.insights.topEvents.slice(0, 10)"
            :key="row.eventName"
            class="flex items-center gap-2 text-xs"
          >
            <span class="w-44 shrink-0 truncate font-mono text-gray-600" :title="row.eventName">
              {{ row.eventName }}
            </span>
            <div class="flex-1">
              <div
                class="h-3.5 rounded bg-gray-700"
                :style="{
                  width: percent(
                    row.count /
                      (props.insights?.topEvents[0]?.count || 1),
                  ),
                }"
              ></div>
            </div>
            <span class="w-10 shrink-0 text-right text-gray-900">
              {{ row.count }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
