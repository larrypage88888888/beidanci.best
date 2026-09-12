import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/** 开发时 /api 代理到本地 wrangler dev（apps/server），生产由 Workers 同域托管 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '词流 WordFlow',
        short_name: '词流',
        description: '按水平动态选词、双调度模式的趣味背单词应用',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8fafc',
        theme_color: '#2563eb',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // API 一律走网络（后端权威）；离线兜底仅限页面壳与静态资源
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // 本地 wrangler dev 固定跑在 8799（8787 常被其他 Worker 项目占用）
      '/api': 'http://127.0.0.1:8799',
      '/ws': { target: 'ws://127.0.0.1:8799', ws: true },
    },
  },
});
