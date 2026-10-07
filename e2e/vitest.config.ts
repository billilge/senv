import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 서버 코드(Nest 데코레이터)를 함께 불러오므로 SWC로 변환한다
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.e2e.test.ts'],
    globalSetup: ['../apps/server/src/testing/mysql.global-setup.ts'],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
