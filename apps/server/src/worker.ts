import { loadWorkerConfig } from './config/server-config.js';
import { createPrismaClient } from './database/prisma.js';
import { createWorker } from './worker/create-worker.js';

// 설정이 틀리면 ConfigError로 기동을 멈춘다 (변수 이름만 보여주고 값은 보여주지 않는다)
const config = loadWorkerConfig(process.env);

const worker = await createWorker({ prisma: createPrismaClient(config.databaseUrl) });
worker.enableShutdownHooks();
