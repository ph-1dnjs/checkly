import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Electron의 file:// 로드에서도 번들을 찾도록 상대 자산 경로를 사용한다.
  base: './',
  plugins: [react()],
  root: 'src/renderer',
  build: {
    outDir: '../../dist',
    emptyOutDir: true
  }
})
