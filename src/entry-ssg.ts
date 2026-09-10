import { createSSRApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import App from './App.vue'
import { trackDirective } from './directives/track'

/**
 * vite-ssg 构建期渲染入口（只在 `vite-ssg build` 的 SSR 阶段被 import，不进浏览器）。
 *
 * 构建流程（见 vite.config.ts 的 ssgOptions.entry）：
 * 1. 客户端构建照常以 index.html → src/main.ts 为入口（含 qiankun 嵌入态逻辑）；
 * 2. 本文件再被构建为 SSR bundle，vite-ssg 在 Node 中 import 它、调用导出的
 *    createApp() 拿到 app 实例，renderToString 后把首屏 HTML 注入 dist/index.html
 *    的 #app 容器。因此本入口与 main.ts 完全解耦——main.ts 顶层的 window 访问
 *    （qiankun 检测）不会在 Node 里执行。
 *
 * 与 main.ts render() 的约定保持一致：pinia 用 app.use + setActivePinia 双注册，
 * store 内不传参的 useXxxStore() 依赖活跃实例。
 *
 * 渲染语义：store 的 localStorage 镜像读取在 Node 下全部走 try/catch 回退默认值
 * （connectionMode=direct、无凭据），IndexedDB 水合在 onMounted、SSR 阶段不执行，
 * 所以产物是「空工作台首屏」（默认参数栏 + 空会话引导态）——这正是给爬虫看的
 * 静态内容；真实用户浏览器里由 main.ts 的 hydration 挂载接管（见其 render 注释）。
 *
 * vite-ssg 对无路由单页的约定：createApp 返回值不带 routes 时只渲染 `/` 一个页面。
 */
export async function createApp() {
  const app = createSSRApp(App)
  const pinia = createPinia()
  app.use(pinia)
  setActivePinia(pinia)
  app.directive('track', trackDirective)
  return { app }
}
