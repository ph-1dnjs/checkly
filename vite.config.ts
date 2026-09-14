import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { apiWebDev } from './src/app/api-testing/main/web-dev'

export default defineConfig(({ mode }) => ({
  // Electron의 file:// 로드에서도 번들을 찾도록 상대 자산 경로를 사용한다.
  base: './',
  plugins: [react(), ...(mode === 'api-web' ? [apiWebDev()] : [])],
  server: mode === 'api-web' ? { host: '127.0.0.1', port: 5174, strictPort: true, cors: false } : undefined,
  root: 'src/renderer',
  build: {
    outDir: '../../dist',
    emptyOutDir: true
  }
}))
