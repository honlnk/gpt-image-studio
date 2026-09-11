import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { defineConfig, type Plugin, type Rollup, type UserConfig } from 'vite'
import type { ViteSSGOptions } from 'vite-ssg'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { renderDownloadTemplate } from './src/pages/download/ssgTemplate'

// vite 的 UserConfig 没有声明 vite-ssg 的 ssgOptions 字段（vite-ssg 未做模块增强），
// 用交叉类型补上，保持 defineConfig 的类型检查。
type UserConfigWithSSG = UserConfig & { ssgOptions?: Partial<ViteSSGOptions> }

// https://vite.dev/config/
export default defineConfig(({ mode }): UserConfigWithSSG => ({
  // 用 '/' 而非 './'：/companion 独立页面需要绝对资源路径，否则 /companion 下
  // ./assets/... 会解析成 /companion/assets/... 导致 404。
  // 自定义域名 image.honlnk.com 在根路径，不再需要相对 base 兼容 GH Pages repo 子路径。
  base: '/',
  // Tauri runs its own dev server watcher and reloads the webview; letting Vite
  // clear the terminal would wipe Tauri's Rust logs on every HMR.
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 8888,
    // Tauri's devUrl points at this exact port; strictPort prevents Vite from
    // silently moving to 8889+ if 8888 is briefly busy, which would make the
    // desktop webview load a stale/empty page.
    strictPort: true,
  },
  // vite-ssg 构建期预渲染（SEO 方案 B，见 docs/guides/seo-strategy.md §3.4）：
  // `pnpm build`（vite-ssg build）先照常做客户端构建（入口 index.html → main.ts，
  // 产物与 vite build 一致），再以 entry-ssg.ts 为 SSR 入口在 Node 里 renderToString，
  // 把首屏 HTML 注入 dist/index.html 的 #app。SSR 入口与浏览器入口解耦，
  // qiankun 嵌入态逻辑不进 Node。onFinished 清理 ssrManifest 等中间产物。
  //
  // 多路由（无 vue-router）：includedRoutes 声明要预渲染的路径列表，vite-ssg
  // 对每个路径调一次 entry-ssg.ts 的 createApp(route)，按嵌套目录产出
  // dist/<route>/index.html。/download 是下载营销页（docs/plans/download-page-plan.md），
  // 其模板在 onBeforePageRender 里改写 title/canonical/OG/JSON-LD 并剔除 splash——
  // 否则所有路由都会带首页的 SEO 元信息。
  ssgOptions: {
    entry: 'src/entry-ssg.ts',
    includedRoutes: () => ['/', '/download'],
    // nested：产出 dist/download/index.html，GitHub Pages 对 /download 和 /download/
    // 都能直接服务（flat 的 download.html 只覆盖前者，带尾斜杠会落进 404 fallback）。
    dirStyle: 'nested',
    onBeforePageRender(route, indexHTML) {
      return route === '/download' ? renderDownloadTemplate(indexHTML) : indexHTML
    },
    onFinished() {
      rmSync('dist/.vite', { recursive: true, force: true })
      rmSync('dist/ssr-manifest.json', { force: true })
    },
  },
  plugins: [
    vue(),
    mode === 'development' && vueDevTools(),
    tailwindcss(),
    // qiankun 嵌入态 CSS 注入（见 src/main.ts injectEmbeddedCss）需要运行期拿到
    // bundle CSS 的 URL，但产物文件名带 hash 构建前无法预知。这里在 generateBundle
    // 阶段把 entry chunk 里的 __EMBEDDED_CSS_FILE__ 占位符替换成真实 CSS 文件名。
    {
      name: 'embedded-css-url',
      generateBundle(_, bundle) {
        const cssAsset = Object.values(bundle).find(
          (a): a is Rollup.OutputAsset =>
            a.type === 'asset' && a.fileName.endsWith('.css'),
        )
        if (!cssAsset) return
        for (const chunk of Object.values(bundle)) {
          if (
            chunk.type === 'chunk' &&
            chunk.code.includes('__EMBEDDED_CSS_FILE__')
          ) {
            chunk.code = (chunk as Rollup.OutputChunk).code.replaceAll(
              '__EMBEDDED_CSS_FILE__',
              cssAsset.fileName,
            )
          }
        }
      },
    } satisfies Plugin,
    // GitHub Pages SPA fallback：直接访问/刷新 /companion 时 GH Pages 返回 404.html。
    // 构建后把 index.html 复制一份成 404.html（GH Pages 对未知路径返回它，状态码 200），
    // SPA 得以加载后由 App.vue 顶层路由分发接管。
    {
      name: 'spa-404-fallback',
      closeBundle() {
        const index = 'dist/index.html'
        const notFound = 'dist/404.html'
        if (existsSync(index)) {
          copyFileSync(index, notFound)
        }
      },
    },
  ].filter(Boolean),
}))
