import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  // 워크스페이스 패키지(@senv/*)는 배포본에 함께 묶는다. 키체인 같은 네이티브 모듈은 dependencies로 둔다
  noExternal: [/^@senv\//],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
});
