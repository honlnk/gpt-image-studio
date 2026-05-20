import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 8888,
  },
  resolve: {
    alias: {
      '@gpt-image-studio/protocol': path.resolve(__dirname, 'packages/protocol/src/index.ts'),
    },
  },
  plugins: [
    vue(),
    mode === 'development' && vueDevTools(),
    tailwindcss(),
  ].filter(Boolean),
}))
