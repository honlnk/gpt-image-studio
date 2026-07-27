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
 */

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
