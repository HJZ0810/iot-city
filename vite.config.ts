import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // 生产部署基路径：默认 '/'（本地开发/根路径部署），VITE_BASE=/legacy/ 用于 iot.luo-jin-ai.com/legacy/ 子路径部署
  base: process.env.VITE_BASE ?? '/',
  publicDir: 'apps/web/public',
  server: { host: '0.0.0.0', port: 5173, proxy: { '/api': 'http://127.0.0.1:3220', '/ws': { target: 'ws://127.0.0.1:3220', ws: true } } },
  build: { outDir: 'dist/web', emptyOutDir: false }
});
