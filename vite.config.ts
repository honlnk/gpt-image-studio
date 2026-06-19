import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
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
  ].filter(Boolean),
}))
