import { createApp, type App as VueApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
// 嵌入态 CSS 注入用：build 时替换成真实 CSS 文件 URL（带 hash）。
// qiankun 嵌入态下 import './style.css' 的副作用注入会被 import-html-entry 破坏，
// 需要用这个 URL 手动创建 <link> 注入真实 document.head（见 injectEmbeddedCss）。
import styleCssUrl from './style.css?url'
import App from './App.vue'
import { trackDirective } from './directives/track'
import { useSettingsStore } from './stores/settingsStore'

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

let app: VueApp | null = null

interface QiankunProps {
  /** 宿主提供的 Companion 服务地址（嵌入态必填）。 */
  companionUrl?: string
  /** 宿主签发的 JWT（作为 Bearer token）。 */
  jwt?: string
  /** qiankun 传入的挂载容器（实际是 ShadowRoot/HTMLElement 的容器选择器或元素）。 */
  container?: HTMLElement | string
}

function render(props: QiankunProps = {}) {
  app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.directive('track', trackDirective)

  // 嵌入态：挂载前注入宿主配置（必须在 useStudioViewModel 装配前，
  // 因为 resolveStorage 在 ViewModel setup 时读一次 connectionMode.value）。
  if (window.__POWERED_BY_QIANKUN__ && props.companionUrl && props.jwt) {
    const settings = useSettingsStore(pinia)
    settings.applyEmbeddedConfig({
      companionUrl: props.companionUrl,
      jwt: props.jwt,
    })
  }

  // 嵌入态：注入子应用 CSS。qiankun 的 import-html-entry 会移除子应用 HTML 的
  // <link rel=stylesheet>，沙箱配置下样式丢失，这里手动注入（见 injectEmbeddedCss）。
  if (window.__POWERED_BY_QIANKUN__ && props.container) {
    injectEmbeddedCss(props.container)
  }

  const mountTarget = props.container ?? '#app'
  app.mount(mountTarget)
}

/**
 * 嵌入态 CSS 注入：把子应用 CSS 以 <link> 注入宿主真实 document.head。
 *
 * 两个难点及解法：
 * 1. qiankun 的 JS 沙箱 patch 了 document.head.appendChild 等 DOM API，子应用动态插入的
 *    link/style 会被转移到沙箱容器（卸载即丢失）。
 *    解法：通过 props.container.ownerDocument 拿宿主真实 document 再注入。
 * 2. styleCssUrl 是相对于子应用源的绝对路径（/assets/xxx.css），在宿主页面里会按
 *    document.baseURI（宿主 origin）解析 → 404。相对/绝对路径的 URL 解析由浏览器按
 *    真实文档 baseURI 完成，qiankun 沙箱不会重写。
 *    解法：用 qiankun 执行子应用 entry 前注入的 window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__
 *    （= 宿主 registerMicroApps 的 entry 地址）拼出子应用源的完整 URL。
 *
 * CSS URL 由 Vite build 时 `import styleCssUrl from './style.css?url'` 内联进 JS（带 hash）。
 * 幂等：用 data-app-css 属性标记，避免重复注入。
 */
function injectEmbeddedCss(container: HTMLElement | string) {
  const containerEl =
    typeof container === 'string'
      ? document.querySelector<HTMLElement>(container)
      : container
  if (!containerEl) return
  const realDoc = containerEl.ownerDocument
  const realHead = realDoc.head
  // 幂等：用 data-app-css 标记，避免重复注入
  if (realHead.querySelector('link[data-app-css]')) return
  const publicPath = (
    window as unknown as Record<string, unknown>
  ).__INJECTED_PUBLIC_PATH_BY_QIANKUN__ as string | undefined
  const href = publicPath ? new URL(styleCssUrl, publicPath).href : styleCssUrl
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
  if (app) {
    app.unmount()
    app = null
  }
}

// 嵌入态：把生命周期挂到 window 全局，让 qiankun import-entry 在 prod 构建产物里
// 也能发现（Vite 应用入口的 IIFE 产物会剥离顶层 export，但保留 window 副作用赋值）。
// 独立态不需要，仅在 __POWERED_BY_QIANKUN__ 时挂载，避免污染全局命名空间。
if (window.__POWERED_BY_QIANKUN__) {
  const lifecycle = { bootstrap, mount, unmount }
  ;(window as unknown as Record<string, unknown>)[QIANKUN_APP_NAME] = lifecycle
}
