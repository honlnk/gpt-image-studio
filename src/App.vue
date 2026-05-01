<script setup lang="ts">
import { computed, ref, watch } from 'vue'

type MessageRole = 'user' | 'assistant'
type MessageStatus = 'pending' | 'success' | 'error'
type ImageSource = 'generated' | 'imported'
type ImageTone = 'amber' | 'green' | 'rose' | 'blue'
type ImageVariant = 'thumb' | 'library' | 'result'

type Conversation = {
  id: string
  title: string
  summary: string
  updatedAt: string
}

type Message = {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  referencedImageIds: string[]
  resultImageIds: string[]
  status: MessageStatus
  createdAt: string
}

type ImageAsset = {
  id: string
  name: string
  source: ImageSource
  prompt: string
  createdAt: string
  tone: ImageTone
}

const DEFAULT_API_BASE_URL = 'https://code.mrzengchn.com/v1/images'
const STORAGE_KEYS = {
  apiKey: 'gpt-image-studio:api-key',
  apiBaseUrl: 'gpt-image-studio:api-base-url',
} as const

const model = ref('gpt-image-2')
const apiKey = ref(readStorage(STORAGE_KEYS.apiKey, ''))
const apiBaseUrl = ref(readStorage(STORAGE_KEYS.apiBaseUrl, DEFAULT_API_BASE_URL))
const size = ref('auto')
const quality = ref('auto')
const background = ref('auto')
const outputFormat = ref('png')
const isSettingsOpen = ref(false)
const isLibraryOpen = ref(false)
const composerText = ref('')
const attachedImages = ref<string[]>([])

const conversations = ref<Conversation[]>([
  {
    id: 'c-1',
    title: '咖啡馆海报探索',
    summary: '复古橱窗、暖光、手写标题',
    updatedAt: '刚刚',
  },
  {
    id: 'c-2',
    title: '产品图背景替换',
    summary: '白底耳机改成工作台场景',
    updatedAt: '昨天',
  },
  {
    id: 'c-3',
    title: '头像风格统一',
    summary: '把多张头像调整成同一视觉',
    updatedAt: '周三',
  },
])

const activeConversationId = ref('c-1')
const messages = ref<Message[]>([
  {
    id: 'm-1',
    conversationId: 'c-1',
    role: 'user',
    content: '生成一张复古咖啡馆开业海报，画面里有雨夜街道和温暖橱窗。',
    referencedImageIds: [],
    resultImageIds: [],
    status: 'success',
    createdAt: '10:24',
  },
  {
    id: 'm-2',
    conversationId: 'c-1',
    role: 'assistant',
    content: '已生成一张候选海报。',
    referencedImageIds: [],
    resultImageIds: ['img-1'],
    status: 'success',
    createdAt: '10:25',
  },
  {
    id: 'm-3',
    conversationId: 'c-1',
    role: 'user',
    content: '保留这个氛围，但把文字区域留得更干净一点。',
    referencedImageIds: ['img-1'],
    resultImageIds: [],
    status: 'success',
    createdAt: '10:30',
  },
  {
    id: 'm-4',
    conversationId: 'c-1',
    role: 'assistant',
    content: '正在基于引用图调整版式。',
    referencedImageIds: ['img-1'],
    resultImageIds: [],
    status: 'pending',
    createdAt: '10:31',
  },
  {
    id: 'm-5',
    conversationId: 'c-2',
    role: 'user',
    content: '把这张产品图放到简洁的木质桌面上，光线自然一点。',
    referencedImageIds: ['img-2'],
    resultImageIds: [],
    status: 'success',
    createdAt: '昨天',
  },
  {
    id: 'm-6',
    conversationId: 'c-2',
    role: 'assistant',
    content: '编辑失败，后续会提供重试入口。',
    referencedImageIds: ['img-2'],
    resultImageIds: [],
    status: 'error',
    createdAt: '昨天',
  },
])

const imageAssets = ref<ImageAsset[]>([
  {
    id: 'img-1',
    name: '雨夜咖啡馆海报',
    source: 'generated',
    prompt: '复古咖啡馆开业海报，雨夜街道，暖光橱窗',
    createdAt: '10:25',
    tone: 'amber',
  },
  {
    id: 'img-2',
    name: '耳机产品原图',
    source: 'imported',
    prompt: '用户导入的参考图',
    createdAt: '昨天',
    tone: 'green',
  },
  {
    id: 'img-3',
    name: '柔和头像草图',
    source: 'generated',
    prompt: '柔和光线，干净背景，半身头像',
    createdAt: '周三',
    tone: 'rose',
  },
  {
    id: 'img-4',
    name: '城市霓虹封面',
    source: 'generated',
    prompt: '赛博城市，霓虹灯，电影感封面',
    createdAt: '周一',
    tone: 'blue',
  },
])

const activeConversation = computed(() =>
  conversations.value.find((item) => item.id === activeConversationId.value),
)
const activeMessages = computed(() =>
  messages.value.filter((message) => message.conversationId === activeConversationId.value),
)
const activeAttachments = computed(() =>
  attachedImages.value
    .map((id) => imageAssets.value.find((image) => image.id === id))
    .filter((image): image is ImageAsset => Boolean(image)),
)
const canSend = computed(() => Boolean(composerText.value.trim() || attachedImages.value.length))
const imageModeLabel = computed(() => (attachedImages.value.length ? '引用图片编辑' : '文字生成图片'))

const controlFocus =
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#1a5f7a]/25'
const buttonBase = `cursor-pointer rounded-lg font-extrabold ${controlFocus}`
const outlineButton = `${buttonBase} border border-[#cec6b8] bg-[#fffefa] text-[#243247] hover:border-[#1a5f7a] hover:bg-[#e7f3f7] hover:text-[#103a4c]`
const primaryButton = `${buttonBase} border-0 bg-[#1a5f7a] text-white hover:bg-[#13495e]`
const labelClass = 'mb-[7px] block text-sm font-bold text-[#243247]'
const fieldControlClass = `min-h-11 w-full rounded-lg border border-[#cec6b8] bg-[#fffefa] px-[11px] py-[9px] text-[#172033] ${controlFocus}`
const eyebrowClass = 'mb-[3px] block text-xs font-extrabold uppercase tracking-normal text-[#667583]'
const smallTextClass = 'overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-[1.45] text-[#667583]'
const toneClasses: Record<ImageTone, string> = {
  amber:
    '[background:linear-gradient(135deg,rgba(24,37,52,0.82),rgba(24,37,52,0.1)),radial-gradient(circle_at_62%_38%,#f2c66d_0_18%,transparent_19%),linear-gradient(145deg,#7c3f26,#edb969_54%,#2b4654)]',
  green:
    '[background:linear-gradient(135deg,rgba(22,42,37,0.74),rgba(22,42,37,0.1)),radial-gradient(circle_at_72%_25%,#d9efcf_0_16%,transparent_17%),linear-gradient(145deg,#224c43,#9fbf9c_56%,#f3ede0)]',
  rose:
    '[background:linear-gradient(135deg,rgba(60,31,47,0.76),rgba(60,31,47,0.08)),radial-gradient(circle_at_45%_34%,#f6d5d7_0_18%,transparent_19%),linear-gradient(145deg,#84445d,#efb8b8_58%,#fff7ee)]',
  blue:
    '[background:linear-gradient(135deg,rgba(18,30,55,0.8),rgba(18,30,55,0.1)),radial-gradient(circle_at_68%_30%,#7ee1ed_0_14%,transparent_15%),linear-gradient(145deg,#273b73,#7b72c8_52%,#f7a67a)]',
}

watch(apiKey, (value) => writeStorage(STORAGE_KEYS.apiKey, value.trim()))
watch(apiBaseUrl, (value) => writeStorage(STORAGE_KEYS.apiBaseUrl, value.trim()))

function readStorage(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 本阶段只保留设置入口，后续会统一迁移到 IndexedDB。
  }
}

function openSettings() {
  isSettingsOpen.value = true
}

function closeSettings() {
  isSettingsOpen.value = false
}

function selectConversation(id: string) {
  activeConversationId.value = id
}

function createConversation() {
  const id = `c-${Date.now()}`
  conversations.value.unshift({
    id,
    title: '新的图片创作',
    summary: '从一句 prompt 开始',
    updatedAt: '刚刚',
  })
  activeConversationId.value = id
}

function attachImage(id: string) {
  if (!attachedImages.value.includes(id)) {
    attachedImages.value.push(id)
  }
}

function removeAttachment(id: string) {
  attachedImages.value = attachedImages.value.filter((item) => item !== id)
}

function submitMockMessage() {
  if (!canSend.value) return

  const conversationId = activeConversationId.value
  const text = composerText.value.trim() || '基于引用图片继续编辑。'
  const references = [...attachedImages.value]
  const userMessageId = `m-${Date.now()}`
  const assistantMessageId = `m-${Date.now() + 1}`

  messages.value.push({
    id: userMessageId,
    conversationId,
    role: 'user',
    content: text,
    referencedImageIds: references,
    resultImageIds: [],
    status: 'success',
    createdAt: '刚刚',
  })
  messages.value.push({
    id: assistantMessageId,
    conversationId,
    role: 'assistant',
    content: references.length ? '正在基于引用图片生成编辑结果。' : '正在生成图片。',
    referencedImageIds: references,
    resultImageIds: [],
    status: 'pending',
    createdAt: '刚刚',
  })

  updateConversationSummary(conversationId, text)
  composerText.value = ''
  attachedImages.value = []
}

function updateConversationSummary(conversationId: string, text: string) {
  const conversation = conversations.value.find((item) => item.id === conversationId)
  if (!conversation) return

  conversation.title = text.length > 16 ? `${text.slice(0, 16)}...` : text
  conversation.summary = imageModeLabel.value
  conversation.updatedAt = '刚刚'
}

function retryMessage(message: Message) {
  message.status = 'pending'
  message.content = '已重新加入生成队列。'
}

function imageById(id: string) {
  return imageAssets.value.find((image) => image.id === id)
}

function conversationClass(conversation: Conversation) {
  return [
    buttonBase,
    'relative grid w-full gap-1 rounded-lg border p-3 text-left text-[#243247] hover:border-[#cfc7b8] hover:bg-[#fffefa]',
    conversation.id === activeConversationId.value
      ? 'border-[#1a5f7a] bg-[#fffefa] shadow-[inset_3px_0_0_#1a5f7a]'
      : 'border-transparent bg-transparent',
  ]
}

function messageClass(message: Message) {
  return [
    'w-[min(760px,100%)] rounded-lg border p-[15px] shadow-[0_14px_46px_rgba(55,43,28,0.08)] max-[560px]:self-stretch max-[560px]:p-[13px]',
    message.role === 'user'
      ? 'self-end border-[#b7cdd7] bg-[#eef8fb]'
      : 'self-start border-[#ded6c8] bg-[#fffcf6]/90',
    message.status === 'error' ? 'border-[#e4afa8] bg-[#fff7f5]' : '',
  ]
}

function libraryPanelClass() {
  return [
    'flex min-h-screen flex-col gap-4 border-l border-[#ded6c8] bg-[#fffcf6]/90 p-[18px] max-[1180px]:fixed max-[1180px]:inset-y-0 max-[1180px]:right-0 max-[1180px]:z-[12] max-[1180px]:w-[min(360px,92vw)] max-[1180px]:shadow-[-24px_0_70px_rgba(19,29,43,0.18)] max-[1180px]:transition-transform max-[1180px]:duration-[160ms] max-[560px]:p-3.5',
    isLibraryOpen.value ? 'max-[1180px]:translate-x-0' : 'max-[1180px]:translate-x-full',
  ]
}

function imageClass(image?: ImageAsset, variant: ImageVariant = 'thumb') {
  const variants: Record<ImageVariant, string> = {
    thumb: 'h-[38px] w-[38px] rounded-lg',
    library: 'h-[72px] w-[72px] rounded-lg',
    result: 'h-[220px] w-full rounded-none',
  }

  return [
    'block shrink-0 border border-white/70 shadow-[inset_0_0_0_1px_rgba(19,29,43,0.08)]',
    variants[variant],
    toneClasses[image?.tone || 'amber'],
  ]
}
</script>

<template>
  <main
    class="grid min-h-screen min-w-[320px] grid-cols-[280px_minmax(0,1fr)_320px] bg-[#f5f2eb] text-[#172033] antialiased [background:linear-gradient(120deg,rgba(255,255,255,0.74),rgba(255,255,255,0)),#f5f2eb] [font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI','Microsoft_YaHei',sans-serif] [font-synthesis:none] [text-rendering:optimizeLegibility] max-[1180px]:grid-cols-[260px_minmax(0,1fr)] max-[820px]:grid-cols-1"
  >
    <aside
      class="flex min-h-screen flex-col gap-4 border-r border-[#ded6c8] bg-[#fffcf6]/90 p-[18px] max-[820px]:min-h-[auto] max-[820px]:border-r-0 max-[820px]:border-b max-[560px]:p-3.5"
      aria-label="历史会话"
    >
      <div class="flex items-center justify-between gap-3.5">
        <div>
          <span :class="eyebrowClass">GPT Image Studio</span>
          <strong class="block text-lg text-[#172033]">图片工作台</strong>
        </div>
        <button
          :class="`${outlineButton} inline-flex h-9 w-9 shrink-0 items-center justify-center p-0 text-lg`"
          aria-label="打开设置"
          type="button"
          @click="openSettings"
        >
          ⚙
        </button>
      </div>

      <button :class="`${primaryButton} min-h-[42px] px-3.5 py-2.5`" type="button" @click="createConversation">
        新建会话
      </button>

      <nav
        class="grid min-h-0 gap-2 overflow-auto max-[820px]:auto-cols-[minmax(210px,1fr)] max-[820px]:grid-flow-col max-[820px]:overflow-x-auto max-[820px]:overflow-y-hidden"
      >
        <button
          v-for="conversation in conversations"
          :key="conversation.id"
          :class="conversationClass(conversation)"
          type="button"
          @click="selectConversation(conversation.id)"
        >
          <span class="overflow-hidden text-ellipsis whitespace-nowrap font-[850]">{{ conversation.title }}</span>
          <small :class="smallTextClass">{{ conversation.summary }}</small>
          <time class="mt-1 text-[13px] leading-[1.45] text-[#667583]">{{ conversation.updatedAt }}</time>
        </button>
      </nav>
    </aside>

    <section class="grid min-h-screen min-w-0 grid-rows-[auto_1fr_auto] max-[820px]:min-h-[calc(100vh-198px)]" aria-label="聊天工作区">
      <header
        class="flex min-h-[76px] items-center justify-between gap-3.5 border-b border-[#ded6c8] bg-[#fffcf6]/80 px-[22px] py-4 backdrop-blur-2xl max-[820px]:flex-col max-[820px]:items-start max-[560px]:p-3.5"
      >
        <div>
          <span :class="eyebrowClass">{{ imageModeLabel }}</span>
          <h1 class="m-0 text-[22px] leading-[1.2] tracking-normal text-[#16202f]">{{ activeConversation?.title }}</h1>
        </div>
        <div class="flex items-center gap-2.5 max-[820px]:w-full">
          <button
            :class="`${outlineButton} min-h-9 px-3 py-[7px] text-[13px] max-[820px]:flex-1`"
            type="button"
            @click="isLibraryOpen = !isLibraryOpen"
          >
            {{ isLibraryOpen ? '隐藏图片库' : '打开图片库' }}
          </button>
          <button
            :class="`${outlineButton} min-h-9 px-3 py-[7px] text-[13px] max-[560px]:hidden`"
            type="button"
            @click="openSettings"
          >
            设置
          </button>
        </div>
      </header>

      <div class="flex min-h-0 flex-col gap-[18px] overflow-auto p-[22px] max-[560px]:p-3.5">
        <article
          v-for="message in activeMessages"
          :key="message.id"
          :class="messageClass(message)"
        >
          <div class="mb-2 flex items-center justify-between gap-3 text-[13px] text-[#667583]">
            <strong class="text-[#243247]">{{ message.role === 'user' ? '你' : 'GPT Image Studio' }}</strong>
            <span>{{ message.createdAt }}</span>
          </div>

          <p class="m-0 text-[15px] leading-[1.7] text-[#172033]">{{ message.content }}</p>

          <div v-if="message.referencedImageIds.length" class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="imageId in message.referencedImageIds"
              :key="imageId"
              :class="`${buttonBase} inline-flex min-w-0 max-w-full items-center gap-2 border border-[#cec6b8] bg-[#fffefa] px-[9px] py-1.5 text-[#243247] hover:border-[#1a5f7a]`"
              type="button"
              @click="attachImage(imageId)"
            >
              <span :class="imageClass(imageById(imageId))"></span>
              {{ imageById(imageId)?.name }}
            </button>
          </div>

          <div
            v-if="message.status === 'pending'"
            class="mt-3 inline-flex gap-1.5 rounded-full border border-[#ded6c8] bg-[#fffefa] px-[11px] py-[9px]"
          >
            <span class="h-[7px] w-[7px] rounded-full bg-[#1a5f7a] opacity-[0.38]"></span>
            <span class="h-[7px] w-[7px] rounded-full bg-[#1a5f7a] opacity-[0.62]"></span>
            <span class="h-[7px] w-[7px] rounded-full bg-[#1a5f7a] opacity-[0.86]"></span>
          </div>

          <div
            v-if="message.resultImageIds.length"
            class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2 max-[560px]:grid-cols-1"
          >
            <figure
              v-for="imageId in message.resultImageIds"
              :key="imageId"
              class="m-0 overflow-hidden rounded-lg border border-[#ded6c8] bg-[#fffefa]"
            >
              <span :class="imageClass(imageById(imageId), 'result')"></span>
              <figcaption class="grid gap-1 p-[11px]">
                <strong>{{ imageById(imageId)?.name }}</strong>
                <small class="text-[13px] leading-[1.45] text-[#667583]">{{ imageById(imageId)?.prompt }}</small>
              </figcaption>
              <button
                :class="`${buttonBase} mx-[11px] mb-[11px] min-h-9 w-[calc(100%-22px)] border border-[#1a5f7a] bg-[#e7f3f7] text-[#103a4c]`"
                type="button"
                @click="attachImage(imageId)"
              >
                设为引用图
              </button>
            </figure>
          </div>

          <button
            v-if="message.status === 'error'"
            :class="`${buttonBase} mt-3 min-h-[34px] border border-[#1a5f7a] bg-[#e7f3f7] px-3 py-1.5 text-[#103a4c]`"
            type="button"
            @click="retryMessage(message)"
          >
            重试
          </button>
        </article>
      </div>

      <form
        class="grid gap-2.5 border-t border-[#ded6c8] bg-[#fffcf6]/90 px-[22px] pt-4 pb-[18px] backdrop-blur-2xl max-[560px]:p-3.5"
        @submit.prevent="submitMockMessage"
      >
        <div v-if="activeAttachments.length" class="flex flex-wrap gap-2">
          <div
            v-for="image in activeAttachments"
            :key="image.id"
            class="flex max-w-full items-center gap-2 rounded-full border border-[#cec6b8] bg-[#fffefa] px-[7px] py-1.5"
          >
            <span :class="imageClass(image)"></span>
            <strong class="max-w-[210px] overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[#243247]">
              {{ image.name }}
            </strong>
            <button
              :class="`${buttonBase} h-6 w-6 border-0 bg-[#f4efe5] text-[#667583]`"
              type="button"
              @click="removeAttachment(image.id)"
            >
              ×
            </button>
          </div>
        </div>

        <label class="sr-only" for="composerText">输入图片需求</label>
        <textarea
          id="composerText"
          v-model="composerText"
          :class="`min-h-[76px] max-h-[180px] w-full resize-y rounded-lg border border-[#cec6b8] bg-[#fffefa] px-3.5 py-[13px] text-[#172033] ${controlFocus}`"
          placeholder="描述你想生成的图片，或先从右侧图片库选择参考图再描述如何修改..."
          rows="2"
        />

        <div class="flex items-center justify-between gap-3 max-[820px]:w-full max-[560px]:flex-col max-[560px]:items-stretch">
          <div class="flex flex-wrap gap-2">
            <span class="rounded-full border border-[#ded6c8] bg-[#fbf6ec] px-[9px] py-1.5 text-xs font-extrabold text-[#667583]">{{ model }}</span>
            <span class="rounded-full border border-[#ded6c8] bg-[#fbf6ec] px-[9px] py-1.5 text-xs font-extrabold text-[#667583]">{{ size }}</span>
            <span class="rounded-full border border-[#ded6c8] bg-[#fbf6ec] px-[9px] py-1.5 text-xs font-extrabold text-[#667583]">{{ quality }}</span>
            <span class="rounded-full border border-[#ded6c8] bg-[#fbf6ec] px-[9px] py-1.5 text-xs font-extrabold text-[#667583]">{{ outputFormat }}</span>
          </div>
          <button
            :class="`${primaryButton} min-h-10 min-w-[82px] shrink-0 px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50 max-[820px]:flex-1`"
            :disabled="!canSend"
            type="submit"
          >
            发送
          </button>
        </div>
      </form>
    </section>

    <aside :class="libraryPanelClass()" aria-label="图片库">
      <div class="flex items-center justify-between gap-3.5">
        <div>
          <span :class="eyebrowClass">本地图片库</span>
          <strong class="block text-lg text-[#172033]">{{ imageAssets.length }} 张图片</strong>
        </div>
        <button
          :class="`${outlineButton} hidden min-h-9 px-3 py-[7px] text-[13px] max-[1180px]:inline-flex`"
          type="button"
          @click="isLibraryOpen = false"
        >
          收起
        </button>
      </div>

      <div class="grid min-h-0 gap-2.5 overflow-auto">
        <article
          v-for="image in imageAssets"
          :key="image.id"
          class="grid grid-cols-[72px_minmax(0,1fr)] gap-2.5 rounded-lg border border-[#ded6c8] bg-[#fffefa] p-[9px]"
        >
          <span :class="imageClass(image, 'library')"></span>
          <div class="grid min-w-0 content-center gap-1">
            <strong class="overflow-hidden text-ellipsis whitespace-nowrap">{{ image.name }}</strong>
            <small :class="smallTextClass">{{ image.source === 'generated' ? '生成图' : '参考图' }} · {{ image.createdAt }}</small>
          </div>
          <button
            :class="`${buttonBase} col-span-full min-h-[34px] border border-[#1a5f7a] bg-[#e7f3f7] text-[#103a4c]`"
            type="button"
            @click="attachImage(image.id)"
          >
            引用
          </button>
        </article>
      </div>
    </aside>

    <div
      v-if="isSettingsOpen"
      class="fixed inset-0 z-20 grid place-items-center bg-[#172033]/40 p-5"
      role="presentation"
      @click.self="closeSettings"
    >
      <section
        aria-labelledby="settingsTitle"
        aria-modal="true"
        class="max-h-[calc(100vh-40px)] w-[min(560px,100%)] overflow-auto rounded-lg border border-[#d8d1c2] bg-[#fffefa] p-[22px] shadow-[0_28px_90px_rgba(19,29,43,0.32)]"
        role="dialog"
      >
        <div class="mb-[18px] flex items-start justify-between gap-4">
          <div>
            <h2 id="settingsTitle" class="m-0 mb-[5px] text-[22px] leading-[1.2] tracking-normal text-[#172033]">接口设置</h2>
            <p class="text-[13px] leading-[1.45] text-[#667583]">当前仍使用浏览器本地配置，后续会迁移到 IndexedDB 设置表。</p>
          </div>
          <button
            :class="`${outlineButton} inline-flex h-9 w-9 shrink-0 items-center justify-center p-0 text-lg`"
            aria-label="关闭设置"
            type="button"
            @click="closeSettings"
          >
            ×
          </button>
        </div>

        <div class="mb-[18px] rounded-lg border border-[#ead6aa] bg-[#fff7df] p-3 text-[13px] leading-[1.45] text-[#6b552b]">
          API key 会保存在当前浏览器本地环境。共享电脑或公共环境中请谨慎使用。
        </div>

        <div class="mb-[15px]">
          <label :class="labelClass" for="apiKey">OpenAI API key</label>
          <input
            id="apiKey"
            v-model="apiKey"
            :class="fieldControlClass"
            autocomplete="off"
            placeholder="sk-..."
            type="password"
          />
        </div>

        <div class="mb-[15px]">
          <label :class="labelClass" for="apiBaseUrl">API Base URL</label>
          <input id="apiBaseUrl" v-model="apiBaseUrl" :class="fieldControlClass" type="url" />
        </div>

        <div class="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
          <div class="mb-[15px]">
            <label :class="labelClass" for="model">模型</label>
            <input id="model" v-model="model" :class="fieldControlClass" list="models" />
            <datalist id="models">
              <option value="gpt-image-2" />
              <option value="gpt-image-1.5" />
              <option value="gpt-image-1" />
              <option value="gpt-image-1-mini" />
            </datalist>
          </div>

          <div class="mb-[15px]">
            <label :class="labelClass" for="size">尺寸</label>
            <select id="size" v-model="size" :class="fieldControlClass">
              <option value="auto">auto</option>
              <option value="1024x1024">1024x1024</option>
              <option value="1536x1024">1536x1024</option>
              <option value="1024x1536">1024x1536</option>
            </select>
          </div>

          <div class="mb-[15px]">
            <label :class="labelClass" for="quality">质量</label>
            <select id="quality" v-model="quality" :class="fieldControlClass">
              <option value="auto">auto</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </div>

          <div class="mb-[15px]">
            <label :class="labelClass" for="background">背景</label>
            <select id="background" v-model="background" :class="fieldControlClass">
              <option value="auto">auto</option>
              <option value="opaque">opaque</option>
              <option value="transparent">transparent</option>
            </select>
          </div>

          <div class="mb-[15px]">
            <label :class="labelClass" for="outputFormat">格式</label>
            <select id="outputFormat" v-model="outputFormat" :class="fieldControlClass">
              <option value="png">png</option>
              <option value="webp">webp</option>
              <option value="jpeg">jpeg</option>
            </select>
          </div>
        </div>

        <div class="mt-2 flex justify-end">
          <button :class="`${primaryButton} inline-flex min-h-11 w-28 items-center justify-center`" type="button" @click="closeSettings">
            完成
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
