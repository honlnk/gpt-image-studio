<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  activateDataset,
  getActiveDataset,
  getOssConfig,
  saveOssConfig,
  type DatasetView,
  type OssCredentialsView,
} from "../../services/companionApi";

/**
 * 存储位置配置面板（阶段二 PR7，仅 Companion 模式显示）。
 *
 * 提供 D6 三选项切换：A 自定义目录 / B 默认目录 / C OSS。
 * 切换流程（D1 数据集隔离）：
 * 1. 调 activateDataset 切换 Companion 的 active dataset。
 * 2. 成功后 window.location.reload() —— ViewModel setup 重新装配 storage，hydrate 读新数据集。
 *
 * 切换前给确认提示（当前内容不可见但不删除）。
 */

const props = defineProps<{
  companionUrl: string;
  companionAccessKey: string;
}>();

const emit = defineEmits<{
  /** 切换成功后触发，让父组件做 reload 或提示。 */
  switched: [];
}>();

const activeDataset = ref<DatasetView | null>(null);
const ossConfig = ref<OssCredentialsView | null>(null);
const loading = ref(true);
const switching = ref(false);
const errorMsg = ref("");
const successMsg = ref("");

// 切换表单状态
type SelectedKind = "filesystem-default" | "filesystem-custom" | "oss";
const selectedKind = ref<SelectedKind>("filesystem-default");
const customDirectory = ref("");
const ossEndpoint = ref("");
const ossBucket = ref("");
const ossAccessKeyId = ref("");
const ossAccessKeySecret = ref("");

const kindLabels: Record<SelectedKind, string> = {
  "filesystem-default": "默认目录（推荐）",
  "filesystem-custom": "指定目录",
  oss: "阿里云 OSS",
};

onMounted(async () => {
  await refresh();
});

async function refresh() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const [dataset, oss] = await Promise.all([
      getActiveDataset(props.companionUrl, props.companionAccessKey),
      getOssConfig(props.companionUrl),
    ]);
    activeDataset.value = dataset;
    ossConfig.value = oss;
    if (dataset) {
      selectedKind.value = dataset.image_store_kind;
    }
    if (oss) {
      ossEndpoint.value = oss.endpoint;
      ossBucket.value = oss.bucket;
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function handleSwitch() {
  if (switching.value) return;
  // 确认提示（D1：当前内容将不可见，不会删除）
  const currentLabel = activeDataset.value
    ? kindLabels[activeDataset.value.image_store_kind] ?? activeDataset.value.label
    : "未知";
  const newLabel = kindLabels[selectedKind.value];
  const confirmed = window.confirm(
    `切换到「${newLabel}」后，当前「${currentLabel}」的内容将不可见（不会删除）。\n` +
      `新内容会存到新位置。切回「${currentLabel}」可找回原有内容。\n\n是否继续？`,
  );
  if (!confirmed) return;

  // OSS 模式：先保存 OSS 凭据
  if (selectedKind.value === "oss") {
    if (!ossEndpoint.value || !ossBucket.value || !ossAccessKeyId.value || !ossAccessKeySecret.value) {
      errorMsg.value = "请填写完整的 OSS 配置（endpoint/bucket/AccessKey）";
      return;
    }
    switching.value = true;
    errorMsg.value = "";
    const ossResult = await saveOssConfig(props.companionUrl, {
      endpoint: ossEndpoint.value,
      bucket: ossBucket.value,
      accessKeyId: ossAccessKeyId.value,
      accessKeySecret: ossAccessKeySecret.value,
    });
    if (!ossResult.ok) {
      errorMsg.value = `OSS 配置失败：${ossResult.error}`;
      switching.value = false;
      return;
    }
  }

  // 自定义目录：校验非空
  if (selectedKind.value === "filesystem-custom" && !customDirectory.value.trim()) {
    errorMsg.value = "请输入目录路径";
    return;
  }

  switching.value = true;
  errorMsg.value = "";

  const input =
    selectedKind.value === "oss"
      ? {
          storageKind: "oss" as const,
          storageConfig: {
            endpoint: ossEndpoint.value,
            bucket: ossBucket.value,
            prefix: "gpt-image-studio",
          },
          imageStoreKind: "oss" as const,
        }
      : selectedKind.value === "filesystem-custom"
        ? {
            storageKind: "filesystem" as const,
            storageConfig: { directory: customDirectory.value.trim() },
            imageStoreKind: "filesystem-custom" as const,
          }
        : {
            storageKind: "filesystem" as const,
            storageConfig: { directory: "" }, // default 由 Companion 决定
            imageStoreKind: "filesystem-default" as const,
          };

  const result = await activateDataset(
    props.companionUrl,
    props.companionAccessKey,
    input,
  );
  if (!result.ok) {
    errorMsg.value = `切换失败：${result.error}`;
    switching.value = false;
    return;
  }

  successMsg.value = result.created ? "已创建新数据集，正在重新加载…" : "已切换数据集，正在重新加载…";
  emit("switched");
  // 短暂延迟让用户看到提示，再 reload
  setTimeout(() => {
    window.location.reload();
  }, 800);
}
</script>

<template>
  <section aria-labelledby="storageLocationTitle">
    <h3 id="storageLocationTitle" class="text-base font-semibold text-gray-900">
      存储位置
    </h3>
    <p class="mt-1 text-xs leading-relaxed text-gray-500">
      Companion 模式下，数据存储在本地 Companion 服务。切换存储位置会切换数据集（当前内容不会删除，切回可找回）。
    </p>

    <div v-if="loading" class="mt-4 text-sm text-gray-500">加载中…</div>

    <div v-else class="mt-4 space-y-4">
      <!-- 当前位置 -->
      <div class="rounded-lg border border-gray-200 px-3 py-2.5">
        <div class="text-xs text-gray-500">当前存储位置</div>
        <div class="mt-1 text-sm font-medium text-gray-900">
          {{ activeDataset ? kindLabels[activeDataset.image_store_kind] ?? activeDataset.label : '未配置' }}
        </div>
        <div v-if="activeDataset" class="mt-1 text-xs text-gray-400">
          {{ activeDataset.label }}
        </div>
      </div>

      <!-- 选择新位置 -->
      <div class="space-y-2">
        <div class="text-sm font-medium text-gray-700">切换到</div>
        <label
          v-for="kind in (['filesystem-default', 'filesystem-custom', 'oss'] as const)"
          :key="kind"
          :class="[
            'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
            selectedKind === kind
              ? 'border-gray-900 bg-gray-50'
              : 'border-gray-200 hover:border-gray-300',
          ]"
        >
          <input
            type="radio"
            :value="kind"
            v-model="selectedKind"
            class="mt-0.5 h-4 w-4 accent-gray-900"
          />
          <div class="flex-1">
            <div class="text-sm font-medium text-gray-900">{{ kindLabels[kind] }}</div>
            <div v-if="kind === 'filesystem-default'" class="mt-0.5 text-xs text-gray-500">
              存到 Companion 默认目录，无需配置，数据安全。
            </div>
            <div v-else-if="kind === 'filesystem-custom'" class="mt-0.5 text-xs text-gray-500">
              存到指定文件夹，图片可直接用文件管理器打开。需输入绝对路径。
            </div>
            <div v-else class="mt-0.5 text-xs text-gray-500">
              上传到阿里云 OSS，跨设备访问。需配置 bucket 和 AccessKey。
            </div>
          </div>
        </label>
      </div>

      <!-- 自定义目录输入 -->
      <div v-if="selectedKind === 'filesystem-custom'" class="rounded-lg border border-gray-200 px-3 py-2.5">
        <label class="text-xs font-medium text-gray-600">目录绝对路径</label>
        <input
          type="text"
          v-model="customDirectory"
          placeholder="/Users/yourname/Pictures/GPT-Image-Studio"
          class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
        />
        <p class="mt-1 text-xs text-gray-400">目录必须已存在且可写，不允许系统敏感目录。</p>
      </div>

      <!-- OSS 配置 -->
      <div v-if="selectedKind === 'oss'" class="space-y-3 rounded-lg border border-gray-200 px-3 py-2.5">
        <div>
          <label class="text-xs font-medium text-gray-600">Endpoint</label>
          <input
            type="text"
            v-model="ossEndpoint"
            placeholder="oss-cn-hangzhou.aliyuncs.com"
            class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600">Bucket</label>
          <input
            type="text"
            v-model="ossBucket"
            placeholder="my-bucket"
            class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600">AccessKey ID</label>
          <input
            type="text"
            v-model="ossAccessKeyId"
            placeholder="LTAI..."
            class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600">AccessKey Secret</label>
          <input
            type="password"
            v-model="ossAccessKeySecret"
            placeholder="••••••••"
            class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
        <div v-if="ossConfig" class="text-xs text-gray-400">
          当前已配置：{{ ossConfig.endpoint }} / {{ ossConfig.bucket }}（{{ ossConfig.accessKeyIdMasked }}）
        </div>
        <p class="text-xs text-gray-400">保存前会做连通性测试，凭据错误将被拒绝。AccessKey 只存在 Companion 本地。</p>
      </div>

      <!-- 错误/成功提示 -->
      <div v-if="errorMsg" class="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
        {{ errorMsg }}
      </div>
      <div v-if="successMsg" class="rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
        {{ successMsg }}
      </div>

      <!-- 切换按钮 -->
      <button
        type="button"
        :disabled="switching"
        :class="[
          'w-full rounded-md px-3 py-2 text-sm font-medium transition-colors',
          switching
            ? 'cursor-not-allowed bg-gray-300 text-gray-500'
            : 'bg-gray-900 text-white hover:bg-gray-800',
        ]"
        @click="handleSwitch"
      >
        {{ switching ? '切换中…' : '切换存储位置' }}
      </button>
    </div>
  </section>
</template>
