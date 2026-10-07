import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 개발 중에는 API·로그인 요청을 Nest 서버(3000)로 넘겨 같은 출처처럼 쓴다 (쿠키 세션)
const server = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': server, '/auth': server, '/healthz': server },
  },
  build: { outDir: 'dist' },
});
