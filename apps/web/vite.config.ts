import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        download: resolve(__dirname, 'download.html'),
      },
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    // Cross-Origin Isolation 헤더 설정 (LiteRT-LM WebGPU 고성능 모드 활성화)
    {
      name: 'configure-cross-origin-isolation',
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          next();
        });
      },
    },
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  // 빌드 시 프리뷰 서버에도 동일 헤더 적용
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
})
