import { createApp, type App as VueApp } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import './style.css'
import App from './App.vue'

// 嵌入态 CSS 注入用：占位符在 build 时被 vite 插件替换成 bundle CSS 产物文件名
// （assets/index-xxxx.css，见 vite.config.ts 的 embedded-css-url 插件）。
// 背景：qiankun 会把 entry HTML 的 <link rel=stylesheet> 内联成 <style> 塞进挂载容器，
// 但 Vue mount 会清空容器 innerHTML，内联样式随之被销毁——所以嵌入态必须在运行期
// 手动注入完整 bundle CSS（见 injectEmbeddedCss）。
const EMBEDDED_CSS_FILE = '__EMBEDDED_CSS_FILE__'
import { trackDirective } from './directives/track'
import { useSettingsStore } from './stores/settingsStore'
import { configureEmbedding, listenHostMessages } from './services/embeddedBridge'

/**
 * 前端入口（阶段三 PR5：qiankun 嵌入兼容）。
 *
 * 两种运行形态共用同一份构建产物：
 * - 独立态（默认）：直接 createApp + mount('#app')，行为同阶段二。
 * - 嵌入态（qiankun 子应用）：导出 bootstrap/mount/unmount 生命周期，
 *   宿主通过 mount(props) 注入 companionUrl + jwt，settingsStore 据此切换到
 *   localCompanion 模式 + Bearer JWT 认证。
 *
 * 检测标志：window.__POWERED_BY_QIANKUN__（qiankun 在子应用 entry 执行前注入）。
 *
 * 生命周期发现机制（重要）：
 * Vite 默认按「应用入口」打包，产出 IIFE 脚本——顶层 `export` 语句会被打包器
 * 视为无外部消费者而剥离，因此 qiankun 的 import-entry 无法从产物里拿到
 * bootstrap/mount/unmount。qiankun 对「非 webpack/非 UMD」子应用的官方约定是
 * 把生命周期挂到 window 全局（global[name]）。本文件在嵌入态下同时：
 *   1. 用 `export` 导出（dev 态 ESM 可见，便于本地调试与单元测试）；
 *   2. 赋值到 `window[QIANKUN_APP_NAME]`（prod 构建后 import-entry 据此发现）。
 * 宿主 registerMicroApps 的 name 必须与下方 QIANKUN_APP_NAME 一致。
 */

/** qiankun 注册子应用时使用的 name，必须与宿主 registerMicroApps({ name }) 一致。 */
const QIANKUN_APP_NAME = 'gpt-image-studio'

/**
 * 嵌入态标记 class，挂在 <html> 上。用于：
 * - style.css 的嵌入态高度链（html.__embedded__ body { height:100% }）
 * - StudioShell 的 h-full（嵌入态）/ h-screen（独立态）切换
 * 见 docs/evolution/phase3-pr7-embed-experience.md §2.4。
 */
const EMBEDDED_HTML_CLASS = '__embedded__'

let app: VueApp | null = null
// pinia 模块级共享：render 创建、unmount 置空。setActivePinia 保证 ViewModel 内
// 不传参的 useXxxStore() 与此处是同一实例（否则 main.ts 写入的 isEmbedded 等
// 嵌入态配置 ViewModel 读不到）。
let piniaInstance: Pinia | null = null
// 宿主消息监听卸载函数，unmount 时按顺序清理（见下方 unmount 的清理顺序注释）。
let unlistenHostMessages: (() => void) | null = null

interface QiankunProps {
  /** 宿主提供的 Companion 服务地址（嵌入态必填）。 */
  companionUrl?: string
  /** 宿主签发的 JWT（作为 Bearer token）。 */
  jwt?: string
  /** qiankun 传入的挂载容器（实际是 ShadowRoot/HTMLElement 的容器选择器或元素）。 */
  container?: HTMLElement | string
  /**
   * 嵌入态是否隐藏子应用自带侧边栏（默认 true）。
   * 嵌入态下会话管理应由宿主提供，子应用侧边栏不再显示。见文档 §2.5。
   */
  hideSidebar?: boolean
  /**
   * 宿主允许的跨域 origin 白名单（跨域嵌入时必填）。
   *
   * 默认未配置时，postMessage 通信桥仅允许同源（PR7/PR8 demo 的行为）。
   * 宿主跨域嵌入（子应用与宿主不同源，例如子应用部署在 studio.example.com、
   * 宿主在 admin.example.com）时，需把宿主 origin 传入，否则双向 postMessage
   * 会被 origin 校验拒绝。
   *
   * 示例：`allowedOrigins: ['https://admin.example.com']`
   */
  allowedOrigins?: string[]
}

function render(props: QiankunProps = {}) {
  // 独立态生产构建：dist/index.html 含构建期预渲染的首屏 HTML（vite-ssg，
  // 见 src/entry-ssg.ts）。这里始终用普通 createApp（不用 createSSRApp 的
  // hydration），因为 IndexedDB 是异步的，首次渲染时数据还没恢复，hydration
  // 必然 mismatch，Vue 会清空 DOM 并重建，导致白屏。预渲染内容仅用于
  // SEO（爬虫看到完整 HTML），浏览器里由客户端渲染接管。
  const prerendered =
    !window.__POWERED_BY_QIANKUN__ &&
    !!document.querySelector('#app')?.firstElementChild
  app = createApp(App)
  piniaInstance = createPinia()
  // 显式设为活跃 pinia：ViewModel 内 useSettingsStore()/useConversationsStore() 不传
  // pinia 参数时走活跃实例，必须与此处一致，否则 main.ts 写入的 isEmbedded 等配置
  // ViewModel 读不到（拿到不同的 store 实例）。
  setActivePinia(piniaInstance)
  app.use(piniaInstance)
  app.directive('track', trackDirective)

  // 嵌入态：挂载前注入宿主配置（必须在 useStudioViewModel 装配前，
  // 因为 resolveStorage 在 ViewModel setup 时读一次 connectionMode.value）。
  //
  // 进入嵌入态只看 __POWERED_BY_QIANKUN__，不绑定凭据是否齐全——凭据缺失只影响
  // 连接（生成会失败），不应阻断 isEmbedded/hideSidebar/高度修复等所有嵌入态行为。
  // 此前的 && props.companionUrl && props.jwt 条件会导致凭据未配时整个嵌入态失效。
  if (window.__POWERED_BY_QIANKUN__) {
    const settings = useSettingsStore(piniaInstance)
    settings.applyEmbeddedConfig({
      companionUrl: props.companionUrl ?? '',
      jwt: props.jwt ?? '',
      hideSidebar: props.hideSidebar,
    })
    // 跨域白名单：宿主通过 props.allowedOrigins 注入，供 postMessage 通信桥做 origin 校验。
    // 未配置时仅允许同源（向后兼容 PR7/PR8 demo 的同源场景）。
    configureEmbedding({ allowedOrigins: props.allowedOrigins })
    // __embedded__ class：触发 style.css 嵌入态高度链 + StudioShell h-full。
    document.documentElement.classList.add(EMBEDDED_HTML_CLASS)
  }

  // 嵌入态：注入子应用 CSS。qiankun 会把 entry HTML 的 <link rel=stylesheet> 内联成
  // <style> 塞进挂载容器，但下方 app.mount 会清空容器 innerHTML 把它销毁，
  // 这里手动注入（见 injectEmbeddedCss）。
  if (window.__POWERED_BY_QIANKUN__ && props.container) {
    injectEmbeddedCss(props.container)
  }

  const mountTarget = props.container ?? '#app'
  // 预渲染首屏的入场动画：挂载前把 #app 置于「透明 + 轻微下沉 + 微模糊」，
  // 挂载重建 DOM 后上浮淡入，掩盖重建瞬间。作用在 #app 而非 documentElement——
  // 页面背景不动，只有内容入场。
  // 动画结束必须清理内联样式：transform/filter 会为 position:fixed 后代
  // （移动端侧边栏）创建新的包含块。prefers-reduced-motion 用户跳过动画。
  const appEl = prerendered ? document.querySelector<HTMLElement>('#app') : null
  const animateEntrance =
    appEl !== null &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (animateEntrance && appEl) {
    appEl.style.cssText = 'opacity:0;transform:translateY(10px);filter:blur(4px)'
  }
  app.mount(mountTarget, false)
  if (animateEntrance && appEl) {
    appEl.style.transition =
      'opacity .5s cubic-bezier(.22,1,.36,1), transform .5s cubic-bezier(.22,1,.36,1), filter .5s cubic-bezier(.22,1,.36,1)'
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        appEl.style.opacity = '1'
        appEl.style.transform = 'translateY(0)'
        appEl.style.filter = 'blur(0)'
      })
    })
    const cleanup = () => {
      appEl.style.cssText = ''
    }
    appEl.addEventListener('transitionend', cleanup, { once: true })
    // 兜底：后台标签页里 transitionend 可能不触发
    setTimeout(cleanup, 900)
  }

  // 嵌入态：注册宿主消息监听（postMessage 通道，见 embeddedBridge.ts）。
  // 必须在 mount 之后——监听器触发的切换依赖 conversationSwitcher，而它由
  // ViewModel 在 onMounted 时注入。unmount 时按清理顺序先于 app.unmount 卸载。
  if (window.__POWERED_BY_QIANKUN__) {
    unlistenHostMessages = listenHostMessages()
  }
}

/**
 * 嵌入态 CSS 注入：把子应用完整 bundle CSS 以 <link> 注入宿主真实 document.head。
 *
 * 为什么需要它：qiankun 的 import-html-entry 会把 entry HTML 的 <link rel=stylesheet>
 * 抓取后内联成 <style> 放在挂载容器（wrapper）里，但 Vue app.mount(container) 会先
 * 清空容器 innerHTML，内联样式在挂载瞬间被销毁（scoped 样式随之全部丢失）。
 * 因此嵌入态改由运行期手动注入。
 *
 * 三个难点及解法：
 * 1. qiankun 的 JS 沙箱 patch 了 document.head.appendChild 等 DOM API，子应用动态插入的
 *    link/style 会被转移到沙箱容器（卸载即丢失）。
 *    解法：通过 props.container.ownerDocument 拿宿主真实 document 再注入。
 * 2. bundle CSS 产物文件名带 hash（assets/index-xxxx.css），构建前无法预知。
 *    解法：EMBEDDED_CSS_FILE 占位符由 vite.config.ts 的 embedded-css-url 插件在
 *    generateBundle 阶段替换成真实文件名。
 * 3. 产物路径相对于子应用源，在宿主页面里按 document.baseURI（宿主 origin）解析 → 404。
 *    解法：用 qiankun 执行子应用 entry 前注入的 window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__
 *    （= 宿主 registerMicroApps 的 entry 地址）拼出子应用源的完整 URL。
 *
 * 幂等：用 data-app-css 属性标记，避免重复注入。
 */
function injectEmbeddedCss(container: HTMLElement | string) {
  const containerEl =
    typeof container === 'string'
      ? document.querySelector<HTMLElement>(container)
      : container
  if (!containerEl) return
  // dev 态占位符未被替换（vite 插件只在 build 时生效），跳过注入
  if (EMBEDDED_CSS_FILE.startsWith('__')) return
  const realDoc = containerEl.ownerDocument
  const realHead = realDoc.head
  // 幂等：用 data-app-css 标记，避免重复注入
  if (realHead.querySelector('link[data-app-css]')) return
  const publicPath = (
    window as unknown as Record<string, unknown>
  ).__INJECTED_PUBLIC_PATH_BY_QIANKUN__ as string | undefined
  const href = publicPath
    ? new URL(EMBEDDED_CSS_FILE, publicPath).href
    : EMBEDDED_CSS_FILE
  const link = realDoc.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.setAttribute('data-app-css', href)
  realHead.appendChild(link)
}

// ─── 独立态：直接渲染 ───
if (!window.__POWERED_BY_QIANKUN__) {
  render({})
}

// ─── 嵌入态：导出 qiankun 生命周期 ───

export async function bootstrap(): Promise<void> {
  // qiankun 要求导出 bootstrap（可为空实现）。子应用初始化逻辑放 mount 里，
  // 因为 props（companionUrl/jwt）在 mount 时才拿到。
}

export async function mount(props: QiankunProps): Promise<void> {
  render(props)
}

export async function unmount(): Promise<void> {
  // 清理顺序（文档 §3.5）：qiankun 沙箱不会自动清理真实 window 上的监听器——
  // demo 的"重新挂载"是 location.reload() 掩盖了这一点，真实宿主用 loadMicroApp
  // 反复挂载时漏一步就叠加监听。顺序固定：
  //   1. 先卸 host message 监听（避免卸载过程中收到消息触发已失效的 switcher）
  //   2. app.unmount（触发 ViewModel onUnmounted：移除 popstate、setConversationSwitcher(null)）
  //   3. 移除 __embedded__ class
  //   4. pinia 置 null
  unlistenHostMessages?.()
  unlistenHostMessages = null
  if (app) {
    app.unmount()
    app = null
  }
  document.documentElement.classList.remove(EMBEDDED_HTML_CLASS)
  piniaInstance = null
}

// 嵌入态：把生命周期挂到 window 全局，让 qiankun import-entry 在 prod 构建产物里
// 也能发现（Vite 应用入口的 IIFE 产物会剥离顶层 export，但保留 window 副作用赋值）。
// 独立态不需要，仅在 __POWERED_BY_QIANKUN__ 时挂载，避免污染全局命名空间。
if (window.__POWERED_BY_QIANKUN__) {
  const lifecycle = { bootstrap, mount, unmount }
  ;(window as unknown as Record<string, unknown>)[QIANKUN_APP_NAME] = lifecycle
}
