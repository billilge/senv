import { createApp } from './app/create-app.js';
import { HttpGitHubClient } from './auth/http-github-client.js';
import { loadServerConfig } from './config/server-config.js';
import { createPrismaClient } from './database/prisma.js';
import { S3SnapshotStore } from './storage/s3-snapshot-store.js';

// 설정이 틀리면 ConfigError로 기동을 멈춘다 (변수 이름만 보여주고 값은 보여주지 않는다)
const config = loadServerConfig(process.env);

const app = await createApp({
  config,
  prisma: createPrismaClient(config.databaseUrl),
  snapshotStore: new S3SnapshotStore(config.storage),
  github: new HttpGitHubClient(config.github.clientId, config.github.clientSecret),
});
app.enableShutdownHooks();
await app.listen(config.port);
