import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { defineConfig, type Plugin, type Rollup } from 'vite'
import { copyFileSync, existsSync } from 'node:fs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
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
