import { randomBytes } from 'node:crypto';
import { MemoryTargetProvider } from '@senv/target-testkit';
import { createApp } from '../app/create-app.js';
import { SessionService } from '../auth/session-service.js';
import type { ServerConfig } from '../config/server-config.js';
import { createPrismaClient } from '../database/prisma.js';
import { InMemorySnapshotStore } from '../storage/in-memory-snapshot-store.js';
import { FakeGitHubClient } from './fake-github.js';

/**
 * 브라우저 E2E용 서버 (결정 57). 프로덕션 빌드·이미지에는 들어가지 않는다 (build:e2e로만 만든다).
 * 저장소는 메모리, GitHub는 가짜, 배포 대상은 메모리 제공자다. 관리자 세션을 하나 만들어
 * 준비되면 표준 출력에 한 줄 JSON으로 알린다.
 */
const databaseUrl = process.env.DATABASE_URL;
const dashboardDir = process.env.DASHBOARD_DIR;
const port = Number(process.env.PORT ?? 0);
if (!databaseUrl || !dashboardDir || !port) {
  throw new Error('DATABASE_URL, DASHBOARD_DIR, PORT가 필요합니다');
}

const appUrl = `http://localhost:${port}`;
const config: ServerConfig = {
  port,
  appUrl,
  databaseUrl,
  storage: { endpoint: 'http://unused', accessKeyId: 'x', secretAccessKey: 'x', bucket: 'x' },
  keyring: { currentKekId: 'kek-e2e', keks: new Map([['kek-e2e', randomBytes(32)]]) },
  sessionSecret: randomBytes(32).toString('hex'),
  github: { clientId: 'e2e', clientSecret: 'e2e', org: 'billilge' },
  bootstrapAdmins: [],
  trustProxyHops: 0,
};
const prisma = createPrismaClient(databaseUrl);
const app = await createApp(
  {
    config,
    prisma,
    snapshotStore: new InMemorySnapshotStore(),
    github: new FakeGitHubClient(),
    dashboardDir,
    targetProviders: [
      new MemoryTargetProvider({
        resources: [
          { id: 'app-web-local', name: 'stream-web-local' },
          { id: 'app-web-prod', name: 'stream-web-prod' },
        ],
      }),
    ],
  },
  { logger: false },
);
await app.listen(port, '127.0.0.1');

const admin = await prisma.user.create({
  data: { githubId: '1', login: 'alice', name: 'Alice', role: 'admin', status: 'active' },
});
const { token } = await app.get(SessionService).create(admin.id);
console.log(JSON.stringify({ ready: true, url: appUrl, sessionToken: token }));
