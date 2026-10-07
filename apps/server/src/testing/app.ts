import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { inject } from 'vitest';
import { createApp } from '../app/create-app.js';
import { ApiTokenService } from '../auth/api-token-service.js';
import type { ServerConfig } from '../config/server-config.js';
import { InMemorySnapshotStore } from '../storage/in-memory-snapshot-store.js';
import { createTestPrisma } from './database.js';
import { FakeGitHubClient } from './fake-github.js';
import { createTestUser } from './users.js';

export const TEST_APP_URL = 'http://localhost:3000';

/** 테스트용 의존성(실제 MySQL, 메모리 저장소, 가짜 GitHub)으로 HTTP 앱을 띄운다 */
export async function createTestApp(
  options: { now?: () => Date; bootstrapAdmins?: string[] } = {},
) {
  const prisma = createTestPrisma();
  const github = new FakeGitHubClient();
  const store = new InMemorySnapshotStore();
  const config: ServerConfig = {
    port: 0,
    appUrl: TEST_APP_URL,
    databaseUrl: inject('databaseUrl'),
    storage: { endpoint: 'http://unused', accessKeyId: 'x', secretAccessKey: 'x', bucket: 'x' },
    keyring: { currentKekId: 'kek-test', keks: new Map([['kek-test', randomBytes(32)]]) },
    sessionSecret: 'x'.repeat(32),
    github: { clientId: 'test-client-id', clientSecret: 'test-client-secret', org: 'billilge' },
    bootstrapAdmins: options.bootstrapAdmins ?? ['admin'],
  };

  const app: INestApplication = await createApp(
    { config, prisma, snapshotStore: store, github, now: options.now },
    { logger: false },
  );
  await app.init();

  return {
    app,
    http: () => request(app.getHttpServer()),
    prisma,
    github,
    store,
    config,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** 테스트 사용자를 만들고 CLI처럼 Bearer 토큰으로 인증하는 헤더를 돌려준다 */
export async function signIn(
  t: TestApp,
  overrides: Parameters<typeof createTestUser>[1] = {},
): Promise<{ userId: string; auth: { Authorization: string } }> {
  const user = await createTestUser(t.prisma, overrides);
  const { accessToken } = await t.app.get(ApiTokenService).issuePair(user.id);
  return { userId: user.id, auth: { Authorization: `Bearer ${accessToken}` } };
}
