import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { JobsService } from './jobs-service.js';

const prisma = createTestPrisma();
const T0 = new Date('2026-10-08T09:00:00.000Z');
const SECOND = 1000;

let now: Date;
let jobs: JobsService;

beforeEach(async () => {
  await resetDatabase(prisma);
  now = T0;
  jobs = new JobsService(prisma, () => now);
});
afterAll(() => prisma.$disconnect());

const at = (ms: number) => {
  now = new Date(T0.getTime() + ms);
};

describe('JobsService', () => {
  it('등록한 작업을 가져가면 실행 중이 되고, 다른 쪽은 같은 작업을 가져가지 못한다', async () => {
    await jobs.enqueue(prisma, { type: 'target.sync', payload: { mappingId: 'm1' } });

    const claimed = await jobs.claim();
    expect(claimed).toMatchObject({
      type: 'target.sync',
      payload: { mappingId: 'm1' },
      attempts: 1,
    });
    expect(await jobs.claim()).toBeNull();
    expect(await prisma.job.findFirstOrThrow()).toMatchObject({ status: 'running' });
  });

  it('동시에 가져가도 서로 다른 작업을 가져간다 (SKIP LOCKED)', async () => {
    await jobs.enqueue(prisma, { type: 't', payload: { n: 1 } });
    await jobs.enqueue(prisma, { type: 't', payload: { n: 2 } });

    const [a, b] = await Promise.all([jobs.claim(), jobs.claim()]);
    expect(a && b && a.id !== b.id).toBe(true);
  });

  it('같은 키로 다시 등록하면 대기 중인 이전 작업을 대체한다', async () => {
    await jobs.enqueue(prisma, { type: 't', payload: { v: 1 }, dedupeKey: 'sync:m1' });
    await jobs.enqueue(prisma, { type: 't', payload: { v: 2 }, dedupeKey: 'sync:m1' });

    const pending = await prisma.job.findMany();
    expect(pending.map((job) => JSON.parse(job.payload))).toEqual([{ v: 2 }]);
  });

  it('실패하면 10초·20초 뒤로 미뤄 다시 하고, 세 번째 실패에서 멈춘다', async () => {
    await jobs.enqueue(prisma, { type: 't', payload: {} });

    const first = await jobs.claim();
    await jobs.fail(first?.id ?? '', new Error('Coolify 오류'));
    expect(await jobs.claim()).toBeNull();
    at(10 * SECOND);
    const second = await jobs.claim();
    expect(second?.attempts).toBe(2);
    await jobs.fail(second?.id ?? '', new Error('Coolify 오류'));
    at(30 * SECOND);
    const third = await jobs.claim();
    await jobs.fail(third?.id ?? '', new Error('끝내 실패'));

    expect(await prisma.job.findFirstOrThrow()).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: '끝내 실패',
    });
  });

  it('성공하면 done이다', async () => {
    await jobs.enqueue(prisma, { type: 't', payload: {} });
    const job = await jobs.claim();
    await jobs.complete(job?.id ?? '');
    expect(await prisma.job.findFirstOrThrow()).toMatchObject({ status: 'done' });
  });

  it('실행 중에 worker가 죽어 잠금 시간이 지난 작업은 다시 대기로 돌린다', async () => {
    await jobs.enqueue(prisma, { type: 't', payload: {} });
    await jobs.claim();
    at(61 * SECOND);
    expect(await jobs.recoverStale()).toBe(1);
    expect(await jobs.claim()).toMatchObject({ attempts: 2 });
  });
});
