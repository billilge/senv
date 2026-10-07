import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// 개발 중에는 API·로그인 요청을 Nest 서버(3000)로 넘겨 같은 출처처럼 쓴다 (쿠키 세션)
const server = 'http://localhost:3000';

/** 목업 모드: GitHub 로그인 대신 바로 로그인한 것으로 돌려보낸다 (src/mock/start-mock.tsx) */
function mockLogin(): Plugin {
  return {
    name: 'senv-mock-login',
    configureServer(dev) {
      dev.middlewares.use('/auth/github', (req, res) => {
        const next = new URL(req.url ?? '/', 'http://localhost').searchParams.get('next') ?? '/';
        res.statusCode = 302;
        res.setHeader('Location', `/__mock/login?next=${encodeURIComponent(next)}`);
        res.end();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const mock = mode === 'mock';
  return {
    plugins: mock ? [react(), mockLogin()] : [react()],
    server: {
      port: 5173,
      ...(mock ? {} : { proxy: { '/api': server, '/auth': server, '/healthz': server } }),
    },
    build: { outDir: 'dist' },
  };
});
