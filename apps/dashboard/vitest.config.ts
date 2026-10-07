import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3000' } },
    setupFiles: ['./src/testing/setup.ts'],
    // Primer는 CSS 모듈을 쓴다. 테스트에서는 클래스 이름만 있으면 된다
    css: { modules: { classNameStrategy: 'non-scoped' } },
    // Primer 패키지는 안에서 CSS를 불러오므로 Node에 바로 넘기지 않고 Vite가 처리하게 한다
    server: { deps: { inline: [/@primer\//] } },
  },
});
