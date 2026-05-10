import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Use relative base so the same build works on GitHub Pages project sites
// (https://user.github.io/repo/) and other static hosts without path config.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '时间化战争迷雾',
        short_name: '时间迷雾',
        description: '回合制指挥演示：时间化战争迷雾与情报延迟。',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'standalone',
        start_url: './',
      },
    }),
  ],
});
