import { createSSRApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import App from './App.vue'
import DownloadPage from './pages/download/DownloadPage.vue'
import { trackDirective } from './directives/track'
import { i18n, setAppLocale } from './i18n'

/**
 * vite-ssg 构建期渲染入口（只在 `vite-ssg build` 的 SSR 阶段被 import，不进浏览器）。
 *
 * 构建流程（见 vite.config.ts 的 ssgOptions.entry）：
 * 1. 客户端构建照常以 index.html → src/main.ts 为入口（含 qiankun 嵌入态逻辑）；
 * 2. 本文件再被构建为 SSR bundle，vite-ssg 在 Node 中 import 它、对每个
 *    includedRoutes 路径调用 createApp(route) 拿到 app 实例，renderToString 后
 *    把首屏 HTML 注入 dist/<route>/index.html 的 #app 容器。因此本入口与 main.ts
 *    完全解耦——main.ts 顶层的 window 访问（qiankun 检测）不会在 Node 里执行。
 *
 * 路由分发（无 vue-router）：
 * - '/'            → 工作室 App（pinia + track 指令）；
 * - '/download'    → 下载页·中文（纯静态营销页，不挂 pinia——不需要 IndexedDB/store
 *   水合；运行时「最新版本」解析只发生在浏览器 onMounted，SSG 产物用
 *   FALLBACK_RELEASE 渲染，保证爬虫可见有效下载链接）；
 * - '/en/download' → 下载页·英文（同一组件，SSG/挂载时按路由切 i18n locale）。
 *
 * 与 main.ts render() 的约定保持一致：pinia 用 app.use + setActivePinia 双注册，
 * store 内不传参的 useXxxStore() 依赖活跃实例。
 *
 * 渲染语义：store 的 localStorage 镜像读取在 Node 下全部走 try/catch 回退默认值
 * （connectionMode=direct、无凭据），IndexedDB 水合在 onMounted、SSR 阶段不执行，
 * 所以产物是「空工作台首屏」（默认参数栏 + 空会话引导态）——这正是给爬虫看的
 * 静态内容；真实用户浏览器里由 main.ts 的 hydration 挂载接管（见其 render 注释）。
 */
export async function createApp(route?: string) {
  if (route === '/download' || route === '/en/download') {
    // 下载营销页按路由固定语言（无 pinia；文案走 i18n 词库 download.* 域）。
    // 路由 → locale 是刻意的：SSG 产物语言由 URL 决定，不跟随运行时检测。
    const app = createSSRApp(DownloadPage)
    app.use(i18n)
    setAppLocale(route === '/download' ? 'zh-CN' : 'en-US')
    return { app }
  }
  const app = createSSRApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(i18n)
  // Node 侧无 navigator，i18n 默认解析为 en-US——工作室页是中文 SEO 基线，
  // SSG 显式回 zh-CN（浏览器里由 main.ts 按用户语言接管）。
  setAppLocale('zh-CN')
  setActivePinia(pinia)
  app.directive('track', trackDirective)
  return { app }
}
