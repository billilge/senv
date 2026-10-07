import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type WorkerDependencies, WorkerModule } from './worker.module.js';

export async function createWorker(
  deps: WorkerDependencies & { logger?: false },
): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(WorkerModule.register(deps), {
    logger: deps.logger === false ? false : ['error', 'warn', 'log'],
  });
}
