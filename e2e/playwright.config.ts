import { defineConfig } from '@playwright/test';

/**
 * 브라우저 E2E (결정 34·57). browser/run.ts가 서버를 띄운 뒤 이 설정으로 Playwright를 돌린다.
 * 로컬은 설치된 Chrome을 써서 브라우저를 내려받지 않고, CI(CI=true)는 받아 둔 Chromium을 쓴다.
 */
export default defineConfig({
  testDir: './browser',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    ...(process.env.CI ? {} : { channel: 'chrome' }),
    storageState: './browser/.auth/admin.json',
    locale: 'ko-KR',
    trace: 'retain-on-failure',
  },
});
