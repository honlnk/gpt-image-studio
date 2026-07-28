import { createApp, type App as VueApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
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

  const mountTarget = props.container ?? '#app'
  app.mount(mountTarget)
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
