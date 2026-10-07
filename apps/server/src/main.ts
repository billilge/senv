import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { createApp } from './app/create-app.js';
import { HttpGitHubClient } from './auth/http-github-client.js';
import { loadServerConfig } from './config/server-config.js';
import { createPrismaClient } from './database/prisma.js';
import { S3SnapshotStore } from './storage/s3-snapshot-store.js';

// 설정이 틀리면 ConfigError로 기동을 멈춘다 (변수 이름만 보여주고 값은 보여주지 않는다)
const config = loadServerConfig(process.env);

// 모노레포 구조 그대로: apps/server/dist/main.js → apps/dashboard/dist (이미지도 같은 구조)
const dashboardDir = fileURLToPath(new URL('../../dashboard/dist/', import.meta.url));
const hasDashboard = existsSync(join(dashboardDir, 'index.html'));

const app = await createApp({
  config,
  prisma: createPrismaClient(config.databaseUrl),
  snapshotStore: new S3SnapshotStore(config.storage),
  github: new HttpGitHubClient(config.github.clientId, config.github.clientSecret),
  dashboardDir: hasDashboard ? dashboardDir : undefined,
});
if (!hasDashboard) {
  new Logger('Dashboard').warn(`대시보드 빌드가 없어 API만 엽니다: ${dashboardDir}`);
}
app.enableShutdownHooks();
await app.listen(config.port);
