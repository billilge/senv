import { defineConfig } from 'tsup';

// 서버(NestJS)는 CommonJS, 대시보드·CLI는 ESM이라 두 형식을 함께 내보낸다
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // tsup의 d.ts 빌드가 내부적으로 baseUrl을 넣는데, TypeScript 6에서 deprecated라 이 빌드에서만 경고를 끈다
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: true,
});
