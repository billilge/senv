import type { INestApplicationContext } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { createTestUser } from '../testing/users.js';
import { CleanupTask } from './cleanup.task.js';
import { createWorker } from './create-worker.js';

const prisma = createTestPrisma();
const NOW = new Date('2026-10-07T09:00:00.000Z');
const expired = new Date(NOW.getTime() - 1000);

let worker: INestApplicationContext;

beforeEach(async () => {
  await resetDatabase(prisma);
  worker = await createWorker({ prisma, now: () => NOW, logger: false });
});
afterEach(() => worker.close());
afterAll(() => prisma.$disconnect());

describe('worker', () => {
  it('만료 기록 정리를 1시간마다 하도록 등록한다', () => {
    const job = worker.get(SchedulerRegistry).getCronJob('cleanup-expired');
    const [first, second] = job.nextDates(2).map((date) => date.toJSDate());
    expect(first?.getMinutes()).toBe(0);
    expect(first?.getSeconds()).toBe(0);
    expect((second?.getTime() ?? 0) - (first?.getTime() ?? 0)).toBe(60 * 60 * 1000);
  });

  it('정리 작업은 잠금을 얻어 만료된 기록을 지운다', async () => {
    const user = await createTestUser(prisma);
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: 'a'.repeat(64),
        createdAt: expired,
        lastUsedAt: expired,
        expiresAt: expired,
      },
    });

    expect(await worker.get(CleanupTask).run()).toEqual({
      ran: true,
      result: { sessions: 1, apiTokens: 0, deviceCodes: 0 },
    });
    expect(await prisma.session.count()).toBe(0);
  });
});
