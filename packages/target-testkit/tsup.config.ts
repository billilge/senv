import { defineConfig } from 'tsup';

// 제공자 패키지와 서버 테스트가 쓰는 도구 (ESM만)
export default defineConfig({
  // 계약 테스트(vitest를 씀)는 따로 내보내서, 메모리 제공자만 쓰는 곳이 vitest를 불러오지 않게 한다
  entry: ['src/index.ts', 'src/contract.ts'],
  format: ['esm'],
  // tsup의 d.ts 빌드가 내부적으로 baseUrl을 넣는데, TypeScript 6에서 deprecated라 이 빌드에서만 경고를 끈다
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  external: ['vitest'],
  clean: true,
  sourcemap: true,
});
