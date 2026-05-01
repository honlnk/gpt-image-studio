<script setup>
import { computed, ref, watch } from 'vue'

const DEFAULT_API_BASE_URL = 'https://code.mrzengchn.com/v1/images'
const STORAGE_KEYS = {
  apiKey: 'gpt-image-studio:api-key',
  apiBaseUrl: 'gpt-image-studio:api-base-url',
}

const model = ref('gpt-image-2')
const apiKey = ref(readStorage(STORAGE_KEYS.apiKey, ''))
const apiBaseUrl = ref(readStorage(STORAGE_KEYS.apiBaseUrl, DEFAULT_API_BASE_URL))
const mode = ref('generate')
const prompt = ref('')
const size = ref('auto')
const quality = ref('auto')
const background = ref('auto')
const outputFormat = ref('png')
const imageFile = ref(null)
const maskFile = ref(null)
const imageSrc = ref('')
const status = ref('')
const statusType = ref('')
const isBusy = ref(false)
const isSettingsOpen = ref(false)

const isEditMode = computed(() => mode.value === 'edit')
const actionLabel = computed(() => (isEditMode.value ? '编辑图片' : '生成图片'))

watch(apiKey, (value) => writeStorage(STORAGE_KEYS.apiKey, value.trim()))
watch(apiBaseUrl, (value) => writeStorage(STORAGE_KEYS.apiBaseUrl, value.trim()))

function readStorage(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    setStatus('浏览器本地存储不可用，配置不会在刷新后保留。', 'error')
  }
}

function setImageFile(event) {
  imageFile.value = event.target.files?.[0] ?? null
}

function setMaskFile(event) {
  maskFile.value = event.target.files?.[0] ?? null
}

function openSettings() {
  isSettingsOpen.value = true
}

function closeSettings() {
  isSettingsOpen.value = false
}

function validate() {
  if (!apiKey.value.trim()) return '请填写 OpenAI API key。'
  if (!apiBaseUrl.value.trim()) return '请填写 API Base URL。'
  if (!model.value.trim()) return '请填写模型名称。'
  if (!prompt.value.trim()) return '请填写 prompt。'
  if (isEditMode.value && !imageFile.value) return '编辑模式需要上传原图。'
  return ''
}

async function submit() {
  const validationError = validate()

  if (validationError) {
    setStatus(validationError, 'error')
    return
  }

  isBusy.value = true
  imageSrc.value = ''
  setStatus('正在请求 Images API...', '')

  try {
    const payload = isEditMode.value ? await editImage() : await generateImage()
    const imageData = payload?.data?.[0]?.b64_json

    if (!imageData) {
      throw new Error('响应中没有 data[0].b64_json。')
    }

    imageSrc.value = `data:image/${outputFormat.value};base64,${imageData}`
    setStatus('完成。', 'success')
  } catch (error) {
    setStatus(formatError(error), 'error')
  } finally {
    isBusy.value = false
  }
}

async function generateImage() {
  return requestJson(`${normalizedBaseUrl()}/generations`, {
    model: model.value.trim(),
    prompt: prompt.value.trim(),
    size: size.value,
    quality: quality.value,
    background: background.value,
    output_format: outputFormat.value,
  })
}

async function editImage() {
  const body = new FormData()
  body.append('model', model.value.trim())
  body.append('prompt', prompt.value.trim())
  body.append('image', imageFile.value)
  body.append('size', size.value)
  body.append('quality', quality.value)
  body.append('background', background.value)
  body.append('output_format', outputFormat.value)

  if (maskFile.value) {
    body.append('mask', maskFile.value)
  }

  return requestForm(`${normalizedBaseUrl()}/edits`, body)
}

function normalizedBaseUrl() {
  return apiBaseUrl.value.trim().replace(/\/+$/, '')
}

async function requestJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.value.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  return parseResponse(response)
}

async function requestForm(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.value.trim()}`,
    },
    body,
  })

  return parseResponse(response)
}

async function parseResponse(response) {
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}

  if (!response.ok) {
    const message = payload?.error?.message || `请求失败：HTTP ${response.status}`
    throw new Error(message)
  }

  return payload
}

function downloadName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `gpt-image-studio-${stamp}.${outputFormat.value}`
}

function setStatus(message, type) {
  status.value = message
  statusType.value = type
}

function formatError(error) {
  if (error instanceof SyntaxError) return '接口返回了无法解析的响应。'
  return error?.message || String(error)
}
</script>

<template>
  <main class="app-shell">
    <section class="workspace">
      <form class="panel controls" @submit.prevent="submit">
        <div class="topline">
          <span>GPT Image Studio</span>
          <button class="settings-button" type="button" @click="openSettings">
            设置
          </button>
        </div>

        <div class="intro">
          <h1>简约图片生成工具</h1>
          <p>输入 prompt 和参数，直接调用兼容 OpenAI Images API 的接口。</p>
        </div>

        <div class="config-summary">
          <div>
            <span>当前模型</span>
            <strong>{{ model || '未设置' }}</strong>
          </div>
          <div>
            <span>接口配置</span>
            <strong>{{ apiKey ? '已保存' : '未填写 API key' }}</strong>
          </div>
        </div>

        <fieldset class="mode-switch">
          <legend>模式</legend>
          <label :class="{ active: mode === 'generate' }">
            <input v-model="mode" type="radio" value="generate" />
            文生图
          </label>
          <label :class="{ active: mode === 'edit' }">
            <input v-model="mode" type="radio" value="edit" />
            编辑图片
          </label>
        </fieldset>

        <div class="field">
          <label for="prompt">Prompt</label>
          <textarea
            id="prompt"
            v-model="prompt"
            placeholder="描述你想生成或编辑的图片..."
          />
        </div>

        <div v-if="isEditMode" class="edit-block">
          <div class="field">
            <label for="imageFile">原图</label>
            <input
              id="imageFile"
              accept="image/png,image/jpeg,image/webp"
              type="file"
              @change="setImageFile"
            />
          </div>

          <div class="field">
            <label for="maskFile">Mask（可选）</label>
            <input
              id="maskFile"
              accept="image/png"
              type="file"
              @change="setMaskFile"
            />
            <p class="hint">透明区域表示需要被编辑的部分。</p>
          </div>
        </div>

        <div class="settings-grid">
          <div class="field">
            <label for="size">尺寸</label>
            <select id="size" v-model="size">
              <option value="auto">auto</option>
              <option value="1024x1024">1024x1024</option>
              <option value="1536x1024">1536x1024</option>
              <option value="1024x1536">1024x1536</option>
            </select>
          </div>

          <div class="field">
            <label for="quality">质量</label>
            <select id="quality" v-model="quality">
              <option value="auto">auto</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </div>

          <div class="field">
            <label for="background">背景</label>
            <select id="background" v-model="background">
              <option value="auto">auto</option>
              <option value="opaque">opaque</option>
              <option value="transparent">transparent</option>
            </select>
          </div>

          <div class="field">
            <label for="outputFormat">格式</label>
            <select id="outputFormat" v-model="outputFormat">
              <option value="png">png</option>
              <option value="webp">webp</option>
              <option value="jpeg">jpeg</option>
            </select>
          </div>
        </div>

        <button class="primary-action" :disabled="isBusy" type="submit">
          {{ isBusy ? '处理中...' : actionLabel }}
        </button>

        <p v-if="status" :class="['status', statusType]" role="status">{{ status }}</p>
      </form>

      <section class="panel result-panel">
        <div class="result-toolbar">
          <div>
            <strong>预览</strong>
            <span>{{ imageSrc ? '已生成结果' : '等待生成' }}</span>
          </div>
          <a
            v-if="imageSrc"
            class="download"
            :download="downloadName()"
            :href="imageSrc"
          >
            下载
          </a>
        </div>

        <div class="preview">
          <img v-if="imageSrc" :src="imageSrc" alt="生成的图片" />
          <div v-else class="empty-state">
            <span></span>
            <p>生成结果会显示在这里</p>
          </div>
        </div>
      </section>
    </section>

    <div
      v-if="isSettingsOpen"
      class="modal-backdrop"
      role="presentation"
      @click.self="closeSettings"
    >
      <section
        aria-labelledby="settingsTitle"
        aria-modal="true"
        class="settings-modal"
        role="dialog"
      >
        <div class="modal-header">
          <div>
            <h2 id="settingsTitle">接口设置</h2>
            <p>配置会保存在当前浏览器本地存储中。</p>
          </div>
          <button aria-label="关闭设置" class="icon-button" type="button" @click="closeSettings">
            ×
          </button>
        </div>

        <div class="notice">
          API key 会保存在浏览器 localStorage。共享电脑或公共环境中请谨慎使用。
        </div>

        <div class="field">
          <label for="apiKey">OpenAI API key</label>
          <input
            id="apiKey"
            v-model="apiKey"
            autocomplete="off"
            placeholder="sk-..."
            type="password"
          />
        </div>

        <div class="field">
          <label for="apiBaseUrl">API Base URL</label>
          <input id="apiBaseUrl" v-model="apiBaseUrl" type="url" />
          <p class="hint">默认使用兼容代理地址，刷新页面会保留当前配置。</p>
        </div>

        <div class="field">
          <label for="model">模型</label>
          <input id="model" v-model="model" list="models" />
          <datalist id="models">
            <option value="gpt-image-2" />
            <option value="gpt-image-1.5" />
            <option value="gpt-image-1" />
            <option value="gpt-image-1-mini" />
          </datalist>
        </div>

        <div class="modal-actions">
          <button class="primary-action" type="button" @click="closeSettings">
            完成
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
