import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  // esbuild는 데코레이터 메타데이터를 만들지 못해 Nest DI가 동작하지 않으므로 SWC로 변환한다
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
