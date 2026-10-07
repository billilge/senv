import { defineConfig } from 'tsup';

// Coolify 배포 대상 제공자 (ESM만)
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // tsup의 d.ts 빌드가 내부적으로 baseUrl을 넣는데, TypeScript 6에서 deprecated라 이 빌드에서만 경고를 끈다
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: true,
});
