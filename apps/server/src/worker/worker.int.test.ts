import { randomBytes } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { TargetUnavailableError } from '@senv/core';
import { MemoryTargetProvider } from '@senv/target-testkit';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Keyring } from '../crypto/envelope.js';
import { JobsService } from '../jobs/jobs-service.js';
import { ProjectsService } from '../projects/projects-service.js';
import { PublishService } from '../publishing/publish-service.js';
import { SnapshotService } from '../snapshots/snapshot-service.js';
import { InMemorySnapshotStore } from '../storage/in-memory-snapshot-store.js';
import { ConnectionsService } from '../targets/connections-service.js';
import { MappingsService } from '../targets/mappings-service.js';
import { SyncScheduler } from '../targets/sync-scheduler.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { createTestUser } from '../testing/users.js';
import { CleanupTask } from './cleanup.task.js';
import { createWorker } from './create-worker.js';
import { DriftTask } from './drift.task.js';
import { SyncJobTask } from './sync-job.task.js';

const prisma = createTestPrisma();
const NOW = new Date('2026-10-07T09:00:00.000Z');
const expired = new Date(NOW.getTime() - 1000);

const keyring: Keyring = { currentKekId: 'kek-1', keks: new Map([['kek-1', randomBytes(32)]]) };

let worker: INestApplicationContext;
let store: InMemorySnapshotStore;
let memory: MemoryTargetProvider;

beforeEach(async () => {
  await resetDatabase(prisma);
  store = new InMemorySnapshotStore();
  memory = new MemoryTargetProvider({ resources: [{ id: 'app-api', name: 'stream-api' }] });
  worker = await createWorker({
    prisma,
    snapshotStore: store,
    keyring,
    targetProviders: [memory],
    now: () => NOW,
    logger: false,
  });
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

  it('2초마다 동기화 작업을, 1시간마다 드리프트를 확인하도록 등록한다', () => {
    const registry = worker.get(SchedulerRegistry);
    expect(registry.getInterval('target-jobs')).toBeDefined();
    const [first] = registry
      .getCronJob('target-drift')
      .nextDates(1)
      .map((date) => date.toJSDate());
    expect(first?.getMinutes()).toBe(0);
  });
});

describe('worker 배포 대상 동기화', () => {
  /** api가 게시하면서 등록한 작업을 흉내 낸다 (같은 저장소·KEK) */
  async function publishedWithMapping() {
    // 자동 실행과 겹치지 않게 테스트에서는 직접 돌린다
    worker.get(SchedulerRegistry).deleteInterval('target-jobs');
    const connections = worker.get(ConnectionsService);
    const { id: connectionId } = await connections.create(
      { name: 'main', type: 'memory', config: { token: 'test-token' } },
      'u1',
    );
    const projects = new ProjectsService(prisma);
    await projects.create({ name: 'server' });
    await projects.ensureSharedProject();
    const mapping = await worker
      .get(MappingsService)
      .create('server', { connectionId, env: 'production', resourceId: 'app-api' });
    const api = new PublishService(
      prisma,
      new SnapshotService(store, keyring),
      () => NOW,
      new SyncScheduler(new JobsService(prisma, () => NOW)),
    );
    await api.publish({
      project: 'server',
      env: 'production',
      baseVersion: 0,
      changes: { set: { A: '1' } },
      actor: 'u1',
    });
    return mapping.id;
  }

  it('게시로 등록된 작업을 처리해 원격에 반영하고 작업을 끝낸다', async () => {
    const mappingId = await publishedWithMapping();

    expect(await worker.get(SyncJobTask).tick()).toBe(1);

    expect(memory.variablesOf('app-api')).toEqual({ A: '1' });
    expect(await prisma.job.findFirstOrThrow()).toMatchObject({ status: 'done' });
    expect(await prisma.syncRun.findFirstOrThrow()).toMatchObject({
      mappingId,
      trigger: 'publish',
      status: 'succeeded',
    });
  });

  it('제공자가 실패하면 작업을 뒤로 미룬다 (재시도)', async () => {
    await publishedWithMapping();
    memory.failNext(new TargetUnavailableError('Coolify 오류 (502)'));

    await worker.get(SyncJobTask).tick();

    expect(await prisma.job.findFirstOrThrow()).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'Coolify 오류 (502)',
    });
  });

  it('드리프트 점검은 동기화한 적 있는 매핑을 모두 확인한다', async () => {
    await publishedWithMapping();
    await worker.get(SyncJobTask).tick();
    memory.seed('app-api', { A: 'changed' });

    expect(await worker.get(DriftTask).run()).toEqual({
      ran: true,
      result: { checked: 1, drifted: 1 },
    });
  });
});
